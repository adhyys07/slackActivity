import fs from 'fs';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q.res));

async function main() {
  console.log('\n⚡ Slack Activity Agent Setup\n');
  console.log('1. Go to https://api.slack.com/apps → Create New App');
  console.log('2. OAuth & Permissions → add scopes: users.profile:write, users.profile:read');
  console.log('3. Install to workspace → copy User OAuth Token\n');

  const token = await ask('Paste your xoxp- token: ');
  if (!token.startsWith('xoxp-')) { console.error('✖ Must start with xoxp-'); process.exit(1); }

  process.stdout.write('Testing... ');
  const res = await fetch('https://slack.com/api/auth.test', { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!data.ok) { console.error(`\n✖ ${data.error}`); process.exit(1); }
  console.log(`✔ @${data.user} in ${data.team}`);

  const interval = await ask('\nPoll interval ms? [5000]: ');
  const debug    = await ask('Debug logging? (y/N): ');

  fs.writeFileSync('.env', [
    `SLACK_TOKEN=${token}`,
    `POLL_INTERVAL=${interval.trim() || '5000'}`,
    `DEBUG=${debug.toLowerCase() === 'y'}`,
    `STEAM_PATH=`,
  ].join('\n') + '\n');

  console.log('\n✔ .env created! Run: npm start');
  rl.close();
}

main();