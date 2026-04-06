/**
 * QR code pairing and session management.
 *
 * Flow:
 * 1. /pair — network interface picker
 * 2. /pair/qr?ip=X&ttl=Y — QR code with one-time pairing code + chosen TTL
 * 3. /api/pair/redeem — exchange code for session token with TTL
 * 4. /api/sessions — list/revoke active sessions
 */

import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { networkInterfaces, hostname as getHostname, homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface NetworkInterface {
  name: string;
  label: string;
  address: string;
}

export interface Session {
  token: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
}

// --- Session store (persisted to disk) ---

const SESSION_DIR = join(homedir(), ".t3code-remote");
const SESSION_FILE = join(SESSION_DIR, "sessions.json");

const sessions = new Map<string, Session>();

const MAX_SESSIONS = 10;

function saveSessions(): void {
  try {
    mkdirSync(SESSION_DIR, { recursive: true });
    const data = Object.fromEntries(sessions);
    writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

function loadSessions(): void {
  try {
    const raw = readFileSync(SESSION_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, Session>;
    const now = Date.now();
    for (const [token, session] of Object.entries(data)) {
      // Skip expired sessions (but keep never-expiring ones)
      if (session.expiresAt !== 0 && now > session.expiresAt) continue;
      sessions.set(token, session);
    }
  } catch {}
}

// Load sessions from disk on startup
loadSessions();

/** Register a new session token with a TTL. */
export function registerSession(
  token: string,
  label: string,
  ttlMs: number
): void {
  // Enforce max sessions — evict oldest
  if (sessions.size >= MAX_SESSIONS) {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [t, s] of sessions) {
      if (s.createdAt < oldestTime) {
        oldestTime = s.createdAt;
        oldest = t;
      }
    }
    if (oldest) sessions.delete(oldest);
  }

  const now = Date.now();
  sessions.set(token, {
    token,
    label,
    createdAt: now,
    expiresAt: ttlMs === 0 ? 0 : now + ttlMs,
    lastUsedAt: now,
  });
  saveSessions();
}

/** Validate a session token. Returns true if valid and not expired. */
export function isValidSessionToken(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  // expiresAt === 0 means never expires
  if (session.expiresAt !== 0 && Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  session.lastUsedAt = Date.now();
  return true;
}

/** Revoke a session by token. */
export function revokeSession(token: string): boolean {
  const result = sessions.delete(token);
  saveSessions();
  return result;
}

/** Revoke a session by token prefix (for the management UI). */
export function revokeByTokenPrefix(prefix: string): boolean {
  for (const [token] of sessions) {
    if ((token.slice(0, 8) + "...") === prefix) {
      sessions.delete(token);
      saveSessions();
      return true;
    }
  }
  return false;
}

/** Revoke all sessions. */
export function revokeAllSessions(): void {
  sessions.clear();
  saveSessions();
}

/** List all active (non-expired) sessions. Returns sanitized data (no full tokens). */
export function listSessions(): Array<{
  tokenPrefix: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
  expiresIn: string;
}> {
  const now = Date.now();
  const result: ReturnType<typeof listSessions> = [];

  for (const [token, session] of sessions) {
    if (session.expiresAt !== 0 && now > session.expiresAt) {
      sessions.delete(token);
      continue;
    }

    let expiresIn: string;
    if (session.expiresAt === 0) {
      expiresIn = "never";
    } else {
      const remainMs = session.expiresAt - now;
      const hours = Math.floor(remainMs / 3600000);
      const days = Math.floor(hours / 24);
      expiresIn =
        days > 0
          ? `${days}d ${hours % 24}h`
          : hours > 0
            ? `${hours}h ${Math.floor((remainMs % 3600000) / 60000)}m`
            : `${Math.floor(remainMs / 60000)}m`;
    }

    result.push({
      tokenPrefix: token.slice(0, 8) + "...",
      label: session.label,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      expiresIn,
    });
  }

  return result;
}

// Clean up expired sessions periodically
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt !== 0 && now > session.expiresAt) sessions.delete(token);
  }
}, 60_000);

// Allow clean shutdown
export function stopCleanup(): void {
  clearInterval(cleanupInterval);
}

// --- One-time pairing codes ---

const pendingPairCodes = new Map<
  string,
  { createdAt: number; sessionToken: string; ttlMs: number; label: string }
>();

