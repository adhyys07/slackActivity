import 'dotenv/config';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { execFile } from 'child_process';
import { detectDevTool } from './detectors/devtools.js';
import { detectMeetingApp } from './detectors/meetings.js';
import { detectMediaTool } from './detectors/media.js';
import { enrichCodingActivity } from './detectors/project.js';
import { detectSpotify } from './detectors/spotify.js';
import { detectSteamGame, getSteamAppList } from './detectors/steam.js';
import { getRunningProcesses } from './platform/processes.js';
import { applyActivitySettings, sortActivitiesByPriority } from '../config/user-settings.js';
import { loadLocalSettings, pauseForMs, pauseUntilTomorrow, resumeUpdates } from './local-settings.js';
import { addActivityHistoryEntry, clearActivityHistory, readActivityHistory } from './activity-history.js';

const DEFAULT_SERVER_URL = 'https://slackactivity-c162e24cca07.herokuapp.com';
const SERVER_URL = (process.env.SERVER_URL || process.env.BASE_URL || DEFAULT_SERVER_URL).replace(/\/$/, '');
const POLL_INTERVAL = parseInt(process.env.LOCAL_AGENT_INTERVAL ?? process.env.POLL_INTERVAL ?? '5000', 10);
const DEBUG = process.env.DEBUG === 'true';
const CONFIG_DIR = path.join(os.homedir(), '.slack-activity');
const CONFIG_FILE = path.join(CONFIG_DIR, 'agent.json');
const LOG_FILE = process.env.LOCAL_AGENT_LOG || (process.pkg ? path.join(path.dirname(process.execPath), 'SlackActivityAgent.log') : null);
let lastActivity = null;
let lastSyncAt = null;
let lastError = null;
let remoteSettingsCache = null;
let remoteSettingsFetchedAt = 0;
const SETTINGS_CACHE_TTL = 30 * 1000;

if (!SERVER_URL) {
    console.error('SERVER_URL is required. Example: $env:SERVER_URL="https://your-app.herokuapp.com"');
    process.exit(1);
}

function log(...parts) {
    const message = parts.join(' ');
    console.log(message);
    if (LOG_FILE) {
        try {
            fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
        } catch {}
    }
}

function logError(...parts) {
    const message = parts.join(' ');
    console.error(message);
    if (LOG_FILE) {
        try {
            fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
        } catch {}
    }
}

function openBrowser(url) {
    const command = process.platform === 'win32' ? 'powershell' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32'
        ? ['-NoProfile', '-Command', 'Start-Process', url]
        : [url];
    execFile(command, args);
}

function startDashboard(token) {
    const app = express();

    app.get('/', (req, res) => {
        res.type('html').send(`
            <!doctype html>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: Arial, sans-serif; margin: 32px; color: #1d1c1d; }
              button { margin: 4px 8px 4px 0; padding: 8px 10px; }
              code { background: #eee; padding: 2px 4px; border-radius: 4px; }
            </style>
            <h1>Slack Activity</h1>
            <p>Current: ${escapeHtml(lastActivity?.name ?? 'None')}</p>
            <p>Category: ${lastActivity?.category ?? '-'}</p>
            <p>Last sync: ${lastSyncAt ? new Date(lastSyncAt).toLocaleString() : '-'}</p>
            <p>Error: ${escapeHtml(lastError ?? '-')}</p>
            ${renderHistoryTable(readActivityHistory())}
            <form method="post" action="/history/clear"><button>Clear history</button></form>
            <form method="post" action="/pause"><button>Pause 1 hour</button></form>
            <form method="post" action="/pause-tomorrow"><button>Pause until tomorrow</button></form>
            <form method="post" action="/resume"><button>Resume</button></form>
            <p>Settings file: <code>${escapeHtml(path.join(CONFIG_DIR, 'settings.json'))}</code></p>
            `);
    });

    app.post('/pause', express.urlencoded({ extended: false }), async (req, res) => {
        pauseForMs(60 * 60 * 1000);
        await tick(token, { clear: true, clearStatus: true, force: true });
        res.redirect('/');
    });

    app.post('/pause-tomorrow', express.urlencoded({ extended: false }), async (req, res) => {
        pauseUntilTomorrow();
        await tick(token, { clear: true, clearStatus: true, force: true });
        res.redirect('/');
    });

    app.post('/history/clear', express.urlencoded({ extended: false }), (req, res) => {
        clearActivityHistory();
        res.redirect('/');
    });

    app.post('/resume', async (req, res) => {
        resumeUpdates();
        await tick(token, { force: true });
        res.redirect('/');
    });

    const server = app.listen(3784, () => {
        log('Dashboard running at http://localhost:3784');
    });
    server.on('error', (err) => {
        logError(chalk.yellow('dashboard unavailable:'), err.message);
    });
}

