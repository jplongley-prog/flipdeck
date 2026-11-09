import { invoke } from "@tauri-apps/api/core";

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  /** Path to a private key. Passwords are never persisted. */
  identityFile?: string | null;
}

export function connectionsLoad(): Promise<SavedConnection[]> {
  return invoke<SavedConnection[]>("connections_load");
}

export function connectionsSave(connections: SavedConnection[]): Promise<void> {
  return invoke<void>("connections_save", { connections });
}
