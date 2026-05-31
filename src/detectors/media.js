import { APP_DB } from '../../config/apps.js';

const MEDIA_CATEGORIES = new Set(['media']);

export function detectMediaTool(processes) {
    for (const proc of processes) {
        const app = APP_DB[proc];
        if (app && MEDIA_CATEGORIES.has(app.category)) return { ...app, proc };
    }
    return null;
}
