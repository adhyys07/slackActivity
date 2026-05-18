import 'dotenv/config';
import chalk from 'chalk';
import { detectDevTool } from './detectors/devtools.js';
import { detectSteamGame, getSteamAppList } from './detectors/steam.js';
import { getRunningProcesses } from './platform/processes.js';

const SERVER_URL = (process.env.SERVER_URL || process.env.BASE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.LOCAL_AGENT_TOKEN;
const POLL_INTERVAL = parseInt(process.env.LOCAL_AGENT_INTERVAL ?? process.env.POLL_INTERVAL ?? '5000', 10);
const DEBUG = process.env.DEBUG === 'true';

if (!SERVER_URL) {
    console.error('SERVER_URL is required. Example: $env:SERVER_URL="https://your-app.herokuapp.com"');
    process.exit(1);
}

if (!TOKEN) {
    console.error('LOCAL_AGENT_TOKEN is required. Copy it from the connected page in the web app.');
    process.exit(1);
}

async function detectLocalActivity(processes) {
    const steam = await detectSteamGame(processes);
    if (steam) return steam;

    const dev = detectDevTool(processes);
    if (dev) return dev;

    return null;
}

async function postActivity(activity) {
    const res = await fetch(`${SERVER_URL}/api/local-activity`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
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

async function tick() {
    try {
        const processes = await getRunningProcesses();
        const activity = await detectLocalActivity(processes);
        const payload = JSON.stringify(activity || null);

        if (payload !== lastPayload) {
            await postActivity(activity);
            lastPayload = payload;

            if (activity) {
                console.log(chalk.green('reported'), chalk.bold(activity.name), chalk.gray(activity.category));
            } else {
                console.log(chalk.gray('reported no local activity'));
            }
        } else if (activity) {
            await postActivity(activity);
            if (DEBUG) console.log(chalk.gray(`refreshed ${activity.name}`));
        }
    } catch (err) {
        console.error(chalk.red('local agent error:'), err.message);
    }
}

async function main() {
    console.log(chalk.bold.blue('Slack Activity Local Agent'));
    console.log(chalk.gray(`Reporting to ${SERVER_URL}`));
    await getSteamAppList().catch(() => {});
    await tick();
    setInterval(tick, POLL_INTERVAL);
}

main();
