import { LinearClient } from '@linear/sdk';
import dotenv from 'dotenv';
import process from 'process';
import {
    IssueCreateInput,
    IssueUpdateInput,
    ProjectCreateInput,
    ProjectUpdateInput,
    RoadmapCreateInput,
    toLinearState,
    LinearIssueResponse,
    LinearIssueDetails,
    LinearIssueSearchResponse,
    LinearIssueSearchHit,
    LinearProjectResponse,
    LinearSuccessResponse,
    TeamMetadata
} from './types';

dotenv.config();

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey || !apiKey.startsWith('lin_api_') || apiKey === 'mock-key') {
    console.warn("WARNING: LINEAR_API_KEY is not set or invalid. Using MOCK MODE.");
}

// Initialize Linear Client
export const getLinearClient = (apiKey?: string) => {
    const key = apiKey || process.env.LINEAR_API_KEY;
    if (!key) {
        throw new Error('Linear API Key not found');
    }
    return new LinearClient({ apiKey: key });
};

// Helper to determine if we should mock
const shouldMock = (apiKey?: string) => {
    const key = apiKey || process.env.LINEAR_API_KEY;
    console.log(`[Linear] Using API Key: ${key ? (key.startsWith('lin_api_') ? 'VALID_PREFIX' : 'INVALID_PREFIX') : 'MISSING'}`);
    return !key || !key.startsWith('lin_api_') || key === 'mock-key';
};

// Mock Data
const MOCK_TEAM = { id: 'mock-team-id', name: 'Voice App - Tech' };
const MOCK_USER = { id: 'mock-user-id', name: 'Mock User', displayName: 'Mock User' };
const MOCK_PROJECT = { id: 'mock-proj-1', name: 'Mock Project', state: 'planned' };
const MOCK_ROADMAP = { id: 'mock-road-1', name: 'Mock Roadmap' };

// Caching
const metadataCache = new Map<string, { data: TeamMetadata; expires: number }>();
const milestoneCache = new Map<string, { data: Array<{ id: string; name: string }>; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 mins

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function extractIssueIdentifierFromText(value: string): string | undefined {
    const match =
        value.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i) ||
        value.match(/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)\b/i);
    if (!match) return undefined;
    return match[1].toUpperCase();
}

/**
 * Linear label groups allow ONLY ONE child label to be applied per group.
 * If multiple child labels from the same group are present, keep the first (stable order) and drop the rest.
 */
export function enforceExclusiveChildLabelIds(
    labelIds: string[] | undefined,
    labels: TeamMetadata['labels'] | undefined
): { labelIds: string[] | undefined; droppedLabelIds: string[] } {
    if (!labelIds || labelIds.length < 2 || !labels || labels.length === 0) {
        return { labelIds, droppedLabelIds: [] };
    }

    const byId = new Map(labels.map(l => [l.id, l] as const));
    const seenIds = new Set<string>();
    const usedParentIds = new Set<string>();
    const keep: string[] = [];
    const dropped: string[] = [];

    for (const id of labelIds) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const meta = byId.get(id);
        const parentId = meta?.parentId;

        if (parentId) {
            if (usedParentIds.has(parentId)) {
                dropped.push(id);
                continue;
            }
            usedParentIds.add(parentId);
        }

        keep.push(id);
    }

    return { labelIds: keep, droppedLabelIds: dropped };
}

function normalizeComparableText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N}\s-]/gu, '');
}

/**
 * Removes a leading title line from a markdown description (common when the template starts with `# <title>`).
 */
export function stripTitleFromDescription(title: string | undefined, description: string | undefined): string | undefined {
    if (!title || !description) return description;

    const lines = description.split(/\r?\n/);
    let index = 0;
    while (index < lines.length && lines[index].trim() === '') index++;
    if (index >= lines.length) return description;

    const firstLine = lines[index].trim();
    const headerMatch = firstLine.match(/^#{1,6}\s+(.+)$/);
    const rawFirstText = headerMatch ? headerMatch[1].trim() : firstLine;

    if (normalizeComparableText(rawFirstText) !== normalizeComparableText(title)) return description;

    // Drop the title line.
    lines.splice(index, 1);
    // Drop any blank lines that immediately follow.
    while (index < lines.length && lines[index].trim() === '') lines.splice(index, 1);

    return lines.join('\n').trimStart();
}

/**
 * Extracts a single-line "Phase" marker from the description (e.g. `**Phase:** P0: Something`)
 * and returns both the extracted value and the cleaned description (with that line removed).
 */
export function extractPhaseAndStripFromDescription(
    description: string | undefined
): { phase: string | undefined; description: string | undefined } {
    if (!description) return { phase: undefined, description };

    const lines = description.split(/\r?\n/);
    const phasePattern = /^\s*(?:\*\*phase:\*\*|phase:)\s*(.+?)\s*$/i;

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(phasePattern);
        if (!match) continue;

        const phase = match[1].trim();
        lines.splice(i, 1);
        while (i < lines.length && lines[i].trim() === '') lines.splice(i, 1);

        return { phase, description: lines.join('\n').trimStart() };
    }

    return { phase: undefined, description };
}

