export default function About() {
  return <div className="info-page">
    <section className="info-hero"><span className="eyebrow">About Domain Monitor</span><h1>One place to see whether your websites are reachable.</h1><p>Domain Monitor turns simple URL checks into a persistent monitoring workspace with domain history, shared groups, permissions and custom dashboards.</p></section>
    <div className="info-grid"><div className="panel"><h2>Check anything</h2><p>Use a root domain or any nested subdomain such as <strong>h1.h2.google.com</strong>. Upload multiple domains from Excel when you have a larger list.</p></div><div className="panel"><h2>Keep it private</h2><p>Guest checks are session-only. Logged-in users get persistent storage, history and workspaces tied to their account.</p></div><div className="panel"><h2>Work as a team</h2><p>Create or join groups, give members view access, approval-based editing or privileged direct editing.</p></div><div className="panel"><h2>Admin control</h2><p>The platform administrator can manage users, groups, domains and administrator access.</p></div></div>
  </div>;
}
