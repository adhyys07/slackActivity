import 'dotenv/config';
import chalk from 'chalk';
import { getRunningProcesses } from './platform/processes.js';
import { detectSteamGame, getSteamAppList } from './detectors/steam.js';
import { detectSpotify } from './detectors/spotify.js';
import { detectDevTool } from './detectors/devtools.js';
import { setSlackStatus , clearSlackStatus } from './slack.js';

const TOKEN = process.env.SLACK_TOKEN;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL ?? '5000', 10);
const DEBUG = process.env.DEBUG === 'true';

if (!TOKEN || TOKEN === 'xoxp-your-token-here') {
  console.error(chalk.red('✖ SLACK_TOKEN not set. Copy .env.example → .env and add your token.'));
  process.exit(1);
}

async function detectActivity(processes) {
    const steam = await detectSteamGame(processes);
    if (steam) return steam;

    const spotify = await detectSpotify(processes);
    if (spotify) return spotify;

    const dev = detectDevTool(processes);
    if (dev) return dev;
    return null;
}

function buildStatus(activity) {
    if (!activity) return { text: '', emoji: '' };
    const labels = { game: 'Playing', coding: 'Coding in', design: 'Designing in', music: null };
    let text;
    if (activity.category === 'music') {
      text = activity.detail ? `Listening to ${activity.detail}` : `Listening on ${activity.name}`;
    } else {
      text = `${labels[activity.category] ?? 'Using'} ${activity.name}`;
    }
    return { text, emoji: activity.emoji };
}

async function tick() {
    try{
        const processes = await getRunningProcesses();
        if (DEBUG) console.log(chalk.gray(`[debug] ${processes.length} processes`));
        const activity = await detectActivity(processes);
        const { text, emoji } = buildStatus(activity);
        const changed = await setSlackStatus(text, emoji, TOKEN);

        if (changed) {
            if (activity) console.log(chalk.green('●'), chalk.bold(activity.name), chalk.gray('→'), chalk.cyan(`${emoji} ${text}`));
            else          console.log(chalk.gray('○ No activity — status cleared'));
        }
    } catch (err) {
        console.error(chalk.red('Error during status update:'), err);
    }
}

async function main() {
    console.log(chalk.bold.blue('⚡ Slack Activity Agent'));
    console.log(chalk.gray(`   Platform: ${process.platform}  |  Interval: ${POLL_INTERVAL}ms\n`));

    await getSteamAppList().catch(()=>{});
    console.log(chalk.green('✔ Watching...\n'));
    await tick();
    setInterval(tick, POLL_INTERVAL);

    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, async () => {
            console.log(chalk.yellow('\nClearing Status!'));
            try { await clearSlackStatus(TOKEN); } catch {}
            process.exit(0);
        });
    }
}
main();