function inferPriorityFromText(description: string | undefined, phase?: string): number | undefined {
    if (typeof phase === 'string' && phase.trim().length > 0) {
        const match = phase.match(/\b(p[0-4])\b/i);
        if (!match) return undefined;
        const code = match[1].toLowerCase();
        const level = Number.parseInt(code.slice(1), 10);
        if (!Number.isFinite(level)) return undefined;

        if (level <= 0) return 1;
        if (level === 1) return 2;
        if (level === 2) return 3;
        return 4;
    }

    if (!description) return undefined;
    const match =
        description.match(/\*\*phase:\*\*\s*(p[0-4])\b/i) ||
        description.match(/^\s*phase:\s*(p[0-4])\b/im);
    if (!match) return undefined;

    const code = match[1].toLowerCase();
    const level = Number.parseInt(code.slice(1), 10);
    if (!Number.isFinite(level)) return undefined;

    // Map P0..P3 (common scheme) to Linear 1..4 (Urgent..Low).
    if (level <= 0) return 1;
    if (level === 1) return 2;
    if (level === 2) return 3;
    return 4;
}

/**
 * Normalizes user/AI priority inputs into Linear's numeric priority:
 * 0 = no priority, 1 = urgent, 2 = high, 3 = normal, 4 = low.
 */
export function normalizeIssuePriority(value: unknown, description?: string, phase?: string): number | undefined {
    const inferred = inferPriorityFromText(description, phase);

    if (value === undefined || value === null || value === '') {
        return inferred;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        const n = Math.trunc(value);
        if (n === 0 && inferred !== undefined) return inferred;
        if (n >= 0 && n <= 4) return n;
        return inferred;
    }

    const raw = String(value).trim().toLowerCase().replace(/\s+/g, '');
    const map: Record<string, number> = {
        urgent: 1,
        p0: 1,
        high: 2,
        p1: 2,
        normal: 3,
        medium: 3,
        p2: 3,
        low: 4,
        p3: 4,
        p4: 4,
        none: 0,
        nopriority: 0,
        'no-priority': 0
    };

    if (map[raw] !== undefined) return map[raw];

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
        if (parsed === 0 && inferred !== undefined) return inferred;
        if (parsed >= 0 && parsed <= 4) return parsed;
    }

    return inferred;
}

function buildMilestoneMatchCandidates(input: string): string[] {
    const raw = input.trim();
    const out: string[] = [];
    const push = (s: string | undefined) => {
        if (!s) return;
        const v = s.trim();
        if (!v) return;
        if (!out.includes(v)) out.push(v);
    };

    push(raw);

    // Split on colon (e.g. "P0: Something")
    const colonIndex = raw.indexOf(':');
    if (colonIndex !== -1) {
        push(raw.slice(0, colonIndex));
        push(raw.slice(colonIndex + 1));
    }

    // Split on common dash separators (hyphen, en-dash, em-dash)
    const dashParts = raw.split(/\s+[–—-]\s+/);
    if (dashParts.length > 1) {
        for (const part of dashParts) push(part);
    }

    // Pull out a P0/P1/... code if present
    const pMatch = raw.match(/\bP([0-4])\b/i);
    if (pMatch) push(`P${pMatch[1]}`);

    return out;
}

/**
 * Best-effort match of a milestone by name from a free-text hint (e.g. phase code/name).
 */
