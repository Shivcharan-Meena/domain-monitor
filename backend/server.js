require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const cron = require("node-cron");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const { initDb, query } = require("./db");
const { normalizeUrl, checkUrl, checkDomain, checkDomainIds, checkAllDomains } = require("./monitor");

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const RESET_TOKEN_MINUTES = Number(process.env.RESET_TOKEN_MINUTES || 30);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || FRONTEND_URL.split(",")[0] || "http://localhost:5173").trim().replace(/\/$/, "");
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const MAIL_FROM = String(process.env.MAIL_FROM || SMTP_USER || "").trim();

const mailTransport = SMTP_HOST && SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

const resetRequestWindowMs = 15 * 60 * 1000;
const resetRequestLimit = 5;
const resetRequestLog = new Map();

function isResetRateLimited(key) {
  const now = Date.now();
  const current = resetRequestLog.get(key) || { count: 0, startedAt: now };
  if (now - current.startedAt >= resetRequestWindowMs) {
    resetRequestLog.set(key, { count: 1, startedAt: now });
    return false;
  }
  current.count += 1;
  resetRequestLog.set(key, current);
  return current.count > resetRequestLimit;
}

function buildResetEmail(resetUrl, name) {
  return {
    subject: "Reset your Domain Monitor password",
    text: `Hi ${name},\n\nWe received a request to reset your Domain Monitor password. Use this link within ${RESET_TOKEN_MINUTES} minutes:\n\n${resetUrl}\n\nThis link can be used only once. If you did not request a password reset, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:auto">
        <h2>Reset your Domain Monitor password</h2>
        <p>Hi ${String(name).replace(/[<>&\"]/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;",'\"':'&quot;'}[c]))},</p>
        <p>We received a request to reset your Domain Monitor password.</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:700">Reset password</a></p>
        <p>This link expires in <strong>${RESET_TOKEN_MINUTES} minutes</strong> and can be used only once.</p>
        <p>If you did not request this reset, you can safely ignore this email.</p>
      </div>`,
  };
}

async function sendPasswordResetEmail(email, name, resetUrl) {
  if (!mailTransport || !MAIL_FROM) {
    throw new Error("Password reset email service is not configured.");
  }
  const content = buildResetEmail(resetUrl, name);
  await mailTransport.sendMail({ from: MAIL_FROM, to: email, ...content });
}

