use std::ffi::OsStr;
use std::io::{self, Read};
use std::process::Command;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Create a background helper command without flashing a console window.
///
/// Aelyris is a GUI app, so short-lived helpers such as `where.exe`, `git.exe`,
/// `gh.exe`, and language servers must not borrow the foreground with a black
/// console window while panes or files are opening.
pub fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    hide_window(&mut command);
    command
}

pub fn hide_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[derive(Debug, Clone)]
pub struct SupervisedCommandConfig {
    pub deadline: Duration,
    pub output_limit_bytes: usize,
    pub cancellation: Option<Arc<AtomicBool>>,
}

impl Default for SupervisedCommandConfig {
    fn default() -> Self {
        Self {
            deadline: Duration::from_secs(10 * 60),
            output_limit_bytes: 1024 * 1024,
            cancellation: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupervisedCommandStatus {
    Exited,
    TimedOut,
    Cancelled,
}

#[derive(Debug)]
pub struct SupervisedCommandOutput {
    pub status: SupervisedCommandStatus,
    pub exit_code: Option<i32>,
    pub stdout_tail: Vec<u8>,
    pub stderr_tail: Vec<u8>,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub duration: Duration,
}

/// Run a non-interactive child with one bounded lifecycle contract.
///
/// Both output pipes are drained concurrently so a flooding child cannot block on a
/// full OS pipe. Only the final configured number of bytes is retained. Timeout and
/// cancellation terminate the process tree before the reader threads are joined.
pub fn run_supervised(
    command: &mut Command,
    config: &SupervisedCommandConfig,
) -> io::Result<SupervisedCommandOutput> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = command.spawn()?;
    guard_child_against_orphan(child.id());
    let stdout = child.stdout.take().expect("piped stdout must exist");
    let stderr = child.stderr.take().expect("piped stderr must exist");
    let limit = config.output_limit_bytes;
    let stdout_reader = thread::spawn(move || read_tail(stdout, limit));
    let stderr_reader = thread::spawn(move || read_tail(stderr, limit));

    let (status, exit_code) = loop {
        if let Some(exit) = child.try_wait()? {
            break (SupervisedCommandStatus::Exited, exit.code());
        }
        if config
            .cancellation
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::Acquire))
        {
            terminate_child_tree(&mut child);
            break (
                SupervisedCommandStatus::Cancelled,
                child.wait().ok().and_then(|exit| exit.code()),
            );
        }
        if started.elapsed() >= config.deadline {
            terminate_child_tree(&mut child);
            break (
                SupervisedCommandStatus::TimedOut,
                child.wait().ok().and_then(|exit| exit.code()),
            );
        }
        thread::sleep(Duration::from_millis(10));
    };

    let (stdout_tail, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| io::Error::other("supervised stdout reader panicked"))??;
    let (stderr_tail, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| io::Error::other("supervised stderr reader panicked"))??;
    Ok(SupervisedCommandOutput {
        status,
        exit_code,
        stdout_tail,
        stderr_tail,
        stdout_truncated,
        stderr_truncated,
        duration: started.elapsed(),
    })
}

fn read_tail(mut reader: impl Read, limit: usize) -> io::Result<(Vec<u8>, bool)> {
    let mut tail = Vec::with_capacity(limit.min(64 * 1024));
    let mut truncated = false;
    let mut chunk = [0_u8; 8192];
    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        if limit == 0 {
            truncated = true;
            continue;
        }
        if read >= limit {
            tail.clear();
            tail.extend_from_slice(&chunk[read - limit..read]);
            truncated = true;
            continue;
        }
        let overflow = tail.len().saturating_add(read).saturating_sub(limit);
        if overflow > 0 {
            tail.drain(..overflow);
            truncated = true;
        }
        tail.extend_from_slice(&chunk[..read]);
    }
    Ok((tail, truncated))
}

fn terminate_child_tree(child: &mut std::process::Child) {
    terminate_process_tree(child.id());
    let _ = child.kill();
}

/// Best-effort terminate a child and its descendants by PID. Callers still own
/// and must reap their direct `Child` handle after this returns.
pub(crate) fn terminate_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = hidden_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

