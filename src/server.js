import 'dotenv/config';
import express from 'express';
import chalk from 'chalk';
import { clearPairingCode, ensureAgentToken, findSlackUser, findUserByAgentToken, findUserById, findUserByPairingCode, getStats, getSyncStats, getUserSettings, initDb, saveSpotifyTokens, saveUserSettings, setPairingCode, updateLastStatus, updateLocalActivity, upsertSlackUser } from './db.js';
import { clearSlackStatus, exchangeSlackCode, getSlackAuthUrl } from './slack.js';
import { exchangeSpotifyCode, getSpotifyAuthUrl } from './spotify.js';
import { startWorker, syncOnce } from './worker.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

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
    a.button,
    button.button {
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
    const user = await getUserFromAgentRequest(req);
    if (!user) {
        res.status(401).json({ ok: false, error: 'Missing or invalid local agent token' });
        return;
    }

    const activity = req.body?.activity || null;
    if (activity && (!activity.name || !activity.category || !activity.emoji)) {
        res.status(400).json({ ok: false, error: 'Invalid activity payload' });
        return;
    }

    await updateLocalActivity({ userId: user.id, activity });
    if (!activity && req.body?.clearStatus === true) {
        await clearSlackStatus(user.slack_user_token);
        await updateLastStatus({ userId: user.id, text: '', emoji: '' });
    }
    res.json({ ok: true });
});

app.get('/auth/slack', (req, res) => {
    const pair = req.query.pair ? String(req.query.pair) : null;
    const suffix = pair ? `&state=${encodeURIComponent(pair)}` : '';
    res.redirect(`${getSlackAuthUrl()}${suffix}`);
});

