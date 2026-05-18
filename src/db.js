import Database from 'better-sqlite3';

export const db = new Database('app.db');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_team_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  slack_user_token TEXT NOT NULL,
  spotify_refresh_token TEXT,
  spotify_access_token TEXT,
  spotify_token_expires_at INTEGER,
  last_status_text TEXT,
  last_status_emoji TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(slack_team_id, slack_user_id)
);
`);
