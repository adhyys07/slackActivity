import { execSync } from 'child_process';

export function getRunningProcesses() {
    try {
        switch (process.platform) {
            case 'win32': return getProcessesWindows();
            case 'darwin': return getProcessesMac();
            default: return getProcessesLinux();
        }
    } catch (error) {
        console.error('Error fetching processes:', error);
        return [];
        }
    }

function getProcessesWindows() {
    const out = execSync('tasklist /fo csv /nh', { encoding: 'utf8', windowsHide: true });
    return out.split('\n') 
        .map(line => line.split(',')[0]?.replace(/"/g, '').trim())
        .filter(Boolean);
}

function getProcessesMac() {
    return execSync('ps -A -o comm=', { encoding: 'utf8' })
        .split('\n')
        .map(line => line.trim().split('/').pop())
        .filter(Boolean);
}

function getProcessesLinux() {
    return execSync('ps -A -o comm=', { encoding: 'utf8' })
        .split('\n')
        .map(line => line.trim().split('/').pop())
        .filter(Boolean);
}