function readSavedToken() {
    if (process.env.LOCAL_AGENT_TOKEN) return process.env.LOCAL_AGENT_TOKEN;
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (config.serverUrl === SERVER_URL && config.token) return config.token;
    } catch {}
    return null;
}

function saveToken(token) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ serverUrl: SERVER_URL, token }, null, 2));
}

async function pairAgent() {
    const code = crypto.randomBytes(24).toString('hex');
    const pairUrl = `${SERVER_URL}/pair?code=${encodeURIComponent(code)}`;

    log(chalk.yellow('No saved local agent token found.'));
    log(chalk.gray('Opening browser to connect Slack and Spotify...'));
    log(chalk.gray(pairUrl));
    openBrowser(pairUrl);

    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const res = await fetch(`${SERVER_URL}/api/local-agent/pairing/${code}`);
        if (res.status === 202) {
            log(chalk.gray('Waiting for browser authorization...'));
            continue;
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `Pairing failed: ${res.status}`);

        saveToken(data.token);
        log(chalk.green('Local agent paired successfully.'));
        return data.token;
    }

    throw new Error('Pairing timed out. Run npm run local-agent again.');
}

async function getAgentToken() {
    return readSavedToken() || pairAgent();
}

async function detectLocalActivity(processes) {
    const settings = await loadEffectiveSettings();

    const meeting = detectMeetingApp(processes);
    if (meeting && settings.quietWhenMeeting) return null;

    const candidates = [
        await detectSteamGame(processes),
        await detectSpotify(processes),
        meeting,
        detectMediaTool(processes),
        detectDevTool(processes),
    ]
        .filter(Boolean)
        .map((activity) => enrichCodingActivity(activity, settings))
        .map((activity) => applyActivitySettings(activity, settings))
        .filter(Boolean);
    
    return sortActivitiesByPriority(candidates, settings)[0] ?? null;
}

async function loadEffectiveSettings() {
    const localSettings = loadLocalSettings();
    if (remoteSettingsCache && Date.now() - remoteSettingsFetchedAt < SETTINGS_CACHE_TTL) {
        return mergeSettings(localSettings, remoteSettingsCache);
    }

    const token = readSavedToken();
    if (!token) return localSettings;

    try {
        const res = await fetch(`${SERVER_URL}/api/settings`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.settings) {
            remoteSettingsCache = data.settings;
            remoteSettingsFetchedAt = Date.now();
            return mergeSettings(localSettings, data.settings);
        }
    } catch (err) {
        if (DEBUG) log(chalk.gray(`settings fetch skipped: ${err.message}`));
    }

    return localSettings;
}

function mergeSettings(base, override) {
    return {
        ...base,
        ...override,
        quietHours: {
            ...base.quietHours,
            ...override.quietHours,
        },
        privacy: {
            ...base.privacy,
            ...override.privacy,
        },
        appOverrides: {
            ...base.appOverrides,
            ...override.appOverrides,
        },
    };
}