/// Guarantee a spawned child process can never become an orphan ("zombie") that
/// outlives this process. On Windows the child is assigned to a process-global
/// Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: when THIS
/// process exits — cleanly OR on an abnormal crash (e.g. a WebView2
/// STATUS_ACCESS_VIOLATION, where no Rust `Drop`/shutdown code runs) — the OS
/// closes the last job handle and terminates every member. Graceful
/// `taskkill /T /F` paths still run on clean shutdown; this is the crash-proof
/// backstop they cannot provide.
///
/// Used for every PTY child (so agent CLIs/shells die with the app or sidecar)
/// and for the PTY sidecar itself (so an app crash cascades: app dies → its job
/// kills the sidecar → the sidecar's own job kills its agent children).
///
/// Best-effort and never fatal: a failure (e.g. the child already belongs to a
/// job that forbids nesting) just leaves that child to the graceful kill paths.
pub fn guard_child_against_orphan(pid: u32) {
    #[cfg(windows)]
    job::assign(pid);
    #[cfg(not(windows))]
    {
        // No portable equivalent; POSIX would use a process group / prctl
        // PR_SET_PDEATHSIG. Aelyris targets Windows, so this is a documented no-op.
        let _ = pid;
    }
}

#[cfg(windows)]
mod job {
    use std::sync::OnceLock;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// Owns the process-global job handle for the lifetime of the process. It is
    /// intentionally never closed by us — the OS closing it at process exit is
    /// exactly the trigger that kills the members. Raw `HANDLE` is not `Send`/
    /// `Sync`, but a job handle is a process-wide kernel object we only ever read.
    struct Job(HANDLE);
    // SAFETY: a job `HANDLE` is a process-wide kernel object. We store it once in a
    // `OnceLock` (initialization is serialized) and only ever pass it by value to
    // `AssignProcessToJobObject` / `IsProcessInJob`, which are thread-safe by Windows
    // design. We never mutate through it and never close it, so sharing it across
    // threads cannot create a data race or a use-after-close.
    unsafe impl Send for Job {}
    // SAFETY: see the `Send` impl above — the handle is read-only and the Win32 calls
    // that consume it are internally synchronized by the kernel.
    unsafe impl Sync for Job {}

    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    fn handle() -> Option<HANDLE> {
        JOB.get_or_init(create).as_ref().map(|job| job.0)
    }

    fn create() -> Option<Job> {
        // SAFETY: `CreateJobObjectW`/`SetInformationJobObject` are FFI calls. The
        // `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` is fully initialized and outlives the
        // call; its size is passed exactly. On any error we close the handle we own
        // (`CloseHandle(job)`) before returning, so no handle is leaked.
        unsafe {
            let job = match CreateJobObjectW(None, PCWSTR::null()) {
                Ok(handle) => handle,
                Err(err) => {
                    log::warn!("no-orphan job: CreateJobObject failed: {err}");
                    return None;
                }
            };
            let info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                BasicLimitInformation:
                    windows::Win32::System::JobObjects::JOBOBJECT_BASIC_LIMIT_INFORMATION {
                        LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                        ..Default::default()
                    },
                ..Default::default()
            };
            if let Err(err) = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) {
                log::warn!("no-orphan job: SetInformationJobObject failed: {err}");
                let _ = CloseHandle(job);
                return None;
            }
            log::debug!("no-orphan job created (kill-on-close)");
            Some(Job(job))
        }
    }

    pub fn assign(pid: u32) {
        let Some(job) = handle() else {
            return;
        };
        // SAFETY: `OpenProcess` returns an owned handle on `Ok`, which we pass to
        // `AssignProcessToJobObject` and then close exactly once with `CloseHandle`
        // on every path. `job` is the process-global handle that lives for the whole
        // process, so it is valid for the duration of the assign. The assign happens
        // AFTER `CreateProcessW`, so a host crash in that (small) window can leave the
        // child unguarded — see the spawn-site note; the ConPTY path cannot eliminate
        // this window without vendoring portable-pty.
        unsafe {
            match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                Ok(process) => {
                    if let Err(err) = AssignProcessToJobObject(job, process) {
                        // Rare: Win8+ allows nested jobs, so even ConPTY children
                        // normally assign fine — verified by the membership test
                        // pty::manager::tests::conpty_child_is_assigned_to_the_
                        // kill_on_close_job. A genuine failure (a truly non-nestable
                        // job, e.g. an enterprise GPO-imposed outer job) falls back to
                        // the graceful kill paths — not a leak source by itself, but
                        // it silently weakens the crash backstop, so warn (not debug)
                        // so an operator can see the degraded state.
                        log::warn!("no-orphan job: assign pid={pid} failed: {err}");
                    }
                    let _ = CloseHandle(process);
                }
                Err(err) => {
                    log::warn!("no-orphan job: OpenProcess pid={pid} failed: {err}");
                }
            }
        }
    }

    /// Test-only: is the process-global kill-on-close job available?
    #[cfg(test)]
    pub fn is_available() -> bool {
        handle().is_some()
    }

    /// Test-only: is `pid` an actual MEMBER of the kill-on-close job? Returns
    /// None if the job is unavailable or the membership query itself failed.
    /// Lets tests prove `assign` truly added the child (not merely that it did
    /// not panic), including for ConPTY children whose own job could in theory
    /// block nested assignment.
    #[cfg(test)]
    pub fn is_member(pid: u32) -> Option<bool> {
        use windows::core::BOOL;
        use windows::Win32::System::JobObjects::IsProcessInJob;
        use windows::Win32::System::Threading::PROCESS_QUERY_INFORMATION;
        let job = handle()?;
        // SAFETY: `OpenProcess` yields an owned handle on `Ok` which we close exactly
        // once with `CloseHandle` after the query. `result` is a stack `BOOL` written
        // by `IsProcessInJob`; `job` is the long-lived process-global handle. Test-only.
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid).ok()?;
            let mut result = BOOL(0);
            let query = IsProcessInJob(process, Some(job), &mut result);
            let _ = CloseHandle(process);
            query.ok()?;
            Some(result.as_bool())
        }
    }
}