export function findProjectMilestoneMatch(
    milestones: Array<{ id: string; name: string }>,
    hint: string
): { id: string; name: string } | undefined {
    if (!hint || milestones.length === 0) return undefined;

    const candidates = buildMilestoneMatchCandidates(hint);
    const normalizedCandidates = candidates.map(c => normalizeComparableText(c));

    const scored: Array<{ score: number; length: number; milestone: { id: string; name: string } }> = [];

    for (const milestone of milestones) {
        const normalizedName = normalizeComparableText(milestone.name);
        for (const candidate of normalizedCandidates) {
            if (!candidate) continue;
            if (normalizedName === candidate) {
                scored.push({ score: 3, length: candidate.length, milestone });
                continue;
            }
            if (normalizedName.startsWith(candidate) || candidate.startsWith(normalizedName)) {
                scored.push({ score: 2, length: candidate.length, milestone });
                continue;
            }
            if (normalizedName.includes(candidate) || candidate.includes(normalizedName)) {
                scored.push({ score: 1, length: candidate.length, milestone });
            }
        }
    }

    scored.sort((a, b) => b.score - a.score || b.length - a.length);
    return scored[0]?.milestone;
}

// Wrapper to safely execute or return mock
async function safeExecute<T>(operation: () => Promise<T>, mockData: T, apiKey?: string): Promise<T> {
    if (shouldMock(apiKey)) {
        console.log(`[MockMode] Skipping Linear API call. Returning mock data.`);
        return mockData;
    }
    try {
        return await operation();
    } catch (error) {
        const err = error as { status?: number; message?: string };
        if (err.status === 401 || err.message?.includes('authenticated')) {
             console.warn(`[LinearAuthError] Auth failed. Falling back to mock data.`);
             return mockData;
        }
        throw error;
    }
}

// --- Metadata & Caching ---

export const getTeamMetadata = async (teamId: string, opts?: { force?: boolean, apiKey?: string }): Promise<TeamMetadata> => {
    // 1. Check Cache (skip if using custom key to avoid leakage across keys, or just accept it)
    // For simplicity, we cache by teamId. If keys differ, they might see different data?
    // Ideally cache key includes apiKey hash, but for local tool reuse is fine.
    if (!opts?.force) {
        const cached = metadataCache.get(teamId);
        if (cached && Date.now() < cached.expires) {
            console.log(`[Linear] Returning cached metadata for team ${teamId}`);
            return cached.data;
        }
    }

    // 2. Mock Data
    const mockMetadata: TeamMetadata = {
        team: { id: teamId, name: 'Mock Team' },
        projects: [{ id: 'mock-proj-1', name: 'Mock Project', state: 'planned' }],
        cycles: [{ id: 'mock-cycle-1', name: 'Cycle 1', number: 1, endsAt: new Date(Date.now() + 86400000).toISOString() }],
        labels: [
            { id: 'mock-label-bug', name: 'Bug', color: '#ff0000', isGroup: false },
            { id: 'mock-label-feat', name: 'Feature', color: '#00ff00', isGroup: false }
        ],
        states: [
            { id: 'mock-state-backlog', name: 'Backlog', type: 'backlog', position: 1 },
            { id: 'mock-state-todo', name: 'Todo', type: 'unstarted', position: 2 },
            { id: 'mock-state-in-progress', name: 'In Progress', type: 'started', position: 3 },
            { id: 'mock-state-done', name: 'Done', type: 'completed', position: 4 }
        ]
    };

    if (shouldMock(opts?.apiKey)) {
        return mockMetadata;
    }

    // 3. Real Fetch
    try {
        console.log(`[Linear] Fetching metadata for team ${teamId}...`);
        const client = getLinearClient(opts?.apiKey);
        const team = await client.team(teamId);

        // Parallel fetch for speed
        const [projectsConn, cyclesConn, labelsConn, statesConn] = await Promise.all([
            team.projects({ first: 100 }),
            team.cycles({ first: 50 }),
            team.labels({ first: 250 }),
            team.states({ first: 100 })
        ]);

        // Helpers to fetch all pages (simple version for now, assume most fit in first batch or just take first batch for speed)
        // TODO: implement robust pagination if needed. For now 100 items is likely enough for AI context.

        const labelIdToName = new Map(labelsConn.nodes.map(l => [l.id, l.name] as const));

        const metadata: TeamMetadata = {
            team: { id: team.id, name: team.name },
            projects: projectsConn.nodes.map(p => ({ id: p.id, name: p.name, state: p.state })),
            cycles: cyclesConn.nodes.map(c => ({
                id: c.id,
                name: c.name || '',
                number: c.number,
                startsAt: c.startsAt?.toISOString(),
                endsAt: c.endsAt?.toISOString()
            })),
            labels: labelsConn.nodes.map(l => ({
                id: l.id,
                name: l.name,
                color: l.color,
                parentId: l.parentId,
                parentName: l.parentId ? labelIdToName.get(l.parentId) : undefined,
                isGroup: l.isGroup
            })),
            states: statesConn.nodes.map(s => ({ id: s.id, name: s.name, type: s.type, position: s.position }))
        };

        // Update Cache
        metadataCache.set(teamId, { data: metadata, expires: Date.now() + CACHE_TTL });
        return metadata;

    } catch (e) {
        console.error("Error fetching team metadata:", e);
        // Fallback to mock if real fetch fails? Or rethrow?
        // Let's rethrow so we know it failed, or return mock if explicitly want safe fallback.
        // Given existing patterns, we might fallback if auth fails, but here we are deep in logic.
        throw e;
    }
};

