const lastStatuses = new Map();

function getBaseUrl() {
    return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function getSlackRedirectUri() {
    return process.env.SLACK_REDIRECT_URI || `${getBaseUrl()}/auth/slack/callback`;
}

function basicAuth(id, secret) {
    return Buffer.from(`${id}:${secret}`).toString('base64');
}

export function getSlackAuthUrl() {
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', process.env.SLACK_CLIENT_ID);
    url.searchParams.set('user_scope', 'users.profile:write,users.profile:read');
    url.searchParams.set('redirect_uri', getSlackRedirectUri());
    return url.toString();
}

export async function exchangeSlackCode(code) {
    const { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET } = process.env;
    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
        throw new Error('Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET');
    }

    const res = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicAuth(SLACK_CLIENT_ID, SLACK_CLIENT_SECRET)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            code,
            redirect_uri: getSlackRedirectUri(),
        }),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(`Slack OAuth failed: ${data.error}`);
    if (!data.authed_user?.access_token) throw new Error('Slack did not return a user token');

    return {
        teamId: data.team?.id,
        userId: data.authed_user.id,
        userToken: data.authed_user.access_token,
    };
}

async function postSlackStatus(text, emoji, token) {
    const res = await fetch('https://slack.com/api/users.profile.set', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ profile: { status_text: text, status_emoji: emoji, status_expiration:0 } }),
    });

    return res.json();
}

export async function setSlackStatus(text, emoji, token) {
    const cacheKey = token || 'default';
    const last = lastStatuses.get(cacheKey);
    if (last?.text === text && last?.emoji === emoji) return false;

    let data = await postSlackStatus(text, emoji, token);
    if (!data.ok && data.error === 'profile_status_set_failed_not_valid_emoji' && emoji) {
        console.warn(`Slack rejected status emoji ${emoji}; retrying without an emoji.`);
        data = await postSlackStatus(text, '', token);
    }

    if (!data.ok) throw new Error(`Failed to set Slack status: ${data.error}`);

    lastStatuses.set(cacheKey, { text, emoji });
    return true;
}

export async function clearSlackStatus(token) {
    return setSlackStatus('', '', token);
}