// The React dev server runs on a different origin (5173) from the API (5000).
// Enable CORS and JSON parsing before any routes so browser preflight requests
// and JSON request bodies (guest checks, login, groups, etc.) work correctly.
const allowedOrigins = FRONTEND_URL.split(",").map((value) => value.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // Allow non-browser/server-to-server requests with no Origin header.
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
}));
app.use(express.json({ limit: "1mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function signToken(user) {
  return jwt.sign(
    { id: Number(user.id), email: user.email, name: user.name, isAdmin: Boolean(user.is_admin) },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

async function adminOnly(req, res, next) {
  try {
    const result = await query(`SELECT is_admin FROM users WHERE id = $1`, [req.user.id]);
    if (!result.rows[0]?.is_admin) return res.status(403).json({ message: "Administrator permission required" });
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getGroupAccess(userId, groupId) {
  const result = await query(
    `SELECT g.id, g.name, g.owner_id, g.join_code,
            CASE WHEN g.owner_id = $1 THEN 'admin' ELSE COALESCE(gm.permission, 'none') END AS permission
     FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
     WHERE g.id = $2 AND (g.owner_id = $1 OR gm.user_id = $1)`,
    [userId, groupId]
  );
  return result.rows[0] || null;
}

async function getDomainAccess(userId, domainId) {
  const result = await query(
    `SELECT d.*, CASE WHEN d.owner_id = $1 OR g.owner_id = $1 THEN 'admin' ELSE COALESCE(gm.permission, 'none') END AS permission
     FROM domains d LEFT JOIN groups g ON g.id = d.group_id
     LEFT JOIN group_members gm ON gm.group_id = d.group_id AND gm.user_id = $1
     WHERE d.id = $2 AND (d.owner_id = $1 OR g.owner_id = $1 OR gm.user_id = $1)`,
    [userId, domainId]
  );
  return result.rows[0] || null;
}

function canEdit(permission) { return ["admin", "edit", "edit_privileged"].includes(permission); }
function canDirectEdit(permission) { return ["admin", "edit_privileged"].includes(permission); }

function parseExcelDomains(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  if (!workbook.SheetNames.length) return [];
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map((row) => row.domain ?? row.Domain ?? row.URL ?? row.url ?? "");
}

// Return a clean JSON error for rejected browser origins.
app.use((error, req, res, next) => {
  if (error?.message?.startsWith("CORS blocked origin:")) {
    return res.status(403).json({ message: "This frontend origin is not allowed by the API." });
  }
  next(error);
});

async function checkGuestDomains(values) {
  const normalized = [];
  const seen = new Set();
  let invalid = 0;
  for (const raw of values || []) {
    const url = normalizeUrl(raw);
    if (!url) { invalid++; continue; }
    if (seen.has(url)) continue;
    seen.add(url); normalized.push(url);
  }
  const results = await Promise.all(normalized.map((url) => checkUrl(url)));
  return { results, invalid, skipped: Math.max(0, (values || []).length - normalized.length - invalid) };
}

// ---------------- HEALTH ----------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------------- GUEST / PUBLIC ----------------
// These endpoints deliberately never access the domains/status tables.
app.post("/api/guest/check", async (req, res) => {
  try {
    const domains = Array.isArray(req.body.domains) ? req.body.domains : [req.body.domain];
    const checked = await checkGuestDomains(domains.filter((value) => value != null));
    res.json({ ...checked, message: "Guest checks are session-only and are not saved." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/guest/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Excel file is required" });
    const values = parseExcelDomains(req.file.buffer);
    const checked = await checkGuestDomains(values);
    res.json({ ...checked, message: "Guest upload checked. Nothing was saved." });
  } catch (error) {
    res.status(400).json({ message: `Could not read the Excel file: ${error.message}` });
  }
});

// ---------------- AUTH ----------------
app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
      return res.status(400).json({ message: "Enter a valid name, email and password of at least 6 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, is_admin, created_at`,
      [name, email, passwordHash]
    );
    const user = result.rows[0];
    res.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "Email is already registered" });
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const result = await query(
      `SELECT id, name, email, password_hash, is_admin, created_at FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    delete user.password_hash;
    res.json({ user, token: signToken(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const result = await query(
    `SELECT id, name, email, is_admin, created_at FROM users WHERE id = $1`,
    [req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ message: "User not found" });
  res.json(result.rows[0]);
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const generic = "If that email is registered, a password reset email has been sent.";
  const rateKey = `${req.ip || "unknown"}:${crypto.createHash("sha256").update(email).digest("hex")}`;

  if (isResetRateLimited(rateKey)) {
    return res.status(429).json({ message: "Too many reset requests. Please try again later." });
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.json({ message: generic });
  }

  try {
    const userResult = await query(`SELECT id, name, email FROM users WHERE email = $1`, [email]);
    if (!userResult.rows.length) return res.json({ message: generic });

    if (!mailTransport || !MAIL_FROM) {
      console.error("Password reset requested but SMTP is not configured.");
      return res.status(503).json({
        message: "Password reset email service is temporarily unavailable. Please contact the administrator.",
      });
    }

    const user = userResult.rows[0];
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'))`,
      [user.id, tokenHash, RESET_TOKEN_MINUTES]
    );

    const resetUrl = `${PUBLIC_APP_URL}/reset-password/${rawToken}`;
    try {
      await sendPasswordResetEmail(user.email, user.name, resetUrl);
    } catch (mailError) {
      await query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1`, [tokenHash]);
      console.error("Password reset email failed:", mailError.message);
      return res.status(503).json({
        message: "Password reset email service is temporarily unavailable. Please try again later.",
      });
    }

    // Never return or log the reset token/link. Ownership is verified by control
    // of the registered mailbox that received this one-time link.
    res.json({ message: generic });
  } catch (error) {
    res.status(500).json({ message: "Could not start password reset." });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    if (!token || password.length < 6) return res.status(400).json({ message: "A valid reset token and password of at least 6 characters are required." });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    if (!result.rows.length) return res.status(400).json({ message: "Reset link is invalid or expired." });

    const passwordHash = await bcrypt.hash(password, 12);
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, result.rows[0].user_id]);
    await query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [result.rows[0].user_id]);
    res.json({ message: "Password reset successfully. You can now log in." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------- GROUPS ----------------
app.get("/api/groups", auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT g.id, g.name, g.owner_id, g.join_code, g.created_at,
              CASE WHEN g.owner_id = $1 THEN 'admin' ELSE gm.permission END AS permission,
              (SELECT COUNT(*)::int FROM domains d WHERE d.group_id = g.id) AS domain_count,
              (1 + (SELECT COUNT(*)::int FROM group_members gm2 WHERE gm2.group_id = g.id)) AS member_count
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       WHERE g.owner_id = $1 OR gm.user_id = $1
       ORDER BY g.id DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups", auth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const domainIds = Array.isArray(req.body.domainIds) ? req.body.domainIds.map(Number).filter(Number.isFinite) : [];
    if (!name) return res.status(400).json({ message: "Group name is required" });

    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `DM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      try {
        result = await query(
          `INSERT INTO groups (name, owner_id, join_code) VALUES ($1, $2, $3) RETURNING *`,
          [name, req.user.id, code]
        );
        break;
      } catch (error) {
        if (error.code !== "23505") throw error;
      }
    }
    if (!result) return res.status(500).json({ message: "Could not generate a unique group join code" });

    const group = result.rows[0];
    if (domainIds.length) {
      await query(
        `UPDATE domains SET group_id = $1, updated_at = NOW()
         WHERE owner_id = $2 AND id = ANY($3::bigint[])`,
        [group.id, req.user.id, domainIds]
      );
    } else {
      // A group created without an explicit selection should still be useful:  
      // include the owner's currently personal domains, but never steal a domain
      // that already belongs to another group.
      await query(
        `UPDATE domains
         SET group_id = $1, updated_at = NOW()
         WHERE owner_id = $2 AND group_id IS NULL`,
        [group.id, req.user.id]
      );
    }
    res.status(201).json(group);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups/join", auth, async (req, res) => {
  try {
    const code = String(req.body.joinCode || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ message: "Group join code is required" });

    const result = await query(`SELECT id, name, owner_id FROM groups WHERE join_code = $1`, [code]);
    if (!result.rows.length) return res.status(404).json({ message: "Group not found. Check the join code." });
    const group = result.rows[0];
    if (Number(group.owner_id) === Number(req.user.id)) return res.status(400).json({ message: "You already own this group." });

    await query(
      `INSERT INTO group_members (group_id, user_id, permission)
       VALUES ($1, $2, 'view')
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [group.id, req.user.id]
    );
    res.json({ message: "Joined group with view permission.", group });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/groups/:id", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access) return res.status(404).json({ message: "Group not found" });

    const [members, domains, recentHistory, requests, permissionRequests, domainAddRequests, myPermissionRequests, myEditRequests, myDomainAddRequests, stats] = await Promise.all([
      query(`SELECT u.id, u.name, u.email, gm.permission
             FROM group_members gm JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = $1 ORDER BY u.name`, [groupId]),
      query(`SELECT d.* FROM domains d WHERE d.group_id = $1 ORDER BY d.id DESC`, [groupId]),
      query(`SELECT h.*, d.url FROM status_history h JOIN domains d ON d.id = h.domain_id WHERE d.group_id = $1 ORDER BY h.checked_at DESC LIMIT 50`, [groupId]),
      access.permission === "admin"
        ? query(`SELECT er.*, d.url, u.name AS requester_name, u.email AS requester_email
                 FROM edit_requests er JOIN domains d ON d.id = er.domain_id JOIN users u ON u.id = er.requester_id
                 WHERE d.group_id = $1 AND er.status = 'pending' ORDER BY er.created_at DESC`, [groupId])
        : Promise.resolve({ rows: [] }),
      access.permission === "admin"
        ? query(`SELECT pr.*, u.name AS requester_name, u.email AS requester_email
                 FROM permission_requests pr JOIN users u ON u.id = pr.user_id
                 WHERE pr.group_id = $1 AND pr.status = 'pending' ORDER BY pr.created_at DESC`, [groupId])
        : Promise.resolve({ rows: [] }),
      access.permission === "admin"
        ? query(`SELECT ar.*, u.name AS requester_name, u.email AS requester_email
                 FROM domain_add_requests ar JOIN users u ON u.id = ar.requester_id
                 WHERE ar.group_id = $1 AND ar.status = 'pending' ORDER BY ar.created_at DESC`, [groupId])
        : Promise.resolve({ rows: [] }),
      query(`SELECT * FROM permission_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending' ORDER BY created_at DESC`, [groupId, req.user.id]),
      query(`SELECT er.*, d.url FROM edit_requests er JOIN domains d ON d.id = er.domain_id
             WHERE d.group_id = $1 AND er.requester_id = $2 AND er.status = 'pending' ORDER BY er.created_at DESC`, [groupId, req.user.id]),
      query(`SELECT * FROM domain_add_requests WHERE group_id = $1 AND requester_id = $2 AND status = 'pending' ORDER BY created_at DESC`, [groupId, req.user.id]),
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'OK')::int AS ok,
                    COUNT(*) FILTER (WHERE status = 'Redirect')::int AS redirects,
                    COUNT(*) FILTER (WHERE status = 'Client Error')::int AS client_errors,
                    COUNT(*) FILTER (WHERE status = 'Server Error')::int AS server_errors,
                    COUNT(*) FILTER (WHERE status = 'Unreachable')::int AS unreachable,
                    COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
                    COALESCE(ROUND(AVG(response_time_ms))::int, 0) AS avg_response_time
             FROM domains WHERE group_id = $1`, [groupId]),
    ]);

    res.json({ group: access, members: members.rows, domains: domains.rows, recentHistory: recentHistory.rows, editRequests: requests.rows, permissionRequests: permissionRequests.rows, domainAddRequests: domainAddRequests.rows, myPermissionRequests: myPermissionRequests.rows, myEditRequests: myEditRequests.rows, myDomainAddRequests: myDomainAddRequests.rows, stats: stats.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups/:id/members", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the group owner can manage members" });

    const email = String(req.body.email || "").trim().toLowerCase();
    const permission = String(req.body.permission || "view");
    if (!email || !["view", "edit", "edit_privileged"].includes(permission)) return res.status(400).json({ message: "Valid email and permission are required" });

    const userResult = await query(`SELECT id, name, email FROM users WHERE email = $1`, [email]);
    if (!userResult.rows.length) return res.status(404).json({ message: "User is not registered yet" });
    if (Number(userResult.rows[0].id) === Number(req.user.id)) return res.status(400).json({ message: "The group owner is already the admin" });

    await query(
      `INSERT INTO group_members (group_id, user_id, permission) VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET permission = EXCLUDED.permission`,
      [groupId, userResult.rows[0].id, permission]
    );
    res.status(201).json({ message: "Member added", member: { ...userResult.rows[0], permission } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch("/api/groups/:id/members/:userId", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the group owner can manage members" });
    const permission = String(req.body.permission || "view");
    if (!["view", "edit", "edit_privileged"].includes(permission)) return res.status(400).json({ message: "Invalid permission" });
    await query(`UPDATE group_members SET permission = $1 WHERE group_id = $2 AND user_id = $3`, [permission, groupId, userId]);
    res.json({ message: "Permission updated" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete("/api/groups/:id/members/:userId", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the group owner can manage members" });
    await query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
    res.json({ message: "Member removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups/:id/domain", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const url = normalizeUrl(req.body.domain);
    if (!url) return res.status(400).json({ message: "Enter a valid domain or subdomain" });

    const access = await getGroupAccess(req.user.id, groupId);
    if (!access) return res.status(404).json({ message: "Group not found" });

    const existing = await query(`SELECT id FROM domains WHERE group_id = $1 AND url = $2`, [groupId, url]);
    if (existing.rows.length) return res.status(409).json({ message: "That domain is already in this group" });

    if (!canDirectEdit(access.permission)) {
      if (access.permission !== "edit") {
        return res.status(403).json({ message: "You need edit permission to request a new group domain." });
      }
      const pending = await query(
        `INSERT INTO domain_add_requests (group_id, requester_id, url) VALUES ($1,$2,$3) RETURNING *`,
        [groupId, req.user.id, url]
      );
      return res.status(202).json({ pending: true, message: "Domain addition sent to the group owner for approval.", request: pending.rows[0] });
    }

    const result = await query(
      `INSERT INTO domains (url, owner_id, group_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_id, url) DO NOTHING
       RETURNING *`,
      [url, req.user.id, groupId]
    );

    if (!result.rows.length) return res.status(409).json({ message: "You already own this domain" });
    const created = result.rows[0];
    const checked = await checkDomain(created.id);
    res.status(201).json(checked);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "A pending request for this domain already exists." });
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups/:id/domains", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the group owner can add domains" });
    const domainIds = Array.isArray(req.body.domainIds) ? req.body.domainIds.map(Number).filter(Number.isFinite) : [];
    if (!domainIds.length) return res.status(400).json({ message: "Select at least one domain" });
    await query(`UPDATE domains SET group_id = $1, updated_at = NOW() WHERE owner_id = $2 AND id = ANY($3::bigint[])`, [groupId, req.user.id, domainIds]);
    res.json({ message: "Domains added to group" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete("/api/groups/:id/domains/:domainId", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const domainId = Number(req.params.domainId);
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the group owner can remove domains" });
    await query(`UPDATE domains SET group_id = NULL, updated_at = NOW() WHERE id = $1 AND group_id = $2 AND owner_id = $3`, [domainId, groupId, req.user.id]);
    res.json({ message: "Domain removed from group" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups/:id/edit-requests/:requestId", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    const decision = String(req.body.decision || "");
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the group owner can review edits" });
    if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ message: "Decision must be approved or rejected" });

    const result = await query(
      `SELECT er.* FROM edit_requests er JOIN domains d ON d.id = er.domain_id
       WHERE er.id = $1 AND d.group_id = $2 AND er.status = 'pending'`,
      [requestId, groupId]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Edit request not found" });
    const request = result.rows[0];

    if (decision === "approved") {
      await query(`UPDATE domains SET url = $1, updated_at = NOW() WHERE id = $2`, [request.new_url, request.domain_id]);
      await checkDomain(request.domain_id);
    }

    await query(`UPDATE edit_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`, [decision, req.user.id, requestId]);
    res.json({ message: `Edit ${decision}` });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "That domain already exists for the owner." });
    res.status(500).json({ message: error.message });
  }
});


app.post("/api/groups/:id/domain-add-requests/:requestId", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    const decision = String(req.body.decision || "");
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the group owner can review domain additions" });
    if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ message: "Decision must be approved or rejected" });

    const result = await query(`SELECT * FROM domain_add_requests WHERE id=$1 AND group_id=$2 AND status='pending'`, [requestId, groupId]);
    if (!result.rows.length) return res.status(404).json({ message: "Domain add request not found" });
    const request = result.rows[0];

    if (decision === "approved") {
      const duplicate = await query(`SELECT id FROM domains WHERE group_id=$1 AND url=$2`, [groupId, request.url]);
      if (duplicate.rows.length) {
        await query(`UPDATE domain_add_requests SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`, [req.user.id, requestId]);
        return res.status(409).json({ message: "That domain is already in the group; request rejected." });
      }
      const inserted = await query(`INSERT INTO domains (url, owner_id, group_id) VALUES ($1,$2,$3) RETURNING id`, [request.url, request.requester_id, groupId]);
      await checkDomain(inserted.rows[0].id);
    }

    await query(`UPDATE domain_add_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3`, [decision, req.user.id, requestId]);
    res.json({ message: `Domain addition ${decision}.` });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "That domain already exists for this owner." });
    res.status(500).json({ message: error.message });
  }
});

// Member asks the group owner for elevated editing permission.
app.post("/api/groups/:id/permission-requests", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const requestedPermission = String(req.body.permission || "edit");
    const message = String(req.body.message || "").trim().slice(0, 500);
    if (!["edit", "edit_privileged"].includes(requestedPermission)) {
      return res.status(400).json({ message: "Choose edit or privileged edit." });
    }

    const access = await getGroupAccess(req.user.id, groupId);
    if (!access) return res.status(404).json({ message: "Group not found" });
    if (access.permission === "admin") {
      return res.status(400).json({ message: "The group owner already has administrator access." });
    }
    if (access.permission === requestedPermission || (access.permission === "edit_privileged" && requestedPermission === "edit")) {
      return res.status(400).json({ message: "You already have that permission." });
    }

    const result = await query(
      `INSERT INTO permission_requests (group_id, user_id, requested_permission, message)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [groupId, req.user.id, requestedPermission, message || null]
    );
    res.status(201).json({ message: "Permission request sent to the group owner.", request: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "You already have a pending permission request for this group." });
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups/:id/permission-requests/:requestId", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    const decision = String(req.body.decision || "");
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the group owner can review permission requests" });
    if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ message: "Decision must be approved or rejected" });

    const result = await query(
      `SELECT * FROM permission_requests WHERE id = $1 AND group_id = $2 AND status = 'pending'`,
      [requestId, groupId]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Permission request not found" });
    const request = result.rows[0];

    if (decision === "approved") {
      await query(
        `INSERT INTO group_members (group_id, user_id, permission)
         VALUES ($1,$2,$3)
         ON CONFLICT (group_id,user_id) DO UPDATE SET permission = EXCLUDED.permission`,
        [groupId, request.user_id, request.requested_permission]
      );
    }

    await query(
      `UPDATE permission_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3`,
      [decision, req.user.id, requestId]
    );
    res.json({ message: `Permission request ${decision}.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------- CONTACT ----------------
app.post("/api/contact", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const concern = String(req.body.concern || "").trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || concern.length < 5) {
      return res.status(400).json({ message: "Please enter your name, a valid email address, and your concern." });
    }
    await query(`INSERT INTO contact_messages (name,email,concern) VALUES ($1,$2,$3)`, [name,email,concern]);
    res.status(201).json({ message: "Thanks. Your message has been sent to the administrator." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------- DOMAINS ----------------
app.get("/api/domains", auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT d.*, g.name AS group_name,
              CASE WHEN d.owner_id = $1 OR g.owner_id = $1 THEN 'admin' ELSE COALESCE(gm.permission, 'none') END AS permission
       FROM domains d
       LEFT JOIN groups g ON g.id = d.group_id
       LEFT JOIN group_members gm ON gm.group_id = d.group_id AND gm.user_id = $1
       WHERE d.owner_id = $1 OR g.owner_id = $1 OR gm.user_id = $1
       ORDER BY d.id DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/domains", auth, async (req, res) => {
  try {
    const url = normalizeUrl(req.body.domain);
    if (!url) return res.status(400).json({ message: "Enter a valid domain or subdomain, e.g. h1.h2.google.com" });
    const result = await query(`INSERT INTO domains (url, owner_id) VALUES ($1, $2) ON CONFLICT (owner_id, url) DO NOTHING RETURNING *`, [url, req.user.id]);
    if (!result.rows.length) return res.status(409).json({ message: "Domain already exists" });
    const created = result.rows[0];
    // Do the first check before responding so the UI never has to show a
    // misleading long-lived "Pending" row.
    const checked = await checkDomain(created.id);
    res.status(201).json(checked);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/api/domains/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const url = normalizeUrl(req.body.domain);
    if (!url) return res.status(400).json({ message: "Enter a valid domain or subdomain" });
    const access = await getDomainAccess(req.user.id, id);
    if (!access || !canEdit(access.permission)) return res.status(403).json({ message: "You do not have permission to edit this domain" });

    if (!canDirectEdit(access.permission)) {
      const result = await query(
        `INSERT INTO edit_requests (domain_id, requester_id, old_url, new_url) VALUES ($1, $2, $3, $4) RETURNING id, status`,
        [id, req.user.id, access.url, url]
      );
      return res.status(202).json({ message: "Edit submitted for admin approval", pending: true, request: result.rows[0] });
    }

    const result = await query(
      `UPDATE domains SET url = $1, enabled = COALESCE($2, enabled), updated_at = NOW() WHERE id = $3 RETURNING *`,
      [url, typeof req.body.enabled === "boolean" ? req.body.enabled : null, id]
    );
    res.json(await checkDomain(result.rows[0].id));
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "Domain already exists" });
    res.status(500).json({ message: error.message });
  }
});

app.patch("/api/domains/:id/toggle", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await getDomainAccess(req.user.id, id);
    if (!access || !canEdit(access.permission)) return res.status(403).json({ message: "You do not have permission to edit this domain" });
    if (!canDirectEdit(access.permission)) return res.status(403).json({ message: "Changing enabled state requires admin or privileged edit permission" });
    const result = await query(`UPDATE domains SET enabled = NOT enabled, updated_at = NOW() WHERE id = $1 RETURNING *`, [id]);
    if (!result.rows.length) return res.status(404).json({ message: "Domain not found" });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete("/api/domains/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await getDomainAccess(req.user.id, id);
    if (!access || access.permission !== "admin") return res.status(403).json({ message: "Only the owner/group admin can delete a domain" });
    const result = await query(`DELETE FROM domains WHERE id = $1 RETURNING id`, [id]);
    if (!result.rows.length) return res.status(404).json({ message: "Domain not found" });
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/domains/:id/check", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await getDomainAccess(req.user.id, id);
    if (!access) return res.status(404).json({ message: "Domain not found" });
    // This endpoint intentionally checks exactly one requested domain.
    res.json(await checkDomain(id));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/domains/check-all", auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT d.id
       FROM domains d
       LEFT JOIN groups g ON g.id = d.group_id
       LEFT JOIN group_members gm ON gm.group_id = d.group_id AND gm.user_id = $1
       WHERE d.enabled = TRUE AND (d.owner_id = $1 OR g.owner_id = $1 OR gm.user_id = $1)
       ORDER BY d.id`,
      [req.user.id]
    );
    const domains = await checkDomainIds(result.rows.map((row) => Number(row.id)));
    res.json({ domains });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups/:id/check-all", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access) return res.status(404).json({ message: "Group not found" });
    const result = await query(`SELECT id FROM domains WHERE group_id = $1 AND enabled = TRUE ORDER BY id`, [groupId]);
    const domains = await checkDomainIds(result.rows.map((row) => Number(row.id)));
    res.json({ domains });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/domains/:id/history", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await getDomainAccess(req.user.id, id);
    if (!access) return res.status(404).json({ message: "Domain not found" });
    const result = await query(`SELECT * FROM status_history WHERE domain_id = $1 ORDER BY checked_at DESC LIMIT 100`, [id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/dashboard", auth, async (req, res) => {
  try {
    const [stats, domains, history] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'OK')::int AS ok,
                COUNT(*) FILTER (WHERE status = 'Redirect')::int AS redirects,
                COUNT(*) FILTER (WHERE status = 'Client Error')::int AS client_errors,
                COUNT(*) FILTER (WHERE status = 'Server Error')::int AS server_errors,
                COUNT(*) FILTER (WHERE status = 'Unreachable')::int AS unreachable,
                COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
                COALESCE(ROUND(AVG(response_time_ms))::int, 0) AS avg_response_time
         FROM domains d
         LEFT JOIN groups g ON g.id = d.group_id
         LEFT JOIN group_members gm ON gm.group_id = d.group_id AND gm.user_id = $1
         WHERE d.enabled = TRUE AND (d.owner_id = $1 OR g.owner_id = $1 OR gm.user_id = $1)`,
        [req.user.id]
      ),
      query(
        `SELECT d.*, g.name AS group_name,
                CASE WHEN d.owner_id = $1 OR g.owner_id = $1 THEN 'admin' ELSE COALESCE(gm.permission, 'none') END AS permission
         FROM domains d
         LEFT JOIN groups g ON g.id = d.group_id
         LEFT JOIN group_members gm ON gm.group_id = d.group_id AND gm.user_id = $1
         WHERE d.owner_id = $1 OR g.owner_id = $1 OR gm.user_id = $1
         ORDER BY d.id DESC`,
        [req.user.id]
      ),
      query(
        `SELECT h.*, d.url FROM status_history h
         JOIN domains d ON d.id = h.domain_id
         LEFT JOIN groups g ON g.id = d.group_id
         LEFT JOIN group_members gm ON gm.group_id = d.group_id AND gm.user_id = $1
         WHERE d.owner_id = $1 OR g.owner_id = $1 OR gm.user_id = $1
         ORDER BY h.checked_at DESC LIMIT 50`,
        [req.user.id]
      ),
    ]);
    res.json({ stats: stats.rows[0], domains: domains.rows, history: history.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/history/recent", auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT h.*, d.url FROM status_history h JOIN domains d ON d.id = h.domain_id
       LEFT JOIN groups g ON g.id = d.group_id
       LEFT JOIN group_members gm ON gm.group_id = d.group_id AND gm.user_id = $1
       WHERE d.owner_id = $1 OR g.owner_id = $1 OR gm.user_id = $1
       ORDER BY h.checked_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/groups/:id/dashboard", auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const access = await getGroupAccess(req.user.id, groupId);
    if (!access) return res.status(404).json({ message: "Group not found" });

    const [domains, history, stats] = await Promise.all([
      query(`SELECT d.*
             FROM domains d
             WHERE d.group_id = $1
             ORDER BY d.id DESC`, [groupId]),
      query(`SELECT h.*, d.url
             FROM status_history h
             JOIN domains d ON d.id = h.domain_id
             WHERE d.group_id = $1
             ORDER BY h.checked_at DESC
             LIMIT 50`, [groupId]),
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'OK')::int AS ok,
                    COUNT(*) FILTER (WHERE status = 'Redirect')::int AS redirects,
                    COUNT(*) FILTER (WHERE status = 'Client Error')::int AS client_errors,
                    COUNT(*) FILTER (WHERE status = 'Server Error')::int AS server_errors,
                    COUNT(*) FILTER (WHERE status = 'Unreachable')::int AS unreachable,
                    COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
                    COALESCE(ROUND(AVG(response_time_ms))::int, 0) AS avg_response_time
             FROM domains WHERE group_id = $1`, [groupId]),
    ]);

    res.json({ group: access, domains: domains.rows, history: history.rows, stats: stats.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/groups/:id/upload", auth, upload.single("file"), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (!req.file) return res.status(400).json({ message: "Excel file is required" });

    const access = await getGroupAccess(req.user.id, groupId);
    if (!access) return res.status(404).json({ message: "Group not found" });
    if (!canEdit(access.permission)) {
      return res.status(403).json({ message: "You need edit permission to upload group domains." });
    }

    const rows = parseExcelDomains(req.file.buffer);
    let added = 0;
    let skipped = 0;
    let pending = 0;
    const ids = [];

    for (const raw of rows) {
      const url = normalizeUrl(raw);
      if (!url) { skipped++; continue; }

      const existing = await query(`SELECT id FROM domains WHERE group_id = $1 AND url = $2`, [groupId, url]);
      if (existing.rows.length) { skipped++; continue; }

      if (!canDirectEdit(access.permission)) {
        const result = await query(
          `INSERT INTO domain_add_requests (group_id, requester_id, url) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING RETURNING id`,
          [groupId, req.user.id, url]
        );
        if (result.rows.length) pending++;
        else skipped++;
      } else {
        const result = await query(
          `INSERT INTO domains (url, owner_id, group_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (owner_id, url) DO NOTHING
           RETURNING id`,
          [url, req.user.id, groupId]
        );
        if (result.rows.length) {
          added++;
          ids.push(result.rows[0].id);
        } else skipped++;
      }
    }

    if (ids.length) await checkDomainIds(ids);
    const message = canDirectEdit(access.permission)
      ? `Upload complete: ${added} added, ${skipped} skipped.`
      : `Upload submitted: ${pending} domain(s) are waiting for owner approval, ${skipped} skipped.`;
    res.json({ message, added, pending, skipped });
  } catch (error) {
    res.status(400).json({ message: `Could not process the Excel file: ${error.message}` });
  }
});

app.post("/api/domains/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Excel file is required" });
    const rows = parseExcelDomains(req.file.buffer);
    const ids = [];
    let added = 0;
    let skipped = 0;

    for (const raw of rows) {
      const url = normalizeUrl(raw);
      if (!url) {
        skipped++;
        continue;
      }
      const result = await query(
        `INSERT INTO domains (url, owner_id) VALUES ($1, $2)
         ON CONFLICT (owner_id, url) DO NOTHING RETURNING id`,
        [url, req.user.id]
      );
      if (result.rows.length) {
        added++;
        ids.push(result.rows[0].id);
      } else skipped++;
    }

    await checkDomainIds(ids);
    res.json({ message: "Upload complete", added, skipped });
  } catch (error) {
    res.status(400).json({ message: `Could not process the Excel file: ${error.message}` });
  }
});

