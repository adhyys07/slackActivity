import 'dotenv/config';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { detectDevTool } from './detectors/devtools.js';
import { detectSteamGame, getSteamAppList } from './detectors/steam.js';
import { getRunningProcesses } from './platform/processes.js';

const SERVER_URL = (process.env.SERVER_URL || process.env.BASE_URL || '').replace(/\/$/, '');
const POLL_INTERVAL = parseInt(process.env.LOCAL_AGENT_INTERVAL ?? process.env.POLL_INTERVAL ?? '5000', 10);
const DEBUG = process.env.DEBUG === 'true';
const CONFIG_DIR = path.join(os.homedir(), '.slack-activity');
const CONFIG_FILE = path.join(CONFIG_DIR, 'agent.json');

if (!SERVER_URL) {
    console.error('SERVER_URL is required. Example: $env:SERVER_URL="https://your-app.herokuapp.com"');
    process.exit(1);
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

    console.log(chalk.yellow('No saved local agent token found.'));
    console.log(chalk.gray('Opening browser to connect Slack and Spotify...'));
    console.log(chalk.gray(pairUrl));
    openBrowser(pairUrl);

    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const res = await fetch(`${SERVER_URL}/api/local-agent/pairing/${code}`);
        if (res.status === 202) {
            console.log(chalk.gray('Waiting for browser authorization...'));
            continue;
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `Pairing failed: ${res.status}`);

        saveToken(data.token);
        console.log(chalk.green('Local agent paired successfully.'));
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

    const dev = detectDevTool(processes);
    if (dev) return dev;

    return null;
}

async function postActivity(token, activity) {
    const res = await fetch(`${SERVER_URL}/api/local-activity`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ activity }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(data.error || `Local activity post failed: ${res.status}`);
    }
}

let lastPayload = null;

async function tick(token) {
    try {
        const processes = await getRunningProcesses();
        const activity = await detectLocalActivity(processes);
        const payload = JSON.stringify(activity || null);

        if (payload !== lastPayload) {
            await postActivity(token, activity);
            lastPayload = payload;

            if (activity) {
                console.log(chalk.green('reported'), chalk.bold(activity.name), chalk.gray(activity.category));
            } else {
                console.log(chalk.gray('reported no local activity'));
            }
        } else if (activity) {
            await postActivity(token, activity);
            if (DEBUG) console.log(chalk.gray(`refreshed ${activity.name}`));
        }
    } catch (err) {
        console.error(chalk.red('local agent error:'), err.message);
    }
}

async function main() {
    console.log(chalk.bold.blue('Slack Activity Local Agent'));
    console.log(chalk.gray(`Reporting to ${SERVER_URL}`));
    const token = await getAgentToken();
    await getSteamAppList().catch(() => {});
    await tick(token);
    setInterval(() => tick(token), POLL_INTERVAL);
}

main().catch((err) => {
    console.error(chalk.red(err.message));
    process.exit(1);
});
