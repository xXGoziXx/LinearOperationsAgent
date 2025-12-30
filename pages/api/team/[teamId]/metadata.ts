import type { NextApiRequest, NextApiResponse } from 'next';
import * as LinearService from '../../../../lib/linear';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { teamId } = req.query;
        const linearKey = req.headers['x-linear-api-key'] as string | undefined;

        if (typeof teamId !== 'string') {
            return res.status(400).json({ error: 'Invalid teamId' });
        }

        const metadata = await LinearService.getTeamMetadata(teamId, { apiKey: linearKey });
        res.json(metadata);
    } catch (error) {
        console.error("Get Metadata Error:", error);
        res.status(500).json({ error: "Failed to fetch team metadata" });
    }
}

