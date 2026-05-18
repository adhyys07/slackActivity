import { APP_DB } from "../../config/apps.js";

const DEV_CATEGORIES = new Set(['coding', 'design']);

export function detectDevTool(processes) {
    for (const proc of processes) {
        const entry = APP_DB[proc];
        if (entry && DEV_CATEGORIES.has(entry.category)) return { ...entry, proc };
    }
    return null;
}
