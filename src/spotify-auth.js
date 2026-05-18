import 'dotenv/config';
import http from 'http';
import { execFile } from 'child_process';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';
const SCOPE = 'user-read-currently-playing';

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'powershell' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-Command', 'Start-Process', url]
    : [url];
  execFile(command, args);
}

function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Spotify authorization failed: ${error}`);
        server.close(() => reject(new Error(error)));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Spotify authorization complete. You can close this tab and return to the terminal.');
      server.close(() => resolve(code));
    });

    server.listen(8888, '127.0.0.1', () => {
      const authUrl = new URL('https://accounts.spotify.com/authorize');
      authUrl.searchParams.set('client_id', CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('scope', SCOPE);
      openBrowser(authUrl.toString());
      console.log('Opened Spotify authorization in your browser...');
      console.log(`If it does not open correctly, paste this URL into your browser:\n${authUrl}`);
    });
  });
}

async function exchangeCode(code) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Spotify token exchange failed');
  return data;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env first.');
    process.exit(1);
  }

  console.log(`Using redirect URI: ${REDIRECT_URI}`);
  console.log('Make sure this exact URI is listed in your Spotify app settings.');

  const code = await waitForCode();
  if (!code) throw new Error('Spotify did not return an authorization code.');

  const tokens = await exchangeCode(code);
  console.log('\nAdd this to your .env:\n');
  console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
