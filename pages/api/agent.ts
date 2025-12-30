import type { NextApiRequest, NextApiResponse } from 'next';
import * as Agent from '../../lib/agent';
import * as LinearService from '../../lib/linear';
import {
    TeamMetadata,
} from '../../lib/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, teamId, history } = req.body;
    const linearKey = req.headers['x-linear-api-key'] as string | undefined;
    const openAIKey = req.headers['x-openai-api-key'] as string | undefined;

    let metadata: TeamMetadata | undefined;
    let effectiveTeamId: string | undefined = typeof teamId === 'string' ? teamId : undefined;
    if (teamId) {
        try {
            metadata = await LinearService.getTeamMetadata(teamId, { apiKey: linearKey });
            effectiveTeamId = metadata?.team?.id || effectiveTeamId;
        } catch (e) {
            console.warn(`Failed to fetch metadata for team ${teamId}`, e);
        }
    } else {
        // Fallback: Try to get default team to provide *some* context
        const defTeam = await LinearService.getFirstTeam({ apiKey: linearKey });
        if (defTeam) {
            try {
                metadata = await LinearService.getTeamMetadata(defTeam.id, { apiKey: linearKey });
                effectiveTeamId = metadata?.team?.id || defTeam.id;
            } catch (e) {}
        }
    }

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    try {
        // 1. Get Intent from AI
        const agentResponse = await Agent.processUserQuery(message, {
            teamId,
            metadata,
            linearKey,
            openAIKey,
            history
        });

        // Normalize preview payload (keeps UI consistent with execution-time sanitization).
        try {
            if ((agentResponse.action === 'createIssue' || agentResponse.action === 'updateIssue') && agentResponse.payload) {
                const p = agentResponse.payload as any;

                let extractedPhase: string | undefined;
                let phaseStrippedDescription: string | undefined;

                if (typeof p.title === 'string' && typeof p.description === 'string') {
                    p.description = LinearService.stripTitleFromDescription(p.title, p.description) ?? p.description;
                }

                if (typeof p.description === 'string') {
                    const { phase, description } = LinearService.extractPhaseAndStripFromDescription(p.description);
                    extractedPhase = phase;
                    if (typeof description === 'string') phaseStrippedDescription = description;
                }

                const normalizedPriority = LinearService.normalizeIssuePriority(
                    p.priority,
                    typeof p.description === 'string' ? p.description : undefined,
                    p.projectMilestoneName || p.milestoneName || p.phase || extractedPhase
                );
                if (normalizedPriority !== undefined) {
                    p.priority = normalizedPriority;
                }

                const milestoneHint =
                    p.projectMilestoneName || p.milestoneName || p.phase || extractedPhase;

                if (!p.projectMilestoneId && typeof p.projectId === 'string' && typeof milestoneHint === 'string' && milestoneHint.trim().length > 0) {
                    const milestones = await LinearService.getProjectMilestones(p.projectId, { apiKey: linearKey });
                    const match = LinearService.findProjectMilestoneMatch(milestones, milestoneHint);
                    if (match) {
                        p.projectMilestoneId = match.id;
                        p.projectMilestoneName = match.name;
                    }
                }

                // Remove the Phase line if a milestone is set/resolved.
                if (p.projectMilestoneId && typeof phaseStrippedDescription === 'string') {
                    p.description = phaseStrippedDescription;
                }
            }
            if ((agentResponse.action === 'createProject' || agentResponse.action === 'updateProject') && agentResponse.payload) {
                const p = agentResponse.payload as any;

                if (typeof p.title === 'string' && typeof p.name !== 'string') {
                    p.name = p.title;
                }

                const projectTitle =
                    typeof p.name === 'string'
                        ? p.name
                        : (typeof p.title === 'string' ? p.title : undefined);

                if (typeof projectTitle === 'string' && typeof p.description === 'string') {
                    p.description = LinearService.stripTitleFromDescription(projectTitle, p.description) ?? p.description;
                }

                // Best-effort defaulting: ensure teamIds for createProject if a team is selected.
                if (agentResponse.action === 'createProject') {
                    if (!Array.isArray(p.teamIds) || p.teamIds.length === 0) {
                        if (typeof teamId === 'string' && teamId.trim().length > 0) {
                            p.teamIds = [teamId];
                        }
                    }
                }
            }
        } catch {}

        // Prefill updateIssue previews with current issue data (after normalization so we don't mutate untouched fields).
        try {
            if (agentResponse.action === 'updateIssue' && agentResponse.payload) {
                const p = agentResponse.payload as any;
                const issueRef = typeof p.id === 'string' ? p.id.trim() : '';
                if (issueRef) {
                    const issue = await LinearService.getIssueByIdOrIdentifier(issueRef, {
                        teamId: effectiveTeamId,
                        apiKey: linearKey
                    });
                    const basePayload = {
                        id: issue.id,
                        teamId: issue.teamId,
                        title: issue.title,
                        description: issue.description,
                        priority: issue.priority,
                        projectId: issue.projectId,
                        projectMilestoneId: issue.projectMilestoneId,
                        cycleId: issue.cycleId,
                        labelIds: issue.labelIds,
                        assigneeId: issue.assigneeId,
                        stateId: issue.stateId
                    };
                    agentResponse.payload = { ...basePayload, ...p, id: issue.id } as any;
                }
            }
        } catch (e) {
            console.warn('[Agent] Failed to prefill updateIssue payload', e);
        }

        const MUTATION_ACTIONS = new Set([
            'createIssue',
            'updateIssue',
            'deleteIssue',
            'createProject',
            'updateProject',
            'createRoadmap'
        ]);
        const READ_ACTIONS = new Set(['readIssue', 'searchIssues', 'readProject', 'readRoadmap']);

        const isPlanAction = MUTATION_ACTIONS.has(agentResponse.action);
        const isReadAction = READ_ACTIONS.has(agentResponse.action);

        if (isReadAction) {
            try {
                let result: any;
                if (agentResponse.action === 'readIssue') {
                    const p = agentResponse.payload as any;
                    const issueRef = typeof p?.id === 'string' ? p.id : '';
                    result = await LinearService.getIssueByIdOrIdentifier(issueRef, {
                        teamId: effectiveTeamId,
                        apiKey: linearKey
                    });

                    const stateName =
                        metadata?.states?.find((s) => s.id === result.stateId)?.name || result.stateId || '—';
                    const projectName =
                        metadata?.projects?.find((pr) => pr.id === result.projectId)?.name ||
                        result.projectId ||
                        '—';
                    const labelNames = (Array.isArray(result.labelIds) ? result.labelIds : [])
                        .map((id: string) => metadata?.labels?.find((l) => l.id === id)?.name || id)
                        .join(', ');

                    const messageLines = [
                        `${result.identifier} — ${result.title}`,
                        `Status: ${stateName}`,
                        `Priority: ${result.priorityLabel ?? result.priority ?? '—'}`,
                        `Project: ${projectName}`,
                        `Labels: ${labelNames || '—'}`,
                        `URL: ${result.url}`,
                        result.description ? `\nDescription:\n${result.description}` : ''
                    ].filter((line) => line !== '');

                    return res.json({
                        agent: { action: 'message', payload: {}, message: messageLines.join('\n') },
                        result,
                        status: 'success'
                    });
                }

                if (agentResponse.action === 'searchIssues') {
                    const p = agentResponse.payload as any;
                    const term = typeof p?.term === 'string' ? p.term : '';
                    const search = await LinearService.searchIssues(term, {
                        teamId: typeof p?.teamId === 'string' ? p.teamId : effectiveTeamId,
                        first: typeof p?.first === 'number' ? p.first : 10,
                        includeArchived: typeof p?.includeArchived === 'boolean' ? p.includeArchived : false,
                        apiKey: linearKey
                    });
                    result = search;

                    const lines = search.nodes.slice(0, 10).map((hit, idx) => {
                        const stateName =
                            metadata?.states?.find((s) => s.id === hit.stateId)?.name || hit.stateId || '—';
                        return `${idx + 1}. ${hit.identifier} — ${hit.title} (${stateName}) ${hit.url}`;
                    });
                    const header = `Found ${search.totalCount} issue(s) for "${term}":`;
                    const body = lines.length > 0 ? lines.join('\n') : '(no matches)';

                    return res.json({
                        agent: { action: 'message', payload: {}, message: `${header}\n${body}` },
                        result,
                        status: 'success'
                    });
                }

                if (agentResponse.action === 'readProject') {
                    const p = agentResponse.payload as any;
                    const id = typeof p?.id === 'string' ? p.id : '';
                    result = await LinearService.getProject(id, { apiKey: linearKey });
                    return res.json({
                        agent: {
                            action: 'message',
                            payload: {},
                            message: `Project ${result?.id || id}: ${result?.name || '—'}`
                        },
                        result,
                        status: 'success'
                    });
                }

                if (agentResponse.action === 'readRoadmap') {
                    const p = agentResponse.payload as any;
                    const id = typeof p?.id === 'string' ? p.id : '';
                    result = await LinearService.getRoadmap(id, { apiKey: linearKey });
                    return res.json({
                        agent: {
                            action: 'message',
                            payload: {},
                            message: `Roadmap ${result?.id || id}: ${result?.name || '—'}`
                        },
                        result,
                        status: 'success'
                    });
                }
            } catch (e: any) {
                return res.json({
                    agent: { action: 'message', payload: {}, message: e?.message || 'Read failed.' },
                    result: { error: e?.message || 'Read failed.' },
                    status: 'failed'
                });
            }
        }

        if (isPlanAction) {
            console.log("Agent Plan:", agentResponse);
        }

        // ALWAYS return the plan, do not execute yet
        res.json({
            agent: agentResponse,
            result: null, // No result yet
            status: agentResponse.action === 'error' ? 'failed' : (isPlanAction ? 'pending' : 'success')
        });

    } catch (error: any) {
        console.error("Route Error:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
}