app.get('/auth/slack/callback', async (req, res) => {
    try {
        if (req.query.error) throw new Error(String(req.query.error));
        if (!req.query.code) throw new Error('Missing Slack authorization code');

        const pairCode = req.query.state ? String(req.query.state) : null;
        const slack = await exchangeSlackCode(req.query.code);
        await upsertSlackUser(slack);
        const user = await findSlackUser(slack.teamId, slack.userId);
        await ensureAgentToken(user.id);
        if (pairCode) {
            await setPairingCode({ userId: user.id, code: pairCode, expiresAt: Date.now() + 10 * 60 * 1000 });
        }

        res.type('html').send(page('Connect Spotify', `
          <h1>Slack connected</h1>
          <p>One more step: connect Spotify so the app can read your currently playing track.</p>
          <a class="button" href="/auth/spotify?user=${encodeURIComponent(user.id)}${pairCode ? `&pair=${encodeURIComponent(pairCode)}` : ''}">Connect Spotify</a>
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

    res.redirect(getSpotifyAuthUrl(req.query.pair ? `${user.id}:${req.query.pair}` : user.id));
});

app.get('/auth/spotify/callback', async (req, res) => {
    try {
        if (req.query.error) throw new Error(String(req.query.error));
        if (!req.query.code) throw new Error('Missing Spotify authorization code');

        const [userId, pairCode] = String(req.query.state || '').split(':');
        const user = await findUserById(userId);
        if (!user) return res.status(404).send('User not found');

        const spotify = await exchangeSpotifyCode(req.query.code);
        await saveSpotifyTokens({ userId: user.id, ...spotify });
        const agentToken = await ensureAgentToken(user.id);
        if (pairCode) {
            await setPairingCode({ userId: user.id, code: pairCode, expiresAt: Date.now() + 10 * 60 * 1000 });
        }
        const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

        res.type('html').send(page('Connected', `
          <h1>You are connected</h1>
          <p>Your Slack status will update while Spotify is playing. To detect Steam and desktop apps, run the local agent on your computer.</p>
          <div class="panel">
            <p><code>$env:SERVER_URL="${baseUrl}"; $env:LOCAL_AGENT_TOKEN="${agentToken}"; npm run local-agent</code></p>
            <p><a href="/settings?token=${encodeURIComponent(agentToken)}">Open settings</a></p>
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

app.get('/settings', async (req, res) => {
    const user = await getUserFromToken(req.query.token);
    if (!user) {
        res.status(401).type('html').send(page('Settings', '<h1>Settings unavailable</h1><p>Missing or invalid settings token.</p>'));
        return;
    }

    const settings = await getUserSettings(user.id);
    const json = JSON.stringify(settings || {}, null, 2);
    res.type('html').send(page('Slack Activity Settings', `
      <h1>Slack Activity Settings</h1>
      <p>Edit JSON settings for app priority, custom status text, quiet hours, and privacy.</p>
      <form method="post" action="/settings">
        <input type="hidden" name="token" value="${escapeHtml(req.query.token)}">
        <textarea name="settings" rows="22" style="width:100%;font-family:monospace">${escapeHtml(json)}</textarea>
        <p><button class="button" type="submit">Save settings</button></p>
      </form>
    `));
});

app.post('/settings', async (req, res) => {
    const user = await getUserFromToken(req.body.token);
    if (!user) {
        res.status(401).type('html').send(page('Settings', '<h1>Settings unavailable</h1><p>Missing or invalid settings token.</p>'));
        return;
    }

    try {
        const settings = JSON.parse(req.body.settings || '{}');
        await saveUserSettings({ userId: user.id, settings });
        res.redirect(`/settings?token=${encodeURIComponent(req.body.token)}`);
    } catch (err) {
        res.status(400).type('html').send(page('Settings Error', `<h1>Could not save settings</h1><p>${escapeHtml(err.message)}</p>`));
    }
});

app.get('/api/settings', async (req, res) => {
    const user = await getUserFromAgentRequest(req);
    if (!user) {
        res.status(401).json({ ok: false, error: 'Missing or invalid local agent token' });
        return;
    }

    const settings = await getUserSettings(user.id);

    res.json({
        ok: true,
        settings,
    });
});

app.post('/api/settings', async (req, res) => {
    const user = await getUserFromAgentRequest(req);
    if (!user) {
        res.status(401).json({ ok: false, error: 'Missing or invalid local agent token' });
        return;
    }

    if (!req.body?.settings || typeof req.body.settings !== 'object') {
        res.status(400).json({ ok: false, error: 'Invalid settings payload' });
        return;
    }

    await saveUserSettings({
        userId: user.id,
        settings: req.body.settings,
    });

    res.json({ ok:true });
});

app.get('/pair', (req, res) => {
    const code = req.query.code ? String(req.query.code) : null;
    if (!code) return res.status(400).send('Missing pairing code');

    res.type('html').send(page('Pair Local Agent', `
      <h1>Pair local agent</h1>
      <p>Connect Slack and Spotify to pair this computer with your account.</p>
      <a class="button" href="/auth/slack?pair=${encodeURIComponent(code)}">Connect Slack</a>
    `));
});

app.get('/api/local-agent/pairing/:code', async (req, res) => {
    const user = await findUserByPairingCode(req.params.code);
    if (!user || !user.agent_token || !user.spotify_refresh_token) {
        res.status(202).json({ ok: false, pending: true });
        return;
    }

    if (Number(user.pairing_expires_at || 0) < Date.now()) {
        await clearPairingCode(user.id);
        res.status(410).json({ ok: false, error: 'Pairing code expired' });
        return;
    }

    await clearPairingCode(user.id);
    res.json({ ok: true, token: user.agent_token });
});

await initDb();

app.listen(port, () => {
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    console.log(chalk.bold.blue('Slack Spotify Status app'));
    console.log(chalk.gray(`Listening on ${baseUrl}`));
    startWorker();
});

async function getUserFromAgentRequest(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
    return getUserFromToken(token);
}

async function getUserFromToken(token) {
    if (!token) return null;
    return findUserByAgentToken(token);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
