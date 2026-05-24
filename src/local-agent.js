import 'dotenv/config';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { detectDevTool } from './detectors/devtools.js';
import { detectSpotify } from './detectors/spotify.js';
import { detectSteamGame, getSteamAppList } from './detectors/steam.js';
import { getRunningProcesses } from './platform/processes.js';

const DEFAULT_SERVER_URL = 'https://slackactivity-c162e24cca07.herokuapp.com';
const SERVER_URL = (process.env.SERVER_URL || process.env.BASE_URL || DEFAULT_SERVER_URL).replace(/\/$/, '');
const POLL_INTERVAL = parseInt(process.env.LOCAL_AGENT_INTERVAL ?? process.env.POLL_INTERVAL ?? '5000', 10);
const DEBUG = process.env.DEBUG === 'true';
const CONFIG_DIR = path.join(os.homedir(), '.slack-activity');
const CONFIG_FILE = path.join(CONFIG_DIR, 'agent.json');
const LOG_FILE = process.env.LOCAL_AGENT_LOG || (process.pkg ? path.join(path.dirname(process.execPath), 'SlackActivityAgent.log') : null);

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
    const steam = await detectSteamGame(processes);
    if (steam) return steam;

    const spotify = await detectSpotify(processes);
    if (spotify) return spotify;

    const dev = detectDevTool(processes);
    if (dev) return dev;

    return null;
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

            if (activity) {
                log(chalk.green('reported'), chalk.bold(activity.name), chalk.gray(activity.category));
            } else {
                log(chalk.gray('reported no local activity'));
            }
        } else if (activity) {
            await postActivity(token, activity);
            if (DEBUG) log(chalk.gray(`refreshed ${activity.name}`));
        }
    } catch (err) {
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
            if (!chunk.toLowerCase().includes('shutdown')) return;
            try {
                await shutdown(token, 'tray exit');
            } finally {
                process.exit(0);
            }
        });
    }
}

main().catch((err) => {
    logError(chalk.red(err.message));
    process.exit(1);
});
