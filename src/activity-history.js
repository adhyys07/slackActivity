import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_DIR = path.join(os.homedir(), '.slack-activity');
const HISTORY_FILE = path.join(CONFIG_DIR, 'activity-history.json');
const MAX_HISTORY_ITEMS = 250;

export function readActivityHistory() {
    try {
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        return Array.isArray(history) ? history : [];
    } catch {
        return [];
    }
}

export function addActivityHistoryEntry(entry) {
    const history = readActivityHistory();
    const next = [
        {
            timestamp: Date.now(),
            ...entry,
        },
        ...history,
    ].slice(0, MAX_HISTORY_ITEMS);

    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(next, null, 2));

    return next;
}

export function clearActivityHistory() {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
}
