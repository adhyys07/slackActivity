import fs from 'fs';
import path from 'path';
import os from 'os';

function getDefaultSteamPath() {
  if (process.env.STEAM_PATH) return process.env.STEAM_PATH;
  switch (process.platform) {
    case 'win32':
      return path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam');
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Steam');
    default:
      for (const p of [
        path.join(os.homedir(), '.steam', 'steam'),
        path.join(os.homedir(), '.local', 'share', 'Steam'),
      ]) {
        if (fs.existsSync(p)) return p;
      }
      return path.join(os.homedir(), '.steam', 'steam');
  }
}

function parseAcf(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*"(\w+)"\s+"([^"]+)"/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function getLibraryPaths(steamPath) {
  const paths = [path.join(steamPath, 'steamapps')];
  const vdf = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (!fs.existsSync(vdf)) return paths;
  try {
    const content = fs.readFileSync(vdf, 'utf8');
    for (const m of content.matchAll(/"path"\s+"([^"]+)"/g)) {
      const p = path.join(m[1], 'steamapps');
      if (fs.existsSync(p)) paths.push(p);
    }
  } catch {}
  return paths;
}

export function getInstalledSteamGames(steamPath = getDefaultSteamPath()) {
  const games = {};
  if (!fs.existsSync(steamPath)) return games;

  for (const libPath of getLibraryPaths(steamPath)) {
    let files;
    try {
      files = fs.readdirSync(libPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;
      try {
        const data = parseAcf(fs.readFileSync(path.join(libPath, file), 'utf8'));
        if (data.appid && data.name) {
          games[data.appid] = { name: data.name, exe: data.exe ?? null };
        }
      } catch {}
    }
  }
  return games;
}

let steamAppCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const IGNORED_STEAM_APP_IDS = new Set(['228980']);
const IGNORED_STEAM_APP_NAMES = new Set(['steamworks common redistributables']);

function isIgnoredSteamApp(appid, game) {
  return IGNORED_STEAM_APP_IDS.has(String(appid)) || IGNORED_STEAM_APP_NAMES.has(game.name.toLowerCase());
}

export async function getSteamAppList() {
  if (steamAppCache && Date.now() - cacheTimestamp < CACHE_TTL) return steamAppCache;
  try {
    console.log('[steam] Fetching Steam app list...');
    const res = await fetch('https://api.steampowered.com/ISteamApps/GetAppList/v2/');
    const data = await res.json();
    steamAppCache = Object.fromEntries(data.applist.apps.map((a) => [String(a.appid), a.name]));
    cacheTimestamp = Date.now();
    console.log(`[steam] Loaded ${Object.keys(steamAppCache).length} apps`);
  } catch (err) {
    console.error('[steam] Failed to fetch app list:', err.message);
  }
  return steamAppCache ?? {};
}

export async function detectSteamGame(runningProcesses) {
  const installed = getInstalledSteamGames();
  if (!Object.keys(installed).length) return null;

  const processSet = new Set(runningProcesses.map((p) => p.toLowerCase()));

  for (const [appid, game] of Object.entries(installed)) {
    if (isIgnoredSteamApp(appid, game)) continue;

    if (game.exe && processSet.has(path.basename(game.exe).toLowerCase())) {
      return { name: game.name, appid, emoji: ':steam:', category: 'game' };
    }

    const slug = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const proc of processSet) {
      const procSlug = proc.replace(/[^a-z0-9]/g, '').replace('exe', '');
      if (procSlug.length > 4 && (procSlug.includes(slug) || slug.includes(procSlug))) {
        return { name: game.name, appid, emoji: ':steam:', category: 'game' };
      }
    }
  }
  return null;
}