export const getProjectMilestones = async (projectId: string, opts?: { force?: boolean, apiKey?: string }): Promise<Array<{ id: string; name: string }>> => {
     if (!opts?.force) {
        const cached = milestoneCache.get(projectId);
        if (cached && Date.now() < cached.expires) {
            return cached.data;
        }
    }

    const mockMilestones = [
        { id: 'mock-ms-1', name: 'Alpha Release' },
        { id: 'mock-ms-2', name: 'Beta Release' }
    ];

    if (shouldMock(opts?.apiKey)) return mockMilestones;

    try {
        const client = getLinearClient(opts?.apiKey);
        const project = await client.project(projectId);
        const msConn = await project.projectMilestones({ first: 50 });
        const milestones = msConn.nodes.map(m => ({ id: m.id, name: m.name }));

         milestoneCache.set(projectId, { data: milestones, expires: Date.now() + CACHE_TTL });
         return milestones;
    } catch (e) {
        console.error("Error fetching milestones:", e);
        return [];
    }
};

// --- Issues ---

export const createIssue = async (payload: IssueCreateInput, apiKey?: string): Promise<LinearIssueResponse> => {
    // Sanitize payload to avoid sending preview/helper fields (e.g. `projectName`) to Linear.
    const {
        teamId,
        title,
        description,
        priority,
        projectId,
        projectMilestoneId,
        cycleId,
        labelIds,
        assigneeId,
        stateId,
        state
    } = payload as any;

    const milestoneHint =
        (payload as any).projectMilestoneName ||
        (payload as any).milestoneName ||
        (payload as any).phase ||
        undefined;

    const titleStrippedDescription = stripTitleFromDescription(title, description);
    const { phase, description: withoutPhaseDescription } = extractPhaseAndStripFromDescription(titleStrippedDescription);
    const normalizedPriority = normalizeIssuePriority(priority, withoutPhaseDescription, milestoneHint || phase);

    let resolvedProjectMilestoneId: string | undefined = typeof projectMilestoneId === 'string' ? projectMilestoneId : undefined;
    if (resolvedProjectMilestoneId && !projectId) {
        console.warn('[Linear] Dropping projectMilestoneId because projectId is missing.');
        resolvedProjectMilestoneId = undefined;
    }

    const milestoneHintResolved =
        typeof milestoneHint === 'string' && milestoneHint.trim().length > 0 ? milestoneHint : phase;

    if (!resolvedProjectMilestoneId && projectId && typeof milestoneHintResolved === 'string' && milestoneHintResolved.trim().length > 0) {
        try {
            const milestones = await getProjectMilestones(projectId, { apiKey });
            const match = findProjectMilestoneMatch(milestones, milestoneHintResolved);
            if (match) {
                resolvedProjectMilestoneId = match.id;
            }
        } catch (e) {
            // If milestone lookup fails, proceed without it.
        }
    }

    const finalDescription =
        resolvedProjectMilestoneId && typeof withoutPhaseDescription === 'string'
            ? withoutPhaseDescription
            : titleStrippedDescription;

    const linearPayload: IssueCreateInput = {
        teamId,
        title,
        description: finalDescription,
        priority: normalizedPriority,
        projectId,
        projectMilestoneId: resolvedProjectMilestoneId,
        cycleId,
        labelIds,
        assigneeId,
        stateId,
        state
    };

    if (linearPayload.labelIds && linearPayload.labelIds.length > 1) {
        try {
            const metadata = await getTeamMetadata(teamId, { apiKey });
            const { labelIds: nextLabelIds, droppedLabelIds } = enforceExclusiveChildLabelIds(
                linearPayload.labelIds,
                metadata.labels
            );
            if (droppedLabelIds.length > 0) {
                const byId = new Map(metadata.labels.map(l => [l.id, l.name] as const));
                console.warn(
                    `[Linear] Dropped conflicting child labels for createIssue: ${droppedLabelIds
                        .map(id => byId.get(id) || id)
                        .join(', ')}`
                );
            }
            linearPayload.labelIds = nextLabelIds;
        } catch (e) {
            // If metadata lookup fails, proceed without label group enforcement.
        }
    }

    return safeExecute(
        async () => {
            const client = getLinearClient(apiKey);
            const result = await client.createIssue(linearPayload);
            const issue = await result.issue;
            if (!issue) throw new Error("Failed to create issue");
            return {
                id: issue.id,
                title: issue.title,
                identifier: issue.identifier,
                url: issue.url,
                success: true
            };
        },
        {
            id: 'mock-issue-' + Date.now(),
            title: linearPayload.title,
            identifier: 'MOCK-1',
            url: 'http://localhost/mock',
            success: true
        },
        apiKey
    );
};

