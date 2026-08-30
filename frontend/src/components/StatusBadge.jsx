export default function StatusBadge({ status, code }) {
  const cls = {
    OK: "ok",
    Redirect: "redirect",
    "Client Error": "client",
    Blocked: "client",
    "Server Error": "server",
    Unreachable: "down",
    Pending: "pending",
  }[status] || "pending";

  return <span className={`badge ${cls}`}>{status}{code ? ` · ${code}` : ""}</span>;
}
