import 'dotenv/config';
import express from 'express';
import chalk from 'chalk';
import { db } from './db.js';
import { exchangeSlackCode, getSlackAuthUrl } from './slack.js';
import { exchangeSpotifyCode, getSpotifyAuthUrl } from './spotify.js';
import { getSyncStats, startWorker, syncOnce } from './worker.js';

const app = express();
const port = process.env.PORT || 3000;

const upsertSlackUser = db.prepare(`
INSERT INTO users (slack_team_id, slack_user_id, slack_user_token, updated_at)
VALUES (?, ?, ?, unixepoch())
ON CONFLICT(slack_team_id, slack_user_id)
DO UPDATE SET
  slack_user_token = excluded.slack_user_token,
  updated_at = unixepoch()
`);

const findSlackUser = db.prepare(`
SELECT *
FROM users
WHERE slack_team_id = ?
AND slack_user_id = ?
`);

const findUserById = db.prepare('SELECT * FROM users WHERE id = ?');

const saveSpotifyTokens = db.prepare(`
UPDATE users
SET spotify_access_token = ?,
    spotify_refresh_token = ?,
    spotify_token_expires_at = ?,
    updated_at = unixepoch()
WHERE id = ?
`);

const getStats = db.prepare(`
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN spotify_refresh_token IS NOT NULL THEN 1 ELSE 0 END) AS connected
FROM users
`);

function page(title, body) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1d1c1d;
      background: #f6f6f4;
    }
    main {
      max-width: 720px;
      margin: 72px auto;
      padding: 0 20px;
    }
    h1 {
      font-size: 34px;
      line-height: 1.1;
      margin: 0 0 12px;
    }
    p {
      color: #555;
      line-height: 1.5;
    }
    a.button {
      display: inline-block;
      margin-top: 18px;
      padding: 12px 16px;
      border-radius: 6px;
      color: white;
      background: #1264a3;
      text-decoration: none;
      font-weight: 700;
    }
    .panel {
      margin-top: 24px;
      padding: 18px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: white;
    }
    code {
      padding: 2px 5px;
      border-radius: 4px;
      background: #eee;
    }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

app.get('/', (req, res) => {
    const stats = getStats.get();
    res.type('html').send(page('Slack Spotify Status', `
      <h1>Slack Spotify Status</h1>
      <p>Connect Slack and Spotify, then this app will update your Slack status with your currently playing song.</p>
      <a class="button" href="/auth/slack">Connect Slack</a>
      <div class="panel">
        <p><strong>${stats.connected || 0}</strong> fully connected user(s)</p>
        <p><strong>${stats.total || 0}</strong> Slack user(s) started setup</p>
      </div>
    `));
});

app.get('/health', (req, res) => {
    const stats = getSyncStats.get();
    res.json({
        ok: true,
        totalUsers: stats.total_users || 0,
        spotifyConnectedUsers: stats.spotify_connected_users || 0,
        activeStatuses: stats.active_statuses || 0,
    });
});

app.get('/sync-now', async (req, res) => {
    const expectedSecret = process.env.SYNC_SECRET;
    if (expectedSecret && req.query.secret !== expectedSecret) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    try {
        const result = await syncOnce({ force: req.query.force === '1' || req.query.force === 'true' });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/auth/slack', (req, res) => {
    res.redirect(getSlackAuthUrl());
});

app.get('/auth/slack/callback', async (req, res) => {
    try {
        if (req.query.error) throw new Error(String(req.query.error));
        if (!req.query.code) throw new Error('Missing Slack authorization code');

        const slack = await exchangeSlackCode(req.query.code);
        upsertSlackUser.run(slack.teamId, slack.userId, slack.userToken);
        const user = findSlackUser.get(slack.teamId, slack.userId);

        res.type('html').send(page('Connect Spotify', `
          <h1>Slack connected</h1>
          <p>One more step: connect Spotify so the app can read your currently playing track.</p>
          <a class="button" href="/auth/spotify?user=${encodeURIComponent(user.id)}">Connect Spotify</a>
        `));
    } catch (err) {
        res.status(500).type('html').send(page('Slack Error', `
          <h1>Slack connection failed</h1>
          <p>${err.message}</p>
          <p><a href="/">Return home</a></p>
        `));
    }
});

app.get('/auth/spotify', (req, res) => {
    const userId = req.query.user;
    const user = findUserById.get(userId);
    if (!user) return res.status(404).send('User not found');

    res.redirect(getSpotifyAuthUrl(user.id));
});

app.get('/auth/spotify/callback', async (req, res) => {
    try {
        if (req.query.error) throw new Error(String(req.query.error));
        if (!req.query.code) throw new Error('Missing Spotify authorization code');

        const user = findUserById.get(req.query.state);
        if (!user) return res.status(404).send('User not found');

        const spotify = await exchangeSpotifyCode(req.query.code);
        saveSpotifyTokens.run(
            spotify.accessToken,
            spotify.refreshToken,
            spotify.expiresAt,
            user.id,
        );

        res.type('html').send(page('Connected', `
          <h1>You are connected</h1>
          <p>Your Slack status will update while Spotify is playing. You can close this tab.</p>
          <div class="panel">
            <p>Keep the app process running with <code>npm start</code>.</p>
          </div>
        `));
    } catch (err) {
        res.status(500).type('html').send(page('Spotify Error', `
          <h1>Spotify connection failed</h1>
          <p>${err.message}</p>
          <p><a href="/">Return home</a></p>
        `));
    }
});

app.listen(port, () => {
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    console.log(chalk.bold.blue('Slack Spotify Status app'));
    console.log(chalk.gray(`Listening on ${baseUrl}`));
    startWorker();
});
