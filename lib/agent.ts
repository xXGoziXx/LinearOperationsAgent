import OpenAI from 'openai';
import * as LinearService from './linear';
import {
    AgentResponse,
    FileUploadResponse,
    IssueCreateInput,
    LINEAR_PROJECT_STATES,
    TeamMetadata
} from './types';

const SYSTEM_PROMPT = `
You are an AI Linear Operations Agent. Convert user natural language into structured JSON describing the correct Linear API operations.

CONTEXT:
You may be provided with "ALLOWED_OPTIONS" containing the specific IDs for Projects, Cycles, Labels, and States available in the current team.

RULES:
0. RESPONSE SHAPE (CRITICAL): Always return a JSON object with keys "action" and "payload".
   - If the user is chatting (not requesting a Linear operation) OR you need clarification, return: { "action": "message", "payload": {}, "message": "<your reply>" }.
   - Use { "action": "error", "payload": {}, "message": "<reason>" } only for real failures (invalid/unsupported request, malformed output, etc.).
   - Do NOT return a message-only object.

1. ID ENFORCEMENT: For any field where you have ALLOWED_OPTIONS (projectId, cycleId, labelIds, stateId), you MUST use a valid ID from that list.
   - Do NOT use names for these fields.
   - Do NOT invent IDs.
   - If the user asks for "Bug" label, look up the ID for "Bug" in ALLOWED_OPTIONS.labels.
   - If you cannot find a matching ID, omit the field or ask for clarification (only if critical).

2. PROJECT STATES: Use "started" for In Progress. Valid: backlog, planned, started, paused, completed, canceled.

3. LABEL GROUPS (IMPORTANT): Some labels are child labels under a label group (they will share the same \`parentId\` / \`parentName\` in ALLOWED_OPTIONS.labels).
   - You MUST NOT apply more than one child label from the same group to an issue.
   - If multiple child labels from the same group seem relevant, pick the single best match and omit the others.

4. PRIORITY (IMPORTANT): Linear priority is numeric:
   - 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.
   - If you see P0/P1/P2/P3 used as priority codes, map them to 1/2/3/4 respectively (P0 is highest).

5. DESCRIPTION (IMPORTANT):
   - Do NOT repeat the title inside the description (no leading "# <title>" header).
   - Do NOT include a "**Phase:**" line in the description; use a milestone field instead.

6. RELATIONSHIPS:
    - If setting 'projectMilestoneId', you MUST also set 'projectId'.
    - 'labelIds' must be an array of strings.
    - For issue references, you may use either the UUID id or the human identifier (e.g. "ENG-123") in fields named 'id'.

7. READING DATA (IMPORTANT):
   - If the user asks a question about an existing Linear issue (status, summary, "what is X about"), use action 'readIssue' with { id }.
   - If the user asks to find/search/list issues, use action 'searchIssues' with { term, teamId?, first? }.

Supported Actions:
- createIssue: { teamId, title, description, priority, projectId, projectMilestoneId, labelIds, assigneeId, stateId, cycleId }
- updateIssue: { id, ...updates }
- deleteIssue: { id }
- readIssue: { id }  // id may be UUID or identifier like ENG-123
- searchIssues: { term, teamId?, first? } // use term like "login" or "ENG-123"
- createProject: { name, teamIds, state, leadId }
- updateProject: { id, ...updates }
- message: { } (no-op chat response)

Return ONLY raw JSON.
`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

const VALID_AGENT_ACTIONS = new Set([
    'createIssue',
    'updateIssue',
    'deleteIssue',
    'createProject',
    'updateProject',
    'createRoadmap',
    'readIssue',
    'searchIssues',
    'readProject',
    'readRoadmap',
    'message',
    'error'
]);