// ---------------- PERSONAL DASHBOARDS ----------------
app.get("/api/dashboards", auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT d.id, d.name, d.group_id, d.created_at, g.name AS group_name,
              (SELECT COUNT(*)::int FROM domains dom WHERE dom.group_id = d.group_id) AS domain_count
       FROM dashboards d LEFT JOIN groups g ON g.id = d.group_id
       WHERE d.owner_id = $1 ORDER BY d.id DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/dashboards", auth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const groupId = req.body.groupId == null || req.body.groupId === "" ? null : Number(req.body.groupId);
    if (!name) return res.status(400).json({ message: "Dashboard name is required" });

    if (groupId != null) {
      const access = await getGroupAccess(req.user.id, groupId);
      if (!access) return res.status(403).json({ message: "You do not have access to that group" });
    }

    const result = await query(`INSERT INTO dashboards (owner_id, name, group_id) VALUES ($1, $2, $3) RETURNING *`, [req.user.id, name, groupId]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/dashboards/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const dashboardResult = await query(
      `SELECT d.*, g.name AS group_name FROM dashboards d LEFT JOIN groups g ON g.id = d.group_id WHERE d.id = $1 AND d.owner_id = $2`,
      [id, req.user.id]
    );
    if (!dashboardResult.rows.length) return res.status(404).json({ message: "Dashboard not found" });
    const dashboard = dashboardResult.rows[0];

    const condition = dashboard.group_id
      ? { sql: `WHERE d.group_id = $2`, params: [req.user.id, dashboard.group_id] }
      : { sql: `WHERE d.owner_id = $1 AND d.group_id IS NULL`, params: [req.user.id] };
    const stats = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'OK')::int AS ok,
              COUNT(*) FILTER (WHERE status = 'Redirect')::int AS redirects,
              COUNT(*) FILTER (WHERE status = 'Client Error')::int AS client_errors,
              COUNT(*) FILTER (WHERE status = 'Server Error')::int AS server_errors,
              COUNT(*) FILTER (WHERE status = 'Unreachable')::int AS unreachable,
              COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
              COALESCE(ROUND(AVG(response_time_ms))::int, 0) AS avg_response_time
       FROM domains d ${condition.sql}`,
      condition.params
    );
    const domains = await query(
      `SELECT d.*,
              CASE WHEN d.owner_id = $1 OR g.owner_id = $1 THEN 'admin' ELSE COALESCE(gm.permission, 'view') END AS permission
       FROM domains d LEFT JOIN groups g ON g.id = d.group_id
       LEFT JOIN group_members gm ON gm.group_id = d.group_id AND gm.user_id = $1
       ${condition.sql}
       ORDER BY d.id DESC`,
      condition.params
    );
    res.json({ dashboard, stats: stats.rows[0], domains: domains.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete("/api/dashboards/:id", auth, async (req, res) => {
  try {
    const result = await query(`DELETE FROM dashboards WHERE id = $1 AND owner_id = $2 RETURNING id`, [Number(req.params.id), req.user.id]);
    if (!result.rows.length) return res.status(404).json({ message: "Dashboard not found" });
    res.json({ message: "Dashboard deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------- PLATFORM ADMIN ----------------
app.get("/api/admin/stats", auth, adminOnly, async (req, res) => {
  const [users, groups, domains, pending] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM users`),
    query(`SELECT COUNT(*)::int AS count FROM groups`),
    query(`SELECT COUNT(*)::int AS count FROM domains`),
    query(`SELECT COUNT(*)::int AS count FROM edit_requests WHERE status = 'pending'`),
  ]);
  res.json({ users: users.rows[0].count, groups: groups.rows[0].count, domains: domains.rows[0].count, pending_requests: pending.rows[0].count });
});

