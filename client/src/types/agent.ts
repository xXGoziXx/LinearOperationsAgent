export type AgentActionType =
    | 'createIssue'
    | 'updateIssue'
    | 'deleteIssue'
    | 'createProject'
    | 'createRoadmap'
    | 'readProject'
    | 'readRoadmap'
    | 'error';

export interface AgentActionPayload {
    [key: string]: unknown;
}

export interface AgentResponse {
    action: AgentActionType;
    payload: AgentActionPayload;
    message?: string;
}

export interface BatchItem {
    file: string;
    status: 'pending' | 'success' | 'failed' | 'skipped';
    action?: AgentActionType;
    payload?: AgentActionPayload;
    data?: unknown; // The execution result
    error?: string;
    reason?: string;
}

export interface ApiResponse {
    agent?: AgentResponse; // For chat
    result?: unknown; // Single result or batch container
    results?: BatchItem[]; // For batch uploads
    status?: 'pending' | 'success' | 'failed';
}

