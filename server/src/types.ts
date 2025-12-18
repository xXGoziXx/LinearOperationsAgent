// ============================================================================
// Linear API Input Types
// ============================================================================

export interface IssueCreateInput {
    teamId: string;
    title: string;
    description?: string;
    priority?: number;
    projectId?: string;
    projectMilestoneId?: string;
    cycleId?: string;
    labelIds?: string[];
    assigneeId?: string;
    stateId?: string;
    // Legacy support (optional, but prefer stateId)
    state?: string;
}

export interface IssueUpdateInput {
    id: string;
    title?: string;
    description?: string;
    priority?: number;
    projectId?: string;
    projectMilestoneId?: string;
    cycleId?: string;
    labelIds?: string[];
    assigneeId?: string;
    stateId?: string;
    state?: string;
}

export interface ProjectCreateInput {
    name: string;
    teamIds: string[];
    description?: string;
    state?: string;
    leadId?: string;
    color?: string;
    icon?: string;
    priority?: number;
}

export interface ProjectUpdateInput {
    id: string;
    name?: string;
    teamIds?: string[];
    description?: string;
    state?: string;
    leadId?: string;
    color?: string;
    icon?: string;
    priority?: number;
}

export interface RoadmapCreateInput {
    name: string;
}

// ============================================================================
// State Mapping
// ============================================================================

// Internal states (user-friendly naming)
export const INTERNAL_PROJECT_STATES = {
    planned: "planned",
    inProgress: "inProgress",
    paused: "paused",
    completed: "completed",
    canceled: "canceled"
} as const;

// Linear API states (required by Linear SDK)
export const LINEAR_PROJECT_STATES = {
    backlog: "backlog",
    planned: "planned",
    started: "started",
    paused: "paused",
    completed: "completed",
    canceled: "canceled"
} as const;

export type InternalProjectState = typeof INTERNAL_PROJECT_STATES[keyof typeof INTERNAL_PROJECT_STATES];
export type LinearProjectState = typeof LINEAR_PROJECT_STATES[keyof typeof LINEAR_PROJECT_STATES];

/**
 * Converts internal project state to Linear API state
 * Maps "inProgress" -> "started" for Linear compatibility
 */
export function toLinearState(internalState: string | undefined): string | undefined {
    if (!internalState) return undefined;
    if (internalState === "inProgress") return "started";
    // Validate it's a valid Linear state
    const validStates = Object.values(LINEAR_PROJECT_STATES);
    if (validStates.includes(internalState as LinearProjectState)) {
        return internalState;
    }
    // Default to planned if invalid
    console.warn(`Invalid project state: ${internalState}, defaulting to 'planned'`);
    return "planned";
}

/**
 * Converts Linear API state to internal state
 * Maps "started" -> "inProgress" for internal use
 */
export function toInternalState(linearState: string | undefined): string | undefined {
    if (!linearState) return undefined;
    if (linearState === "started") return "inProgress";
    return linearState;
}

// ============================================================================
// Metadata Types
// ============================================================================

export interface TeamMetadata {
    team: { id: string; name: string };
    projects: Array<{ id: string; name: string; state?: string }>;
    cycles: Array<{ id: string; name: string; number?: number; startsAt?: string; endsAt?: string }>;
    labels: Array<{
        id: string;
        name: string;
        color?: string;
        /** If set, this label is a child label and `parentId` points to the label group. */
        parentId?: string;
        /** Convenience field derived from `parentId` for UI/AI context. */
        parentName?: string;
        /** Whether the label is a group (i.e., can have children). */
        isGroup?: boolean;
    }>;
    states: Array<{ id: string; name: string; type?: string; position?: number }>;
    // Optional: Only populated if specifically requested or pre-fetched
    milestonesByProjectId?: Record<string, Array<{ id: string; name: string }>>;
}

// ============================================================================
// Agent Response Types (Discriminated Union)
// ============================================================================

export type AgentAction =
    | 'createIssue'
    | 'updateIssue'
    | 'deleteIssue'
    | 'createProject'
    | 'updateProject'
    | 'createRoadmap'
    | 'readProject'
    | 'readRoadmap'
    | 'error';

