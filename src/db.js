import Database from 'better-sqlite3';
import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;
const usingPostgres = Boolean(process.env.DATABASE_URL);

let sqlite = null;
let pool = null;

if (usingPostgres) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    });
} else {
    sqlite = new Database('app.db');
}

function normalizeUser(row) {
    if (!row) return null;
    return {
        ...row,
        spotify_token_expires_at: Number(row.spotify_token_expires_at || 0),
        local_activity_updated_at: Number(row.local_activity_updated_at || 0),
    };
}

function createAgentToken() {
    return crypto.randomBytes(32).toString('hex');
}

export async function initDb() {
    if (usingPostgres) {
        await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  slack_team_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  slack_user_token TEXT NOT NULL,
  spotify_refresh_token TEXT,
  spotify_access_token TEXT,
  spotify_token_expires_at BIGINT,
  agent_token TEXT UNIQUE,
  local_activity_name TEXT,
  local_activity_emoji TEXT,
  local_activity_category TEXT,
  local_activity_detail TEXT,
  local_activity_updated_at BIGINT,
  pairing_code TEXT UNIQUE,
  pairing_expires_at BIGINT,
  last_status_text TEXT,
  last_status_emoji TEXT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  UNIQUE(slack_team_id, slack_user_id)
);
`);
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_token TEXT UNIQUE');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS local_activity_name TEXT');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS local_activity_emoji TEXT');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS local_activity_category TEXT');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS local_activity_detail TEXT');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS local_activity_updated_at BIGINT');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pairing_code TEXT UNIQUE');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pairing_expires_at BIGINT');
        return;
    }

    sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_team_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  slack_user_token TEXT NOT NULL,
  spotify_refresh_token TEXT,
  spotify_access_token TEXT,
  spotify_token_expires_at INTEGER,
  agent_token TEXT UNIQUE,
  local_activity_name TEXT,
  local_activity_emoji TEXT,
  local_activity_category TEXT,
  local_activity_detail TEXT,
  local_activity_updated_at INTEGER,
  pairing_code TEXT UNIQUE,
  pairing_expires_at INTEGER,
  last_status_text TEXT,
  last_status_emoji TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(slack_team_id, slack_user_id)
);
`);

    const columns = sqlite.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
    const addColumn = (name, sql) => {
        if (!columns.includes(name)) sqlite.exec(`ALTER TABLE users ADD COLUMN ${sql}`);
    };
    addColumn('agent_token', 'agent_token TEXT');
    addColumn('local_activity_name', 'local_activity_name TEXT');
    addColumn('local_activity_emoji', 'local_activity_emoji TEXT');
    addColumn('local_activity_category', 'local_activity_category TEXT');
    addColumn('local_activity_detail', 'local_activity_detail TEXT');
    addColumn('local_activity_updated_at', 'local_activity_updated_at INTEGER');
    addColumn('pairing_code', 'pairing_code TEXT');
    addColumn('pairing_expires_at', 'pairing_expires_at INTEGER');
}

export async function getStats() {
    if (usingPostgres) {
        const { rows } = await pool.query(`
SELECT
  COUNT(*)::INTEGER AS total,
  COUNT(*) FILTER (WHERE spotify_refresh_token IS NOT NULL)::INTEGER AS connected
FROM users
`);
        return rows[0];
    }

    return sqlite.prepare(`
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN spotify_refresh_token IS NOT NULL THEN 1 ELSE 0 END) AS connected
FROM users
`).get();
}

export async function getSyncStats() {
    if (usingPostgres) {
        const { rows } = await pool.query(`
SELECT
  COUNT(*)::INTEGER AS total_users,
  COUNT(*) FILTER (WHERE spotify_refresh_token IS NOT NULL)::INTEGER AS spotify_connected_users,
  COUNT(*) FILTER (WHERE last_status_text IS NOT NULL AND last_status_text != '')::INTEGER AS active_statuses
FROM users
`);
        return rows[0];
    }

    return sqlite.prepare(`
SELECT
  COUNT(*) AS total_users,
  SUM(CASE WHEN spotify_refresh_token IS NOT NULL THEN 1 ELSE 0 END) AS spotify_connected_users,
  SUM(CASE WHEN last_status_text IS NOT NULL AND last_status_text != '' THEN 1 ELSE 0 END) AS active_statuses
FROM users
`).get();
}

export async function upsertSlackUser({ teamId, userId, userToken }) {
    if (usingPostgres) {
        await pool.query(`
INSERT INTO users (slack_team_id, slack_user_id, slack_user_token, agent_token, updated_at)
VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW())::BIGINT)
ON CONFLICT(slack_team_id, slack_user_id)
DO UPDATE SET
  slack_user_token = EXCLUDED.slack_user_token,
  updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
`, [teamId, userId, userToken, createAgentToken()]);
        return;
    }

    sqlite.prepare(`
INSERT INTO users (slack_team_id, slack_user_id, slack_user_token, agent_token, updated_at)
VALUES (?, ?, ?, ?, unixepoch())
ON CONFLICT(slack_team_id, slack_user_id)
DO UPDATE SET
  slack_user_token = excluded.slack_user_token,
  updated_at = unixepoch()
`).run(teamId, userId, userToken, createAgentToken());
}

