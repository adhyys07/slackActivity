import { execFileSync, execSync } from 'child_process';

let cachedAccessToken = process.env.SPOTIFY_ACCESS_TOKEN || null;
let tokenExpiresAt = 0;

function isSpotifyRunning(processes) {
    const names = new Set(processes.map(p => p.toLowerCase()));
    return names.has('spotify') || names.has('spotify.exe');
}

async function getSpotifyAccessToken() {
    if (cachedAccessToken && Date.now() < tokenExpiresAt) return cachedAccessToken;
    if (process.env.SPOTIFY_ACCESS_TOKEN && !process.env.SPOTIFY_REFRESH_TOKEN) return process.env.SPOTIFY_ACCESS_TOKEN;

    const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) return null;

    const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: SPOTIFY_REFRESH_TOKEN,
        }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    cachedAccessToken = data.access_token;
    tokenExpiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
    return cachedAccessToken;
}

async function getSpotifyWebTrack() {
    try {
        const token = await getSpotifyAccessToken();
        if (!token) return null;

        const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 204 || res.status === 202 || !res.ok) return null;
        const data = await res.json();
        if (!data.is_playing || data.currently_playing_type !== 'track' || !data.item) return null;

        const artists = data.item.artists?.map((artist) => artist.name).filter(Boolean).join(', ');
        return artists ? `${artists} - ${data.item.name}` : data.item.name;
    } catch {
        return null;
    }
}

function getTrackMac(){
  try {
    const script = `tell application "Spotify" to if player state is playing then return (artist of current track) & " - " & (name of current track)`;
    return execSync(`osascript -e '${script}'`, { encoding: 'utf8', timeout: 2000 }).trim() || null;
  } catch { return null; }
}

function getTrackWindows() {
    const mediaTrack = getWindowsMediaTrack();
    if (mediaTrack) return mediaTrack;

    try {
        const ps = `(Get-Process spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -ne 'Spotify' } | Select-Object -First 1 -ExpandProperty MainWindowTitle)`;
        const title = execSync(`powershell -Command "${ps}"`, { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim();
        return title && title !== 'Spotify' ? title : null;
    } catch { return null; }
}

function getWindowsMediaTrack() {
    try {
        const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$managerTask = [System.WindowsRuntimeSystemExtensions]::AsTask([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
$manager = $managerTask.GetAwaiter().GetResult()
$session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
if ($null -eq $session) { exit 0 }
$propsTask = [System.WindowsRuntimeSystemExtensions]::AsTask($session.TryGetMediaPropertiesAsync())
$props = $propsTask.GetAwaiter().GetResult()
$status = [string]$session.GetPlaybackInfo().PlaybackStatus
[pscustomobject]@{ status = $status; artist = $props.Artist; title = $props.Title } | ConvertTo-Json -Compress
`;
        const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 3000,
            windowsHide: true,
        }).trim();
        if (!out) return null;

        const track = JSON.parse(out);
        if (track.status !== 'Playing' || !track.title) return null;
        return track.artist ? `${track.artist} - ${track.title}` : track.title;
    } catch { return null; }
}

function getTrackLinux() {
    try {
        const status = execSync('playerctl -p spotify status 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
        if (status !== 'Playing') return null;
        const artist = execSync('playerctl -p spotify metadata artist 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
        const title  = execSync('playerctl -p spotify metadata title 2>/dev/null',  { encoding: 'utf8', timeout: 2000 }).trim();
        return artist && title ? `${artist} - ${title}` : null;
    } catch { return null; }
}

export async function detectSpotify(processes) {
    const webTrack = await getSpotifyWebTrack();
    if (webTrack) {
        return { name: 'Spotify', emoji: ':musical_note:', category: 'music', detail: webTrack };
    }

    if (!isSpotifyRunning(processes)) return null;

    let track = null;
    try{
        if (process.platform === 'darwin') track = getTrackMac();
        else if (process.platform === 'win32') track = getTrackWindows();
        else track = getTrackLinux();
    } catch {}
    
    return { name: 'Spotify', emoji: ':musical_note:', category: 'music', detail: track };
}
