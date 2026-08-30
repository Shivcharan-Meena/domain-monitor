import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Domains from "./pages/Domains";
import Groups from "./pages/Groups";
import Login from "./pages/Login";
import Home from "./pages/Home";
import About from "./pages/About";
import Contact from "./pages/Contact";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Admin from "./pages/Admin";
import { getMe } from "./api";

function Navbar({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = (path) => location.pathname === path || (path !== "/" && location.pathname.startsWith(path));

  function logout() {
    localStorage.removeItem("domain_monitor_token");
    onLogout();
    navigate("/");
  }

  return (
    <header className="navbar">
      <Link className="brand" to={user ? "/" : "/"}>Domain Monitor</Link>
      {user ? (
        <>
          <nav className="main-nav">
            <Link className={isActive("/") ? "active" : ""} to="/">Dashboard</Link>
            <Link className={isActive("/domains") ? "active" : ""} to="/domains">Domains</Link>
            <Link className={isActive("/groups") ? "active" : ""} to="/groups">Groups</Link>
            {user.is_admin && <Link className={isActive("/admin") ? "active" : ""} to="/admin">Administrator</Link>}
          </nav>
          <div className="user-menu">
            <img className="user-avatar" src={`https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(`${user.id}-${user.email}`)}`} alt="Cute avatar" loading="lazy" />
            <span>{user.name}</span>
            {user.is_admin && <span className="role-pill">Admin</span>}
            <button className="small outline" onClick={logout}>Logout</button>
          </div>
        </>
      ) : (
        <nav className="main-nav public-nav">
          <Link className={isActive("/about") ? "active" : ""} to="/about">About Us</Link>
          <Link className={isActive("/contact") ? "active" : ""} to="/contact">Contact Us</Link>
          <Link className="button small" to="/login">Login</Link>
          <Link className="button small primary-light" to="/login?register=1">Register</Link>
        </nav>
      )}
    </header>
  );
}

function PublicLayout({ children }) {
  return <div className="app"><Navbar user={null} onLogout={() => {}} /><main className="content public-content">{children}</main></div>;
}

function ProtectedLayout({ user, onLogout, children }) {
  return <div className="app"><Navbar user={user} onLogout={onLogout} /><main className="content">{children}</main></div>;
}

function Protected({ user, children }) {
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("domain_monitor_token");
    if (!token) {
      setChecking(false);
      return;
    }
    getMe()
      .then((response) => setUser(response.data))
      .catch(() => localStorage.removeItem("domain_monitor_token"))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="auth-page"><div className="auth-card"><h2>Loading Domain Monitor…</h2></div></div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login onLogin={setUser} />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/about" element={<PublicLayout><About /></PublicLayout>} />
      <Route path="/contact" element={<PublicLayout><Contact /></PublicLayout>} />
      <Route path="/" element={
        user ? <ProtectedLayout user={user} onLogout={() => setUser(null)}><Dashboard /></ProtectedLayout> : <PublicLayout><Home /></PublicLayout>
      } />
      <Route path="/domains" element={<Protected user={user}><ProtectedLayout user={user} onLogout={() => setUser(null)}><Domains /></ProtectedLayout></Protected>} />
      <Route path="/groups" element={<Protected user={user}><ProtectedLayout user={user} onLogout={() => setUser(null)}><Groups /></ProtectedLayout></Protected>} />
      <Route path="/admin" element={<Protected user={user}>{user?.is_admin ? <ProtectedLayout user={user} onLogout={() => setUser(null)}><Admin /></ProtectedLayout> : <Navigate to="/" replace />}</Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
