import OpenAI from 'openai';
import dotenv from 'dotenv';
import * as LinearService from './linear';

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;

const openai = apiKey ? new OpenAI({ apiKey }) : null;

export interface AgentResponse {
    action: string;
    payload: any;
    message?: string;
}

const SYSTEM_PROMPT = `
You are an AI Linear Operations Agent. Convert user natural language into structured JSON describing the correct Linear API operations.
Never hallucinate project IDs or labels—if not provided, ask for them or use reasonable defaults if instructed? actually better to omit optional fields if unknown.

Supported Actions:
- createIssue: { teamId, title, description, priority, projectId, labelIds, assigneeId, state }
- updateIssue: { id, ...updates }
- deleteIssue: { id }
- createProject: { name, teamIds }
- updateProject: { id, ...updates }
- createRoadmap: { name, teamId }
- readProject: { id }
- readRoadmap: { id }
- assignMetadata: { assigneeName, labelNames } (Helper to resolve names before actions)

Return ONLY raw JSON, no markdown formatting.
Format:
{
  "action": "createIssue",
  "payload": { ... }
}
`;

export const processUserQuery = async (query: string): Promise<AgentResponse> => {
    if (!openai) {
        // Mock response if no API key
        console.warn("No OpenAI Key, returning mock response");
        return {
            action: 'createIssue',
            payload: {
                teamId: 'team_MOCK',
                title: `Mock Issue from: ${query.substring(0, 20)}...`,
                description: 'This is a mock issue generated because no OpenAI key was found.'
            },
            message: "Generated mock response (no AI key)."
        };
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: query }
            ],
            response_format: { type: "json_object" }
        });

        const content = completion.choices[0].message.content;
        if (!content) throw new Error("No content from AI");

        const parsed = JSON.parse(content);
        return parsed as AgentResponse;

    } catch (error) {
        console.error("AI Error:", error);
        return { action: 'error', payload: {}, message: "Failed to process query." };
    }
};

export const handleFileUpload = async (fileContent: string): Promise<{ action: 'createIssue' | 'updateIssue' | 'createProject' | 'updateProject', payload: any } | null> => {
    if (!openai) {
        return { action: 'createIssue', payload: { title: "Mock File Issue", description: "From file upload (no AI)" } };
    }

    const FILE_PROMPT = `
    You are an AI assistant processing a file upload for Linear.
    Your goal is to extract EXACTLY ONE action from this file: 'createIssue', 'updateIssue', or 'createProject'.

    Rules for Action Selection:
    1. 'createProject': If the file defines a broad initiative, "Project", "PRD", "Epic", or scope with multiple sub-components (e.g. "Phase 1", "Milestone", "Feature Slices").
    2. 'createIssue': If the file describes a specific, actionable task, bug, or feature request.
    3. 'updateIssue': If the file mentions an existing Issue ID (e.g. LIN-123) and changes to it.
    4. 'updateProject': If the file mentions an existing Project ID (e.g. PROJ-123) and changes to it.

    Payload Extraction:
    - Issues: title, priority, assigneeName, labelNames.
    - Projects: name, teamIds, state (planning/started/paused), leadName (if mentioned).

    CRITICAL: The 'description' field MUST follow the allowed Markdown structure relative to the action:

    [TEMPLATE FOR 'createProject']
    """
    # <Project title — Phase code + name>

    ## Overview
    <Why this project exists and the core problem it solves>

    ## Goals & Success Metrics
    - <Metric name: target>
    - <More measurable goals covering conversion, quality, reliability, etc.>

    ## Target Users & Jobs-to-be-Done
    - <Key user segments and their jobs>

    ## In Scope
    - <Features or workstreams included in this phase>

    ## Out of Scope
    - <Items explicitly deferred or owned elsewhere>

    ## Feature Slices
    1. **<Slice name>**
       - Requirements: <Functional/technical expectations>
       - Acceptance: <Observable outcome proving the slice is complete>

    ## User Flows & States
    - <Happy-path walkthrough from start to finish>
    - <Edge cases or alternate states the flow must handle>

    ## Dependencies & Sequencing
    - <External systems, teams, or prior work this project relies on>

    ## Non-Functional Requirements
    - <Performance, security, accessibility, or operational constraints>

    ## Analytics & Experimentation
    - <Events, dashboards, and experiments required to measure success>

    ## Rollout & Launch Criteria
    - <Gating steps, test phases, and launch-readiness checks>

    ## Open Questions & Risks
    - <Outstanding decisions and risk mitigations>
    """

    [TEMPLATE FOR 'createIssue']
    """
    # <Title of the initiative>

    **Phase:** <Phase name and code>
    **Epic:** <Epic identifier>
    **Goal Alignment:** <Tie back to broader goals>

    ## Problem
    <Why this work matters; current gaps or risks>

    ## Scope / Requirements
    - <Bullet list of what must be delivered>

    ## Acceptance Criteria
    - <Bullet list of observable outcomes or tests>

    ## Dependencies
    - <List of upstream/downstream work or resources>

    ## Metrics & Instrumentation
    - <How success will be measured>

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

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                { role: "system", content: "You are a data extraction assistant. Output valid JSON only." },
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
