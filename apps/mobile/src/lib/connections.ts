/**
 * Connection manager — stores and syncs server connections.
 * Uses AsyncStorage with iCloud sync support via NSUbiquitousKeyValueStore.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ServerConnection {
  id: string;
  name: string;
  host: string;
  /** t3code server port (default 3773) */
  t3Port: number;
  /** Companion server port (default 3774) */
  companionPort: number;
  /** Auth token for the t3code server (if --auth-token was used) */
  authToken: string | null;
  /** Auth token for the companion server (obtained via QR pairing) */
  companionToken: string | null;
  /** Color label for visual identification */
  color: string;
  createdAt: string;
  lastConnectedAt: string | null;
}

const STORAGE_KEY = "t3code_remote_connections";

const COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export async function loadConnections(): Promise<ServerConnection[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ServerConnection[];
  } catch {
    return [];
  }
}

export async function saveConnections(
  connections: ServerConnection[]
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
}

export async function addConnection(
  conn: Omit<ServerConnection, "id" | "createdAt" | "lastConnectedAt" | "color" | "companionToken"> & { companionToken?: string | null }
): Promise<ServerConnection> {
  const connections = await loadConnections();
  const newConn: ServerConnection = {
    ...conn,
    companionToken: conn.companionToken ?? null,
    id: generateId(),
    color: randomColor(),
    createdAt: new Date().toISOString(),
    lastConnectedAt: null,
  };
  connections.push(newConn);
  await saveConnections(connections);
  return newConn;
}

export async function updateConnection(
  id: string,
  updates: Partial<Omit<ServerConnection, "id" | "createdAt">>
): Promise<void> {
  const connections = await loadConnections();
  const idx = connections.findIndex((c) => c.id === id);
  if (idx !== -1) {
    connections[idx] = { ...connections[idx], ...updates };
    await saveConnections(connections);
  }
}

export async function deleteConnection(id: string): Promise<void> {
  const connections = await loadConnections();
  await saveConnections(connections.filter((c) => c.id !== id));
}

export async function touchConnection(id: string): Promise<void> {
  await updateConnection(id, {
    lastConnectedAt: new Date().toISOString(),
  });
}
