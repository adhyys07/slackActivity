## slackActivity

Slack Activity is an extension which automatically updates your slack status on the what are you doing like Discord does!

### Setup

1. Copy `.env.example` to `.env`.
2. Create a Slack app and set the redirect URL to `http://localhost:3000/auth/slack/callback`.
3. Add Slack user scopes: `users.profile:write` and `users.profile:read`.
4. Create a Spotify app and set the redirect URI to `http://localhost:3000/auth/spotify/callback`.
5. Fill in `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID`, and `SPOTIFY_CLIENT_SECRET`.
6. Run `npm start`.
7. Open `http://localhost:3000` and connect Slack, then Spotify.

Use `npm run local` for the old single-user local watcher.

### Supported Apps

| Source | Supported apps/activity | Status format | Notes |
| --- | --- | --- | --- |
| Steam local agent | Installed Steam games | `Playing <game>` | Detects running installed Steam games from local Steam libraries. Ignores `Steamworks Common Redistributables`. |
| Spotify local agent | Spotify desktop process | `Listening to <artist> - <song>` or `Listening on Spotify` | Track title depends on what the OS exposes locally. |
| Spotify Web API | Spotify account playback | `Listening to <artist> - <song>` | Requires the user to connect Spotify in the hosted app. |
| Code editors | VS Code, Cursor, IntelliJ IDEA, PyCharm, CLion, Neovim, Vim, Xcode, Sublime Text | `Coding in <app>` | Requires the local agent. |
| Design tools | Figma, Sketch, Blender | `Designing in <app>` | Requires the local agent. |
| Other games/launchers | Epic Games Launcher, League of Legends, Valorant | `Playing <app>` | Process-name based detection from the local agent. |
| Music apps | Apple Music, foobar2000 | `Listening on <app>` | Process-name based detection from the local agent. |

Local activity priority is:

```text
Steam game > Local Spotify > Code/design tools > Spotify Web API > Clear status
```

### Local Agent

The hosted app can read Spotify through the Spotify API, but Steam and desktop apps must be detected on the user's own computer.

Run the local agent on the user's computer:

```powershell
$env:SERVER_URL="https://your-app-name.herokuapp.com"; npm run local-agent
```

The agent opens the hosted app in the browser. After the user authorizes Slack and Spotify, the agent saves its local token in `~/.slack-activity/agent.json` and starts reporting Steam games and supported desktop apps. Fresh local activity takes priority over Spotify.

Build local-agent binaries:

```powershell
npm run build:agent:win
npm run build:agent:linux
npm run build:agent:mac
```

On Windows, macOS binaries are built unsigned. Sign them on a Mac before distribution.

Generated binaries are written to `dist/`:

```text
SlackActivity.exe                     Windows tray app
linux/slack-activity-agent-linux-x64  Linux x64
macos/slack-activity-agent-macos-x64  macOS x64
macos/slack-activity-agent-macos-arm64 macOS Apple Silicon
```

On Windows, users should run `SlackActivity.exe`. It starts the local agent in the background and adds a system tray icon. Use the tray menu's Exit item to stop the agent.

macOS builds must be signed on a Mac before distribution:

```bash
codesign --sign - dist/macos/slack-activity-agent-macos-x64
codesign --sign - dist/macos/slack-activity-agent-macos-arm64
```

### Heroku

Attach Heroku Postgres before connecting users:

```powershell
heroku addons:create heroku-postgresql:essential-0 -a your-app-name
```

Heroku will set `DATABASE_URL` automatically. Without Postgres, connected users are stored in SQLite and will disappear after redeploys or dyno restarts.

Set these config vars to your Heroku app URL:

```env
BASE_URL=https://your-app-name.herokuapp.com
SLACK_REDIRECT_URI=https://your-app-name.herokuapp.com/auth/slack/callback
SPOTIFY_REDIRECT_URI=https://your-app-name.herokuapp.com/auth/spotify/callback
```

Add the same callback URLs in the Slack and Spotify app dashboards.
