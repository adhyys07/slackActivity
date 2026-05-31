import fs from 'fs';
import os from 'os';
import path from 'path';

const OWNER = 'adhyys07';
const REPO = 'slackActivity';
const RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const CONFIG_DIR = path.join(os.homedir(), '.slack-activity');
const UPDATE_DIR = path.join(CONFIG_DIR, 'updates');

export const CURRENT_VERSION = process.env.APP_VERSION || '1.1.0';

export async function checkForUpdate() {
    const res = await fetch(RELEASE_API, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'slack-activity-agent',
        },
    });

    if (!res.ok) throw new Error(`GitHub release check failed: ${res.status}`);

    const release = await res.json();
    const latestVersion = normalizeVersion(release.tag_name || release.name);
    const currentVersion = normalizeVersion(CURRENT_VERSION);
    const asset = findAssetForPlatform(release.assets || []);
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

    return {
        updateAvailable,
        currentVersion,
        latestVersion,
        releaseUrl: release.html_url,
        releaseName: release.name,
        publishedAt: release.published_at,
        asset: asset
            ? {
                name: asset.name,
                size: asset.size,
                downloadUrl: asset.browser_download_url,
            }
            : null,
    };
}

export async function downloadUpdate(asset) {
    if (!asset?.downloadUrl) throw new Error('No update asset available for this platform');

    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const filePath = path.join(UPDATE_DIR, asset.name);

    const res = await fetch(asset.downloadUrl, {
        headers: { 'User-Agent': 'slack-activity-agent' },
    });

    if (!res.ok) throw new Error(`Update download failed: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    if (process.platform !== 'win32') {
        fs.chmodSync(filePath, 0o755);
    }

    return {
        filePath,
        size: buffer.length,
    };
}

export function getUpdateDir() {
    return UPDATE_DIR;
}

function findAssetForPlatform(assets) {
    const wanted = getAssetNameForPlatform();
    return assets.find((asset) => asset.name === wanted) || null;
}

function getAssetNameForPlatform() {
    if (process.platform === 'win32') return 'SlackActivity-windows-x64.exe';
    if (process.platform === 'linux') return 'slack-activity-agent-linux-x64';
    if (process.platform === 'darwin') {
        return process.arch === 'arm64'
            ? 'slack-activity-agent-macos-arm64'
            : 'slack-activity-agent-macos-x64';
    }
    return null;
}

function normalizeVersion(version) {
    return String(version || '0.0.0').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
    const pa = normalizeVersion(a).split('.').map(Number);
    const pb = normalizeVersion(b).split('.').map(Number);

    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const av = Number.isFinite(pa[i]) ? pa[i] : 0;
        const bv = Number.isFinite(pb[i]) ? pb[i] : 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }

    return 0;
}
