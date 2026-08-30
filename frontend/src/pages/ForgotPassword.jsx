import { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setMessage(""); setError(false);
    try {
      const response = await forgotPassword(email);
      setMessage(response.data.message);
    } catch (error) { setError(true); setMessage(error.response?.data?.message || "Could not start password reset."); }
    finally { setBusy(false); }
  }

  return <div className="auth-page"><div className="auth-card">
    <Link className="back-link" to="/login">← Back to login</Link>
    <h1>Reset your password</h1>
    <p>Enter the email address registered to your account. A secure, one-time reset link will be sent to that mailbox.</p>
    <form className="auth-form" onSubmit={submit}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="email" required /><button disabled={busy} aria-busy={busy}>{busy ? "Sending email…" : "Send reset email"}</button></form>
    {message && <div className={`auth-message ${error ? "" : "success"}`}>{message}</div>}
  </div></div>;
}