app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
  const result = await query(
    `SELECT id, name, email, is_admin, created_at,
            (SELECT COUNT(*)::int FROM domains d WHERE d.owner_id = u.id) AS domain_count,
            (SELECT COUNT(*)::int FROM groups g WHERE g.owner_id = u.id) AS owned_group_count
     FROM users u ORDER BY id DESC`
  );
  res.json(result.rows);
});

app.patch("/api/admin/users/:id", auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const isAdmin = Boolean(req.body.isAdmin);
  if (id === Number(req.user.id) && !isAdmin) return res.status(400).json({ message: "You cannot remove your own administrator access." });
  const result = await query(`UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, name, email, is_admin`, [isAdmin, id]);
  if (!result.rows.length) return res.status(404).json({ message: "User not found" });
  res.json(result.rows[0]);
});

app.delete("/api/admin/users/:id", auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (id === Number(req.user.id)) return res.status(400).json({ message: "You cannot delete your own administrator account." });
  const result = await query(`DELETE FROM users WHERE id = $1 RETURNING id`, [id]);
  if (!result.rows.length) return res.status(404).json({ message: "User not found" });
  res.json({ message: "User and owned data deleted" });
});

app.get("/api/admin/groups", auth, adminOnly, async (req, res) => {
  const result = await query(
    `SELECT g.id, g.name, g.join_code, g.created_at, u.name AS owner_name, u.email AS owner_email,
            (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
            (SELECT COUNT(*)::int FROM domains d WHERE d.group_id = g.id) AS domain_count
     FROM groups g JOIN users u ON u.id = g.owner_id ORDER BY g.id DESC`
  );
  res.json(result.rows);
});

