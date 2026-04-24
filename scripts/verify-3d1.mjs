#!/usr/bin/env node
// Phase 3D-1 verifier.
//
// Drives the local HTTP/WS PTY API exposed by the running Tauri app on
// 127.0.0.1:9333 and reports PASS/FAIL per check. Self-contained: uses only
// Node 22+ globals (fetch, WebSocket).
//
// Pre-req: `pnpm tauri:dev` (or any debug build of aether-terminal) is
// running. The script does NOT spawn the app — start it separately.
//
// Authentication: the app requires `Authorization: Bearer <token>` on every
// REST call. The token is either `AETHER_API_TOKEN` (if set when the app was
// started) or the ephemeral UUID logged at WARN level on startup. Export that
// token before running this script:
//
//   AETHER_API_TOKEN=<token> node scripts/verify-3d1.mjs
//
// Exit code: 0 on full PASS, 1 on any failure.

const PORT = 9333;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;
const MARKER = `aether-verify-${Date.now()}`;

const TOKEN = process.env.AETHER_API_TOKEN;
if (!TOKEN) {
  console.error(
    "AETHER_API_TOKEN env var not set — export the token printed by the app at startup.",
  );
  process.exit(1);
}
const AUTH_HEADERS = { Authorization: `Bearer ${TOKEN}` };

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "OK " : "FAIL";
  console.log(`[${tag}] ${name}${detail ? "  — " + detail : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(retries = 10, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${HTTP}/sessions`, { headers: AUTH_HEADERS });
      if (res.ok) return true;
    } catch {}
    await sleep(delayMs);
  }
  return false;
}

async function main() {
  console.log(`Phase 3D-1 verifier — target ${HTTP}`);

  const reachable = await waitForServer();
  record("server reachable + token accepted", reachable);
  if (!reachable) {
    console.log(
      "\nServer not responding (or token rejected). Check that `pnpm tauri:dev` is running and AETHER_API_TOKEN matches the app log.",
    );
    process.exit(1);
  }

  // Auth — missing token should be rejected.
  try {
    const res = await fetch(`${HTTP}/sessions`);
    record("GET /sessions without token -> 401", res.status === 401, `status=${res.status}`);
  } catch (e) {
    record("GET /sessions without token -> 401", false, String(e));
  }

  // Auth — wrong token should be rejected.
  try {
    const res = await fetch(`${HTTP}/sessions`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    record("GET /sessions with wrong token -> 401", res.status === 401, `status=${res.status}`);
  } catch (e) {
    record("GET /sessions with wrong token -> 401", false, String(e));
  }

  let id;
  try {
    const res = await fetch(`${HTTP}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ shell: "powershell", cols: 80, rows: 24 }),
    });
    const body = await res.json();
    id = body.id;
    record("POST /sessions returns id", res.ok && typeof id === "string", `id=${id}`);
  } catch (e) {
    record("POST /sessions returns id", false, String(e));
    return finish();
  }

  try {
    const res = await fetch(`${HTTP}/sessions`, { headers: AUTH_HEADERS });
    const list = await res.json();
    const found = Array.isArray(list) && list.some((s) => s.id === id);
    record("GET /sessions lists new id", found, `count=${list.length}`);
  } catch (e) {
    record("GET /sessions lists new id", false, String(e));
  }

  // Resize — valid dimensions.
  try {
    const res = await fetch(`${HTTP}/sessions/${id}/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ cols: 120, rows: 40 }),
    });
    record("POST /sessions/:id/resize -> 204", res.status === 204, `status=${res.status}`);
  } catch (e) {
    record("POST /sessions/:id/resize -> 204", false, String(e));
  }

  // Resize — invalid dimensions (zero).
  try {
    const res = await fetch(`${HTTP}/sessions/${id}/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ cols: 0, rows: 24 }),
    });
    record("resize with cols=0 -> 400", res.status === 400, `status=${res.status}`);
  } catch (e) {
    record("resize with cols=0 -> 400", false, String(e));
  }

  // Resize — unknown session.
  try {
    const res = await fetch(`${HTTP}/sessions/does-not-exist/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    record("resize unknown id -> 404", res.status === 404, `status=${res.status}`);
  } catch (e) {
    record("resize unknown id -> 404", false, String(e));
  }

  // WebSocket — query-string token fallback, since native WebSocket can't set
  // custom headers on the upgrade request.
  const ws = new WebSocket(
    `${WS}/sessions/${id}/stream?token=${encodeURIComponent(TOKEN)}`,
  );
  ws.binaryType = "arraybuffer";

  const opened = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 3000);
    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(true);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
  record("WS opens with ?token=", opened);
  if (!opened) {
    return finish();
  }

  let received = "";
  ws.addEventListener("message", (ev) => {
    const data = ev.data;
    if (data instanceof ArrayBuffer) {
      received += new TextDecoder().decode(new Uint8Array(data));
    } else {
      received += String(data);
    }
  });

  await sleep(2000);
  record("WS receives initial output", received.length > 0, `${received.length} bytes`);

  const cmd = `echo ${MARKER}\r\n`;
  ws.send(new TextEncoder().encode(cmd));

  const matched = await (async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (received.includes(MARKER)) return true;
      await sleep(100);
    }
    return false;
  })();
  record("WS input is executed by PTY (marker echo)", matched);

  ws.close();
  await sleep(200);

  // WebSocket — missing token should fail handshake.
  const badWs = new WebSocket(`${WS}/sessions/${id}/stream`);
  const badOpened = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2000);
    badWs.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(true);
    });
    badWs.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
  record("WS without token is rejected", !badOpened);

  try {
    const res = await fetch(`${HTTP}/sessions/${id}`, {
      method: "DELETE",
      headers: AUTH_HEADERS,
    });
    record("DELETE /sessions/:id returns 204", res.status === 204, `status=${res.status}`);
  } catch (e) {
    record("DELETE /sessions/:id returns 204", false, String(e));
  }

  try {
    const res = await fetch(`${HTTP}/sessions`, { headers: AUTH_HEADERS });
    const list = await res.json();
    const stillThere = Array.isArray(list) && list.some((s) => s.id === id);
    record("session removed after DELETE", !stillThere);
  } catch (e) {
    record("session removed after DELETE", false, String(e));
  }

  finish();
}

function finish() {
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error("verifier crashed:", e);
  process.exit(1);
});