/// Test-only (Windows): is `pid` actually a member of the process-global
/// kill-on-close Job Object? Lets tests bind the no-orphan guard across BOTH
/// spawn backends — the direct `std::process` spawn (headless agent path) and
/// ConPTY children via `PtyManager` — instead of only asserting no panic.
#[cfg(all(test, windows))]
pub fn is_orphan_guarded(pid: u32) -> Option<bool> {
    job::is_member(pid)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn no_orphan_job_initializes_and_assigns_a_real_child() {
        // The process-global kill-on-close job is created on first use.
        assert!(job::is_available(), "kill-on-close job should be creatable");

        // Exercise the OpenProcess + AssignProcessToJobObject path on a real
        // child we own. The actual orphan-termination fires when the HOST
        // process exits (proven by live verification, not unit-testable in
        // a single process), but this guards the syscall wiring from regressing.
        let mut child = std::process::Command::new("cmd")
            .args(["/c", "ping", "-n", "3", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn sleeper child");
        // Must not panic regardless of whether the child was already in a job.
        guard_child_against_orphan(child.id());
        // And it must actually be a MEMBER now (binds the direct-spawn path used
        // by the headless agent CLI), not merely "did not panic".
        assert_eq!(
            job::is_member(child.id()),
            Some(true),
            "a directly-spawned child must be a member of the kill-on-close job"
        );
        let _ = child.kill();
        let _ = child.wait();
    }

    fn cmd(script: &str) -> Command {
        let mut command = hidden_command("cmd");
        command.args(["/C", script]);
        command
    }

    #[test]
    fn supervised_command_preserves_normal_exit_and_output() {
        let output = run_supervised(
            &mut cmd("echo out & echo err 1>&2 & exit /b 7"),
            &SupervisedCommandConfig::default(),
        )
        .unwrap();
        assert_eq!(output.status, SupervisedCommandStatus::Exited);
        assert_eq!(output.exit_code, Some(7));
        assert!(String::from_utf8_lossy(&output.stdout_tail).contains("out"));
        assert!(String::from_utf8_lossy(&output.stderr_tail).contains("err"));
    }

    #[test]
    fn supervised_command_times_out_a_hung_child() {
        let output = run_supervised(
            &mut cmd("ping -n 30 127.0.0.1 >nul"),
            &SupervisedCommandConfig {
                deadline: Duration::from_millis(50),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(output.status, SupervisedCommandStatus::TimedOut);
        assert!(output.duration < Duration::from_secs(5));
    }

    #[test]
    fn supervised_command_reports_cancellation_distinctly() {
        let cancellation = Arc::new(AtomicBool::new(false));
        let setter = cancellation.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            setter.store(true, Ordering::Release);
        });
        let output = run_supervised(
            &mut cmd("ping -n 30 127.0.0.1 >nul"),
            &SupervisedCommandConfig {
                deadline: Duration::from_secs(5),
                cancellation: Some(cancellation),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(output.status, SupervisedCommandStatus::Cancelled);
    }

    #[test]
    fn supervised_command_drains_flood_and_retains_only_tail() {
        let output = run_supervised(
            &mut cmd("for /L %i in (1,1,5000) do @echo 0123456789abcdef"),
            &SupervisedCommandConfig {
                output_limit_bytes: 257,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(output.status, SupervisedCommandStatus::Exited);
        assert_eq!(output.stdout_tail.len(), 257);
        assert!(output.stdout_truncated);
    }
}
