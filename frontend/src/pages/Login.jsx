import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { login, register } from "../api";

export default function Login({ onLogin }) {
  const [params] = useSearchParams();
  const [registerMode, setRegisterMode] = useState(params.get("register") === "1");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => setRegisterMode(params.get("register") === "1"), [params]);

  async function submit(e) {
    e.preventDefault(); setMessage(""); setLoading(true);
    try {
      const response = registerMode ? await register({ name, email, password }) : await login({ email, password });
      localStorage.setItem("domain_monitor_token", response.data.token);
      onLogin(response.data.user);
    } catch (error) {
      setMessage(error.response?.data?.message || "Something went wrong.");
    } finally { setLoading(false); }
  }

  return <div className="auth-page"><div className="auth-card">
    <Link className="back-link" to="/">← Back to Domain Monitor</Link>
    <h1>{registerMode ? "Create your account" : "Welcome back"}</h1>
    <p>{registerMode ? "Persist your domains, history, groups and dashboards." : "Sign in to access your saved monitoring workspace."}</p>
    <form onSubmit={submit} className="auth-form">
      {registerMode && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />}
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" required />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ characters)" minLength={6} required />
      <button disabled={loading}>{loading ? "Please wait…" : registerMode ? "Create account" : "Login"}</button>
    </form>
    {!registerMode && <Link className="text-link" to="/forgot-password">Forgot password?</Link>}
    {message && <div className="auth-message">{message}</div>}
    <button type="button" className="link-button" onClick={() => { setRegisterMode(!registerMode); setMessage(""); }}>
      {registerMode ? "Already have an account? Login" : "Need an account? Register"}
    </button>
  </div></div>;
}
