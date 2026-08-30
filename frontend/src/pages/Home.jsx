import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { guestCheck, guestUploadExcel } from "../api";
import StatusBadge from "../components/StatusBadge";
import StatCard from "../components/StatCard";

function guestStats(results) {
  const count = (s) => results.filter((x) => x.status === s).length;
  const times = results.map((x) => x.responseTimeMs).filter((x) => Number.isFinite(x));
  return { total: results.length, ok: count("OK"), redirects: count("Redirect"), client_errors: count("Client Error"), server_errors: count("Server Error"), unreachable: count("Unreachable"), avg_response_time: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0 };
}
function mergeResults(current, incoming) {
  const map = new Map(current.map((item) => [item.url, item]));
  for (const item of incoming) map.set(item.url, item);
  return Array.from(map.values());
}

export default function Home() {
  const [domain, setDomain] = useState("");
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const stats = useMemo(() => guestStats(results), [results]);

  async function check() {
    const value = domain.trim();
    if (!value || busy) return;
    try {
      setBusy(true);
      const response = await guestCheck([value]);
      setResults((current) => mergeResults(current, response.data.results));
      setDomain("");
      setMessage("Checked without saving. Add more domains or upload another Excel file.");
    } catch (e) { setMessage(e.response?.data?.message || "Could not check the domain."); }
    finally { setBusy(false); }
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    try {
      setBusy(true);
      const response = await guestUploadExcel(file);
      setResults((current) => mergeResults(current, response.data.results));
      setMessage(`Upload complete: ${response.data.results.length} domain(s) checked. Existing guest results were kept.`);
    } catch (err) { setMessage(err.response?.data?.message || "Could not process the Excel file."); }
    finally { setBusy(false); e.target.value = ""; }
  }

  return <div className="landing-page">
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow">Simple website & subdomain monitoring</span><h1>Check a domain in seconds. Monitor it for the long term when you sign in.</h1><p>Enter as many domains and subdomains as you need, or upload an Excel file. Guest checks stay in memory and are never stored.</p><div className="hero-actions"><Link className="button" to="/login?register=1">Create free account</Link><Link className="button secondary" to="/about">Learn more</Link></div></div>
      <div className="guest-card panel"><div className="section-title"><div><h2>Try it without login</h2><span>Root domains and unlimited subdomain depth are supported.</span></div></div><div className="quick-add guest-input-row"><input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="h1.h2.google.com" onKeyDown={(e) => e.key === "Enter" && check()} /><button onClick={check} disabled={busy || !domain.trim()} aria-busy={busy}>{busy ? "Checking…" : "Check"}</button><label className={`button upload-button ${busy ? "is-busy" : ""}`}>{busy ? "Uploading…" : "Upload Excel"}<input type="file" accept=".xlsx,.xls" hidden onChange={upload} disabled={busy} /></label></div><p className="privacy-note">You can add multiple domains one by one and upload Excel files without erasing earlier results. Refresh clears the guest session.</p>{message && <div className="message">{message}</div>}</div>
    </section>
    {results.length > 0 && <><section className="stats-grid guest-stats"><StatCard title="Checked" value={stats.total}/><StatCard title="2xx OK" value={stats.ok} tone="green"/><StatCard title="Redirects" value={stats.redirects} tone="yellow"/><StatCard title="4xx" value={stats.client_errors} tone="orange"/><StatCard title="5xx" value={stats.server_errors} tone="red"/><StatCard title="Unreachable" value={stats.unreachable} tone="gray"/><StatCard title="Avg Response" value={`${stats.avg_response_time} ms`}/></section><section className="panel table-wrap"><div className="section-title"><h2>Guest results</h2><span>{results.length} result(s), not stored</span></div><table><thead><tr><th>Domain</th><th>Status</th><th>Response</th><th>Checked</th></tr></thead><tbody>{results.map((item)=><tr key={item.url}><td><a className="domain-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a></td><td><StatusBadge status={item.status} code={item.statusCode}/></td><td>{item.responseTimeMs} ms</td><td>{new Date(item.checkedAt).toLocaleString()}</td></tr>)}</tbody></table></section></>}
  </div>;
}
