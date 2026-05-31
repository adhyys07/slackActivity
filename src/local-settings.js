import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_SETTINGS } from '../config/user-settings.js';

const CONFIG_DIR = path.join(os.homedir(), '.slack-activity');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');

export function loadLocalSettings() {
    try {
        const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        return mergeSettings(saved);
    } catch {
        return mergeSettings({});
    }
}

export function saveLocalSettings(settings) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(mergeSettings(settings), null, 2));
}

export function pauseForMs(ms) {
    const settings = loadLocalSettings();
    settings.pausedUntil = Date.now() + Number(ms);
    saveLocalSettings(settings);
}

export function pauseUntilTomorrow() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const settings = loadLocalSettings();
    settings.pausedUntil = tomorrow.getTime();
    saveLocalSettings(settings);
}

export function resumeUpdates() {
    const settings = loadLocalSettings();
    settings.pausedUntil = null;
    saveLocalSettings(settings);
}

function mergeSettings(saved) {
    return {
        ...DEFAULT_SETTINGS,
        ...saved,
        quietHours: {
            ...DEFAULT_SETTINGS.quietHours,
            ...saved.quietHours,
        },
        privacy: {
            ...DEFAULT_SETTINGS.privacy,
            ...saved.privacy,
        },
        appOverrides: {
            ...DEFAULT_SETTINGS.appOverrides,
            ...saved.appOverrides,
        },
    };
}
