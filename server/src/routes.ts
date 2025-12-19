import { Router } from 'express';
import * as Agent from './agent';
import * as LinearService from './linear';
import multer from 'multer';
import {
    AgentResponse,
    IssueCreateInput,
    IssueUpdateInput,
    ProjectCreateInput,
    ProjectUpdateInput,
    TeamMetadata,
    toLinearState,
    IssuePayloadWithHelpers,
    ProjectPayloadWithHelpers
} from './types';

const router = Router();
const upload = multer(); // Memory storage

// Helper to get keys
const getKeys = (req: any) => ({
    linearKey: req.headers['x-linear-api-key'] as string | undefined,
    openAIKey: req.headers['x-openai-api-key'] as string | undefined
});

router.post('/agent', async (req, res) => {
    const { message, teamId, history } = req.body;
    const { linearKey, openAIKey } = getKeys(req);

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
});

router.post('/execute', async (req, res) => {
    const { action, payload, batch } = req.body;
    const { linearKey } = getKeys(req);

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
});

// Helper to execute single linear action
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


router.get('/teams', async (req, res) => {
    const { linearKey } = getKeys(req);
    try {
        const teams = await LinearService.getTeams({ apiKey: linearKey });
        res.json(teams);
    } catch (error) {
        console.error("Get Teams Error:", error);
        res.status(500).json({ error: "Failed to fetch teams" });
    }
});

router.get('/organization', async (req, res) => {
    const { linearKey } = getKeys(req);
    try {
        const org = await LinearService.getOrganization(linearKey);
        res.json(org);
    } catch (error: any) {
        console.error("Get Organization Error:", error);
        res.status(500).json({ error: error?.message || "Failed to fetch organization" });
    }
});

router.get('/team/:teamId/metadata', async (req, res) => {
    try {
        const { teamId } = req.params;
        const { linearKey } = getKeys(req);
        const metadata = await LinearService.getTeamMetadata(teamId, { apiKey: linearKey });
        res.json(metadata);
    } catch (error) {
        console.error("Get Metadata Error:", error);
        res.status(500).json({ error: "Failed to fetch team metadata" });
    }
});

router.get('/project/:projectId/milestones', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { linearKey } = getKeys(req);
        const milestones = await LinearService.getProjectMilestones(projectId, { apiKey: linearKey });
        res.json({ nodes: milestones });
    } catch (error) {
        console.error("Get Milestones Error:", error);
        res.status(500).json({ error: "Failed to fetch project milestones" });
    }
});

