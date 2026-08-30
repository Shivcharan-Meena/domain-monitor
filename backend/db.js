require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS groups (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      join_code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS domains (
      id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      group_id BIGINT REFERENCES groups(id) ON DELETE SET NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'Pending',
      status_code INTEGER,
      response_time_ms INTEGER,
      error_message TEXT,
      last_checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id BIGSERIAL PRIMARY KEY,
      domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      status_code INTEGER,
      response_time_ms INTEGER,
      error_message TEXT,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'view',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id),
      CONSTRAINT group_member_permission_check
        CHECK (permission IN ('view', 'edit', 'edit_privileged'))
    );

    CREATE TABLE IF NOT EXISTS edit_requests (
      id BIGSERIAL PRIMARY KEY,
      domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      old_url TEXT NOT NULL,
      new_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      CONSTRAINT edit_request_status_check
        CHECK (status IN ('pending', 'approved', 'rejected'))
    );

    CREATE TABLE IF NOT EXISTS dashboards (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      group_id BIGINT REFERENCES groups(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS permission_requests (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_permission TEXT NOT NULL DEFAULT 'edit',
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      CONSTRAINT permission_request_permission_check CHECK (requested_permission IN ('edit','edit_privileged')),
      CONSTRAINT permission_request_status_check CHECK (status IN ('pending','approved','rejected'))
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      concern TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS domain_add_requests (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      CONSTRAINT domain_add_request_status_check CHECK (status IN ('pending','approved','rejected'))
    );
  `);

  await query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS join_code TEXT;
    ALTER TABLE domains ADD COLUMN IF NOT EXISTS owner_id BIGINT;
    ALTER TABLE domains ADD COLUMN IF NOT EXISTS group_id BIGINT;
    ALTER TABLE group_members ADD COLUMN IF NOT EXISTS permission TEXT DEFAULT 'view';
    ALTER TABLE group_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE domains ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE domains ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE status_history ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE group_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  // Backfill unique join codes for groups created by older versions.
  const missingGroups = await query(`SELECT id FROM groups WHERE join_code IS NULL OR join_code = ''`);
  for (const row of missingGroups.rows) {
    const code = `DM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    try {
      await query(`UPDATE groups SET join_code = $1 WHERE id = $2`, [code, row.id]);
    } catch (_) {
      // Extremely unlikely collision; leave the row for a later startup retry.
    }
  }

  // Backfill older/empty groups: attach the owner's currently personal domains
  // to the most recently created empty group for that owner. This makes groups
  // created before the group-dashboard feature immediately usable.
  await query(`
    WITH empty_groups AS (
      SELECT DISTINCT ON (g.owner_id) g.id AS group_id, g.owner_id
      FROM groups g
      WHERE NOT EXISTS (SELECT 1 FROM domains d WHERE d.group_id = g.id)
      ORDER BY g.owner_id, g.id DESC
    )
    UPDATE domains d
    SET group_id = eg.group_id, updated_at = NOW()
    FROM empty_groups eg
    WHERE d.owner_id = eg.owner_id
      AND d.group_id IS NULL
  `);

  await query(`
    ALTER TABLE groups ALTER COLUMN join_code SET DEFAULT ('DM-' || upper(substr(md5(random()::text), 1, 8)));
    ALTER TABLE groups ALTER COLUMN join_code SET NOT NULL;
    ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_url_key;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_owner_url
      ON domains(owner_id, url)
      WHERE owner_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_domains_owner ON domains(owner_id);
    CREATE INDEX IF NOT EXISTS idx_domains_group ON domains(group_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_edit_requests_domain ON edit_requests(domain_id, status);
    CREATE INDEX IF NOT EXISTS idx_status_history_domain_checked
      ON status_history(domain_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
    CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON dashboards(owner_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_permission_requests_group_status ON permission_requests(group_id, status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_requests_pending_user_group
      ON permission_requests(group_id, user_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_domain_add_requests_group_status ON domain_add_requests(group_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_domain_add_requests_user_status ON domain_add_requests(requester_id,status,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_add_requests_pending_unique ON domain_add_requests(group_id,requester_id,url) WHERE status='pending';
  `);

  // The first account is the platform administrator. ADMIN_EMAIL can explicitly
  // elevate a known account as well, which is useful for existing databases.
  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (adminEmail) {
    await query(`UPDATE users SET is_admin = TRUE WHERE email = $1`, [adminEmail]);
  }

  const adminCount = await query(`SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE`);
  if (adminCount.rows[0].count === 0) {
    await query(`
      UPDATE users
      SET is_admin = TRUE
      WHERE id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)
    `);
  }
}

module.exports = { query, initDb, pool };
