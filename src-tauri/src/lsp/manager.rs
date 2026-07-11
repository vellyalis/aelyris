use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, Weak};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::types::{LspLanguage, LspServerInfo};

const MAX_HEADER_LINE_BYTES: usize = 8 * 1024;
const MAX_HEADER_BLOCK_BYTES: usize = 32 * 1024;
const MAX_HEADER_COUNT: usize = 64;
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const STOP_TIMEOUT: Duration = Duration::from_secs(2);

/// A JSON-RPC message received from a language server.
#[derive(Debug, Clone)]
pub struct LspMessage {
    pub server_key: String,
    pub json: String,
}

struct ReaderLifecycle {
    handle: Option<JoinHandle<()>>,
    done: mpsc::Receiver<()>,
}

struct LspProcess {
    child: Mutex<Option<Child>>,
    reader: Mutex<ReaderLifecycle>,
    info: LspServerInfo,
}

enum LspSlot {
    Initializing,
    Ready(Arc<LspProcess>),
}

struct LspManagerInner {
    servers: Mutex<HashMap<String, LspSlot>>,
    sender: mpsc::Sender<LspMessage>,
}

impl Drop for LspManagerInner {
    fn drop(&mut self) {
        let handles = match self.servers.get_mut() {
            Ok(servers) => servers
                .drain()
                .filter_map(|(_, slot)| match slot {
                    LspSlot::Ready(process) => Some(process),
                    LspSlot::Initializing => None,
                })
                .collect::<Vec<_>>(),
            Err(_) => Vec::new(),
        };
        for process in handles {
            let _ = stop_process(&process, STOP_TIMEOUT);
        }
    }
}

/// Manages language server processes and relays bounded JSON-RPC messages.
/// Clones share one inner owner; dropping a temporary clone never stops servers.
#[derive(Clone)]
pub struct LspManager {
    inner: Arc<LspManagerInner>,
}

impl LspManager {
    pub fn new(sender: mpsc::Sender<LspMessage>) -> Self {
        Self {
            inner: Arc::new(LspManagerInner {
                servers: Mutex::new(HashMap::new()),
                sender,
            }),
        }
    }

    /// Start a language server for the given language and project root.
    pub fn start(&self, language: LspLanguage, root_path: &str) -> Result<LspServerInfo, String> {
        let key = format!("{:?}:{}", language, root_path);
        {
            let mut servers = self.lock_servers()?;
            if servers.contains_key(&key) {
                return Err(format!(
                    "LSP server already running or starting for {:?} at {}",
                    language, root_path
                ));
            }
            servers.insert(key.clone(), LspSlot::Initializing);
        }

        let constructed = (|| {
            let (cmd, args) = language.server_command();
            let mut child = crate::process::hidden_command(cmd)
                .args(&args)
                .current_dir(root_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("Failed to start {cmd}: {error}. Is it installed?"))?;
            crate::process::guard_child_against_orphan(child.id());

            let pid = child.id();
            let info = LspServerInfo {
                language: language.clone(),
                root_path: root_path.to_string(),
                pid,
            };
            let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
            let tx = self.inner.sender.clone();
            let event_key = key.clone();
            let manager = Arc::downgrade(&self.inner);
            let (done_tx, done_rx) = mpsc::channel();
            let handle = match std::thread::Builder::new()
                .name(format!("lsp-reader-{pid}"))
                .spawn(move || {
                    let result = read_lsp_messages(BufReader::new(stdout), &tx, &event_key);
                    if let Err(error) = result {
                        log::warn!("LSP reader {event_key} stopped: {error}");
                    }
                    retire_after_reader_exit(&manager, &event_key);
                    let _ = done_tx.send(());
                }) {
                Ok(handle) => handle,
                Err(error) => {
                    crate::process::terminate_process_tree(pid);
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Failed to spawn LSP reader: {error}"));
                }
            };
            Ok::<_, String>(Arc::new(LspProcess {
                child: Mutex::new(Some(child)),
                reader: Mutex::new(ReaderLifecycle {
                    handle: Some(handle),
                    done: done_rx,
                }),
                info,
            }))
        })();

        let process = match constructed {
            Ok(process) => process,
            Err(error) => {
                self.remove_initializing(&key);
                return Err(error);
            }
        };
        let mut servers = match self.lock_servers() {
            Ok(servers) => servers,
            Err(error) => {
                let _ = stop_process(&process, STOP_TIMEOUT);
                return Err(error);
            }
        };
        if !matches!(servers.get(&key), Some(LspSlot::Initializing)) {
            drop(servers);
            let _ = stop_process(&process, STOP_TIMEOUT);
            return Err(format!("LSP reservation cancelled for {key}"));
        }
        servers.insert(key, LspSlot::Ready(process.clone()));
        log::info!(
            "Started LSP server {:?} (PID {}) for {}",
            language,
            process.info.pid,
            root_path
        );
        Ok(process.info.clone())
    }

