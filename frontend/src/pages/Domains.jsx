import { useEffect, useState } from "react";
import { checkAllDomains, checkDomain, deleteDomain, getDomains, getHistory, toggleDomain, updateDomain } from "../api";
import StatusBadge from "../components/StatusBadge";

function DomainLink({ url }) {
  return <a className="domain-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>;
}

export default function Domains() {
  const [domains, setDomains] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState("");
  const [checkingIds, setCheckingIds] = useState(() => new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [historyLoadingId, setHistoryLoadingId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [toggleId, setToggleId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  async function load() {
    const response = await getDomains();
    setDomains(response.data);
  }

  useEffect(() => {
    load().catch((e) => setMessage(e.response?.data?.message || "Could not load domains."));
  }, []);

  function startEdit(item) {
    setEditingId(item.id);
    setEditingValue(item.url);
  }

  async function saveEdit(id) {
    try {
      setSavingId(id);
      const response = await updateDomain(id, { domain: editingValue });
      setMessage(response.data.pending ? "Edit sent for owner approval." : "Domain updated.");
      setEditingId(null);
      if (!response.data.pending) {
        setDomains((current) => current.map((item) => item.id === id ? { ...item, ...response.data } : item));
      }
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not edit domain.");
    } finally {
      setSavingId(null);
    }
  }

  async function toggle(id) {
    try {
      setToggleId(id);
      const response = await toggleDomain(id);
      setDomains((current) => current.map((item) => item.id === id ? { ...item, ...response.data } : item));
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not change monitoring state.");
    } finally {
      setToggleId(null);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this domain?")) return;
    try {
      setDeleteId(id);
      await deleteDomain(id);
      setDomains((current) => current.filter((item) => item.id !== id));
      setMessage("Domain deleted.");
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not delete domain.");
    } finally {
      setDeleteId(null);
    }
  }

  async function check(id) {
    if (checkingAll || checkingIds.has(id)) return;
    setCheckingIds((current) => new Set(current).add(id));
    try {
      const response = await checkDomain(id);
      setDomains((current) => current.map((item) => item.id === id ? { ...item, ...response.data } : item));
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

  async function checkAll() {
    if (checkingAll || checkingIds.size) return;
    setCheckingAll(true);
    try {
      const response = await checkAllDomains();
      const byId = new Map(response.data.domains.map((item) => [Number(item.id), item]));
      setDomains((current) => current.map((item) => byId.get(Number(item.id)) || item));
      setMessage(`Checked ${response.data.domains.length} enabled domain(s).`);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not check all domains.");
    } finally {
      setCheckingAll(false);
    }
  }

  async function showHistory(item) {
    try {
      setHistoryLoadingId(item.id);
      const response = await getHistory(item.id);
      setSelected(item);
      setHistory(response.data);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not load history.");
    } finally {
      setHistoryLoadingId(null);
    }
  }

  if (selected) return <div>
    <div className="page-header">
      <div><span className="eyebrow">Domain history</span><h1><DomainLink url={selected.url} /></h1><p>Check history for this domain or subdomain.</p></div>
      <button className="small back-button" onClick={() => setSelected(null)}>← Back to domains</button>
    </div>
    <section className="panel"><div className="section-title"><h2>History</h2><span>{history.length} recent check(s)</span></div>
      <div className="table-wrap"><table><thead><tr><th>Status</th><th>Response</th><th>Checked</th><th>Error</th></tr></thead>
        <tbody>{history.map((item) => <tr key={item.id}><td><StatusBadge status={item.status} code={item.status_code} /></td><td>{item.response_time_ms ?? "-"} ms</td><td>{new Date(item.checked_at).toLocaleString()}</td><td>{item.error_message || "—"}</td></tr>)}{!history.length && <tr><td colSpan="4" className="empty-cell">No checks recorded yet.</td></tr>}</tbody>
      </table></div>
    </section>
  </div>;

  return <div>
    <div className="page-header">
      <div><span className="eyebrow">Saved inventory</span><h1>Domains</h1><p>“Enabled” means automatic monitoring is on. Disabled domains are skipped by scheduled and Check All runs.</p></div>
      <button className="secondary" onClick={checkAll} disabled={checkingAll || checkingIds.size > 0 || !domains.length}>{checkingAll ? "Checking all…" : "Check all domains"}</button>
    </div>
    {message && <div className="message panel">{message}</div>}
    <section className="panel table-wrap"><table><thead><tr><th>Domain / Subdomain</th><th>Status</th><th>Monitoring</th><th>Group</th><th>Last checked</th><th>Permission</th><th>Actions</th></tr></thead>
      <tbody>{domains.map((item) => {
        const canModify = ["admin", "edit_privileged"].includes(item.permission);
        const canEdit = ["admin", "edit", "edit_privileged"].includes(item.permission);
        return <tr key={item.id}>
          <td>{editingId === item.id ? <input value={editingValue} onChange={(e) => setEditingValue(e.target.value)} autoFocus /> : <DomainLink url={item.url} />}</td>
          <td><StatusBadge status={item.status} code={item.status_code} /></td>
          <td><button className="small outline-dark" title="Enabled = included in scheduled monitoring. Disabled = skipped." onClick={() => toggle(item.id)} disabled={!canModify || toggleId === item.id}>{toggleId === item.id ? "Working…" : item.enabled ? "Enabled" : "Disabled"}</button></td>
          <td>{item.group_name || "Personal"}</td>
          <td>{item.last_checked_at ? new Date(item.last_checked_at).toLocaleString() : "Never"}</td>
          <td>{item.permission}</td>
          <td className="actions">
            {canEdit && (editingId === item.id ? <button className="small" onClick={() => saveEdit(item.id)} disabled={savingId === item.id}>{savingId === item.id ? "Saving…" : "Save"}</button> : <button className="small" onClick={() => startEdit(item)}>Edit</button>)}
            <button className="small" onClick={() => check(item.id)} disabled={checkingAll || checkingIds.has(item.id)}>{checkingIds.has(item.id) ? "Checking…" : "Check"}</button>
            <button className="small" onClick={() => showHistory(item)} disabled={historyLoadingId === item.id}>{historyLoadingId === item.id ? "Loading…" : "History"}</button>
            {item.permission === "admin" && <button className="small danger" onClick={() => remove(item.id)} disabled={deleteId === item.id}>{deleteId === item.id ? "Deleting…" : "Delete"}</button>}
          </td>
        </tr>;
      })}{!domains.length && <tr><td colSpan="7" className="empty-cell">No domains yet.</td></tr>}</tbody>
    </table></section>
  </div>;
}
