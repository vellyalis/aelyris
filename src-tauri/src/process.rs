use std::ffi::OsStr;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Create a background helper command without flashing a console window.
///
/// Aether is a GUI app, so short-lived helpers such as `where.exe`, `git.exe`,
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
        // PR_SET_PDEATHSIG. Aether targets Windows, so this is a documented no-op.
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
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    fn handle() -> Option<HANDLE> {
        JOB.get_or_init(create).as_ref().map(|job| job.0)
    }

    fn create() -> Option<Job> {
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
        unsafe {
            match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                Ok(process) => {
                    if let Err(err) = AssignProcessToJobObject(job, process) {
                        // Rare: Win8+ allows nested jobs, so even ConPTY children
                        // normally assign fine — verified by the membership test
                        // pty::manager::tests::conpty_child_is_assigned_to_the_
                        // kill_on_close_job. A genuine failure (a truly non-nestable
                        // job) just falls back to the graceful kill paths — not a
                        // leak source by itself.
                        log::debug!("no-orphan job: assign pid={pid} failed: {err}");
                    }
                    let _ = CloseHandle(process);
                }
                Err(err) => {
                    log::debug!("no-orphan job: OpenProcess pid={pid} failed: {err}");
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
}
