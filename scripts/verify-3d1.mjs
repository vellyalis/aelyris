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

function arrayBufferToString(data) {
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  return String(data);
}

function waitOpen(ws, timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve(true);
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

async function mintTicket(sessionId) {
  try {
    const res = await fetch(`${HTTP}/sessions/${sessionId}/stream-ticket`, {
      method: "POST",
      headers: AUTH_HEADERS,
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.ticket === "string" ? body.ticket : null;
  } catch {
    return null;
  }
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

  // v2b: mint a single-use ticket, then open the WS with `?ticket=<uuid>`.
  // Legacy `?token=` is still accepted but deprecated; we re-verify it
  // further down so the compatibility contract holds.
  let ticket = null;
  try {
    const res = await fetch(`${HTTP}/sessions/${id}/stream-ticket`, {
      method: "POST",
      headers: AUTH_HEADERS,
    });
    if (res.ok) {
      const body = await res.json();
      ticket = body.ticket;
      record(
        "POST /sessions/:id/stream-ticket returns { ticket, expires_in_ms }",
        typeof ticket === "string" && ticket.length === 36 && typeof body.expires_in_ms === "number",
        `expires_in_ms=${body.expires_in_ms}`,
      );
    } else {
      record("POST /sessions/:id/stream-ticket returns { ticket, expires_in_ms }", false, `status=${res.status}`);
    }
  } catch (e) {
    record("POST /sessions/:id/stream-ticket returns { ticket, expires_in_ms }", false, String(e));
  }

  // stream-ticket for unknown session → 404
  try {
    const res = await fetch(`${HTTP}/sessions/does-not-exist/stream-ticket`, {
      method: "POST",
      headers: AUTH_HEADERS,
    });
    record("stream-ticket unknown id -> 404", res.status === 404, `status=${res.status}`);
  } catch (e) {
    record("stream-ticket unknown id -> 404", false, String(e));
  }

  // WebSocket via ?ticket=
  const ws = new WebSocket(
    `${WS}/sessions/${id}/stream?ticket=${encodeURIComponent(ticket ?? "")}`,
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
  record("WS opens with ?ticket=", opened);
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
  record(
    "WS input is executed by PTY (marker echo)",
    matched,
    matched ? "" : `received[len=${received.length}] tail=${JSON.stringify(received.slice(-300))}`,
  );

  ws.close();
  await sleep(200);

  // Same ticket must not redeem twice (one-shot semantics).
  const reuseTicketWs = new WebSocket(
    `${WS}/sessions/${id}/stream?ticket=${encodeURIComponent(ticket ?? "")}`,
  );
  const reuseOpened = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2000);
    reuseTicketWs.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(true);
    });
    reuseTicketWs.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
  record("WS rejects replayed ticket", !reuseOpened);

  // Legacy ?token= path — still works one release past v2b so callers can
  // migrate. Remove this when ?token= is deleted.
  const legacyWs = new WebSocket(
    `${WS}/sessions/${id}/stream?token=${encodeURIComponent(TOKEN)}`,
  );
  const legacyOpened = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 3000);
    legacyWs.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(true);
    });
    legacyWs.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
  record("WS legacy ?token= still authenticates (deprecated)", legacyOpened);
  legacyWs.close();
  await sleep(200);

  // WebSocket — missing token/ticket should fail handshake.
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
  record("WS without token/ticket is rejected", !badOpened);

  // ─── v2c: broadcast fan-out — two WS subscribers see the same echo ──────
  //
  // Mints two fresh tickets for the same session, opens both, writes a
  // single echo from WS_A, and asserts both WS_A and WS_B receive the
  // marker. Before v2c this raced on the physical master reader and one
  // socket would lose bytes to the other.
  {
    const ticketA = await mintTicket(id);
    const ticketB = await mintTicket(id);
    record(
      "v2c: two fresh tickets for same session",
      typeof ticketA === "string" && typeof ticketB === "string" && ticketA !== ticketB,
    );

    const wsA = new WebSocket(`${WS}/sessions/${id}/stream?ticket=${encodeURIComponent(ticketA ?? "")}`);
    const wsB = new WebSocket(`${WS}/sessions/${id}/stream?ticket=${encodeURIComponent(ticketB ?? "")}`);
    wsA.binaryType = "arraybuffer";
    wsB.binaryType = "arraybuffer";

    const openBoth = await Promise.all([
      waitOpen(wsA, 3000),
      waitOpen(wsB, 3000),
    ]);
    record("v2c: two WS subscribers open concurrently", openBoth[0] && openBoth[1]);

    let recvA = "";
    let recvB = "";
    wsA.addEventListener("message", (ev) => {
      recvA += arrayBufferToString(ev.data);
    });
    wsB.addEventListener("message", (ev) => {
      recvB += arrayBufferToString(ev.data);
    });

    await sleep(300);
    const v2cMarker = `${MARKER}-v2c`;
    wsA.send(new TextEncoder().encode(`echo ${v2cMarker}\r\n`));

    const bothSaw = await (async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (recvA.includes(v2cMarker) && recvB.includes(v2cMarker)) return true;
        await sleep(100);
      }
      return false;
    })();
    record(
      "v2c: both WS subscribers receive the same marker (no byte-race)",
      bothSaw,
      `A=${recvA.includes(v2cMarker)} B=${recvB.includes(v2cMarker)}`,
    );

    wsA.close();
    wsB.close();
    await sleep(200);
  }

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