export const updateIssue = async (input: IssueUpdateInput, apiKey?: string): Promise<LinearIssueResponse> => {
    const mockResponse: LinearIssueResponse = {
        success: true,
        id: input.id,
        title: input.title || 'Mock Issue',
        identifier: 'MOCK-UPD',
        url: 'http://localhost/mock'
    };

    return safeExecute(async () => {
        const client = getLinearClient(apiKey);
        const issue = await client.issue(input.id);
        // Sanitize payload to avoid sending preview/helper fields (e.g. `projectName`) to Linear.
        const {
            title,
            description,
            priority,
            projectId,
            projectMilestoneId,
            cycleId,
            labelIds,
            assigneeId,
            stateId,
            state
        } = input as any;

        const milestoneHint =
            (input as any).projectMilestoneName ||
            (input as any).milestoneName ||
            (input as any).phase ||
            undefined;

        const currentDescription = issue.description ?? undefined;
        const nextTitle = typeof title === 'string' ? title : undefined;
        const nextDescription = typeof description === 'string' ? description : undefined;
        const wantsDescriptionUpdate = nextDescription !== undefined && nextDescription !== currentDescription;

        const titleForDescription =
            typeof nextTitle === 'string'
                ? nextTitle
                : (typeof issue.title === 'string' ? issue.title : undefined);
        const titleStrippedDescription =
            wantsDescriptionUpdate && typeof titleForDescription === 'string' && typeof nextDescription === 'string'
                ? stripTitleFromDescription(titleForDescription, nextDescription)
                : nextDescription;
        const { phase, description: withoutPhaseDescription } = wantsDescriptionUpdate
            ? extractPhaseAndStripFromDescription(titleStrippedDescription)
            : { phase: undefined, description: titleStrippedDescription };

        const normalizedPriority =
            priority !== undefined || wantsDescriptionUpdate
                ? normalizeIssuePriority(priority, withoutPhaseDescription, milestoneHint || phase)
                : undefined;

        const sameStringArray = (a: unknown, b: unknown): boolean => {
            if (!Array.isArray(a) || !Array.isArray(b)) return false;
            const aa = a.filter((v): v is string => typeof v === 'string').slice().sort();
            const bb = b.filter((v): v is string => typeof v === 'string').slice().sort();
            if (aa.length !== bb.length) return false;
            for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
            return true;
        };

        const updatePayload: Record<string, unknown> = {};
        if (typeof nextTitle === 'string' && nextTitle !== issue.title) updatePayload.title = nextTitle;
        if (wantsDescriptionUpdate) updatePayload.description = titleStrippedDescription;
        if (normalizedPriority !== undefined && normalizedPriority !== issue.priority) updatePayload.priority = normalizedPriority;
        if (typeof projectId === 'string' && projectId !== issue.projectId) updatePayload.projectId = projectId;
        if (typeof projectMilestoneId === 'string' && projectMilestoneId !== issue.projectMilestoneId) {
            updatePayload.projectMilestoneId = projectMilestoneId;
        }
        if (typeof cycleId === 'string' && cycleId !== issue.cycleId) updatePayload.cycleId = cycleId;
        if (labelIds !== undefined && !sameStringArray(labelIds, issue.labelIds)) updatePayload.labelIds = labelIds;
        if (assigneeId !== undefined && assigneeId !== issue.assigneeId) updatePayload.assigneeId = assigneeId;
        if (stateId !== undefined && stateId !== issue.stateId) updatePayload.stateId = stateId;
        if (state !== undefined) updatePayload.state = state;

        const effectiveProjectId = (typeof projectId === 'string' && projectId) || issue.projectId;
        let resolvedProjectMilestoneId: string | undefined =
            typeof projectMilestoneId === 'string' && projectMilestoneId ? projectMilestoneId : undefined;

        if (resolvedProjectMilestoneId && !effectiveProjectId) {
            console.warn('[Linear] Dropping projectMilestoneId because projectId is missing.');
            resolvedProjectMilestoneId = undefined;
            delete updatePayload.projectMilestoneId;
        }

        const milestoneHintResolved =
            typeof milestoneHint === 'string' && milestoneHint.trim().length > 0 ? milestoneHint : phase;

        if (
            !resolvedProjectMilestoneId &&
            effectiveProjectId &&
            typeof milestoneHintResolved === 'string' &&
            milestoneHintResolved.trim().length > 0
        ) {
            try {
                const milestones = await getProjectMilestones(effectiveProjectId, { apiKey });
                const match = findProjectMilestoneMatch(milestones, milestoneHintResolved);
                if (match) {
                    updatePayload.projectMilestoneId = match.id;
                    // Linear requires the issue to be in the project for milestone assignment.
                    if (!updatePayload.projectId && !issue.projectId) updatePayload.projectId = effectiveProjectId;
                }
            } catch (e) {
                // If milestone lookup fails, proceed without it.
            }
        }

        // Remove the Phase line only if a milestone is set/resolved.
        if (updatePayload.projectMilestoneId && wantsDescriptionUpdate && typeof withoutPhaseDescription === 'string') {
            updatePayload.description = withoutPhaseDescription;
        }

        if (Array.isArray(updatePayload.labelIds) && updatePayload.labelIds.length > 1) {
            try {
                const teamId = issue.teamId;
                if (teamId) {
                    const metadata = await getTeamMetadata(teamId, { apiKey });
                    const { labelIds: nextLabelIds, droppedLabelIds } = enforceExclusiveChildLabelIds(
                        updatePayload.labelIds as string[],
                        metadata.labels
                    );
                    if (droppedLabelIds.length > 0) {
                        const byId = new Map(metadata.labels.map(l => [l.id, l.name] as const));
                        console.warn(
                            `[Linear] Dropped conflicting child labels for updateIssue: ${droppedLabelIds
                                .map(id => byId.get(id) || id)
                                .join(', ')}`
                        );
                    }
                    updatePayload.labelIds = nextLabelIds;
                }
            } catch (e) {
                // If metadata lookup fails, proceed without label group enforcement.
            }
        }

        if (Object.keys(updatePayload).length === 0) {
            return {
                success: true,
                id: issue.id,
                title: issue.title,
                identifier: issue.identifier,
                url: issue.url
            };
        }

        const response = await issue.update(updatePayload);
        const updatedIssue = await response.issue;
        if (!updatedIssue) throw new Error("Failed to update issue");

        return {
            success: true,
            id: updatedIssue.id,
            title: updatedIssue.title,
            identifier: updatedIssue.identifier,
            url: updatedIssue.url
        };
    }, mockResponse, apiKey);
};

