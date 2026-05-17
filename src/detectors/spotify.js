import { execSync } from 'child_process';

function isSpotifyRunning(processes) {
    const names = new Set(processes.map(p => p.toLowerCase()));
    return names.has('spotify') || names.has('spotify.exe');
}

function getTrackMac(){
    
}