async function postActivity(token, activity, options = {}) {
    const res = await fetch(`${SERVER_URL}/api/local-activity`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ activity, clearStatus: Boolean(options.clearStatus) }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(data.error || `Local activity post failed: ${res.status}`);
    }
}

let lastPayload = null;
let shutdownStarted = false;
let intervalHandle = null;

async function tick(token, options = {}) {
    try {
        const activity = options.clear ? null : await detectLocalActivity(await getRunningProcesses());
        const payload = JSON.stringify(activity || null);

        if (options.force || payload !== lastPayload) {
            await postActivity(token, activity, options);
            lastPayload = payload;
            lastActivity = activity;
            lastSyncAt = Date.now();
            lastError = null;
            addActivityHistoryEntry({
                activity: activity
                 ? {
                    name: activity.name,
                    category: activity.category,
                    emoji: activity.emoji,
                    detail: activity.detail ?? null,
                    customText: activity.customText ?? null,
                 }
               : null,
               action: activity ? 'reported' : 'cleared',
            });

            if (activity) {
                log(chalk.green('reported'), chalk.bold(activity.name), chalk.gray(activity.category));
            } else {
                log(chalk.gray('reported no local activity'));
            }
        } else if (activity) {
            await postActivity(token, activity);
            lastActivity = activity;
            lastSyncAt = Date.now();
            lastError = null;
            if (DEBUG) log(chalk.gray(`refreshed ${activity.name}`));
        }
    } catch (err) {
        lastError = err.message;
        logError(chalk.red('local agent error:'), err.message);
    }
}

async function shutdown(token, reason = 'shutdown') {
    if (shutdownStarted) return;
    shutdownStarted = true;
    if (intervalHandle) clearInterval(intervalHandle);

    log(chalk.yellow(`clearing Slack Activity status before ${reason}...`));
    await tick(token, { clear: true, clearStatus: true, force: true });
}

async function main() {
    log(chalk.bold.blue('Slack Activity Local Agent'));
    log(chalk.gray(`Reporting to ${SERVER_URL}`));
    const token = await getAgentToken();
    await getSteamAppList().catch(() => {});
    await tick(token);
    startDashboard(token);
    intervalHandle = setInterval(() => tick(token), POLL_INTERVAL);

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, async () => {
            try {
                await shutdown(token, signal);
            } finally {
                process.exit(0);
            }
        });
    }

    if (process.stdin) {
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', async (chunk) => {
            const command = chunk.trim().toLowerCase();

            if (command.startsWith('pause:')) {
                const value = command.split(':')[1];
                if (value === 'tomorrow') pauseUntilTomorrow();
                else pauseForMs(Number(value));
                await tick(token, { clear: true, clearStatus: true, force: true });
                return;
            }

            if (command === 'resume') {
                resumeUpdates();
                await tick(token, { force: true });
                return;
            }

            if (command === 'shutdown') {
                try {
                    await shutdown(token, 'tray exit');
                } finally {
                    process.exit(0);
                }
            }
        });
    }
}

main().catch((err) => {
    logError(chalk.red(err.message));
    process.exit(1);
});

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderHistoryTable(history) {
    if (!history.length) {
        return '<h2>Activity History</h2><p>No history yet.</p>';
    }

    const rows = history
        .slice(0, 50)
        .map((entry) => {
            const activity = entry.activity;
            const label = activity
                ? `${activity.emoji || ''} ${activity.name} (${activity.category})`
                : 'No activity';
            const detail = activity?.customText || activity?.detail || '';

            return `
                <tr>
                    <td>${escapeHtml(new Date(entry.timestamp).toLocaleString())}</td>
                    <td>${escapeHtml(entry.action)}</td>
                    <td>${escapeHtml(label)}</td>
                    <td>${escapeHtml(detail)}</td>
                </tr>
            `;
        })
        .join('');

    return `
        <h2>Activity History</h2>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin:16px 0;width:100%">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Activity</th>
                    <th>Detail</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}