export const deleteIssue = async (id: string, apiKey?: string): Promise<LinearSuccessResponse> => {
    return safeExecute(
        async () => {
            const client = getLinearClient(apiKey);
            await client.deleteIssue(id);
            return { success: true };
        },
         { success: true },
         apiKey
    );
};

export const getIssue = async (id: string, apiKey?: string) => {
    return safeExecute(
        async () => {
            const client = getLinearClient(apiKey);
            const issue = await client.issue(id);
            return {
                success: true,
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                description: issue.description,
                url: issue.url,
                priority: issue.priority,
                priorityLabel: issue.priorityLabel,
                labelIds: issue.labelIds,
                assigneeId: issue.assigneeId,
                stateId: issue.stateId,
                cycleId: issue.cycleId,
                projectId: issue.projectId,
                projectMilestoneId: issue.projectMilestoneId,
                teamId: issue.teamId
            } satisfies LinearIssueDetails;
        },
        {
            success: true,
            id,
            identifier: 'MOCK-1',
            title: 'Mock Issue',
            description: 'Mock Description',
            url: 'http://localhost/mock',
            priority: 3,
            priorityLabel: 'Normal',
            labelIds: ['mock-label-bug'],
            assigneeId: undefined,
            stateId: 'mock-state-backlog',
            cycleId: undefined,
            projectId: undefined,
            projectMilestoneId: undefined,
            teamId: 'mock-team-id'
        } satisfies LinearIssueDetails,
        apiKey
    );
};

