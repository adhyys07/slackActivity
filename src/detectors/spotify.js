import { execFileSync, execSync } from 'child_process';

function isSpotifyRunning(processes) {
    const names = new Set(processes.map(p => p.toLowerCase()));
    return names.has('spotify') || names.has('spotify.exe');
}

function getTrackMac(){
  try {
    const script = `tell application "Spotify" to if player state is playing then return (artist of current track) & " – " & (name of current track)`;
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
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$manager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
$session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
if ($null -eq $session) { exit 0 }
$props = $session.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
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
        return artist && title ? `${artist} – ${title}` : null;
    } catch { return null; }
}

export function detectSpotify(processes) {
    if (!isSpotifyRunning(processes)) return null;

    let track = null;
    try{
        if (process.platform === 'darwin') track = getTrackMac();
        else if (process.platform === 'win32') track = getTrackWindows();
        else track = getTrackLinux();
    } catch {}

    return { name: 'Spotify', emoji: ':musical_note:', category: 'music', detail: track };
}
