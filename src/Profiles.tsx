import { useCallback, useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { sshRun, type SshProfile } from "./lib/ssh";

// btrfs OS profiles on the Flipper One are managed by `flipper-profile`
// (falling back to raw btrfs). Names are interpolated into a shell command,
// so they are restricted to a safe character set.
const NAME_OK = /^[A-Za-z0-9._-]+$/;

const LIST_CMD =
  "flipper-profile list 2>/dev/null || btrfs subvolume list / 2>&1 || echo 'profile tooling not found'";
const CURRENT_CMD =
  "flipper-profile current 2>/dev/null || btrfs subvolume get-default / 2>&1 || echo '-'";

export default function Profiles({ profile }: { profile: SshProfile }) {
  const [list, setList] = useState("");
  const [current, setCurrent] = useState("");
  const [name, setName] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setOut("Loading profiles…");
    try {
      const [cur, lst] = await Promise.all([
        sshRun(profile, CURRENT_CMD),
        sshRun(profile, LIST_CMD),
      ]);
      setCurrent(cur.stdout.trim() || cur.stderr.trim() || "—");
      setList(lst.stdout.trim() || lst.stderr.trim() || "(empty)");
      setOut("Ready.");
    } catch (e) {
      setOut(String(e));
    } finally {
      setBusy(false);
    }
  }, [profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(action: "create" | "switch" | "delete") {
    const n = name.trim();
    if (!n) return;
    if (!NAME_OK.test(n)) {
      setOut(`Invalid name "${n}". Use letters, digits, dot, dash, underscore.`);
      return;
    }
    const prompts: Record<typeof action, string> = {
      create: `Create a new profile snapshot "${n}"?`,
      switch: `Set "${n}" as the default profile to boot into? This takes effect on next reboot.`,
      delete: `Delete profile "${n}"? This permanently removes that snapshot and cannot be undone.`,
    };
    const ok = await confirm(prompts[action], {
      title: "FlipDeck — Profiles",
      kind: action === "delete" ? "error" : "warning",
    });
    if (!ok) return;

    const cmd =
      action === "create"
        ? `flipper-profile create ${n} 2>&1`
        : action === "switch"
          ? `flipper-profile switch ${n} 2>&1`
          : `flipper-profile delete ${n} 2>&1`;

    setBusy(true);
    setOut(`${action} ${n}…`);
    try {
      const r = await sshRun(profile, cmd);
      setOut(r.stdout.trim() || r.stderr.trim() || `exit ${r.code}`);
      refresh();
    } catch (e) {
      setOut(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ctl">
      <div className="ctl-bar">
        <span className="ctl-title">Profiles — btrfs OS snapshots</span>
        <button onClick={refresh} disabled={busy}>
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      <div className="ctl-body">
        <section className="card">
          <h3>Current profile</h3>
          <pre className="ctl-out" style={{ marginTop: 0 }}>{current || "—"}</pre>
        </section>

        <section className="card">
          <h3>Manage</h3>
          <div className="svc-manage">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="profile name"
            />
            <button className="ghost" onClick={() => act("create")} disabled={busy}>
              Create
            </button>
            <button className="ghost" onClick={() => act("switch")} disabled={busy}>
              Boot into
            </button>
            <button className="ghost danger" onClick={() => act("delete")} disabled={busy}>
              Delete
            </button>
          </div>
          <pre className="ctl-out">{out}</pre>
        </section>

        <section className="card card-wide">
          <h3>All profiles</h3>
          <pre className="ctl-net">{list || "—"}</pre>
        </section>
      </div>
    </div>
  );
}
