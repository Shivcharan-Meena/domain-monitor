import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { resetPassword } from "../api";

export default function ResetPassword() {
  const { token } = useParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault(); setMessage("");
    if (busy) return;
    if (password !== confirm) return setMessage("Passwords do not match.");
    try {
      setBusy(true);
      const response = await resetPassword(token, password);
      setMessage(response.data.message); setDone(true);
    } catch (error) { setMessage(error.response?.data?.message || "Reset link is invalid or expired."); }
    finally { setBusy(false); }
  }

  return <div className="auth-page"><div className="auth-card">
    <h1>Choose a new password</h1><p>This page is accessible only with a secure, one-time link sent to the account's registered email address.</p>
    {!done && <form className="auth-form" onSubmit={submit}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} placeholder="New password" required /><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={6} placeholder="Confirm password" required /><button disabled={busy} aria-busy={busy}>{busy ? "Updating password…" : "Reset password"}</button></form>}
    {message && <div className={`auth-message ${done ? "success" : ""}`}>{message}</div>}
    {done && <Link className="button" to="/login">Go to login</Link>}
  </div></div>;
}