app.delete("/api/admin/groups/:id", auth, adminOnly, async (req, res) => {
  const result = await query(`DELETE FROM groups WHERE id = $1 RETURNING id`, [Number(req.params.id)]);
  if (!result.rows.length) return res.status(404).json({ message: "Group not found" });
  res.json({ message: "Group deleted" });
});

app.get("/api/admin/contacts", auth, adminOnly, async (req, res) => {
  const result = await query(`SELECT id, name, email, concern, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 500`);
  res.json(result.rows);
});

app.get("/api/admin/domains", auth, adminOnly, async (req, res) => {
  const result = await query(
    `SELECT d.id, d.url, d.status, d.enabled, d.last_checked_at, u.name AS owner_name, u.email AS owner_email, g.name AS group_name
     FROM domains d LEFT JOIN users u ON u.id = d.owner_id LEFT JOIN groups g ON g.id = d.group_id ORDER BY d.id DESC LIMIT 1000`
  );
  res.json(result.rows);
});

app.delete("/api/admin/domains/:id", auth, adminOnly, async (req, res) => {
  const result = await query(`DELETE FROM domains WHERE id = $1 RETURNING id`, [Number(req.params.id)]);
  if (!result.rows.length) return res.status(404).json({ message: "Domain not found" });
  res.json({ message: "Domain deleted" });
});

const port = Number(process.env.PORT || 5000);
const interval = Number(process.env.CHECK_INTERVAL_MINUTES || 5);

initDb()
  .then(async () => {
    app.listen(port, () => {
      console.log(`API running at http://localhost:${port}`);
      console.log(`Automatic monitoring every ${interval} minute(s).`);
      if (!process.env.ADMIN_EMAIL) console.log("No ADMIN_EMAIL configured; the first registered account is administrator.");
    });

    let scheduledCheckRunning = false;
    cron.schedule(`*/${Math.max(1, interval)} * * * *`, async () => {
      if (scheduledCheckRunning) {
        console.log("Skipping scheduled check because the previous run is still active.");
        return;
      }
      scheduledCheckRunning = true;
      try {
        console.log("Starting scheduled domain check...");
        await checkAllDomains();
        console.log("Scheduled domain check finished.");
      } catch (error) {
        console.error("Scheduled domain check failed:", error.message);
      } finally {
        scheduledCheckRunning = false;
      }
    }, { timezone: "Asia/Kolkata" });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
