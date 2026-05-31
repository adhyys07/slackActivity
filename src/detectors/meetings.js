import { APP_DB } from '../../config/apps.js';

const MEETING_CATEGORIES = new Set(['meeting']);

export function detectMeetingApp(processes) {
    for (const proc of processes) {
        const app = APP_DB[proc];
        if (app && MEETING_CATEGORIES.has(app.category)) {
            return {
                ...app,
                proc,
                customText: `In a meeting on ${app.name}`,
            };
        }
    }
    return null;
}