router.post('/upload', upload.array('files'), async (req, res) => {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
    }

    const { linearKey, openAIKey } = getKeys(req);
    const files = req.files as Express.Multer.File[];
    const providedTeamId = req.body.teamId;

    const plannedActions = [];

    try {
        const users = await LinearService.getUsers(linearKey);

        // Resolve default team
        let defaultTeam;
        if (providedTeamId) {
             defaultTeam = { id: providedTeamId };
        } else {
             const fallbackTeam = await LinearService.getFirstTeam({ apiKey: linearKey });
             defaultTeam = fallbackTeam;
        }

        for (const file of files) {
            const fileContent = file.buffer.toString('utf-8');

            let metadata;
            const targetTeamId = providedTeamId || defaultTeam?.id;
            if (targetTeamId) {
                try {
                    metadata = await LinearService.getTeamMetadata(targetTeamId, { apiKey: linearKey });
                } catch (e) { console.warn("Metadata fetch failed", e); }
            }

            const agentResult = await Agent.handleFileUpload(fileContent, {
                teamId: targetTeamId,
                metadata,
                linearKey,
                openAIKey
            });

            if (!agentResult) {
                plannedActions.push({ file: file.originalname, status: 'skipped', reason: 'No actionable content found' });
                continue;
            }

            const { action, payload } = agentResult;

            try {
                // Common sanitization & resolver logic (Moved from execution to planning phase)
                const cleanPayload: Record<string, unknown> = { ...payload };
	                // Remove helper fields before sending to Linear (we use them for ID lookup first)
	                delete cleanPayload.assigneeName;
	                delete cleanPayload.teamName;
	                delete cleanPayload.labelNames;
	                delete cleanPayload.leadName;
	                delete cleanPayload.projectMilestoneName;
	                delete cleanPayload.milestoneName;
	                delete cleanPayload.phase;

	                if (action === 'createIssue' || action === 'updateIssue') {
	                    // --- ISSUE LOGIC ---
	                    const issue = payload as IssuePayloadWithHelpers; // working copy for lookups

	                    // Strip redundant title from description; phase is removed only if we can resolve a milestone.
	                    let extractedPhase: string | undefined;
	                    let phaseStrippedDescription: string | undefined;
	                    if (typeof issue.title === 'string' && typeof issue.description === 'string') {
	                        const stripped = LinearService.stripTitleFromDescription(issue.title, issue.description);
	                        if (typeof stripped === 'string') {
	                            issue.description = stripped;
	                            cleanPayload.description = stripped;
	                        }
	                    }
	                    if (typeof issue.description === 'string') {
	                        const { phase, description } = LinearService.extractPhaseAndStripFromDescription(issue.description);
	                        extractedPhase = phase;
	                        if (typeof description === 'string') phaseStrippedDescription = description;
	                    }

                    // 1. Resolve Team (Only for create)
                    if (action === 'createIssue' && !issue.teamId) {
	                         if (defaultTeam) {
	                            cleanPayload.teamId = defaultTeam.id;
                         } else {
                             // If we can't resolve team, we can't plan accurately.
                             // We could leave it empty and let execution fail, or fail here.
                             // Let's add a warning but proceed.
                             console.warn("No default team found for planning.");
                         }
                    }

                    // 2. Resolve Assignee
                    if (issue.assigneeName && users && users.nodes) {
                        const assigneeName = issue.assigneeName;
                        const match = users.nodes.find((u: { name: string; displayName: string }) =>
                            u.name.toLowerCase().includes(assigneeName.toLowerCase()) ||
                            u.displayName.toLowerCase().includes(assigneeName.toLowerCase())
                        );
                        if (match) {
                            cleanPayload.assigneeId = (match as { id: string }).id;
                        }
                    }

                    // 4. Resolve Labels
                    if (issue.labelNames && issue.labelNames.length > 0 && metadata && metadata.labels) {
                        const labelIds: string[] = [];
                        const keptLabelNames: string[] = [];
                        const usedParentIds = new Set<string>();
                        for (const name of issue.labelNames) {
                             const match = metadata.labels.find((l: { name: string, id: string; parentId?: string }) => l.name.toLowerCase() === name.toLowerCase());
                             if (!match) continue;
                             if (match.parentId) {
                                 if (usedParentIds.has(match.parentId)) continue;
                                 usedParentIds.add(match.parentId);
                             }
                             labelIds.push(match.id);
                             keptLabelNames.push(match.name);
                        }
                        if (labelIds.length > 0) {
                            cleanPayload.labelIds = labelIds;
                        }
                        // Keep the preview label list consistent with what we resolved.
                        if (keptLabelNames.length > 0) {
                            issue.labelNames = keptLabelNames;
                        }
                    }

                    // Enforce label-group exclusivity even if labelIds were provided directly by the AI.
                    if (Array.isArray(cleanPayload.labelIds) && metadata?.labels) {
                        const { labelIds: nextLabelIds } = LinearService.enforceExclusiveChildLabelIds(
                            cleanPayload.labelIds as string[],
                            metadata.labels
                        );
                        cleanPayload.labelIds = nextLabelIds;
                    }

	                    // 5. Resolve Project
	                    if ((issue.projectName || issue.project) && metadata && metadata.projects) {
	                        const projName = issue.projectName || issue.project; // flexible check
	                        if (typeof projName === 'string') {
	                             const match = metadata.projects.find((p: { name: string, id: string }) => p.name.toLowerCase().includes(projName.toLowerCase()));
	                             if (match) {
	                                 cleanPayload.projectId = match.id;
	                             }
	                        }
	                    }

	                    // 6. Resolve Project Milestone (best effort via extracted phase/milestone name)
	                    const milestoneHint =
	                        issue.projectMilestoneName || issue.milestoneName || issue.phase || extractedPhase;
	                    if (!cleanPayload.projectMilestoneId && typeof cleanPayload.projectId === 'string' && typeof milestoneHint === 'string' && milestoneHint.trim().length > 0) {
	                        try {
	                            const milestones = await LinearService.getProjectMilestones(cleanPayload.projectId, { apiKey: linearKey });
	                            const match = LinearService.findProjectMilestoneMatch(milestones, milestoneHint);
	                            if (match) {
	                                cleanPayload.projectMilestoneId = match.id;
	                                issue.projectMilestoneName = match.name; // for preview/UI
	                            }
	                        } catch (e) {}
	                    }

	                    // Now that milestone resolution is done, remove the Phase line if a milestone is set.
	                    if (typeof cleanPayload.projectMilestoneId === 'string' && cleanPayload.projectMilestoneId && typeof phaseStrippedDescription === 'string') {
	                        issue.description = phaseStrippedDescription;
	                        cleanPayload.description = phaseStrippedDescription;
	                    }

	                    // 3. Resolve Priority (Linear: 0 none, 1 urgent, 2 high, 3 normal, 4 low)
	                    const normalizedPriority = LinearService.normalizeIssuePriority(
	                        issue.priority,
	                        typeof issue.description === 'string' ? issue.description : undefined,
	                        issue.projectMilestoneName || issue.milestoneName || issue.phase || extractedPhase
	                    );
	                    if (normalizedPriority !== undefined) {
	                        cleanPayload.priority = normalizedPriority;
	                        issue.priority = normalizedPriority;
	                    }

                } else if (action === 'createProject') {
                    // --- PROJECT LOGIC ---
                    const project = payload as ProjectPayloadWithHelpers;

                    if (cleanPayload.title && !cleanPayload.name) {
                        cleanPayload.name = cleanPayload.title;
                    }

                    // Strip redundant title header from project descriptions (best effort).
                    const projectTitle =
                        typeof cleanPayload.name === 'string'
                            ? cleanPayload.name
                            : (typeof cleanPayload.title === 'string' ? cleanPayload.title : undefined);
                    if (typeof projectTitle === 'string' && typeof cleanPayload.description === 'string') {
                        const stripped = LinearService.stripTitleFromDescription(projectTitle, cleanPayload.description);
                        if (typeof stripped === 'string') {
                            cleanPayload.description = stripped;
                            project.description = stripped;
                        }
                    }

                    if (!project.teamIds || project.teamIds.length === 0) {
                         if (defaultTeam) {
                             cleanPayload.teamIds = [defaultTeam.id];
                         }
                    }

                    if (project.leadName && users && users.nodes) {
                        const leadName = project.leadName;
                        const match = users.nodes.find((u: { name: string; displayName: string }) =>
                            u.name.toLowerCase().includes(leadName.toLowerCase()) ||
                            u.displayName.toLowerCase().includes(leadName.toLowerCase())
                        );
                        if (match) {
                            cleanPayload.leadId = (match as { id: string }).id;
                        }
                    }
                }

                // Return PLAN, not result
                plannedActions.push({
                    file: file.originalname,
                    status: 'pending',
                    action,
                    payload: cleanPayload,
                    originalPayload: payload // keep original specifically for debugging/UI if needed
                });

            } catch (e: any) {
                console.error(`Error planning file ${file.originalname}:`, e);
                plannedActions.push({ file: file.originalname, status: 'failed', error: e.message });
            }
        }

        res.json({ results: plannedActions }); // Return plans

    } catch (error) {
        console.error("Upload Search Error:", error);
        res.status(500).json({ error: "Batch processing failed" });
    }
});

export default router;