export const searchIssues = async (
    term: string,
    opts?: { teamId?: string; first?: number; includeArchived?: boolean; apiKey?: string }
): Promise<LinearIssueSearchResponse> => {
    const normalizedTerm = String(term ?? '').trim();
    if (!normalizedTerm) return { success: true, totalCount: 0, nodes: [] };

    return safeExecute(
        async () => {
            const client = getLinearClient(opts?.apiKey);
            const result = await client.searchIssues(normalizedTerm, {
                first: opts?.first ?? 10,
                teamId: opts?.teamId,
                includeArchived: opts?.includeArchived ?? false
            });
            const nodes: LinearIssueSearchHit[] = result.nodes.map((issue) => ({
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                url: issue.url,
                priority: issue.priority,
                priorityLabel: issue.priorityLabel,
                stateId: issue.stateId,
                teamId: issue.teamId,
                projectId: issue.projectId,
                assigneeId: issue.assigneeId
            }));
            return { success: true, totalCount: result.totalCount, nodes };
        },
        {
            success: true,
            totalCount: 1,
            nodes: [
                {
                    id: 'mock-issue-' + Date.now(),
                    identifier: 'MOCK-1',
                    title: 'Mock Issue',
                    url: 'http://localhost/mock',
                    priority: 3,
                    priorityLabel: 'Normal',
                    stateId: 'mock-state-backlog',
                    teamId: 'mock-team-id',
                    projectId: 'mock-proj-1',
                    assigneeId: 'mock-user-id'
                }
            ]
        },
        opts?.apiKey
    );
};

export const getIssueByIdOrIdentifier = async (
    issueRef: string,
    opts?: { teamId?: string; apiKey?: string }
): Promise<LinearIssueDetails> => {
    const raw = String(issueRef ?? '').trim();
    if (!raw) {
        throw new Error('Issue id is required');
    }

    // Prefer UUIDs when present.
    if (isUuid(raw)) {
        return await getIssue(raw, opts?.apiKey);
    }

    // Extract identifier from URLs or text.
    const identifier = extractIssueIdentifierFromText(raw);
    const term = identifier || raw;

    const results = await searchIssues(term, {
        teamId: opts?.teamId,
        first: 10,
        includeArchived: true,
        apiKey: opts?.apiKey
    });
    if (results.nodes.length === 0) {
        throw new Error(`No issues found for "${term}"`);
    }

    const match =
        identifier
            ? results.nodes.find((n) => n.identifier.toUpperCase() === identifier)
            : results.nodes[0];
    if (!match) {
        throw new Error(`No issues found for "${term}"`);
    }

    // Fetch full details when the best match isn't a UUID.
    // The search result doesn't contain all fields (e.g. description), so pull the full issue by id.
    return await getIssue(match.id, opts?.apiKey);
};

// --- Projects ---

export const createProject = async (payload: ProjectCreateInput, opts?: { apiKey?: string }): Promise<LinearProjectResponse> => {
    // Transform state from internal to Linear format
    // Sanitize payload to avoid sending preview/helper fields (e.g. `title`) to Linear.
    const { name, teamIds, description, state, leadId, color, icon, priority } = payload as any;
    const projectTitle =
        typeof name === 'string'
            ? name
            : (typeof (payload as any).title === 'string' ? (payload as any).title : undefined);
    const cleanedDescription =
        typeof projectTitle === 'string' && typeof description === 'string'
            ? (stripTitleFromDescription(projectTitle, description) ?? description)
            : description;
    const linearPayload: ProjectCreateInput = {
        name,
        teamIds,
        description: cleanedDescription,
        state: toLinearState(state),
        leadId,
        color,
        icon,
        priority
    };

    return safeExecute(
        async () => {
            const client = getLinearClient(opts?.apiKey);
            const result = await client.createProject(linearPayload);
            return result as unknown as LinearProjectResponse;
        },
        {
            id: 'mock-proj-' + Date.now(),
            name: payload.name || 'Mock Project',
            slugId: 'MP-' + Math.floor(Math.random() * 1000),
            description: payload.description,
            state: linearPayload.state,
            teamIds: payload.teamIds,
            success: true
        } as any,
        opts?.apiKey
    );
};

