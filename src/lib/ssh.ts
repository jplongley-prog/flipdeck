import { invoke } from "@tauri-apps/api/core";

export interface SshProfile {
  host: string;
  port: number;
  user: string;
  /** Password auth. Empty means "don't try password". */
  password?: string | null;
  /** Optional path to a private key file. */
  identityFile?: string | null;
  /** Passphrase protecting the private key, if any. */
  passphrase?: string | null;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run a single command on the Flipper One over SSH. */
export function sshRun(
  profile: SshProfile,
  command: string,
): Promise<CommandResult> {
  return invoke<CommandResult>("ssh_run", { profile, command });
}

/** Probe the connection (runs `uname -a`). code === 0 means reachable. */
export function sshTest(profile: SshProfile): Promise<CommandResult> {
  return invoke<CommandResult>("ssh_test", { profile });
}
