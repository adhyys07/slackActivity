function getBaseUrl() {
    return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function getSpotifyRedirectUri() {
    return process.env.SPOTIFY_REDIRECT_URI || `${getBaseUrl()}/auth/spotify/callback`;
}

function basicAuth(id, secret) {
    return Buffer.from(`${id}:${secret}`).toString('base64');
}

function tokenExpiry(expiresIn) {
    return Date.now() + ((expiresIn ?? 3600) - 60) * 1000;
}

export function getSpotifyAuthUrl(userId) {
    const url = new URL('https://accounts.spotify.com/authorize');
    url.searchParams.set('client_id', process.env.SPOTIFY_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', getSpotifyRedirectUri());
    url.searchParams.set('scope', 'user-read-currently-playing');
    url.searchParams.set('state', String(userId));
    return url.toString();
}

export async function exchangeSpotifyCode(code) {
    const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET');
    }

    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicAuth(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: getSpotifyRedirectUri(),
        }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.error || 'Spotify OAuth failed');
    if (!data.refresh_token) throw new Error('Spotify did not return a refresh token');

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: tokenExpiry(data.expires_in),
    };
}

export async function refreshSpotifyToken(refreshToken) {
    const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;

    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicAuth(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.error || 'Spotify token refresh failed');

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: tokenExpiry(data.expires_in),
    };
}

export async function getCurrentSpotifyTrack(accessToken) {
    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 204 || res.status === 202) return null;
    if (!res.ok) throw new Error(`Spotify currently-playing failed: ${res.status}`);

    const data = await res.json();
    if (!data.is_playing || data.currently_playing_type !== 'track' || !data.item) return null;

    const artists = data.item.artists?.map((artist) => artist.name).filter(Boolean).join(', ');
    return artists ? `${artists} - ${data.item.name}` : data.item.name;
}
