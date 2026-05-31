export const DEFAULT_SETTINGS = {
    pausedUntil: null,
    quietHours: {
        enabled: false,
        start: '22:00',
        end: '09:00',
    },
    quietWhenMeeting: false,
    enabledCategories: ['game', 'coding', 'design', 'music', 'media', 'meeting'],
    categoryPriority: ['meeting', 'game', 'coding', 'music', 'design', 'media'],
    appOverrides: {
        'VS Code': {
            enabled: true,
            text: 'Coding in VS Code',
            emoji: ':computer:',
        },
        Spotify: {
            enabled: true,
            text: null,
            emoji: ':spotify_logo:',
        },
        Valorant: {
            enabled: true,
            text: 'Playing Valorant',
            emoji: ':dart:',
        },
    },
    privacy: {
        showProjectName: true,
        showSongName: true,
        showGameName: true,
    },
};

export function applyActivitySettings(activity, settings = DEFAULT_SETTINGS) {
    if (!activity) return null;
    if (isPaused(settings) || isQuietHours(settings)) return null;
    if (!settings.enabledCategories?.includes(activity.category)) return null;

    const override = settings.appOverrides?.[activity.name];
    if (override?.enabled === false) return null;

    return {
        ...activity,
        name: override?.name ?? activity.name,
        emoji: override?.emoji ?? activity.emoji,
        customText: override?.text ?? activity.customText ?? null,
    };
}

export function sortActivitiesByPriority(activities, settings = DEFAULT_SETTINGS) {
    const priority = settings.categoryPriority ?? DEFAULT_SETTINGS.categoryPriority;
    return [...activities].sort((a, b) => priorityIndex(a.category, priority) - priorityIndex(b.category, priority));
}

export function isPaused(settings) {
    if (!settings.pausedUntil) return false;
    return Date.now() < Number(settings.pausedUntil);
}

export function isQuietHours(settings) {
    if (!settings.quietHours?.enabled) return false;

    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const start = parseTime(settings.quietHours.start);
    const end = parseTime(settings.quietHours.end);
    if (start === null || end === null) return false;

    if (start < end) return current >= start && current < end;
    return current >= start || current < end;
}

function priorityIndex(category, priority) {
    const index = priority.indexOf(category);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function parseTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;

    return hours * 60 + minutes;
}
