import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import * as Agent from '../../lib/agent';
import * as LinearService from '../../lib/linear';
import {
    IssuePayloadWithHelpers,
    ProjectPayloadWithHelpers
} from '../../lib/types';

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const linearKey = req.headers['x-linear-api-key'] as string | undefined;
    const openAIKey = req.headers['x-openai-api-key'] as string | undefined;

    try {
        const form = formidable({
            maxFiles: 10,
            keepExtensions: true,
        });

        const [fields, files] = await form.parse(req);
        const fileArray = Array.isArray(files.files) ? files.files : (files.files ? [files.files] : []);

        if (fileArray.length === 0) {
            return res.status(400).json({ error: "No files uploaded" });
        }

        const providedTeamId = Array.isArray(fields.teamId) ? fields.teamId[0] : fields.teamId;
        const plannedActions = [];

        const users = await LinearService.getUsers(linearKey);

        // Resolve default team
        let defaultTeam;
        if (providedTeamId) {
            defaultTeam = { id: providedTeamId };
        } else {
            const fallbackTeam = await LinearService.getFirstTeam({ apiKey: linearKey });
            defaultTeam = fallbackTeam;
        }

        for (const file of fileArray) {
            if (!file.filepath) continue;

            const fs = await import('fs/promises');
            const fileBuffer = await fs.readFile(file.filepath);
            const fileContent = fileBuffer.toString('utf-8');

            let metadata;
            const targetTeamId = providedTeamId || defaultTeam?.id;
            if (targetTeamId) {
                try {
                    metadata = await LinearService.getTeamMetadata(targetTeamId, { apiKey: linearKey });
                } catch (e) {
                    console.warn("Metadata fetch failed", e);
                }
            }

            const agentResult = await Agent.handleFileUpload(fileContent, {
                teamId: targetTeamId,
                metadata,
                linearKey,
                openAIKey
            });

            if (!agentResult) {
                plannedActions.push({
                    file: file.originalFilename || 'unknown',
                    status: 'skipped',
                    reason: 'No actionable content found'
                });
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
                    file: file.originalFilename || 'unknown',
                    status: 'pending',
                    action,
                    payload: cleanPayload,
                    originalPayload: payload // keep original specifically for debugging/UI if needed
                });

            } catch (e: any) {
                console.error(`Error planning file ${file.originalFilename}:`, e);
                plannedActions.push({
                    file: file.originalFilename || 'unknown',
                    status: 'failed',
                    error: e.message
                });
            }
        }

        res.json({ results: plannedActions }); // Return plans

    } catch (error) {
        console.error("Upload Search Error:", error);
        res.status(500).json({ error: "Batch processing failed" });
    }
}