export interface CreateIssueResponse {
    action: 'createIssue';
    payload: IssueCreateInput;
    message?: string;
}

export interface UpdateIssueResponse {
    action: 'updateIssue';
    payload: IssueUpdateInput;
    message?: string;
}

export interface DeleteIssueResponse {
    action: 'deleteIssue';
    payload: { id: string };
    message?: string;
}

export interface CreateProjectResponse {
    action: 'createProject';
    payload: ProjectCreateInput;
    message?: string;
}

export interface UpdateProjectResponse {
    action: 'updateProject';
    payload: ProjectUpdateInput;
    message?: string;
}

export interface CreateRoadmapResponse {
    action: 'createRoadmap';
    payload: RoadmapCreateInput;
    message?: string;
}

export interface ReadProjectResponse {
    action: 'readProject';
    payload: { id: string };
    message?: string;
}

export interface ReadRoadmapResponse {
    action: 'readRoadmap';
    payload: { id: string };
    message?: string;
}

export interface ErrorResponse {
    action: 'error';
    payload: Record<string, never>;
    message: string;
}

export type AgentResponse =
    | CreateIssueResponse
    | UpdateIssueResponse
    | DeleteIssueResponse
    | CreateProjectResponse
    | UpdateProjectResponse
    | CreateRoadmapResponse
    | ReadProjectResponse
    | ReadRoadmapResponse
    | ErrorResponse;

// ============================================================================
// File Upload Response Types
// ============================================================================

export type FileUploadAction = 'createIssue' | 'updateIssue' | 'createProject' | 'updateProject';

export interface FileUploadIssueCreate {
    action: 'createIssue';
    payload: IssueCreateInput;
}

export interface FileUploadIssueUpdate {
    action: 'updateIssue';
    payload: IssueUpdateInput;
}

export interface FileUploadProjectCreate {
    action: 'createProject';
    payload: ProjectCreateInput;
}

export interface FileUploadProjectUpdate {
    action: 'updateProject';
    payload: ProjectUpdateInput;
}

export type FileUploadResponse =
    | FileUploadIssueCreate
    | FileUploadIssueUpdate
    | FileUploadProjectCreate
    | FileUploadProjectUpdate
    | null;

// ============================================================================
// Helper Types for Payloads with Name Resolution
// ============================================================================
// Helper type for agent payload BEFORE it goes to Linear
export interface IssuePayloadWithHelpers extends IssueCreateInput {
    assigneeName?: string;
    labelNames?: string[];
    projectName?: string; // Add this
    project?: string; // Add this for flexibility
    projectMilestoneName?: string;
    milestoneName?: string;
    phase?: string;
}

export interface ProjectPayloadWithHelpers extends ProjectCreateInput {
    leadName?: string;
    title?: string; // Sometimes AI returns 'title' instead of 'name'
}

// ============================================================================
// Type Guards
// ============================================================================

export function isIssueCreateInput(payload: unknown): payload is IssueCreateInput {
    const p = payload as IssueCreateInput;
    return typeof p === 'object' && p !== null &&
           typeof p.teamId === 'string' &&
           typeof p.title === 'string';
}

export function isProjectCreateInput(payload: unknown): payload is ProjectCreateInput {
    const p = payload as ProjectCreateInput;
    return typeof p === 'object' && p !== null &&
           typeof p.name === 'string' &&
           Array.isArray(p.teamIds);
}

export function isErrorWithMessage(error: unknown): error is { message: string } {
    return typeof error === 'object' &&
           error !== null &&
           'message' in error &&
           typeof (error as { message: unknown }).message === 'string';
}

// ============================================================================
// Linear API Response Types
// ============================================================================

export interface LinearIssueResponse {
    id: string;
    title: string;
    identifier: string;
    url: string;
    success: true;
}

export interface LinearProjectResponse {
    id: string;
    name: string;
    slugId: string;
    description?: string;
    state?: string;
    teamIds?: string[];
    success: true;
}

export interface LinearSuccessResponse {
    success: true;
    id?: string;
}

export type LinearResponse = LinearIssueResponse | LinearProjectResponse | LinearSuccessResponse;