// Rate limiting: track QR generation timestamps
const qrGenerationTimes: number[] = [];
const QR_RATE_LIMIT = 5; // max codes per minute
const QR_RATE_WINDOW = 60_000;

export function checkQrRateLimit(): boolean {
  const now = Date.now();
  // Remove old entries
  while (qrGenerationTimes.length > 0 && now - qrGenerationTimes[0] > QR_RATE_WINDOW) {
    qrGenerationTimes.shift();
  }
  return qrGenerationTimes.length < QR_RATE_LIMIT;
}

/**
 * Create a one-time pairing code with a specific TTL for the resulting session.
 */
export function createPairCode(ttlMs: number, label: string): { pairCode: string; sessionToken: string } {
  const pairCode = randomBytes(16).toString("base64url");
  const sessionToken = randomBytes(32).toString("base64url");

  pendingPairCodes.set(pairCode, {
    createdAt: Date.now(),
    sessionToken,
    ttlMs,
    label,
  });

  qrGenerationTimes.push(Date.now());
  return { pairCode, sessionToken };
}

/**
 * Redeem a one-time pairing code. Returns session info if valid.
 */
export function redeemPairCode(
  code: string,
  deviceName?: string
): { sessionToken: string; ttlMs: number; label: string } | null {
  const entry = pendingPairCodes.get(code);
  if (!entry) return null;

  // Check code expiry (5 minutes)
  if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
    pendingPairCodes.delete(code);
    return null;
  }

  // One-time use
  pendingPairCodes.delete(code);

  // Use device name if provided, otherwise fall back to generic label
  const label = deviceName || entry.label;

  // Register the session with the chosen TTL
  registerSession(entry.sessionToken, label, entry.ttlMs);

  return {
    sessionToken: entry.sessionToken,
    ttlMs: entry.ttlMs,
    label,
  };
}

// Clean up expired pairing codes
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of pendingPairCodes) {
    if (now - data.createdAt > 5 * 60 * 1000) pendingPairCodes.delete(code);
  }
}, 30_000);

// --- Network interfaces ---

export function getNetworkInterfaces(): NetworkInterface[] {
  const nets = networkInterfaces();
  const results: NetworkInterface[] = [];

  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;

      let label = name;
      if (/^en0$/i.test(name)) label = "Wi-Fi";
      else if (/^en\d+$/i.test(name)) label = `Ethernet (${name})`;
      else if (/^utun/i.test(name) || /^tailscale/i.test(name))
        label = "Tailscale";
      else if (/^tun/i.test(name) || /^wg/i.test(name)) label = "VPN";
      else if (/^bridge/i.test(name)) label = "Bridge";

      if (addr.address.startsWith("100.")) label = "Tailscale";

      results.push({ name, label, address: addr.address });
    }
  }

  return results;
}

// --- TTL options ---

const TTL_OPTIONS = [
  { label: "1 hour", value: 3600000 },
  { label: "8 hours", value: 28800000 },
  { label: "24 hours", value: 86400000 },
  { label: "7 days", value: 604800000 },
  { label: "30 days", value: 2592000000 },
  { label: "Never", value: 0 },
];

// --- HTML pages ---

