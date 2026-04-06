#!/usr/bin/env bun
/**
 * t3code-remote companion server
 *
 * Usage:
 *   npx t3code-remote                    # default ports 3774/3773
 *   npx t3code-remote --port 8080        # companion port
 *   npx t3code-remote --t3-port 3773     # t3code port
 *   npx t3code-remote --no-t3            # don't auto-start t3code
 *   npx t3code-remote --no-open          # don't open browser
 */

import { discoverInstances, probeInstance } from "./discovery";
import {
  listDirectory,
  getQuickPaths,
  scanForProjects,
  assertAllowedPath,
} from "./filesystem";
import { T3Bridge } from "./t3bridge";
import {
  generatePickerPage,
  generateQrPage,
  redeemPairCode,
  isValidSessionToken,
  listSessions,
  revokeAllSessions,
  revokeByTokenPrefix,
  stopCleanup,
} from "./pair";
import { access, constants, mkdir } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { resolve as resolvePath, join as joinPath, basename } from "node:path";
import { hostname, homedir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const PORT = parseInt(getArg("port", "3774"), 10);
const HOST = getArg("host", "0.0.0.0");
const T3_PORT = parseInt(getArg("t3-port", "3773"), 10);
const NO_T3 = args.includes("--no-t3");
const NO_OPEN = args.includes("--no-open");

// --- Auto-start t3code ---
let t3Process: ChildProcess | null = null;

async function ensureT3Running(): Promise<void> {
  if (NO_T3) return;

  const alreadyRunning = await probeInstance("localhost", T3_PORT);
  if (alreadyRunning) {
    console.log(`[t3code] Already running on port ${T3_PORT}`);
    return;
  }

  console.log(`[t3code] Starting on port ${T3_PORT}...`);

  const npxPath =
    process.env.PATH?.split(":")
      .map((p) => `${p}/npx`)
      .find((p) => {
        try {
          require("fs").accessSync(p);
          return true;
        } catch {
          return false;
        }
      }) ?? "npx";

  t3Process = spawn(
    npxPath,
    ["t3", "--host", HOST, "--port", String(T3_PORT), "--no-browser"],
    { stdio: ["ignore", "pipe", "pipe"], detached: false, env: { ...process.env } }
  );

  t3Process.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[t3code] ${line}`);
  });
  t3Process.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.error(`[t3code] ${line}`);
  });
  t3Process.on("exit", (code) => {
    console.log(`[t3code] Process exited with code ${code}`);
    t3Process = null;
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await probeInstance("localhost", T3_PORT)) {
      console.log(`[t3code] Ready on port ${T3_PORT}`);
      return;
    }
  }
  console.warn(`[t3code] Warning: did not become reachable within 30s`);
}

function cleanup() {
  stopCleanup();
  if (t3Process && !t3Process.killed) {
    console.log("[t3code] Shutting down...");
    t3Process.kill("SIGTERM");
  }
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

// --- Auth middleware ---
function checkAuth(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return isValidSessionToken(token);
}

// --- CORS headers (restricted) ---
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };
}

// --- Instance cache ---
interface CachedInstance {
  pid: number;
  host: string;
  port: number;
  requiresAuth: boolean;
  workspaceRoot: string | null;
  reachable: boolean;
}

let cachedInstances: CachedInstance[] = [];
let lastDiscovery = 0;
const DISCOVERY_TTL = 10_000;

async function getInstances(forceRefresh = false): Promise<CachedInstance[]> {
  const now = Date.now();
  if (!forceRefresh && now - lastDiscovery < DISCOVERY_TTL) {
    return cachedInstances;
  }

  const raw = await discoverInstances();
  lastDiscovery = now;

  cachedInstances = await Promise.all(
    raw.map(async (inst) => ({
      pid: inst.pid,
      host: inst.host,
      port: inst.port,
      requiresAuth: inst.authToken !== null,
      workspaceRoot: inst.workspaceRoot,
      reachable: await probeInstance(inst.host, inst.port, inst.authToken),
    }))
  );

  return cachedInstances;
}

// --- Persistent T3 bridge connection ---
let t3BridgeInstance: T3Bridge | null = null;
let t3BridgePort: number | null = null;

async function getT3Bridge(port: number): Promise<T3Bridge> {
  if (t3BridgeInstance && t3BridgePort === port) {
    return t3BridgeInstance;
  }

  // Look up auth token from discovery
  const rawInstances = await discoverInstances();
  const rawMatch = rawInstances.find((i) => i.port === port);

  const bridge = new T3Bridge("localhost", port, rawMatch?.authToken ?? null);
  await bridge.connect();

  t3BridgeInstance = bridge;
  t3BridgePort = port;
  return bridge;
}

// --- Folder name validation ---
function validateFolderName(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("\0")) return false;
  return true;
}

// --- Request handler ---
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    // --- Unauthenticated endpoints ---

    if (path === "/" || path === "/health") {
      return json({ status: "ok" });
    }

    // Pairing flow (served as HTML, local-only)
    if (path === "/pair") {
      return new Response(generatePickerPage(PORT), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/pair/qr") {
      const ip = url.searchParams.get("ip");
      const ttl = parseInt(url.searchParams.get("ttl") || "86400000", 10);
      if (!ip) return new Response("Missing ip", { status: 400 });

      // 0 = never expires, otherwise clamp between 1 hour and 30 days
      const clampedTtl = ttl === 0 ? 0 : Math.max(3600000, Math.min(2592000000, ttl));

      const html = await generateQrPage(ip, PORT, clampedTtl);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/api/pair/redeem" && req.method === "POST") {
      const body = (await req.json()) as { pairCode: string; deviceName?: string };
      const result = redeemPairCode(body.pairCode, body.deviceName);
      if (!result) {
        return json({ error: "Invalid or expired pairing code." }, 401);
      }
      return json({
        sessionToken: result.sessionToken,
        hostname: hostname(),
        t3Port: T3_PORT,
        ttlMs: result.ttlMs,
      });
    }

    // Session management (unauthenticated — accessed from browser on local machine)
    if (path === "/api/sessions" && req.method === "GET") {
      return json({ sessions: listSessions() });
    }

    if (path === "/api/sessions/revoke" && req.method === "POST") {
      const body = (await req.json()) as { tokenPrefix: string };
      revokeByTokenPrefix(body.tokenPrefix);
      return json({ success: true });
    }

    if (path === "/api/sessions/revoke-all" && req.method === "POST") {
      revokeAllSessions();
      return json({ success: true });
    }

    // --- Authenticated endpoints ---

    if (!checkAuth(req)) {
      return json({ error: "Unauthorized. Scan the QR code at /pair to connect." }, 401);
    }

    // Session validation — used by the app before loading the WebView
    if (path === "/api/session/validate") {
      return json({ valid: true });
    }

    if (path === "/api/discover") {
      const refresh = url.searchParams.get("refresh") === "true";
      const instances = await getInstances(refresh);
      return json({ instances });
    }

    if (path === "/api/fs/list") {
      const dirPath = url.searchParams.get("path") || "~";
      const showHidden = url.searchParams.get("hidden") === "true";
      const listing = await listDirectory(dirPath, { showHidden });
      return json(listing);
    }

    if (path === "/api/fs/quick-paths") {
      const paths = getQuickPaths();
      const checked = await Promise.all(
        paths.map(async (p) => {
          try {
            await access(p.path, constants.R_OK);
            return { ...p, exists: true };
          } catch {
            return { ...p, exists: false };
          }
        })
      );
      return json({ paths: checked.filter((p) => p.exists) });
    }

    if (path === "/api/fs/scan-projects") {
      const rootPath = url.searchParams.get("path") || "~";
      const maxDepth = Math.min(parseInt(url.searchParams.get("depth") || "2", 10), 5);
      const projects = await scanForProjects(rootPath, maxDepth);
      return json({ projects });
    }

    if (path === "/api/fs/mkdir" && req.method === "POST") {
      const body = (await req.json()) as { parentPath: string; folderName: string };

      if (!validateFolderName(body.folderName)) {
        return json({ error: "Invalid folder name" }, 400);
      }

      const resolvedParent = resolvePath(body.parentPath.replace(/^~/, homedir()));
      const fullPath = joinPath(resolvedParent, body.folderName);

      // Resolve symlinks and validate the real path
      try {
        const realParent = await realpath(resolvedParent);
        assertAllowedPath(realParent);
      } catch {
        return json({ error: "Access denied" }, 403);
      }

      assertAllowedPath(fullPath);
      await mkdir(fullPath, { recursive: false });
      return json({ success: true, path: fullPath });
    }

    if (path === "/api/project/create" && req.method === "POST") {
      const body = (await req.json()) as {
        t3Port?: number;
        workspaceRoot: string;
        title?: string;
      };

      const targetPort = body.t3Port || T3_PORT;

      try {
        const bridge = await getT3Bridge(targetPort);
        const result = await bridge.createProject(body.workspaceRoot, body.title);
        return json({ success: true, project: result });
      } catch (err) {
        // Reset bridge on failure
        t3BridgeInstance = null;
        t3BridgePort = null;
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Failed to create project: ${msg}` }, 500);
      }
    }

    if (path === "/api/project/list") {
      const t3Port = parseInt(url.searchParams.get("port") || String(T3_PORT), 10);

      try {
        const bridge = await getT3Bridge(t3Port);
        const projects = await bridge.listProjects();
        return json({ projects });
      } catch (err) {
        t3BridgeInstance = null;
        t3BridgePort = null;
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Failed to list projects: ${msg}` }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: corsHeaders(),
  });
}

// --- Start server ---
await ensureT3Running();

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch: handleRequest,
});

const pairUrl = `http://localhost:${PORT}/pair`;

console.log(`
  T3 Code Remote companion server v0.1.0

  Companion:  http://${HOST}:${PORT}
  t3code:     http://${HOST}:${T3_PORT}
  Pair:       ${pairUrl}
`);

// Auto-open browser (using spawn, not exec, to prevent injection)
if (!NO_OPEN) {
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(openCmd, [pairUrl], { stdio: "ignore", detached: true }).unref();
}
