use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use super::types::{LspLanguage, LspServerInfo};

/// A JSON-RPC message received from a language server.
#[derive(Debug, Clone)]
pub struct LspMessage {
    pub server_key: String,
    pub json: String,
}

struct LspProcess {
    child: Child,
    info: LspServerInfo,
}

/// Manages language server processes and relays JSON-RPC messages via channels.
#[derive(Clone)]
pub struct LspManager {
    servers: Arc<Mutex<HashMap<String, LspProcess>>>,
    sender: mpsc::Sender<LspMessage>,
}

impl LspManager {
    pub fn new(sender: mpsc::Sender<LspMessage>) -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
            sender,
        }
    }

    /// Start a language server for the given language and project root.
    pub fn start(&self, language: LspLanguage, root_path: &str) -> Result<LspServerInfo, String> {
        let key = format!("{:?}:{}", language, root_path);

        if let Ok(servers) = self.servers.lock() {
            if servers.contains_key(&key) {
                return Err(format!(
                    "LSP server already running for {:?} at {}",
                    language, root_path
                ));
            }
        }

        let (cmd, args) = language.server_command();

        let mut child = Command::new(cmd)
            .args(&args)
            .current_dir(root_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start {}: {}. Is it installed?", cmd, e))?;

        let pid = child.id();
        let info = LspServerInfo {
            language: language.clone(),
            root_path: root_path.to_string(),
            pid,
        };

        // Spawn stdout reader thread → send messages via channel
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let tx = self.sender.clone();
        let event_key = key.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            read_lsp_messages(reader, &tx, &event_key);
        });

        self.servers
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?
            .insert(
                key,
                LspProcess {
                    child,
                    info: info.clone(),
                },
            );

        log::info!(
            "Started LSP server {:?} (PID {}) for {}",
            language,
            pid,
            root_path
        );
        Ok(info)
    }

    /// Send a JSON-RPC message to a running language server.
    pub fn send(
        &self,
        language: &LspLanguage,
        root_path: &str,
        json_rpc: &str,
    ) -> Result<(), String> {
        let key = format!("{:?}:{}", language, root_path);
        let mut servers = self
            .servers
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let proc = servers
            .get_mut(&key)
            .ok_or(format!("No LSP server for {:?} at {}", language, root_path))?;

        let stdin = proc.child.stdin.as_mut().ok_or("stdin not available")?;
        let content_length = json_rpc.len();
        let message = format!("Content-Length: {}\r\n\r\n{}", content_length, json_rpc);
        stdin
            .write_all(message.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        stdin.flush().map_err(|e| format!("Flush failed: {}", e))?;

        Ok(())
    }

    /// Stop a language server.
    pub fn stop(&self, language: &LspLanguage, root_path: &str) -> Result<(), String> {
        let key = format!("{:?}:{}", language, root_path);
        let mut servers = self
            .servers
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        if let Some(mut proc) = servers.remove(&key) {
            let _ = proc.child.kill();
            let _ = proc.child.wait();
            log::info!("Stopped LSP server {:?} for {}", language, root_path);
        }
        Ok(())
    }

    /// List running servers.
    pub fn list(&self) -> Vec<LspServerInfo> {
        self.servers
            .lock()
            .map(|s| s.values().map(|p| p.info.clone()).collect())
            .unwrap_or_default()
    }

    /// Stop all servers.
    pub fn stop_all(&self) {
        if let Ok(mut servers) = self.servers.lock() {
            for (_, mut proc) in servers.drain() {
                let _ = proc.child.kill();
                let _ = proc.child.wait();
            }
        }
    }
}

/// Read LSP JSON-RPC messages from stdout and send via channel.
fn read_lsp_messages(
    mut reader: BufReader<std::process::ChildStdout>,
    tx: &mpsc::Sender<LspMessage>,
    server_key: &str,
) {
    loop {
        let mut content_length: usize = 0;
        loop {
            let mut header = String::new();
            match reader.read_line(&mut header) {
                Ok(0) => return,
                Ok(_) => {
                    let trimmed = header.trim();
                    if trimmed.is_empty() {
                        break;
                    }
                    if let Some(len_str) = trimmed.strip_prefix("Content-Length: ") {
                        content_length = len_str.parse().unwrap_or(0);
                    }
                }
                Err(_) => return,
            }
        }

        if content_length == 0 {
            continue;
        }

        let mut body = vec![0u8; content_length];
        if std::io::Read::read_exact(&mut reader, &mut body).is_err() {
            return;
        }

        let json = String::from_utf8_lossy(&body).to_string();
        if tx
            .send(LspMessage {
                server_key: server_key.to_string(),
                json,
            })
            .is_err()
        {
            return; // receiver dropped
        }
    }
}

impl Drop for LspManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}
