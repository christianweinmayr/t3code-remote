/**
 * Bridge to t3code server via WebSocket RPC.
 *
 * t3code uses a custom RPC protocol over WebSocket:
 *
 * Request:  { id: "1", body: { _tag: "method.name", ...params } }
 * Response: { id: "1", result: {...} }
 * Error:    { id: "1", error: { message: "..." } }
 * Push:     { type: "push", sequence: N, channel: "...", data: {...} }
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";

export class T3Bridge {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
    }
  >();

  constructor(
    private host: string,
    private port: number,
    private authToken: string | null
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Token in query string is required by t3code's WebSocket handler.
      // Acceptable here since this is a localhost-only connection.
      let url = `ws://${this.host}:${this.port}/ws`;
      if (this.authToken) {
        url += `?token=${encodeURIComponent(this.authToken)}`;
      }

      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout"));
        this.ws?.close();
      }, 5000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.on("error", (err: any) => {
        clearTimeout(timeout);
        const msg = err?.message || err?.error?.message || String(err);
        reject(new Error(`WebSocket error: ${msg}`));
      });

      this.ws.on("close", () => {
        this.ws = null;
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error("WebSocket connection closed"));
        }
        this.pendingRequests.clear();
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Skip push messages (server events)
          if (msg.type === "push") return;

          // Handle RPC responses
          if (msg.id && msg.id !== "unknown") {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
              this.pendingRequests.delete(msg.id);
              if (msg.error) {
                pending.reject(new Error(msg.error.message));
              } else {
                pending.resolve(msg.result);
              }
            }
          } else if (msg.error) {
            // Unknown id error — log it
            console.error("[t3bridge] RPC error:", msg.error.message);
          }
        } catch {
          // ignore malformed messages
        }
      });
    });
  }

  private rpc(tag: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to t3code server");
    }

    const id = String(++this.requestId);

    const request = {
      id,
      body: {
        _tag: tag,
        ...params,
      },
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${tag}`));
      }, 10000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * Create a project in t3code via orchestration command dispatch.
   */
  async createProject(
    workspaceRoot: string,
    title?: string
  ): Promise<unknown> {
    const now = new Date().toISOString();
    const projectTitle =
      title || workspaceRoot.split("/").filter(Boolean).pop() || "Project";

    return this.rpc("orchestration.dispatchCommand", {
      command: {
        type: "project.create",
        commandId: randomUUID(),
        projectId: randomUUID(),
        title: projectTitle,
        workspaceRoot,
        defaultModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-5-20250514",
        },
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  /**
   * List all projects via orchestration snapshot.
   */
  async listProjects(): Promise<unknown> {
    const snapshot = (await this.rpc("orchestration.getSnapshot", {})) as {
      projects?: unknown[];
    };
    return snapshot?.projects ?? [];
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
