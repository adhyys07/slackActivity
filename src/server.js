import 'dotenv/config';
import express from 'express';
import chalk from 'chalk';
import { ensureAgentToken, findSlackUser, findUserByAgentToken, findUserById, getStats, getSyncStats, initDb, saveSpotifyTokens, updateLocalActivity, upsertSlackUser } from './db.js';
import { exchangeSlackCode, getSlackAuthUrl } from './slack.js';
import { exchangeSpotifyCode, getSpotifyAuthUrl } from './spotify.js';
import { startWorker, syncOnce } from './worker.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '16kb' }));

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

app.get('/', async (req, res) => {
    const stats = await getStats();
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

app.get('/health', async (req, res) => {
    const stats = await getSyncStats();
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

app.post('/api/local-activity', async (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
    if (!token) {
        res.status(401).json({ ok: false, error: 'Missing local agent token' });
        return;
    }

    const user = await findUserByAgentToken(token);
    if (!user) {
        res.status(401).json({ ok: false, error: 'Invalid local agent token' });
        return;
    }

    const activity = req.body?.activity || null;
    if (activity && (!activity.name || !activity.category || !activity.emoji)) {
        res.status(400).json({ ok: false, error: 'Invalid activity payload' });
        return;
    }

    await updateLocalActivity({ userId: user.id, activity });
    res.json({ ok: true });
});

app.get('/auth/slack', (req, res) => {
    res.redirect(getSlackAuthUrl());
});

app.get('/auth/slack/callback', async (req, res) => {
    try {
        if (req.query.error) throw new Error(String(req.query.error));
        if (!req.query.code) throw new Error('Missing Slack authorization code');

        const slack = await exchangeSlackCode(req.query.code);
        await upsertSlackUser(slack);
        const user = await findSlackUser(slack.teamId, slack.userId);
        await ensureAgentToken(user.id);

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

app.get('/auth/spotify', async (req, res) => {
    const userId = req.query.user;
    const user = await findUserById(userId);
    if (!user) return res.status(404).send('User not found');

    res.redirect(getSpotifyAuthUrl(user.id));
});

app.get('/auth/spotify/callback', async (req, res) => {
    try {
        if (req.query.error) throw new Error(String(req.query.error));
        if (!req.query.code) throw new Error('Missing Spotify authorization code');

        const user = await findUserById(req.query.state);
        if (!user) return res.status(404).send('User not found');

        const spotify = await exchangeSpotifyCode(req.query.code);
        await saveSpotifyTokens({ userId: user.id, ...spotify });
        const agentToken = await ensureAgentToken(user.id);
        const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

        res.type('html').send(page('Connected', `
          <h1>You are connected</h1>
          <p>Your Slack status will update while Spotify is playing. To detect Steam and desktop apps, run the local agent on your computer.</p>
          <div class="panel">
            <p><code>$env:SERVER_URL="${baseUrl}"; $env:LOCAL_AGENT_TOKEN="${agentToken}"; npm run local-agent</code></p>
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

await initDb();

app.listen(port, () => {
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    console.log(chalk.bold.blue('Slack Spotify Status app'));
    console.log(chalk.gray(`Listening on ${baseUrl}`));
    startWorker();
});
