import { useEffect, useMemo, useRef, useState } from "react";
import { addDomain, checkAllDomains, checkDomain, getDashboard, uploadExcel } from "../api";
import StatusBadge from "../components/StatusBadge";
import StatCard from "../components/StatCard";

function DomainLink({ url }) {
  return <a className="domain-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>;
}

function calculateStats(domains) {
  const checked = domains.filter((d) => d.enabled);
  const count = (status) => checked.filter((d) => d.status === status).length;
  const responseTimes = checked.map((d) => Number(d.response_time_ms)).filter(Number.isFinite);
  return {
    total: checked.length,
    ok: count("OK"),
    redirects: count("Redirect"),
    client_errors: count("Client Error"),
    server_errors: count("Server Error"),
    unreachable: count("Unreachable"),
    avg_response_time: responseTimes.length
      ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
      : 0,
  };
}

export default function Dashboard() {
  const [stats, setStats] = useState({});
  const [domains, setDomains] = useState([]);
  const [history, setHistory] = useState([]);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingIds, setCheckingIds] = useState(() => new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [message, setMessage] = useState("");
  const loadVersion = useRef(0);

  async function load() {
    const versionAtStart = loadVersion.current;
    const response = await getDashboard();
    // Ignore a load that started before a mutation (add/upload/check).
    if (versionAtStart !== loadVersion.current) return;
    setStats(response.data.stats || {});
    setDomains(response.data.domains || []);
    setHistory(response.data.history || []);
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => active && setMessage(e.response?.data?.message || "Could not load dashboard."));
    const timer = setInterval(() => load().catch(() => {}), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function handleAdd() {
    const value = domain.trim();
    if (!value || busy || checkingAll) return;
    try {
      setBusy(true);
      loadVersion.current += 1;
      const response = await addDomain(value);
      setDomain("");
      setDomains((current) => [response.data, ...current.filter((x) => x.id !== response.data.id)]);
      setMessage("Domain added and checked.");
      // Do not reload here: it makes the UI wait unnecessarily.
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not add domain.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file || busy || checkingAll) return;
    try {
      setBusy(true);
      loadVersion.current += 1;
      const response = await uploadExcel(file);
      setMessage(`Upload complete: ${response.data.added} added, ${response.data.skipped} skipped.`);
      await load();
    } catch (err) {
      setMessage(err.response?.data?.message || "Upload failed.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleCheck(id) {
    if (checkingAll || checkingIds.has(id)) return;
    setCheckingIds((current) => new Set(current).add(id));
    try {
      const response = await checkDomain(id);
      setDomains((current) => {
        const next = current.map((item) => item.id === id ? { ...item, ...response.data } : item);
        setStats(calculateStats(next));
        return next;
      });
      setMessage("Domain checked.");
    } catch (e) {
      setMessage(e.response?.data?.message || "Check failed.");
    } finally {
      setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleCheckAll() {
    if (checkingAll || checkingIds.size) return;
    setCheckingAll(true);
    try {
      const response = await checkAllDomains();
      const byId = new Map(response.data.domains.map((item) => [Number(item.id), item]));
      setDomains((current) => current.map((item) => byId.get(Number(item.id)) || item));
      const merged = domains.map((item) => byId.get(Number(item.id)) || item);
      setStats(calculateStats(merged));
      setMessage(`Checked ${response.data.domains.length} enabled domain(s).`);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not check all domains.");
    } finally {
      setCheckingAll(false);
    }
  }

  const anyChecking = checkingAll || checkingIds.size > 0;
  const hasDomains = useMemo(() => domains.length > 0, [domains]);

  return <div>
    <div className="page-header">
      <div>
        <span className="eyebrow">Your workspace</span>
        <h1>Domain Status Dashboard</h1>
        <p>Saved domains are checked automatically every {import.meta.env.VITE_CHECK_INTERVAL_MINUTES || 5} minutes.</p>
      </div>
      <button className="secondary" onClick={handleCheckAll} disabled={anyChecking || !hasDomains} aria-busy={checkingAll}>
        {checkingAll ? "Checking all…" : "Check all domains"}
      </button>
    </div>

    <section className="quick-add panel">
      <input
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="Add domain or subdomain, e.g. h1.h2.google.com"
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
      />
      <button onClick={handleAdd} disabled={busy || checkingAll || !domain.trim()} aria-busy={busy}>{busy ? "Saving…" : "Add Domain"}</button>
      <label className={`button upload-button ${busy ? "is-busy" : ""}`}>{busy ? "Uploading…" : "Upload Excel"}<input type="file" accept=".xlsx,.xls" hidden onChange={handleUpload} disabled={busy || checkingAll} /></label>
      {message && <span className="message inline-message">{message}</span>}
    </section>

    <section className="stats-grid">
      <StatCard title="Total" value={stats.total ?? 0} />
      <StatCard title="200 OK" value={stats.ok ?? 0} tone="green" />
      <StatCard title="Redirects" value={stats.redirects ?? 0} tone="yellow" />
      <StatCard title="4xx Errors" value={stats.client_errors ?? 0} tone="orange" />
      <StatCard title="5xx Errors" value={stats.server_errors ?? 0} tone="red" />
      <StatCard title="Unreachable" value={stats.unreachable ?? 0} tone="gray" />
      <StatCard title="Avg Response" value={`${stats.avg_response_time ?? 0} ms`} />
    </section>

    <section className="panel">
      <div className="section-title"><div><h2>Monitored domains</h2><span>{domains.length} accessible domain(s)</span></div></div>
      <div className="table-wrap"><table><thead><tr><th>Domain</th><th>Status</th><th>Group</th><th>Last checked</th><th>Monitoring</th><th></th></tr></thead>
        <tbody>{domains.map((item) => <tr key={item.id}>
          <td><DomainLink url={item.url} /></td>
          <td><StatusBadge status={item.status} code={item.status_code} /></td>
          <td>{item.group_name ? `${item.group_name} · ${item.permission || "view"}` : "Personal"}</td>
          <td>{item.last_checked_at ? new Date(item.last_checked_at).toLocaleString() : "Never"}</td>
          <td>{item.enabled ? "Enabled" : "Disabled"}</td>
          <td><button className="small" onClick={() => handleCheck(item.id)} disabled={checkingAll || checkingIds.has(item.id)} aria-busy={checkingIds.has(item.id)}>{checkingIds.has(item.id) ? "Checking…" : "Check now"}</button></td>
        </tr>)}{!domains.length && <tr><td colSpan="6" className="empty-cell">No saved domains yet. Add one above.</td></tr>}</tbody>
      </table></div>
    </section>

    <section className="panel">
      <div className="section-title"><div><h2>Recent checks</h2><span>Latest persistent history</span></div></div>
      <div className="history-list">{history.slice(0, 20).map((item) => <div className="history-row" key={item.id}>
        <div className="history-domain"><DomainLink url={item.url} /></div>
        <StatusBadge status={item.status} code={item.status_code} />
        <div>{item.response_time_ms ?? "-"} ms</div>
        <div>{new Date(item.checked_at).toLocaleString()}</div>
      </div>)}{!history.length && <p className="empty-state">No history yet.</p>}</div>
    </section>
  </div>;
}