function coerceAgentResponse(value: unknown): AgentResponse {
    if (!isPlainObject(value)) {
        return { action: 'error', payload: {}, message: 'Invalid AI response (not an object).' };
    }

    const action = value.action;
    const message =
        typeof value.message === 'string' && value.message.trim().length > 0 ? value.message : undefined;

    if (typeof action !== 'string' || !VALID_AGENT_ACTIONS.has(action)) {
        return {
            action: 'error',
            payload: {},
            message: message || 'AI did not return a valid action.'
        };
    }

    const payload =
        'payload' in value && isPlainObject(value.payload) ? (value.payload as Record<string, unknown>) : undefined;

    if (action === 'error') {
        // "error" from the model usually means "no operation" or "need clarification" — treat as a chat message.
        return { action: 'message', payload: {}, message: message || 'No actionable operation detected.' };
    }

    if (action === 'message') {
        return { action: 'message', payload: {}, message: message || 'How can I help?' };
    }

    if (!payload) {
        return {
            action: 'error',
            payload: {},
            message: message || 'AI did not return a valid payload.'
        };
    }

    return {
        action: action as AgentResponse['action'],
        payload: payload as AgentResponse['payload'],
        ...(message ? { message } : {})
    } as AgentResponse;
}

export const processUserQuery = async (
    query: string,
    context?: {
        teamId?: string;
        metadata?: TeamMetadata;
        linearKey?: string;
        openAIKey?: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    }
): Promise<AgentResponse> => {

    const openAiApiKey = context?.openAIKey || process.env.OPENAI_API_KEY;
    if (!openAiApiKey) throw new Error("OpenAI API Key not provided");

    const openai = new OpenAI({ apiKey: openAiApiKey });

    try {
        const metadataStr = context?.metadata ? JSON.stringify(context.metadata, null, 2) : "No metadata available.";

        const history = Array.isArray(context?.history) ? context.history : [];
        const safeHistory = history
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content }));

        const completion = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT}\n\nALLOWED_OPTIONS = ${metadataStr}` },
                ...safeHistory,
                { role: "user", content: query }
            ],
            response_format: { type: "json_object" }
        });

        const content = completion.choices[0].message.content;
        if (!content) throw new Error("No content from AI");

        const parsed = JSON.parse(content);
        return coerceAgentResponse(parsed);

    } catch (error) {
        console.error("AI Error:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to process query.";
        return { action: 'error', payload: {}, message: errorMessage };
    }
};

export const handleFileUpload = async (fileContent: string, context: { teamId?: string; metadata?: TeamMetadata, linearKey?: string, openAIKey?: string }): Promise<AgentResponse | null> => {
    const openAiApiKey = context?.openAIKey || process.env.OPENAI_API_KEY;
    const openai = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;

    if (!openai) {
        const mockPayload: IssueCreateInput = {
            teamId: 'team_MOCK',
            title: "Mock File Issue",
            description: "From file upload (no AI)"
        };
        return { action: 'createIssue', payload: mockPayload };
    }

    const FILE_PROMPT = `
    You are an AI assistant processing a file upload for Linear.
    Your goal is to extract EXACTLY ONE action from this file: 'createIssue', 'updateIssue', 'createProject', or 'updateProject'.

    Action selection (VERY IMPORTANT):
    - Default to 'createIssue' when uncertain.
    - Do NOT choose 'createProject' just because the file contains words like "project", "PRD", "epic", or "phase".
    - Only choose 'createProject' when the file clearly describes a multi-issue initiative (a container) with multiple workstreams/slices/milestones.

    Strong signals for 'createProject' (need multiple signals, not just one):
    - There are multiple independent slices/workstreams/features (2+ distinct deliverables).
    - The doc has project-governance sections like: "Goals & Success Metrics", "In Scope", "Out of Scope", "Feature Slices", "Rollout", "Launch Criteria", "Risks", "Dependencies & Sequencing".
    - The doc includes phases/milestones/roadmap/timeline planning that implies multiple issues.

    Strong signals for 'createIssue':
    - The doc describes ONE primary deliverable (a bug fix, a feature, a task).
    - It has issue-structured sections like: "Acceptance Criteria", "Steps to Reproduce", "Expected vs Actual", "Implementation", "QA Notes".
    - It reads like a single ticket, even if it's a long spec.

    Existing entity updates (only if explicitly referenced):
    - Use 'updateIssue' ONLY if the file clearly references an existing issue identifier and the intent is to modify it.
    - Use 'updateProject' ONLY if the file clearly references an existing project and the intent is to modify it.

    Payload extraction:
    - Issues: title, description, priority, assigneeName, labelNames, projectName, projectMilestoneName (preferred when phase/milestone is mentioned).
    - Projects: name, description, teamIds, state (MUST be one of: backlog/planned/started/paused/completed/canceled), leadName (if mentioned).
    - IMPORTANT: If you include multiple labels, do not include more than one child label from the same label group (e.g. only one of "Back-End" vs "Front-End – Mobile" if they are in the same group).
    - IMPORTANT: Do not include the title/name as a markdown header in the description (no leading "# <title>").
    - IMPORTANT: Linear priority is numeric (0 none, 1 urgent, 2 high, 3 normal, 4 low). If you infer P0/P1/P2/P3 as priority codes, map them to 1/2/3/4.
    - IMPORTANT: If the file mentions a Phase/Milestone, set it as projectMilestoneName (string) in the payload, not inside the description.

    CRITICAL: For project state, use "started" NOT "inProgress". Valid states are: backlog, planned, started, paused, completed, canceled.

    Description templates (guidance; preserve original content when possible):

    [TEMPLATE FOR 'createProject' description]
    """
    ## Overview
    <Why this project exists and the core problem it solves>

    ## Goals & Success Metrics
    - <Metric name: target>

    ## In Scope
    - <Features or workstreams included in this phase>

    ## Out of Scope
    - <Items explicitly deferred or owned elsewhere>

    ## Feature Slices
    1. **<Slice name>**
       - Requirements: <Functional/technical expectations>
       - Acceptance: <Observable outcome proving the slice is complete>

    ## Dependencies & Sequencing
    - <External systems, teams, or prior work this project relies on>

    ## Rollout & Launch Criteria
    - <Gating steps, test phases, and launch-readiness checks>
    """

    [TEMPLATE FOR 'createIssue' description]
    """
    ## Problem
    <Why this work matters; current gaps or risks>

    ## Scope / Requirements
    - <Bullet list of what must be delivered>

    ## Acceptance Criteria
    - <Bullet list of observable outcomes or tests>

    ## Notes
    - <Links, references, extra context>
    """

    Return a single JSON object:
    {
      "action": "createIssue" | "updateIssue" | "createProject" | "updateProject",
      "payload": { ... }
    }

    File Content:
    ${fileContent}
    `;

    const metadataStr = context?.metadata ? JSON.stringify(context.metadata, null, 2) : "No metadata available.";

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
                { role: "system", content: `You are a data extraction assistant. Output valid JSON only.\n\nCONTEXT: If helpful, here are valid IDs for the team:\nALLOWED_OPTIONS = ${metadataStr}` },
                { role: "user", content: FILE_PROMPT }
            ],
             response_format: { type: "json_object" }
        });

        const content = completion.choices[0].message.content;
        if (!content) return null;
        const parsed = JSON.parse(content);

        // Validate basic structure
        if (parsed.action && parsed.payload) {
            return parsed;
        }
        return null;

    } catch (error) {
         console.error("File Parse Error:", error);
         return null;
    }
};

// This block is added based on the user's instruction to pass `context.linearKey` to LinearService calls.
// It is assumed this logic would reside in a function that processes the AI's output (AgentResponse or FileUploadResponse)
// and then interacts with the Linear API.
// The original document did not contain this processing logic, so it's added as a new, separate function.
export const executeLinearActions = async (actions: { action: string; data: any }[], context?: { teamId?: string; linearKey?: string }) => {
    const results = [];
    for (const action of actions) {
        if (action.action === 'createIssue') {
            // Enforce teamId from context if missing
            if (context?.teamId && !action.data.teamId) {
                action.data.teamId = context.teamId;
            }
            const res = await LinearService.createIssue(action.data, context?.linearKey);
            results.push({ ...res, action: 'createIssue' });
        } else if (action.action === 'updateIssue') {
            const res = await LinearService.updateIssue(action.data, context?.linearKey);
            results.push({ ...res, action: 'updateIssue' });
        } else if (action.action === 'createProject') {
                // Enforce teamId
                if (context?.teamId && (!action.data.teamIds || action.data.teamIds.length === 0)) {
                action.data.teamIds = [context.teamId];
            }
            const res = await LinearService.createProject(action.data, { apiKey: context?.linearKey });
            results.push({ ...res, action: 'createProject' });
        }
        // Add other actions like deleteIssue, updateProject if needed
    }
    return results;
};

