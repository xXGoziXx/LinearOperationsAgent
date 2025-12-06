import { Router } from 'express';
import * as Agent from './agent';
import * as LinearService from './linear';
import multer from 'multer';

const router = Router();
const upload = multer(); // Memory storage

    router.post('/agent', async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    try {
        // 1. Get Intent from AI
        const agentResponse = await Agent.processUserQuery(message);
        console.log("Agent Plan:", agentResponse);

        // ALWAYS return the plan, do not execute yet
        res.json({
            agent: agentResponse,
            result: null, // No result yet
            status: 'pending'
        });

    } catch (error) {
        console.error("Route Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post('/execute', async (req, res) => {
    const { action, payload, batch } = req.body;

    // Handle Batch Execution
    if (batch && Array.isArray(batch)) {
        const results = [];
        for (const item of batch) {
            try {
                const result = await executeLinearAction(item.action, item.payload);
                results.push({ ...item, status: 'success', data: result });
            } catch (e: any) {
                console.error(`Batch Execution Error (${item.action}):`, e);
                results.push({ ...item, status: 'failed', error: e.message });
            }
        }
        return res.json({ results });
    }

    // Handle Single Execution
    if (!action || !payload) {
        return res.status(400).json({ error: "Action and payload required" });
    }

    try {
        const result = await executeLinearAction(action, payload);
        res.json({ status: 'success', data: result });
    } catch (error: any) {
        console.error("Execution Error:", error);
        res.status(500).json({ error: error.message || "Execution failed" });
    }
});

// Helper to execute single linear action
async function executeLinearAction(action: string, payload: any) {
    switch (action) {
        case 'createIssue':
            return await LinearService.createIssue(payload);
        case 'updateIssue':
            return await LinearService.updateIssue(payload.id, payload);
        case 'deleteIssue':
            return await LinearService.deleteIssue(payload.id);
        case 'createProject':
            return await LinearService.createProject(payload);
        case 'createRoadmap':
            return await LinearService.createRoadmap(payload);
        case 'readProject':
            return await LinearService.getProject(payload.id);
        case 'readRoadmap':
            return await LinearService.getRoadmap(payload.id);
        case 'error':
            throw new Error(payload.error || "Agent returned error action");
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}


router.get('/teams', async (req, res) => {
    try {
        const teams = await LinearService.getTeams();
        res.json(teams);
    } catch (error) {
        console.error("Get Teams Error:", error);
        res.status(500).json({ error: "Failed to fetch teams" });
    }
});

router.post('/upload', upload.array('files'), async (req, res) => {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
    }

    const files = req.files as Express.Multer.File[];
    const providedTeamId = req.body.teamId;

    const plannedActions = [];

    try {
        // Pre-fetch context once for efficiency
        const users = await LinearService.getUsers();

        let defaultTeam;

        if (providedTeamId) {
            defaultTeam = { id: providedTeamId };
        } else {
            const specificTeam = await LinearService.getTeamByName("Voice App - Tech");
            const fallbackTeam = await LinearService.getFirstTeam();
            defaultTeam = specificTeam || fallbackTeam;
        }

        for (const file of files) {
            const fileContent = file.buffer.toString('utf-8');
            const agentResult = await Agent.handleFileUpload(fileContent);

            if (!agentResult) {
                plannedActions.push({ file: file.originalname, status: 'skipped', reason: 'No actionable content found' });
                continue;
            }

            const { action, payload } = agentResult;

            try {
                // Common sanitization & resolver logic (Moved from execution to planning phase)
                const cleanPayload = { ...payload };
                // Remove helper fields before sending to Linear (we use them for ID lookup first)
                delete cleanPayload.assigneeName;
                delete cleanPayload.teamName;
                delete cleanPayload.labelNames;
                delete cleanPayload.leadName;

                if (action === 'createIssue' || action === 'updateIssue') {
                    // --- ISSUE LOGIC ---
                    const issue = payload; // working copy for lookups

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
                        const match = users.nodes.find((u: any) =>
                            u.name.toLowerCase().includes(issue.assigneeName.toLowerCase()) ||
                            u.displayName.toLowerCase().includes(issue.assigneeName.toLowerCase())
                        );
                        if (match) {
                            cleanPayload.assigneeId = match.id;
                        }
                    }

                    // 3. Resolve Priority
                    if (issue.priority) {
                        const pMap: Record<string, number> = {
                            "urgent": 1, "p1": 1,
                            "high": 2, "p2": 2,
                            "normal": 3, "p3": 3,
                            "low": 4, "p4": 4,
                            "none": 0, "nopriority": 0
                        };
                        const pKey = String(issue.priority).toLowerCase().replace(/\s/g, '');
                        if (pMap[pKey] !== undefined) {
                            cleanPayload.priority = pMap[pKey];
                        } else if (typeof issue.priority === 'string') {
                            const parsed = parseInt(issue.priority);
                            cleanPayload.priority = isNaN(parsed) ? 0 : parsed;
                        }
                    }

                } else if (action === 'createProject') {
                    // --- PROJECT LOGIC ---
                    const project = payload;

                    if (cleanPayload.title && !cleanPayload.name) {
                        cleanPayload.name = cleanPayload.title;
                    }

                    if (!project.teamIds || project.teamIds.length === 0) {
                         if (defaultTeam) {
                             cleanPayload.teamIds = [defaultTeam.id];
                         }
                    }

                    if (project.leadName && users && users.nodes) {
                        const match = users.nodes.find((u: any) =>
                            u.name.toLowerCase().includes(project.leadName.toLowerCase()) ||
                            u.displayName.toLowerCase().includes(project.leadName.toLowerCase())
                        );
                        if (match) {
                            cleanPayload.leadId = match.id;
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