export function generatePickerPage(port: number): string {
  const interfaces = getNetworkInterfaces();
  const hn = getHostname();
  const activeSessions = listSessions();

  const interfaceButtons = interfaces
    .map(
      (iface) => `
      <button class="iface-btn" onclick="selectInterface('${escapeHtml(iface.address)}')">
        <span class="iface-label">${escapeHtml(iface.label)}</span>
        <span class="iface-addr">${escapeHtml(iface.address)}</span>
      </button>`
    )
    .join("\n");

  const ttlOptions = TTL_OPTIONS.map(
    (opt, i) =>
      `<label class="ttl-option">
        <input type="radio" name="ttl" value="${opt.value}" ${i === 2 ? "checked" : ""}>
        <span>${opt.label}</span>
      </label>`
  ).join("\n");

  const sessionRows = activeSessions.length > 0
    ? activeSessions.map(
        (s) => `
        <div class="session-row">
          <div>
            <span class="session-label">${escapeHtml(s.label)}</span>
            <span class="session-token">${escapeHtml(s.tokenPrefix)}</span>
          </div>
          <div>
            <span class="session-expiry">expires in ${escapeHtml(s.expiresIn)}</span>
            <button class="revoke-btn" onclick="revokeSession('${escapeHtml(s.tokenPrefix)}')">Revoke</button>
          </div>
        </div>`
      ).join("\n")
    : '<p class="no-sessions">No active sessions</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>T3 Code Remote — Pair Device</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #fff;
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 2rem;
    }
    .card {
      background: #1a1a1a; border-radius: 20px; padding: 2.5rem;
      text-align: center; max-width: 520px; width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
    h2 { font-size: 1.1rem; font-weight: 600; margin: 1.5rem 0 0.75rem; text-align: left; }
    .subtitle { color: #9ca3af; font-size: 0.95rem; margin-bottom: 1.5rem; }
    .section-label { color: #6b7280; font-size: 0.8rem; text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 0.5rem; text-align: left; }
    .iface-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.25rem; }
    .iface-btn {
      display: flex; justify-content: space-between; align-items: center;
      background: #111; border: 1px solid #2a2a2a; border-radius: 10px;
      padding: 0.85rem 1rem; color: #fff; cursor: pointer;
      transition: border-color 0.2s; font-size: 0.95rem;
    }
    .iface-btn:hover { border-color: #3b82f6; }
    .iface-btn.selected { border-color: #3b82f6; background: #1a2332; }
    .iface-label { font-weight: 600; }
    .iface-addr { font-family: monospace; color: #6b7280; font-size: 0.85rem; }
    .ttl-group { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.25rem; }
    .ttl-option {
      background: #111; border: 1px solid #2a2a2a; border-radius: 8px;
      padding: 0.5rem 0.85rem; cursor: pointer; font-size: 0.85rem; color: #9ca3af;
    }
    .ttl-option:has(input:checked) { border-color: #3b82f6; color: #fff; background: #1a2332; }
    .ttl-option input { display: none; }
    .pair-btn {
      background: #3b82f6; color: #fff; border: none; border-radius: 10px;
      padding: 0.85rem; width: 100%; font-size: 1rem; font-weight: 600;
      cursor: pointer; display: none;
    }
    .pair-btn:hover { background: #2563eb; }
    .pair-btn.visible { display: block; }
    .sessions { margin-top: 1.5rem; border-top: 1px solid #222; padding-top: 1rem; }
    .session-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0; border-bottom: 1px solid #1a1a1a; font-size: 0.85rem;
    }
    .session-label { color: #fff; font-weight: 500; }
    .session-token { color: #4b5563; font-family: monospace; margin-left: 0.5rem; font-size: 0.75rem; }
    .session-expiry { color: #6b7280; font-size: 0.75rem; margin-right: 0.75rem; }
    .revoke-btn {
      background: none; border: 1px solid #7f1d1d; color: #ef4444; border-radius: 6px;
      padding: 0.25rem 0.6rem; cursor: pointer; font-size: 0.75rem;
    }
    .revoke-btn:hover { background: #7f1d1d; color: #fff; }
    .revoke-all-btn {
      background: none; border: 1px solid #7f1d1d; color: #ef4444; border-radius: 8px;
      padding: 0.4rem 0.85rem; cursor: pointer; font-size: 0.8rem; margin-top: 0.75rem;
    }
    .revoke-all-btn:hover { background: #7f1d1d; color: #fff; }
    .no-sessions { color: #4b5563; font-size: 0.85rem; }
    .hostname { color: #4b5563; font-size: 0.8rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>T3 Code Remote</h1>
    <p class="subtitle">Pair a device to this machine</p>

    <p class="section-label">Network</p>
    <div class="iface-list">
      ${interfaceButtons}
    </div>

    <p class="section-label">Session Duration</p>
    <div class="ttl-group">
      ${ttlOptions}
    </div>

    <button class="pair-btn" id="pairBtn" onclick="generateQr()">Generate QR Code</button>

    <div class="sessions">
      <h2>Active Sessions</h2>
      <div id="sessionList">
        ${sessionRows}
      </div>
      ${activeSessions.length > 1 ? '<button class="revoke-all-btn" onclick="revokeAll()">Revoke All</button>' : ''}
    </div>

    <p class="hostname">${escapeHtml(hn)}</p>
  </div>

  <script>
    let selectedIp = null;

    function selectInterface(ip) {
      selectedIp = ip;
      document.querySelectorAll('.iface-btn').forEach(b => b.classList.remove('selected'));
      event.currentTarget.classList.add('selected');
      document.getElementById('pairBtn').classList.add('visible');
    }

    function generateQr() {
      const ttl = document.querySelector('input[name="ttl"]:checked').value;
      window.location.href = '/pair/qr?ip=' + encodeURIComponent(selectedIp) + '&ttl=' + ttl;
    }

    async function revokeSession(prefix) {
      await fetch('/api/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenPrefix: prefix })
      });
      window.location.reload();
    }

    async function revokeAll() {
      await fetch('/api/sessions/revoke-all', { method: 'POST' });
      refreshSessions();
    }

    async function refreshSessions() {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      const list = document.getElementById('sessionList');
      if (!data.sessions || data.sessions.length === 0) {
        list.innerHTML = '<p class="no-sessions">No active sessions</p>';
        return;
      }
      list.innerHTML = data.sessions.map(function(s) {
        return '<div class="session-row"><div>' +
          '<span class="session-label">' + s.label + '</span>' +
          '<span class="session-token">' + s.tokenPrefix + '</span>' +
          '</div><div>' +
          '<span class="session-expiry">expires ' + s.expiresIn + '</span>' +
          '<button class="revoke-btn" onclick="revokeSession(\\'' + s.tokenPrefix + '\\')">Revoke</button>' +
          '</div></div>';
      }).join('');
    }

    // Auto-refresh sessions every 10s
    setInterval(refreshSessions, 10000);
  </script>
</body>
</html>`;
}

export async function generateQrPage(
  ip: string,
  port: number,
  ttlMs: number
): Promise<string> {
  if (!checkQrRateLimit()) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Rate Limited</title>
    <style>body{background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;}
    .card{background:#1a1a1a;border-radius:20px;padding:3rem;text-align:center;max-width:400px;}
    a{color:#3b82f6;}</style></head>
    <body><div class="card"><h2>Too many codes generated</h2><p style="color:#9ca3af;margin-top:1rem;">Wait a minute and try again.</p>
    <a href="/pair" style="display:inline-block;margin-top:1.5rem;">Back</a></div></body></html>`;
  }

  const ttlLabel = TTL_OPTIONS.find((o) => o.value === ttlMs)?.label || `${Math.round(ttlMs / 3600000)}h`;
  const { pairCode } = createPairCode(ttlMs, `Device (${ip})`);

  const payload = JSON.stringify({
    type: "t3code-remote",
    version: 2,
    host: ip,
    companionPort: port,
    pairCode,
    hostname: getHostname(),
  });

  const qrSvg = await QRCode.toString(payload, {
    type: "svg",
    width: 280,
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>T3 Code Remote — Scan QR Code</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #fff; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 2rem;
    }
    .card {
      background: #1a1a1a; border-radius: 20px; padding: 3rem;
      text-align: center; max-width: 480px; width: 100%;
    }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    .subtitle { color: #9ca3af; font-size: 0.95rem; margin-bottom: 2rem; }
    .qr-container { background: #fff; border-radius: 16px; padding: 1.5rem;
      display: inline-block; margin-bottom: 2rem; }
    .qr-container svg { display: block; }
    .steps { text-align: left; margin: 1.5rem 0; color: #9ca3af; font-size: 0.9rem; line-height: 1.8; }
    .info { background: #111; border-radius: 10px; padding: 1rem; font-size: 0.85rem;
      color: #6b7280; line-height: 1.6; }
    .info strong { color: #9ca3af; }
    .expire-note { color: #f59e0b; font-size: 0.8rem; margin-top: 1rem; }
    .back-link { display: inline-block; margin-top: 1.5rem; color: #3b82f6;
      text-decoration: none; font-size: 0.9rem; }
    .back-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>T3 Code Remote</h1>
    <p class="subtitle">Scan this QR code with the app</p>
    <div class="qr-container">${qrSvg}</div>
    <ol class="steps">
      <li>Open <strong>T3 Code Remote</strong> on your iPad</li>
      <li>Tap <strong>+ Pair</strong></li>
      <li>Point the camera at the code above</li>
    </ol>
    <div class="info">
      <strong>Network:</strong> ${escapeHtml(ip)}<br>
      <strong>Session:</strong> ${escapeHtml(ttlLabel)}<br>
      <strong>Machine:</strong> ${escapeHtml(getHostname())}
    </div>
    <p class="expire-note">This code expires in 5 minutes and can only be used once.</p>
    <a href="/pair" class="back-link">Back</a>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
