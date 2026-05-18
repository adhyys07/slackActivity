import { syncOnce } from '../../src/worker.js';

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }

    const expectedSecret = process.env.CRON_SECRET;
    if (expectedSecret) {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${expectedSecret}`) {
            res.status(401).send('Unauthorized');
            return;
        }
    }

    try {
        await syncOnce();
        res.status(200).json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}
