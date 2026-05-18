## slackActivity

Multi-user app that updates each connected user's Slack status with their currently playing Spotify track.

### Setup

1. Copy `.env.example` to `.env`.
2. Create a Slack app and set the redirect URL to `http://localhost:3000/auth/slack/callback`.
3. Add Slack user scopes: `users.profile:write` and `users.profile:read`.
4. Create a Spotify app and set the redirect URI to `http://localhost:3000/auth/spotify/callback`.
5. Fill in `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID`, and `SPOTIFY_CLIENT_SECRET`.
6. Run `npm start`.
7. Open `http://localhost:3000` and connect Slack, then Spotify.

Use `npm run local` for the old single-user local watcher.
