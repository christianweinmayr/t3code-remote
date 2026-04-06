/**
 * Auto-discovers running t3code server instances by scanning processes.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execCb);

export interface T3Instance {
  pid: number;
  host: string;
  port: number;
  authToken: string | null;
  workspaceRoot: string | null;
}

/**
 * Scan running processes for t3code server instances.
 * Uses async exec to avoid blocking the event loop.
 */
export async function discoverInstances(): Promise<T3Instance[]> {
  try {
    const platform = process.platform;
    let output: string;

    if (platform === "win32") {
      const { stdout } = await execAsync(
        "wmic process get processid,commandline /format:csv",
        { timeout: 5000 }
      );
      output = stdout;
      return parseWindowsProcesses(output);
    } else {
      const { stdout } = await execAsync("ps aux", { timeout: 5000 });
      output = stdout;
      return parseUnixProcesses(output);
    }
  } catch {
    return [];
  }
}

function parseUnixProcesses(psOutput: string): T3Instance[] {
  const instances: T3Instance[] = [];
  const lines = psOutput.split("\n");

  for (const line of lines) {
    if (!isT3ServerProcess(line)) continue;

    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[1], 10);
    if (isNaN(pid)) continue;

    const cmdLine = parts.slice(10).join(" ");
    const instance = extractInstanceInfo(pid, cmdLine);
    if (instance) instances.push(instance);
  }

  return instances;
}

function parseWindowsProcesses(csvOutput: string): T3Instance[] {
  const instances: T3Instance[] = [];
  const lines = csvOutput.split("\n");

  for (const line of lines) {
    if (!isT3ServerProcess(line)) continue;

    const parts = line.split(",");
    const cmdLine = parts[1] || "";
    const pid = parseInt(parts[parts.length - 1], 10);
    if (isNaN(pid)) continue;

    const instance = extractInstanceInfo(pid, cmdLine);
    if (instance) instances.push(instance);
  }

  return instances;
}

function isT3ServerProcess(line: string): boolean {
  const patterns = [
    /\bt3\b.*\bserve\b/i,
    /\bt3\b.*--port/i,
    /\bt3\b.*--host/i,
    /\bt3\b.*--auth-token/i,
    /bin\.mjs.*--port/i,
    /t3-code/i,
    /t3code/i,
  ];
  return patterns.some((p) => p.test(line));
}

function extractInstanceInfo(pid: number, cmdLine: string): T3Instance | null {
  const portMatch = cmdLine.match(/--port\s+(\d+)/);
  const hostMatch = cmdLine.match(/--host\s+(\S+)/);
  const authMatch = cmdLine.match(/--auth-token\s+(\S+)/);
  const cwdMatch = cmdLine.match(/--cwd\s+(\S+)/);

  const port = portMatch ? parseInt(portMatch[1], 10) : 3773;

  return {
    pid,
    host: hostMatch?.[1] ?? "localhost",
    port,
    authToken: authMatch?.[1] ?? null,
    workspaceRoot: cwdMatch?.[1] ?? null,
  };
}

/**
 * Check if a t3code instance is reachable.
 */
export async function probeInstance(
  host: string,
  port: number,
  authToken?: string | null
): Promise<boolean> {
  try {
    const url = `http://${host}:${port}/`;
    const headers: Record<string, string> = {};
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}
