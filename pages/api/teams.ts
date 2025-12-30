import type { NextApiRequest, NextApiResponse } from 'next';
import * as LinearService from '../../lib/linear';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const linearKey = req.headers['x-linear-api-key'] as string | undefined;

    try {
        const teams = await LinearService.getTeams({ apiKey: linearKey });
        res.json(teams);
    } catch (error) {
        console.error("Get Teams Error:", error);
        res.status(500).json({ error: "Failed to fetch teams" });
    }
}

