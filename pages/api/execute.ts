import type { NextApiRequest, NextApiResponse } from 'next';
import * as LinearService from '../../lib/linear';
import {
    IssueCreateInput,
    IssueUpdateInput,
    ProjectCreateInput,
    ProjectUpdateInput,
    toLinearState
} from '../../lib/types';

type ActionPayload =
    | IssueCreateInput
    | IssueUpdateInput
    | ProjectCreateInput
    | ProjectUpdateInput
    | { id: string }
    | { term: string; teamId?: string; first?: number; includeArchived?: boolean }
    | { name: string }
    | { error?: string };

async function executeLinearAction(action: string, payload: ActionPayload, apiKey?: string) {
    switch (action) {
        case 'createIssue':
            return await LinearService.createIssue(payload as IssueCreateInput, apiKey);
        case 'updateIssue': {
            const p = payload as IssueUpdateInput;
            return await LinearService.updateIssue(p, apiKey);
        }
        case 'deleteIssue': {
            const p = payload as { id: string };
            return await LinearService.deleteIssue(p.id, apiKey);
        }
        case 'readIssue': {
            const p = payload as { id: string; teamId?: string };
            return await LinearService.getIssueByIdOrIdentifier(p.id, { teamId: p.teamId, apiKey });
        }
        case 'searchIssues': {
            const p = payload as { term: string; teamId?: string; first?: number; includeArchived?: boolean };
            return await LinearService.searchIssues(p.term, {
                teamId: p.teamId,
                first: p.first,
                includeArchived: p.includeArchived,
                apiKey
            });
        }
        case 'createProject': {
            const p = payload as ProjectCreateInput;
            // Transform state before calling Linear API
            const transformedPayload = {
                ...p,
                state: toLinearState(p.state)
            };
            return await LinearService.createProject(transformedPayload, { apiKey });
        }
        case 'updateProject': {
            const p = payload as ProjectUpdateInput;
            // Transform state before calling Linear API
            const transformedPayload = {
                ...p,
                state: toLinearState(p.state)
            };
            return await LinearService.updateProject(p.id, transformedPayload, { apiKey });
        }
        case 'createRoadmap': {
            const p = payload as { name: string };
            return await LinearService.createRoadmap(p, { apiKey });
        }
        case 'readProject': {
            const p = payload as { id: string };
            return await LinearService.getProject(p.id, { apiKey });
        }
        case 'readRoadmap': {
            const p = payload as { id: string };
            return await LinearService.getRoadmap(p.id, { apiKey });
        }
        case 'error': {
            const p = payload as { error?: string };
            throw new Error(p.error || "Agent returned error action");
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { action, payload, batch } = req.body;
    const linearKey = req.headers['x-linear-api-key'] as string | undefined;

    const getClientErrorStatus = (error: unknown): number => {
        const e = error as any;
        const userError =
            e?.type === 'InvalidInput' ||
            e?.type === 'GraphqlError' ||
            (Array.isArray(e?.errors) && e.errors.some((x: any) => x?.userError === true));
        if (userError) return 400;

        const status = e?.status;
        if (typeof status === 'number' && status >= 400 && status < 600) return status;
        return 500;
    };

    const getClientErrorMessage = (error: unknown): string => {
        const e = error as any;
        const msgFromLinear = e?.errors?.[0]?.message;
        if (typeof msgFromLinear === 'string' && msgFromLinear.trim().length > 0) return msgFromLinear;
        const msg = e?.message;
        if (typeof msg === 'string' && msg.trim().length > 0) return msg;
        return 'Execution failed';
    };

    // Handle Batch Execution
    if (batch && Array.isArray(batch)) {
        const results = [];
        for (const item of batch) {
            try {
                const result = await executeLinearAction(item.action, item.payload, linearKey);
                results.push({ ...item, status: 'success', data: result });
            } catch (e) {
                console.error(`Batch Execution Error (${item.action}):`, e);
                results.push({ ...item, status: 'failed', error: getClientErrorMessage(e) });
            }
        }
        return res.json({ results });
    }

    // Handle Single Execution
    if (!action || !payload) {
        return res.status(400).json({ error: "Action and payload required" });
    }

    try {
        const result = await executeLinearAction(action, payload, linearKey);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Execution Error:", error);
        res.status(getClientErrorStatus(error)).json({ error: getClientErrorMessage(error) });
    }
}