    /// Send a JSON-RPC message to a running language server.
    pub fn send(
        &self,
        language: &LspLanguage,
        root_path: &str,
        json_rpc: &str,
    ) -> Result<(), String> {
        if json_rpc.len() > MAX_BODY_BYTES {
            return Err(format!(
                "LSP outbound body exceeds limit: {} > {} bytes",
                json_rpc.len(),
                MAX_BODY_BYTES
            ));
        }
        let key = format!("{:?}:{}", language, root_path);
        let process = self.process_handle(&key)?;
        let mut child = process
            .child
            .lock()
            .map_err(|_| format!("LSP process lock poisoned: {key}"))?;
        let child = child
            .as_mut()
            .ok_or_else(|| format!("LSP server is stopping: {key}"))?;
        let stdin = child.stdin.as_mut().ok_or("stdin not available")?;
        let message = format!("Content-Length: {}\r\n\r\n{}", json_rpc.len(), json_rpc);
        stdin
            .write_all(message.as_bytes())
            .map_err(|error| format!("Write failed: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("Flush failed: {error}"))
    }

    /// Stop a language server with bounded child and reader cleanup.
    pub fn stop(&self, language: &LspLanguage, root_path: &str) -> Result<(), String> {
        let key = format!("{:?}:{}", language, root_path);
        let slot = self
            .lock_servers()?
            .remove(&key)
            .ok_or_else(|| format!("No LSP server for {:?} at {}", language, root_path))?;
        let LspSlot::Ready(process) = slot else {
            return Err(format!("LSP server is still initializing: {key}"));
        };
        stop_process(&process, STOP_TIMEOUT)?;
        log::info!("Stopped LSP server {:?} for {}", language, root_path);
        Ok(())
    }

    /// List running servers without holding the map lock across process locks.
    pub fn list(&self) -> Vec<LspServerInfo> {
        self.inner
            .servers
            .lock()
            .map(|servers| {
                servers
                    .values()
                    .filter_map(|slot| match slot {
                        LspSlot::Ready(process) => Some(process.info.clone()),
                        LspSlot::Initializing => None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Stop all servers after draining the map under a short lock.
    pub fn stop_all(&self) {
        let handles = match self.inner.servers.lock() {
            Ok(mut servers) => servers
                .drain()
                .filter_map(|(_, slot)| match slot {
                    LspSlot::Ready(process) => Some(process),
                    LspSlot::Initializing => None,
                })
                .collect::<Vec<_>>(),
            Err(_) => return,
        };
        for process in handles {
            if let Err(error) = stop_process(&process, STOP_TIMEOUT) {
                log::warn!("LSP stop-all cleanup failed: {error}");
            }
        }
    }

    fn lock_servers(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, LspSlot>>, String> {
        self.inner
            .servers
            .lock()
            .map_err(|_| "LSP server map lock poisoned".to_string())
    }

    fn process_handle(&self, key: &str) -> Result<Arc<LspProcess>, String> {
        match self.lock_servers()?.get(key) {
            Some(LspSlot::Ready(process)) => Ok(process.clone()),
            Some(LspSlot::Initializing) => Err(format!("LSP server is still initializing: {key}")),
            None => Err(format!("No LSP server: {key}")),
        }
    }

    fn remove_initializing(&self, key: &str) {
        if let Ok(mut servers) = self.inner.servers.lock() {
            if matches!(servers.get(key), Some(LspSlot::Initializing)) {
                servers.remove(key);
            }
        }
    }
}

fn stop_process(process: &LspProcess, timeout: Duration) -> Result<(), String> {
    let mut child = process
        .child
        .lock()
        .map_err(|_| "LSP process lock poisoned during stop".to_string())?
        .take();
    if let Some(child) = child.as_mut() {
        crate::process::terminate_process_tree(child.id());
        let _ = child.kill();
        let deadline = Instant::now() + timeout;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Ok(None) => return Err("LSP child did not exit before stop timeout".to_string()),
                Err(error) => return Err(format!("LSP child wait failed: {error}")),
            }
        }
    }

    let mut reader = process
        .reader
        .lock()
        .map_err(|_| "LSP reader lock poisoned during stop".to_string())?;
    if reader.handle.is_none() {
        return Ok(());
    }
    reader
        .done
        .recv_timeout(timeout)
        .map_err(|_| "LSP reader did not exit before stop timeout".to_string())?;
    if let Some(handle) = reader.handle.take() {
        handle
            .join()
            .map_err(|_| "LSP reader thread panicked".to_string())?;
    }
    Ok(())
}

fn retire_after_reader_exit(manager: &Weak<LspManagerInner>, key: &str) {
    let Some(manager) = manager.upgrade() else {
        return;
    };
    let process = match manager.servers.lock() {
        Ok(mut servers) => match servers.remove(key) {
            Some(LspSlot::Ready(process)) => Some(process),
            Some(LspSlot::Initializing) | None => None,
        },
        Err(_) => None,
    };
    let Some(process) = process else { return };
    let mut child = match process.child.lock() {
        Ok(mut child) => child.take(),
        Err(_) => None,
    };
    let Some(child) = child.as_mut() else { return };
    match child.try_wait() {
        Ok(Some(_)) => return,
        Ok(None) => {}
        Err(error) => {
            log::warn!("LSP reader retirement wait failed for {key}: {error}");
            return;
        }
    }
    crate::process::terminate_process_tree(child.id());
    let _ = child.kill();
    let deadline = Instant::now() + STOP_TIMEOUT;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                log::warn!("LSP reader retirement wait failed for {key}: {error}");
                return;
            }
        }
    }
    log::warn!("LSP reader retirement timed out for {key}");
}

#[derive(Debug, PartialEq, Eq)]
enum LspReadError {
    Io(String),
    HeaderLineTooLarge,
    HeaderBlockTooLarge,
    TooManyHeaders,
    MissingContentLength,
    DuplicateContentLength,
    InvalidContentLength,
    BodyTooLarge(usize),
    InvalidUtf8,
}

impl std::fmt::Display for LspReadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

/// Read LSP JSON-RPC messages with strict framing and allocation caps.
fn read_lsp_messages(
    mut reader: impl BufRead,
    tx: &mpsc::Sender<LspMessage>,
    server_key: &str,
) -> Result<(), LspReadError> {
    loop {
        let mut content_length = None;
        let mut header_bytes = 0usize;
        let mut header_count = 0usize;
        loop {
            let mut line = Vec::new();
            let read = read_bounded_line(&mut reader, &mut line, MAX_HEADER_LINE_BYTES)?;
            if read == 0 {
                return Ok(());
            }
            header_bytes = header_bytes.saturating_add(read);
            if header_bytes > MAX_HEADER_BLOCK_BYTES {
                return Err(LspReadError::HeaderBlockTooLarge);
            }
            if line == b"\r\n" || line == b"\n" {
                break;
            }
            header_count += 1;
            if header_count > MAX_HEADER_COUNT {
                return Err(LspReadError::TooManyHeaders);
            }
            let line = std::str::from_utf8(&line).map_err(|_| LspReadError::InvalidUtf8)?;
            let Some((name, value)) = line.trim().split_once(':') else {
                continue;
            };
            if name.eq_ignore_ascii_case("Content-Length") {
                if content_length.is_some() {
                    return Err(LspReadError::DuplicateContentLength);
                }
                let parsed = value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| LspReadError::InvalidContentLength)?;
                if parsed > MAX_BODY_BYTES {
                    return Err(LspReadError::BodyTooLarge(parsed));
                }
                content_length = Some(parsed);
            }
        }

        let content_length = content_length.ok_or(LspReadError::MissingContentLength)?;
        let mut body = vec![0u8; content_length];
        std::io::Read::read_exact(&mut reader, &mut body)
            .map_err(|error| LspReadError::Io(error.to_string()))?;
        let json = String::from_utf8(body).map_err(|_| LspReadError::InvalidUtf8)?;
        if tx
            .send(LspMessage {
                server_key: server_key.to_string(),
                json,
            })
            .is_err()
        {
            return Ok(());
        }
    }
}

fn read_bounded_line(
    reader: &mut impl BufRead,
    output: &mut Vec<u8>,
    limit: usize,
) -> Result<usize, LspReadError> {
    output.clear();
    loop {
        let available = reader
            .fill_buf()
            .map_err(|error| LspReadError::Io(error.to_string()))?;
        if available.is_empty() {
            return Ok(output.len());
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(available.len());
        if output.len().saturating_add(take) > limit {
            return Err(LspReadError::HeaderLineTooLarge);
        }
        let ended = available[..take].ends_with(b"\n");
        output.extend_from_slice(&available[..take]);
        reader.consume(take);
        if ended {
            return Ok(output.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn read_one(input: Vec<u8>) -> Result<LspMessage, LspReadError> {
        let (tx, rx) = mpsc::channel();
        read_lsp_messages(Cursor::new(input), &tx, "test")?;
        rx.try_recv()
            .map_err(|error| LspReadError::Io(error.to_string()))
    }

    #[test]
    fn framing_reads_a_valid_message() {
        let body = br#"{"jsonrpc":"2.0","id":1}"#;
        let input = format!("Content-Length: {}\r\n\r\n", body.len())
            .into_bytes()
            .into_iter()
            .chain(body.iter().copied())
            .collect();
        let message = read_one(input).unwrap();
        assert_eq!(message.server_key, "test");
        assert_eq!(message.json.as_bytes(), body);
    }

    #[test]
    fn framing_rejects_oversized_header_line_before_allocation_growth() {
        let input = format!("X-Test: {}\r\n\r\n", "x".repeat(MAX_HEADER_LINE_BYTES + 1));
        let (tx, _) = mpsc::channel();
        assert_eq!(
            read_lsp_messages(Cursor::new(input.into_bytes()), &tx, "test"),
            Err(LspReadError::HeaderLineTooLarge)
        );
    }

    #[test]
    fn framing_rejects_oversized_body_before_allocation() {
        let input = format!("Content-Length: {}\r\n\r\n", MAX_BODY_BYTES + 1);
        let (tx, _) = mpsc::channel();
        assert_eq!(
            read_lsp_messages(Cursor::new(input.into_bytes()), &tx, "test"),
            Err(LspReadError::BodyTooLarge(MAX_BODY_BYTES + 1))
        );
    }

    #[test]
    fn framing_rejects_duplicate_or_missing_length() {
        for (input, expected) in [
            (
                b"Content-Length: 1\r\nContent-Length: 1\r\n\r\nx".to_vec(),
                LspReadError::DuplicateContentLength,
            ),
            (
                b"Content-Type: application/json\r\n\r\n".to_vec(),
                LspReadError::MissingContentLength,
            ),
        ] {
            let (tx, _) = mpsc::channel();
            assert_eq!(
                read_lsp_messages(Cursor::new(input), &tx, "test"),
                Err(expected)
            );
        }
    }

    #[test]
    fn dropping_a_temporary_manager_clone_does_not_stop_shared_state() {
        let (tx, _rx) = mpsc::channel();
        let manager = LspManager::new(tx);
        let clone = manager.clone();
        drop(clone);
        assert!(manager.list().is_empty());
        assert_eq!(Arc::strong_count(&manager.inner), 1);
    }

    #[test]
    fn stop_process_bounds_child_and_reader_cleanup() {
        let mut child = crate::process::hidden_command("cmd")
            .args(["/c", "ping", "-n", "30", "127.0.0.1"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        crate::process::guard_child_against_orphan(child.id());
        let pid = child.id();
        let stdout = child.stdout.take().unwrap();
        let (tx, _rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            let _ = read_lsp_messages(BufReader::new(stdout), &tx, "stop-test");
            let _ = done_tx.send(());
        });
        let process = LspProcess {
            child: Mutex::new(Some(child)),
            reader: Mutex::new(ReaderLifecycle {
                handle: Some(handle),
                done: done_rx,
            }),
            info: LspServerInfo {
                language: LspLanguage::Rust,
                root_path: ".".to_string(),
                pid,
            },
        };
        let started = Instant::now();
        stop_process(&process, STOP_TIMEOUT).unwrap();
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(process.child.lock().unwrap().is_none());
        assert!(process.reader.lock().unwrap().handle.is_none());
    }
}
