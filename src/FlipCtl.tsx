import { useCallback, useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { sshRun, type SshProfile } from "./lib/ssh";

interface SysInfo {
  hostname: string;
  kernel: string;
  uptime: string;
  cpus: string;
  mem: string;
  disk: string;
}

// One round-trip gathers the whole overview; prefixes keep parsing simple.
const SYS_CMD = [
  'echo "H:$(hostname 2>/dev/null)"',
  'echo "K:$(uname -r 2>/dev/null)"',
  'echo "U:$(uptime -p 2>/dev/null || uptime)"',
  'echo "C:$(nproc 2>/dev/null)"',
  `echo "M:$(free -h 2>/dev/null | awk '/Mem:/{print $3\\"/\\"$2}')"`,
  `echo "D:$(df -h / 2>/dev/null | awk 'NR==2{print $3\\"/\\"$2\\" (\\"$5\\")\\"}')"`,
].join("; ");

export default function FlipCtl({ profile }: { profile: SshProfile }) {
  const [sys, setSys] = useState<SysInfo | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [net, setNet] = useState("");
  const [unit, setUnit] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setOut("Refreshing…");
    try {
      const sysR = await sshRun(profile, SYS_CMD);
      const get = (p: string) =>
        sysR.stdout
          .split("\n")
          .find((l) => l.startsWith(`${p}:`))
          ?.slice(p.length + 1)
          .trim() ?? "";
      setSys({
        hostname: get("H"),
        kernel: get("K"),
        uptime: get("U"),
        cpus: get("C"),
        mem: get("M"),
        disk: get("D"),
      });

      const svcR = await sshRun(
        profile,
        "systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | awk '{print $1}' | head -n 60",
      );
      setServices(svcR.stdout.split("\n").map((s) => s.trim()).filter(Boolean));

      const netR = await sshRun(
        profile,
        "ip -brief address 2>/dev/null || ip addr 2>/dev/null",
      );
      setNet(netR.stdout.trim());
      setOut(sysR.code === 0 ? "Connected." : sysR.stderr.trim() || "Error");
    } catch (e) {
      setOut(String(e));
    } finally {
      setBusy(false);
    }
  }, [profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function runOnUnit(action: "status" | "start" | "stop" | "restart", name: string) {
    const target = name.trim();
    if (!target) return;
    if (action !== "status") {
      const ok = await confirm(`${action} service "${target}" on ${profile.host}?`, {
        title: "FlipCTL",
        kind: "warning",
      });
      if (!ok) return;
    }
    setBusy(true);
    setOut(`${action} ${target}…`);
    try {
      const cmd =
        action === "status"
          ? `systemctl status ${target} --no-pager -n 5 2>&1`
          : `systemctl ${action} ${target} 2>&1; systemctl is-active ${target} 2>&1`;
      const r = await sshRun(profile, cmd);
      setOut(r.stdout.trim() || r.stderr.trim() || `exit ${r.code}`);
      if (action !== "status") refresh();
    } catch (e) {
      setOut(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ctl">
      <div className="ctl-bar">
        <span className="ctl-title">FlipCTL — device control</span>
        <button onClick={refresh} disabled={busy}>
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      <div className="ctl-body">
        <section className="card">
          <h3>System</h3>
          {sys ? (
            <dl className="kv">
              <dt>Host</dt><dd>{sys.hostname || "—"}</dd>
              <dt>Kernel</dt><dd>{sys.kernel || "—"}</dd>
              <dt>Uptime</dt><dd>{sys.uptime || "—"}</dd>
              <dt>CPUs</dt><dd>{sys.cpus || "—"}</dd>
              <dt>Memory</dt><dd>{sys.mem || "—"}</dd>
              <dt>Disk /</dt><dd>{sys.disk || "—"}</dd>
            </dl>
          ) : (
            <div className="muted">No data yet.</div>
          )}
        </section>

        <section className="card">
          <h3>Manage a service</h3>
          <div className="svc-manage">
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="unit name, e.g. ssh.service"
            />
            <button className="ghost" onClick={() => runOnUnit("status", unit)} disabled={busy}>
              Status
            </button>
            <button className="ghost" onClick={() => runOnUnit("restart", unit)} disabled={busy}>
              Restart
            </button>
            <button className="ghost" onClick={() => runOnUnit("start", unit)} disabled={busy}>
              Start
            </button>
            <button className="ghost" onClick={() => runOnUnit("stop", unit)} disabled={busy}>
              Stop
            </button>
          </div>
          <pre className="ctl-out">{out}</pre>
        </section>

        <section className="card">
          <h3>Running services ({services.length})</h3>
          <div className="svc-list">
            {services.map((s) => (
              <button key={s} className="svc-chip" onClick={() => setUnit(s)} title="Select">
                {s}
              </button>
            ))}
            {services.length === 0 && <span className="muted">None listed.</span>}
          </div>
        </section>

        <section className="card">
          <h3>Network</h3>
          <pre className="ctl-net">{net || "—"}</pre>
        </section>
      </div>
    </div>
  );
}