export const updateProject = async (id: string, payload: ProjectUpdateInput, opts?: { apiKey?: string }): Promise<LinearProjectResponse> => {
    // Transform state from internal to Linear format
    // Sanitize payload to avoid sending preview/helper fields to Linear.
    const { name, teamIds, description, state, leadId, color, icon, priority } = payload as any;
    const projectTitle =
        typeof name === 'string'
            ? name
            : (typeof (payload as any).title === 'string' ? (payload as any).title : undefined);
    const cleanedDescription =
        typeof projectTitle === 'string' && typeof description === 'string'
            ? (stripTitleFromDescription(projectTitle, description) ?? description)
            : description;
    const linearPayload: ProjectUpdateInput = {
        id,
        name,
        teamIds,
        description: cleanedDescription,
        state: toLinearState(state),
        leadId,
        color,
        icon,
        priority
    };

    return safeExecute(
        async () => {
            const client = getLinearClient(opts?.apiKey);
            // Linear SDK takes the ID separately; avoid passing it in the payload.
            const { id: _ignoredId, ...updatePayload } = linearPayload as any;
            const result = await client.updateProject(id, updatePayload);
            return result as unknown as LinearProjectResponse;
        },
        {
            id,
            name: payload.name || 'Mock Project Updated',
            slugId: 'MP-UPD',
            description: payload.description,
            state: linearPayload.state,
            teamIds: payload.teamIds,
            success: true
        } as any,
        opts?.apiKey
    );
};

export const getProject = async (id: string, opts?: { apiKey?: string }) => {
    return safeExecute(
        async () => {
            const client = getLinearClient(opts?.apiKey);
            const result = await client.project(id);
            return result as unknown as typeof MOCK_PROJECT;
        },
        MOCK_PROJECT as any,
        opts?.apiKey
    );
};

export const getProjects = async (opts?: { apiKey?: string }) => {
    return safeExecute(
        async () => {
            const client = getLinearClient(opts?.apiKey);
            const result = await client.projects();
            return result as any;
        },
        { nodes: [MOCK_PROJECT] } as any,
        opts?.apiKey
    );
};

// --- Roadmaps ---

export const createRoadmap = async (payload: RoadmapCreateInput, opts?: { apiKey?: string }) => {
    return safeExecute(
        async () => {
             const client = getLinearClient(opts?.apiKey);
            const result = await client.createRoadmap({ name: payload.name });
            return result as any;
        },
        MOCK_ROADMAP as any,
        opts?.apiKey
    );
};

export const getRoadmap = async (id: string, opts?: { apiKey?: string }) => {
    return safeExecute(
        async () => {
            const client = getLinearClient(opts?.apiKey);
            const result = await client.roadmap(id);
            return result as any;
        },
        MOCK_ROADMAP as any,
        opts?.apiKey
    );
};

export const getRoadmaps = async (opts?: { apiKey?: string }) => {
    return safeExecute(
        async () => {
             const client = getLinearClient(opts?.apiKey);
             const result = await client.roadmaps();
             return result as any;
        },
        { nodes: [MOCK_ROADMAP] } as any,
        opts?.apiKey
    );
};

// --- Teams & Users ---

export const getTeams = async (opts?: { apiKey?: string }) => {
    return safeExecute(
        async () => {
            const client = getLinearClient(opts?.apiKey);
            const result = await client.teams();
            return result as any;
        },
        { nodes: [MOCK_TEAM] } as any,
        opts?.apiKey
    );
};

export const getFirstTeam = async (opts?: { apiKey?: string }) => {
    const teams = await getTeams(opts);
    return teams.nodes[0] || null;
};

export const getTeamByName = async (name: string, opts?: { apiKey?: string }) => {
    const teams = await getTeams(opts);
    const match = teams.nodes.find((t: { name: string }) => t.name.toLowerCase() === name.toLowerCase());
    return match || null;
};

export const getUsers = async (apiKey?: string) => {
    return safeExecute(
        async () => {
            const client = getLinearClient(apiKey);
            const result = await client.users();
            return result as any;
        },
        { nodes: [MOCK_USER] } as any,
        apiKey
    );
};

// --- Organization (Workspace) ---

export const getOrganization = async (apiKey?: string): Promise<{ id: string; name: string; urlKey?: string }> => {
    return safeExecute(
        async () => {
            const client = getLinearClient(apiKey);
            const viewer = await client.viewer;
            const org = await viewer.organization;
            return { id: org.id, name: org.name, urlKey: org.urlKey };
        },
        { id: 'mock-org-id', name: 'Mock Workspace', urlKey: 'mock' },
        apiKey
    );
};
