import { useEffect, useState } from "react";
import { sshRun, sshTest, type SshProfile, type CommandResult } from "./lib/ssh";
import {
  connectionsLoad,
  connectionsSave,
  type SavedConnection,
} from "./lib/connections";
import Files from "./Files";
import FlipCtl from "./FlipCtl";
import Profiles from "./Profiles";
import "./App.css";

type Status = "idle" | "testing" | "ok" | "error";
type View = "console" | "files" | "flipctl" | "profiles";

interface LogEntry {
  id: number;
  cmd: string;
  result?: CommandResult;
  error?: string;
}

function App() {
  const [profile, setProfile] = useState<SshProfile>({
    host: "flipper.local",
    port: 22,
    user: "flipper",
    password: "",
    identityFile: "",
    passphrase: "",
  });
  const [view, setView] = useState<View>("console");
  const [status, setStatus] = useState<Status>("idle");
  const [statusMsg, setStatusMsg] = useState("Not connected");
  const [command, setCommand] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [connName, setConnName] = useState("");

  function patch(p: Partial<SshProfile>) {
    setProfile((prev) => ({ ...prev, ...p }));
  }

  useEffect(() => {
    connectionsLoad().then(setSaved).catch(() => {});
  }, []);

  function onSelectSaved(id: string) {
    setSelectedId(id);
    const c = saved.find((x) => x.id === id);
    if (!c) return;
    // Password/passphrase are never stored — keep them blank to re-enter.
    setProfile({
      host: c.host,
      port: c.port,
      user: c.user,
      identityFile: c.identityFile ?? "",
      password: "",
      passphrase: "",
    });
    setConnName(c.name);
  }

  async function saveCurrent() {
    const name = (connName.trim() || profile.host).trim();
    if (!name) return;
    // Overwrite an existing entry with the same name, else add a new one.
    const existing = saved.find((c) => c.name === name);
    const entry: SavedConnection = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      host: profile.host,
      port: profile.port,
      user: profile.user,
      identityFile: profile.identityFile || null,
    };
    const next = existing
      ? saved.map((c) => (c.id === entry.id ? entry : c))
      : [...saved, entry];
    setSaved(next);
    setSelectedId(entry.id);
    try {
      await connectionsSave(next);
    } catch {
      /* ignore persist errors for now */
    }
  }

  async function deleteSaved() {
    if (!selectedId) return;
    const next = saved.filter((c) => c.id !== selectedId);
    setSaved(next);
    setSelectedId("");
    setConnName("");
    try {
      await connectionsSave(next);
    } catch {
      /* ignore */
    }
  }

  async function onTest() {
    setStatus("testing");
    setStatusMsg("Testing connection…");
    try {
      const r = await sshTest(profile);
      if (r.code === 0) {
        setStatus("ok");
        setStatusMsg(r.stdout.trim().split("\n")[0] || "Connected");
      } else {
        setStatus("error");
        setStatusMsg(r.stderr.trim() || `Exited with code ${r.code}`);
      }
    } catch (e) {
      setStatus("error");
      setStatusMsg(String(e));
    }
  }

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || busy) return;
    setBusy(true);
    const id = Date.now();
    setLog((l) => [{ id, cmd }, ...l]);
    try {
      const result = await sshRun(profile, cmd);
      setLog((l) => l.map((x) => (x.id === id ? { ...x, result } : x)));
    } catch (err) {
      setLog((l) => l.map((x) => (x.id === id ? { ...x, error: String(err) } : x)));
    } finally {
      setBusy(false);
      setCommand("");
    }
  }

  const pill =
    status === "ok" ? "online"
    : status === "error" ? "error"
    : status === "testing" ? "…"
    : "offline";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▚</span> FlipDeck
        </div>
        <div className="conn">
          <select
            className="f-saved"
            value={selectedId}
            onChange={(e) => onSelectSaved(e.target.value)}
            title="Saved connections"
          >
            <option value="">— saved —</option>
            {saved.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="f-name"
            value={connName}
            onChange={(e) => setConnName(e.target.value)}
            placeholder="name"
          />
          <button className="ghost" onClick={saveCurrent} title="Save current connection">
            Save
          </button>
          <button
            className="ghost"
            onClick={deleteSaved}
            disabled={!selectedId}
            title="Delete saved connection"
          >
            Del
          </button>
          <span className="sep" />
          <input
            className="f-host"
            value={profile.host}
            onChange={(e) => patch({ host: e.target.value })}
            placeholder="host / IP"
          />
          <input
            className="f-port"
            type="number"
            value={profile.port}
            onChange={(e) => patch({ port: Number(e.target.value) || 22 })}
          />
          <input
            className="f-user"
            value={profile.user}
            onChange={(e) => patch({ user: e.target.value })}
            placeholder="user"
          />
          <input
            className="f-pass"
            type="password"
            value={profile.password ?? ""}
            onChange={(e) => patch({ password: e.target.value })}
            placeholder="password"
          />
          <input
            className="f-key"
            value={profile.identityFile ?? ""}
            onChange={(e) => patch({ identityFile: e.target.value })}
            placeholder="key file (optional)"
          />
          <input
            className="f-pass"
            type="password"
            value={profile.passphrase ?? ""}
            onChange={(e) => patch({ passphrase: e.target.value })}
            placeholder="key passphrase"
          />
          <button onClick={onTest} disabled={status === "testing"}>
            Test
          </button>
          <span className={`pill ${status}`} title={statusMsg}>
            {pill}
          </span>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          <button
            className={`nav ${view === "console" ? "active" : ""}`}
            onClick={() => setView("console")}
          >
            Console
          </button>
          <button
            className={`nav ${view === "files" ? "active" : ""}`}
            onClick={() => setView("files")}
          >
            Files
          </button>
          <button
            className={`nav ${view === "flipctl" ? "active" : ""}`}
            onClick={() => setView("flipctl")}
          >
            FlipCTL
          </button>
          <button
            className={`nav ${view === "profiles" ? "active" : ""}`}
            onClick={() => setView("profiles")}
          >
            Profiles
          </button>
        </nav>

        <main className="content">
          {view === "console" ? (
            <>
              <form className="cmdbar" onSubmit={onRun}>
                <span className="prompt">
                  {profile.user}@{profile.host}:~$
                </span>
                <input
                  autoFocus
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="run a command over SSH…"
                />
                <button type="submit" disabled={busy}>
                  {busy ? "…" : "Run"}
                </button>
              </form>

              <div className="console">
                {log.length === 0 && (
                  <div className="empty">
                    No output yet. Test the connection, then run a command.
                  </div>
                )}
                {log.map((e) => (
                  <div key={e.id} className="entry">
                    <div className="entry-cmd">$ {e.cmd}</div>
                    {e.result?.stdout && <pre className="out">{e.result.stdout}</pre>}
                    {e.result?.stderr && <pre className="err">{e.result.stderr}</pre>}
                    {e.result && e.result.code !== 0 && e.result.code !== null && (
                      <div className="code">exit {e.result.code}</div>
                    )}
                    {e.error && <pre className="err">{e.error}</pre>}
                  </div>
                ))}
              </div>

              <footer className="statusline" data-status={status}>
                {statusMsg}
              </footer>
            </>
          ) : view === "files" ? (
            <Files profile={profile} />
          ) : view === "flipctl" ? (
            <FlipCtl profile={profile} />
          ) : (
            <Profiles profile={profile} />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
