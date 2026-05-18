import chalk from 'chalk';
import { db } from './db.js';
import { setSlackStatus } from './slack.js';
import { getCurrentSpotifyTrack, refreshSpotifyToken } from './spotify.js';

const getConnectedUsers = db.prepare(`
SELECT *
FROM users
WHERE slack_user_token IS NOT NULL
AND spotify_refresh_token IS NOT NULL
`);

const updateSpotifyToken = db.prepare(`
UPDATE users
SET spotify_access_token = ?,
    spotify_refresh_token = ?,
    spotify_token_expires_at = ?,
    updated_at = unixepoch()
WHERE id = ?
`);

const updateLastStatus = db.prepare(`
UPDATE users
SET last_status_text = ?,
    last_status_emoji = ?,
    updated_at = unixepoch()
WHERE id = ?
`);

async function getValidSpotifyAccessToken(user) {
    if (user.spotify_access_token && Date.now() < user.spotify_token_expires_at) {
        return user.spotify_access_token;
    }

    const refreshed = await refreshSpotifyToken(user.spotify_refresh_token);
    updateSpotifyToken.run(
        refreshed.accessToken,
        refreshed.refreshToken,
        refreshed.expiresAt,
        user.id,
    );

    return refreshed.accessToken;
}

export async function syncOnce() {
    const users = getConnectedUsers.all();

    for (const user of users) {
        try {
            const accessToken = await getValidSpotifyAccessToken(user);
            const track = await getCurrentSpotifyTrack(accessToken);
            const text = track ? `Listening to ${track}` : '';
            const emoji = track ? ':musical_note:' : '';

            if (text === user.last_status_text && emoji === user.last_status_emoji) continue;

            await setSlackStatus(text, emoji, user.slack_user_token);
            updateLastStatus.run(text, emoji, user.id);

            const label = track || 'cleared status';
            console.log(chalk.green('synced'), chalk.gray(user.slack_user_id), label);
        } catch (err) {
            console.error(chalk.red(`sync failed for user ${user.id}:`), err.message);
        }
    }
}

export function startWorker() {
    const interval = parseInt(process.env.POLL_INTERVAL ?? '5000', 10);
    syncOnce().catch((err) => console.error(chalk.red('initial sync failed:'), err.message));
    setInterval(() => {
        syncOnce().catch((err) => console.error(chalk.red('sync failed:'), err.message));
    }, interval);
}
