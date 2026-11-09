import { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { sftpList, sftpDownload, sftpUpload, type FileEntry } from "./lib/sftp";
import type { SshProfile } from "./lib/ssh";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

function parentPath(p: string): string {
  if (!p || p === "/") return "/";
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

export default function Files({ profile }: { profile: SshProfile }) {
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("Loading home directory…");

  const load = useCallback(
    async (path: string) => {
      setBusy(true);
      setMsg("Listing…");
      try {
        const l = await sftpList(profile, path);
        setCwd(l.cwd);
        setEntries(l.entries);
        setMsg(`${l.entries.length} items — ${l.cwd}`);
      } catch (e) {
        setMsg(String(e));
      } finally {
        setBusy(false);
      }
    },
    [profile],
  );

  useEffect(() => {
    load("");
  }, [load]);

  async function onDownload(entry: FileEntry) {
    try {
      const dest = await save({ defaultPath: entry.name });
      if (!dest) return;
      setBusy(true);
      setMsg(`Downloading ${entry.name}…`);
      const n = await sftpDownload(profile, entry.path, dest);
      setMsg(`Downloaded ${entry.name} (${fmtSize(n)}) → ${dest}`);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onUpload() {
    try {
      const picked = await open({ multiple: false });
      if (!picked || typeof picked !== "string") return;
      const base = picked.split(/[\\/]/).pop() || "upload.bin";
      const remote = cwd.endsWith("/") ? cwd + base : `${cwd}/${base}`;
      setBusy(true);
      setMsg(`Uploading ${base}…`);
      const n = await sftpUpload(profile, picked, remote);
      setMsg(`Uploaded ${base} (${fmtSize(n)}) → ${remote}`);
      await load(cwd);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="files">
      <div className="files-bar">
        <button
          onClick={() => load(parentPath(cwd))}
          disabled={busy || cwd === "/" || cwd === ""}
          title="Up one level"
        >
          ↑
        </button>
        <input
          className="path"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load(cwd);
          }}
          placeholder="/remote/path"
        />
        <button onClick={() => load(cwd)} disabled={busy}>
          Refresh
        </button>
        <button onClick={onUpload} disabled={busy}>
          Upload…
        </button>
      </div>

      <div className="files-list">
        {entries.length === 0 && !busy && (
          <div className="empty">Empty directory.</div>
        )}
        {entries.map((e) => (
          <div key={e.path} className="file-row">
            <button
              className="file-name"
              onClick={() => (e.isDir ? load(e.path) : onDownload(e))}
              title={e.isDir ? "Open folder" : "Download"}
            >
              <span className="ic">{e.isDir ? "📁" : "📄"}</span>
              {e.name}
            </button>
            <span className="file-size">{e.isDir ? "" : fmtSize(e.size)}</span>
            {!e.isDir && (
              <button className="dl" onClick={() => onDownload(e)} disabled={busy} title="Download">
                ↓
              </button>
            )}
          </div>
        ))}
      </div>

      <footer className="statusline">{msg}</footer>
    </div>
  );
}
