/**
 * API client for the companion server and t3code server.
 */

import type { ServerConnection } from "./connections";

function companionUrl(conn: ServerConnection, path: string): string {
  return `http://${conn.host}:${conn.companionPort}${path}`;
}

function t3Url(conn: ServerConnection): string {
  return `http://${conn.host}:${conn.t3Port}`;
}

/** Build auth headers for the companion server. */
function companionHeaders(conn: ServerConnection): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (conn.companionToken) {
    headers["Authorization"] = `Bearer ${conn.companionToken}`;
  }
  return headers;
}

function createTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? createTimeout(10000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
  return response.json() as Promise<T>;
}

// --- Companion API (all calls include companion auth token) ---

export interface CompanionHealth {
  status: string;
  hostname: string;
  version: string;
}

export interface DiscoveredInstance {
  pid: number;
  host: string;
  port: number;
  requiresAuth: boolean;
  workspaceRoot: string | null;
  reachable: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modified: string;
  isProject: boolean;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
}

export interface QuickPath {
  name: string;
  path: string;
  exists: boolean;
}

export async function checkCompanionHealth(
  conn: ServerConnection
): Promise<CompanionHealth> {
  return fetchJson(companionUrl(conn, "/health"), {
    signal: createTimeout(3000),
  });
}

export async function discoverInstances(
  conn: ServerConnection
): Promise<{ instances: DiscoveredInstance[] }> {
  return fetchJson(companionUrl(conn, "/api/discover?refresh=true"), {
    headers: companionHeaders(conn),
  });
}

export async function listDirectory(
  conn: ServerConnection,
  path: string = "~",
  showHidden: boolean = false
): Promise<DirectoryListing> {
  const params = new URLSearchParams({ path });
  if (showHidden) params.set("hidden", "true");
  return fetchJson(companionUrl(conn, `/api/fs/list?${params}`), {
    headers: companionHeaders(conn),
  });
}

export async function getQuickPaths(
  conn: ServerConnection
): Promise<{ paths: QuickPath[] }> {
  return fetchJson(companionUrl(conn, "/api/fs/quick-paths"), {
    headers: companionHeaders(conn),
  });
}

export async function scanProjects(
  conn: ServerConnection,
  path: string = "~"
): Promise<{ projects: DirectoryEntry[] }> {
  return fetchJson(
    companionUrl(
      conn,
      `/api/fs/scan-projects?path=${encodeURIComponent(path)}`
    ),
    { headers: companionHeaders(conn) }
  );
}

export async function createFolder(
  conn: ServerConnection,
  parentPath: string,
  folderName: string
): Promise<{ success: boolean; path: string }> {
  return fetchJson(companionUrl(conn, "/api/fs/mkdir"), {
    method: "POST",
    headers: companionHeaders(conn),
    body: JSON.stringify({ parentPath, folderName }),
  });
}

export async function createProject(
  conn: ServerConnection,
  workspaceRoot: string,
  title?: string
): Promise<{ success: boolean; project: unknown }> {
  return fetchJson(companionUrl(conn, "/api/project/create"), {
    method: "POST",
    headers: companionHeaders(conn),
    body: JSON.stringify({
      t3Port: conn.t3Port,
      workspaceRoot,
      title,
    }),
  });
}

// --- Direct t3code server ---

export async function checkT3Health(conn: ServerConnection): Promise<boolean> {
  try {
    const response = await fetch(t3Url(conn), {
      signal: createTimeout(3000),
      headers: conn.authToken
        ? { Authorization: `Bearer ${conn.authToken}` }
        : {},
    });
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

/**
 * Build the URL for loading the t3code web UI in a WebView.
 * Auth is handled via injected JavaScript, NOT via URL parameters.
 */
export function getT3WebUrl(conn: ServerConnection): string {
  return t3Url(conn);
}

/**
 * Generate JavaScript to inject into the WebView that bootstraps auth.
 * Intercepts fetch/XMLHttpRequest to add the Authorization header,
 * and sets up the WebSocket connection with auth.
 */
export function getT3AuthInjectionJs(conn: ServerConnection): string {
  if (!conn.authToken) return "";

  // Inject auth token into the page's localStorage/sessionStorage
  // so the t3code web app's wsTransport picks it up.
  // The t3code web app reads auth from URL params or localStorage.
  const token = conn.authToken.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return `
    // Inject auth token for t3code web app
    try {
      localStorage.setItem('t3code-auth-token', '${token}');
      sessionStorage.setItem('t3code-auth-token', '${token}');
    } catch(e) {}
    true;
  `;
}

/** QR code pairing payload (v2 with one-time code) */
export interface PairPayload {
  type: "t3code-remote";
  version: number;
  host: string;
  companionPort: number;
  pairCode: string;
  hostname: string;
}

/** Parse and validate a QR code pairing payload. */
export function parsePairPayload(raw: string): PairPayload | null {
  try {
    const data = JSON.parse(raw);
    if (
      data.type === "t3code-remote" &&
      typeof data.host === "string" &&
      typeof data.companionPort === "number" &&
      (typeof data.pairCode === "string" ||
        typeof data.companionToken === "string")
    ) {
      return data as PairPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Redeem a one-time pairing code for a session token. */
export async function redeemPairCode(
  host: string,
  companionPort: number,
  pairCode: string,
  deviceName?: string
): Promise<{
  sessionToken: string;
  hostname: string;
  t3Port: number;
}> {
  const url = `http://${host}:${companionPort}/api/pair/redeem`;
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairCode, deviceName }),
  });
}
