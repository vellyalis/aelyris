use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const PUBLIC_TOKEN: &str = "a4-12-public-bearer";
const PRIVATE_TOKEN: &str = "a4-12-private-input-authority";

struct ServerProcess {
    child: Child,
    profile: PathBuf,
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.profile);
    }
}

fn reserve_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("reserve loopback port")
        .local_addr()
        .expect("read loopback port")
        .port()
}

fn spawn_server(port: u16) -> ServerProcess {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time after epoch")
        .as_nanos();
    let profile = std::env::temp_dir().join(format!(
        "aelyris-a4-12-pty-server-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir_all(&profile).expect("create isolated server profile");

    let mut command = Command::new(env!("CARGO_BIN_EXE_aelyris-pty-server"));
    command
        .env("AELYRIS_PTY_SERVER_PORT", port.to_string())
        .env("AELYRIS_API_TOKEN", PUBLIC_TOKEN)
        .env("AELYRIS_INPUT_AUTHORITY_TOKEN", PRIVATE_TOKEN)
        .env("USERPROFILE", &profile)
        .env("HOME", &profile)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let child = command.spawn().expect("spawn separate aelyris-pty-server");
    ServerProcess { child, profile }
}

fn request(port: u16, method: &str, path: &str, input_authority: Option<&str>, body: &str) -> u16 {
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).expect("connect to aelyris-pty-server");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("set response timeout");
    let authority_header = input_authority
        .map(|token| format!("X-Aelyris-Input-Authority: {token}\r\n"))
        .unwrap_or_default();
    let raw = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {PUBLIC_TOKEN}\r\nContent-Type: application/json\r\n{authority_header}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(raw.as_bytes())
        .expect("write HTTP request");
    stream.flush().expect("flush HTTP request");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("read HTTP response");
    response
        .lines()
        .next()
        .and_then(|status| status.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .unwrap_or_else(|| panic!("invalid HTTP response: {response:?}"))
}

fn wait_until_ready(server: &mut ServerProcess, port: u16) {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    while std::time::Instant::now() < deadline {
        if let Some(status) = server.child.try_wait().expect("poll server process") {
            panic!("aelyris-pty-server exited before HTTP readiness: {status}");
        }
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("aelyris-pty-server did not bind within 15 seconds");
}

#[test]
fn a4_12_live_sidecar_process_enforces_startup_admission_over_http() {
    let port = reserve_port();
    let mut server = spawn_server(port);
    wait_until_ready(&mut server, port);

    let session_body = r#"{"shell":"powershell","cols":80,"rows":24,"cwd":null,"id":null}"#;
    assert_eq!(
        request(port, "POST", "/sessions", None, session_body),
        503,
        "fresh sidecar must deny session creation while Pending"
    );

    let epoch = "11111111-1111-4111-8111-111111111111";
    let begin = format!(r#"{{"action":"begin","epoch":"{epoch}"}}"#);
    assert_eq!(
        request(
            port,
            "POST",
            "/internal/startup-admission",
            Some(PRIVATE_TOKEN),
            &begin,
        ),
        204,
        "private authority must be able to begin the current admission epoch"
    );

    let failed = format!(
        r#"{{
          "action":"publish",
          "epoch":"{epoch}",
          "report":{{
            "phase":"failed",
            "databaseReady":false,
            "sidecarConnected":false,
            "terminalReconciliationComplete":false,
            "adoptedTerminals":0,
            "restoredSessions":0,
            "reconciledHandoffs":0,
            "authorities":[],
            "quarantinedTotal":0,
            "completedAtMs":1,
            "failureStage":"integration-test",
            "failureReason":"injected failure"
          }}
        }}"#
    );
    assert_eq!(
        request(
            port,
            "POST",
            "/internal/startup-admission",
            Some(PUBLIC_TOKEN),
            &failed,
        ),
        403,
        "public bearer possession must not grant private admission publication"
    );
    assert_eq!(
        request(
            port,
            "POST",
            "/internal/startup-admission",
            Some(PRIVATE_TOKEN),
            &failed,
        ),
        204,
        "private authority must be able to publish Failed"
    );

    let command_body =
        r#"{"program":"cmd.exe","args":[],"cols":80,"rows":24,"cwd":null,"env":null}"#;
    assert_eq!(
        request(port, "POST", "/commands", None, command_body),
        503,
        "sidecar must deny command creation after Failed publication"
    );
}
