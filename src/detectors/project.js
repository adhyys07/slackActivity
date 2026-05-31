import path from 'path';
import { execFileSync } from 'child_process';

export function enrichCodingActivity(activity, settings) {
    if (!activity || activity.category !== 'coding') return activity;
    if (!settings.privacy?.showProjectName) return activity;

    const projectName = getGitProjectName();
    if (!projectName) return activity;

    return {
        ...activity,
        customText: `Coding in ${projectName}`,
    };
}

function getGitProjectName(cwd = process.cwd()) {
    try {
        const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd,
            encoding: 'utf8',
            timeout: 1000,
            windowsHide: true,
        }).trim();
        return path.basename(root);
    } catch {
        return null;
    }
}
