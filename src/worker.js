import chalk from 'chalk';
import { getConnectedUsers, updateLastStatus, updateSpotifyToken } from './db.js';
import { setSlackStatus } from './slack.js';
import { getSpotifyPlayback, refreshSpotifyToken } from './spotify.js';

async function getValidSpotifyAccessToken(user) {
    if (user.spotify_access_token && Date.now() < user.spotify_token_expires_at) {
        return user.spotify_access_token;
    }

    const refreshed = await refreshSpotifyToken(user.spotify_refresh_token);
    await updateSpotifyToken({ userId: user.id, ...refreshed });

    return refreshed.accessToken;
}

export async function syncOnce({ force = false } = {}) {
    const users = await getConnectedUsers();
    if (!users.length) {
        console.log(chalk.gray('sync skipped: no fully connected users'));
        return { users: 0, updated: 0, results: [] };
    }

    let updated = 0;
    const results = [];
    for (const user of users) {
        try {
            const accessToken = await getValidSpotifyAccessToken(user);
            const playback = await getSpotifyPlayback(accessToken);
            const track = playback.track;
            const text = track ? `Listening to ${track}` : '';
            const emoji = track ? ':musical_note:' : '';

            if (!force && text === user.last_status_text && emoji === user.last_status_emoji) {
                results.push({
                    userId: user.slack_user_id,
                    track,
                    updated: false,
                    reason: 'status unchanged',
                    spotify: playback.reason,
                });
                continue;
            }

            const slackChanged = await setSlackStatus(text, emoji, user.slack_user_token, { force });
            await updateLastStatus({ userId: user.id, text, emoji });
            if (slackChanged) updated += 1;

            const label = track || 'cleared status';
            console.log(chalk.green('synced'), chalk.gray(user.slack_user_id), label);
            if (!track) console.log(chalk.gray(`no Spotify track playing for ${user.slack_user_id}`));
            results.push({
                userId: user.slack_user_id,
                track,
                updated: slackChanged,
                reason: track ? 'track synced' : 'no active Spotify track; status cleared',
                spotify: playback.reason,
                forced: force,
            });
        } catch (err) {
            console.error(chalk.red(`sync failed for user ${user.id}:`), err.message);
            results.push({
                userId: user.slack_user_id,
                track: null,
                updated: false,
                error: err.message,
            });
        }
    }

    return { users: users.length, updated, results };
}

export function startWorker() {
    const interval = parseInt(process.env.POLL_INTERVAL ?? '5000', 10);
    syncOnce().catch((err) => console.error(chalk.red('initial sync failed:'), err.message));
    setInterval(() => {
        syncOnce().catch((err) => console.error(chalk.red('sync failed:'), err.message));
    }, interval);
}
