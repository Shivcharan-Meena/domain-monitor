import { useState } from "react";
import { sendContactMessage } from "../api";

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", concern: "" });
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (sending) return;
    try {
      setSending(true);
      const response = await sendContactMessage(form);
      setStatus(response.data.message);
      setForm({ name: "", email: "", concern: "" });
    } catch (error) {
      setStatus(error.response?.data?.message || "Could not send your message.");
    } finally {
      setSending(false);
    }
  }

  return <div className="info-page narrow">
    <section className="info-hero"><span className="eyebrow">Contact Us</span><h1>Tell us what you need.</h1><p>Send a question, bug report or suggestion. Your message is saved for the application administrator to review.</p></section>
    <section className="panel contact-form-panel">
      <form className="auth-form" onSubmit={submit}>
        <label>Name<input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Your name" required /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="you@example.com" required /></label>
        <label>Concern<textarea value={form.concern} onChange={(e) => update("concern", e.target.value)} placeholder="Describe your concern or question…" rows="7" required /></label>
        <button type="submit" disabled={sending}>{sending ? "Sending…" : "Send message"}</button>
        {status && <div className="message">{status}</div>}
      </form>
    </section>
  </div>;
}
