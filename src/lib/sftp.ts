import { invoke } from "@tauri-apps/api/core";
import type { SshProfile } from "./ssh";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export interface Listing {
  cwd: string;
  entries: FileEntry[];
}

/** List a remote directory. Empty path = login/home directory. */
export function sftpList(profile: SshProfile, path: string): Promise<Listing> {
  return invoke<Listing>("sftp_list", { profile, path });
}

/** Download a remote file to a local path. Resolves to bytes written. */
export function sftpDownload(
  profile: SshProfile,
  remotePath: string,
  localPath: string,
): Promise<number> {
  return invoke<number>("sftp_download", { profile, remotePath, localPath });
}

/** Upload a local file to a remote path. Resolves to bytes sent. */
export function sftpUpload(
  profile: SshProfile,
  localPath: string,
  remotePath: string,
): Promise<number> {
  return invoke<number>("sftp_upload", { profile, localPath, remotePath });
}
