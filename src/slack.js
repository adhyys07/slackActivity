let lastText  = null;
let lastEmoji = null;

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
    if (text === lastText && emoji === lastEmoji) return false;

    let data = await postSlackStatus(text, emoji, token);
    if (!data.ok && data.error === 'profile_status_set_failed_not_valid_emoji' && emoji) {
        console.warn(`Slack rejected status emoji ${emoji}; retrying without an emoji.`);
        data = await postSlackStatus(text, '', token);
    }

    if (!data.ok) throw new Error(`Failed to set Slack status: ${data.error}`);

    lastText = text;
    lastEmoji = emoji;
    return true;
}

export async function clearSlackStatus(token) {
    return setSlackStatus('', '', token);
}