export async function findSlackUser(teamId, userId) {
    if (usingPostgres) {
        const { rows } = await pool.query(`
SELECT * FROM users
WHERE slack_team_id = $1
AND slack_user_id = $2
`, [teamId, userId]);
        return normalizeUser(rows[0]);
    }

    return normalizeUser(sqlite.prepare(`
SELECT * FROM users
WHERE slack_team_id = ?
AND slack_user_id = ?
`).get(teamId, userId));
}

export async function findUserById(id) {
    if (usingPostgres) {
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return normalizeUser(rows[0]);
    }

    return normalizeUser(sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export async function ensureAgentToken(userId) {
    const user = await findUserById(userId);
    if (!user) return null;
    if (user.agent_token) return user.agent_token;

    const token = createAgentToken();
    if (usingPostgres) {
        await pool.query(`
UPDATE users
SET agent_token = $1,
    updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE id = $2
`, [token, userId]);
        return token;
    }

    sqlite.prepare(`
UPDATE users
SET agent_token = ?,
    updated_at = unixepoch()
WHERE id = ?
`).run(token, userId);
    return token;
}

export async function setPairingCode({ userId, code, expiresAt }) {
    if (usingPostgres) {
        await pool.query(`
UPDATE users
SET pairing_code = $1,
    pairing_expires_at = $2,
    updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE id = $3
`, [code, expiresAt, userId]);
        return;
    }

    sqlite.prepare(`
UPDATE users
SET pairing_code = ?,
    pairing_expires_at = ?,
    updated_at = unixepoch()
WHERE id = ?
`).run(code, expiresAt, userId);
}

export async function findUserByPairingCode(code) {
    if (usingPostgres) {
        const { rows } = await pool.query('SELECT * FROM users WHERE pairing_code = $1', [code]);
        return normalizeUser(rows[0]);
    }

    return normalizeUser(sqlite.prepare('SELECT * FROM users WHERE pairing_code = ?').get(code));
}

export async function clearPairingCode(userId) {
    if (usingPostgres) {
        await pool.query(`
UPDATE users
SET pairing_code = NULL,
    pairing_expires_at = NULL,
    updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE id = $1
`, [userId]);
        return;
    }

    sqlite.prepare(`
UPDATE users
SET pairing_code = NULL,
    pairing_expires_at = NULL,
    updated_at = unixepoch()
WHERE id = ?
`).run(userId);
}

export async function findUserByAgentToken(agentToken) {
    if (usingPostgres) {
        const { rows } = await pool.query('SELECT * FROM users WHERE agent_token = $1', [agentToken]);
        return normalizeUser(rows[0]);
    }

    return normalizeUser(sqlite.prepare('SELECT * FROM users WHERE agent_token = ?').get(agentToken));
}

export async function saveSpotifyTokens({ userId, accessToken, refreshToken, expiresAt }) {
    if (usingPostgres) {
        await pool.query(`
UPDATE users
SET spotify_access_token = $1,
    spotify_refresh_token = $2,
    spotify_token_expires_at = $3,
    updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE id = $4
`, [accessToken, refreshToken, expiresAt, userId]);
        return;
    }

    sqlite.prepare(`
UPDATE users
SET spotify_access_token = ?,
    spotify_refresh_token = ?,
    spotify_token_expires_at = ?,
    updated_at = unixepoch()
WHERE id = ?
`).run(accessToken, refreshToken, expiresAt, userId);
}

export async function getConnectedUsers() {
    if (usingPostgres) {
        const { rows } = await pool.query(`
SELECT * FROM users
WHERE slack_user_token IS NOT NULL
AND spotify_refresh_token IS NOT NULL
ORDER BY id
`);
        return rows.map(normalizeUser);
    }

    return sqlite.prepare(`
SELECT * FROM users
WHERE slack_user_token IS NOT NULL
AND spotify_refresh_token IS NOT NULL
ORDER BY id
`).all().map(normalizeUser);
}

export async function updateSpotifyToken({ userId, accessToken, refreshToken, expiresAt }) {
    return saveSpotifyTokens({ userId, accessToken, refreshToken, expiresAt });
}

export async function updateLastStatus({ userId, text, emoji }) {
    if (usingPostgres) {
        await pool.query(`
UPDATE users
SET last_status_text = $1,
    last_status_emoji = $2,
    updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE id = $3
`, [text, emoji, userId]);
        return;
    }

    sqlite.prepare(`
UPDATE users
SET last_status_text = ?,
    last_status_emoji = ?,
    updated_at = unixepoch()
WHERE id = ?
`).run(text, emoji, userId);
}

export async function updateLocalActivity({ userId, activity }) {
    const name = activity?.name || null;
    const emoji = activity?.emoji || null;
    const category = activity?.category || null;
    const detail = activity?.detail || null;
    const updatedAt = activity ? Date.now() : null;

    if (usingPostgres) {
        await pool.query(`
UPDATE users
SET local_activity_name = $1,
    local_activity_emoji = $2,
    local_activity_category = $3,
    local_activity_detail = $4,
    local_activity_updated_at = $5,
    updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE id = $6
`, [name, emoji, category, detail, updatedAt, userId]);
        return;
    }

    sqlite.prepare(`
UPDATE users
SET local_activity_name = ?,
    local_activity_emoji = ?,
    local_activity_category = ?,
    local_activity_detail = ?,
    local_activity_updated_at = ?,
    updated_at = unixepoch()
WHERE id = ?
`).run(name, emoji, category, detail, updatedAt, userId);
}
