## slackActivity

Slack Activity automatically updates your Slack status based on what you are doing locally, similar to Discord rich presence. It can show Steam games, Spotify playback, coding tools, design apps, meetings, and other desktop activity.

### Setup

1. Copy `.env.example` to `.env`.
2. Create a Slack app and set the redirect URL to `http://localhost:3000/auth/slack/callback`.
3. Add Slack user scopes: `users.profile:write` and `users.profile:read`.
4. Create a Spotify app and set the redirect URI to `http://localhost:3000/auth/spotify/callback`.
5. Fill in `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID`, and `SPOTIFY_CLIENT_SECRET`.
6. Run `npm start`.
7. Open `http://localhost:3000` and connect Slack, then Spotify.

Use `npm run local` for the old single-user local watcher.

### Features

- Multi-user hosted Slack + Spotify authorization.
- Local agent for Steam games, desktop apps, coding tools, media tools, and meeting apps.
- Per-app status customization with custom text and emoji.
- Category priority settings, so users can prefer coding, games, music, meetings, or media.
- Pause mode and quiet hours.
- Optional quiet mode while a meeting app is running.
- Local dashboard at `http://localhost:3784`.
- Windows tray controls for pause/resume, dashboard, restart, exit, and start on login.
- Automatic Slack status expiration. The default is 30 minutes.
- Git project-aware coding status, such as `Coding in slackActivity`.
- Local agent update checks from GitHub Releases, with dashboard download support.

### Supported Apps

| Source | Supported apps/activity | Status format | Notes |
| --- | --- | --- | --- |
| Steam local agent | Installed Steam games | `Playing <game>` | Detects running installed Steam games from local Steam libraries. Ignores `Steamworks Common Redistributables`. |
| Spotify local agent | Spotify desktop process | `Listening to <artist> - <song>` or `Listening on Spotify` | Track title depends on what the OS exposes locally. |
| Spotify Web API | Spotify account playback | `Listening to <artist> - <song>` | Requires the user to connect Spotify in the hosted app. |
| Code editors | VS Code, Cursor, IntelliJ IDEA, PyCharm, CLion, Neovim, Vim, Xcode, Sublime Text, Android Studio, WebStorm, Rider, Eclipse, Terminal, Windows Terminal, iTerm, Unity, Unreal Engine | `Coding in <app>` or `Coding in <git repo>` | Requires the local agent. |
| Design tools | Figma, Sketch, Blender, Photoshop | `Designing in <app>` | Requires the local agent. |
| Other games/launchers | Epic Games Launcher, League of Legends, Valorant | `Playing <app>` | Process-name based detection from the local agent. |
| Music apps | Apple Music, foobar2000 | `Listening on <app>` | Process-name based detection from the local agent. |
| Media tools | DaVinci Resolve, OBS | `Using <app>` | Requires the local agent. |
| Meeting apps | Discord, Zoom, Microsoft Teams | `In a meeting on <app>` | Requires the local agent. |

Default local activity priority is:

```text
Meeting > Game > Coding > Music > Design > Media > Spotify Web API > Clear status
```

Users can override this priority in settings.

### Local Agent

The hosted app can read Spotify through the Spotify API, but Steam and desktop apps must be detected on the user's own computer.

Run the local agent on the user's computer:

```powershell
$env:SERVER_URL="https://your-app-name.herokuapp.com"; npm run local-agent
```

The agent opens the hosted app in the browser. After the user authorizes Slack and Spotify, the agent saves its local token in `~/.slack-activity/agent.json` and starts reporting Steam games and supported desktop apps. Fresh local activity takes priority over Spotify.

The local dashboard runs at:

```text
http://localhost:3784
```

From the dashboard, users can see current activity, last sync time, errors, and pause/resume controls.

The dashboard also includes update controls. It checks GitHub Releases for the latest local agent release, shows whether an update is available, and can download the matching asset for the user's OS.

### Settings

Local settings are read from:

```text
~/.slack-activity/settings.json
```

Hosted settings can also be edited from:

```text
https://your-app/settings?token=<LOCAL_AGENT_TOKEN>
```

Example settings:

```json
{
  "pausedUntil": null,
  "quietHours": {
    "enabled": false,
    "start": "22:00",
    "end": "09:00"
  },
  "quietWhenMeeting": false,
  "enabledCategories": ["game", "coding", "design", "music", "media", "meeting"],
  "categoryPriority": ["meeting", "game", "coding", "music", "design", "media"],
  "appOverrides": {
    "VS Code": {
      "enabled": true,
      "text": "Coding in VS Code",
      "emoji": ":computer:"
    },
    "Valorant": {
      "enabled": true,
      "text": "Playing Valorant",
      "emoji": ":dart:"
    },
    "Spotify": {
      "enabled": true,
      "text": null,
      "emoji": ":spotify_logo:"
    }
  },
  "privacy": {
    "showProjectName": true,
    "showSongName": true,
    "showGameName": true
  }
}
```

To pause updates from settings, set `pausedUntil` to a future Unix timestamp in milliseconds. To disable a whole category, remove it from `enabledCategories`. To disable one app, set its override to `{ "enabled": false }`.

### Windows Tray

On Windows, users should run `SlackActivity.exe`. It starts the local agent in the background and adds a system tray icon.

Tray menu options:

- Open Slack Activity
- Open Local Dashboard
- Pause for 1 hour
- Pause until tomorrow
- Resume updates
- Start on login
- Disable start on login
- Restart Agent
- Exit

Use the tray menu's Exit item to stop the agent. On exit, the tray app asks the agent to clear the Slack status before shutting down.

### Status Expiration

Slack statuses expire automatically after 30 minutes by default. Override this with:

```env
STATUS_EXPIRATION_SECONDS=1800
```

Set a larger value for longer-lived statuses, or a smaller value if you want Slack to clear stale activity sooner.

### Auto-Update Downloads

The local agent can check the latest GitHub Release and download the correct asset for the current OS.

Downloaded updates are saved to:

```text
~/.slack-activity/updates/
```

The updater currently downloads updates only. It does not replace the running executable automatically yet, because Windows cannot safely replace a running `.exe` directly. Users can download the update from the dashboard and install or replace it manually.

Set the current app version with:

```env
APP_VERSION=1.0.0
```

### Builds

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

macOS builds must be signed on a Mac before distribution:

```bash
codesign --sign - dist/macos/slack-activity-agent-macos-x64
codesign --sign - dist/macos/slack-activity-agent-macos-arm64
```

### Hosting

Attach Postgres DB before connecting users,
For this I used Neon DB as it is free and reliable :)

You need to set `DATABASE_URL` in your environment variable on your hosting service. Without Postgres, connected users are stored in SQLite and will disappear after redeploys or dyno restarts.

Set these config vars to your app URL:

```env
BASE_URL=https://your-app-name.herokuapp.com
SLACK_REDIRECT_URI=https://your-app-name.herokuapp.com/auth/slack/callback
SPOTIFY_REDIRECT_URI=https://your-app-name.herokuapp.com/auth/spotify/callback
```

Add the same callback URLs in the Slack and Spotify app dashboards.
