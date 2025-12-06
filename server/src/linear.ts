import { LinearClient } from '@linear/sdk';
import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey || !apiKey.startsWith('lin_api_') || apiKey === 'mock-key') {
    console.warn("WARNING: LINEAR_API_KEY is not set or invalid. Using MOCK MODE.");
}

// Initialize client (might throw if apiKey is empty string? No, just auth fails later path)
export const linearClient = new LinearClient({
    apiKey: apiKey || 'mock-key'
});

// Helper to determine if we should mock
const shouldMock = () => {
    const key = process.env.LINEAR_API_KEY;
    console.log(`[Linear] Using API Key: ${key}`);
    return !key || !key.startsWith('lin_api_') || key === 'mock-key';
};

// Mock Data
const MOCK_TEAM = { id: 'mock-team-id', name: 'Voice App - Tech' };
const MOCK_USER = { id: 'mock-user-id', name: 'Mock User', displayName: 'Mock User' };
const MOCK_PROJECT = { id: 'mock-proj-1', name: 'Mock Project' };
const MOCK_ROADMAP = { id: 'mock-road-1', name: 'Mock Roadmap' };

// Wrapper to safely execute or return mock
async function safeExecute<T>(operation: () => Promise<T>, mockData: T): Promise<T> {
    if (shouldMock()) {
        console.log(`[MockMode] Skipping Linear API call. Returning mock data.`);
        return mockData;
    }
    try {
        return await operation();
    } catch (error: any) {
        if (error.status === 401 || error.message?.includes('authenticated')) {
             console.warn(`[LinearAuthError] Auth failed. Falling back to mock data.`);
             return mockData;
        }
        throw error;
    }
}

// --- Issues ---

export const createIssue = async (payload: any) => {
    return safeExecute(
        () => linearClient.createIssue(payload),
        {
            id: 'mock-issue-' + Date.now(),
            title: payload.title,
            identifier: 'MOCK-1',
            url: 'http://localhost/mock',
            success: true
        } as any
    );
};

export const updateIssue = async (id: string, payload: any) => {
    return safeExecute(
         () => linearClient.updateIssue(id, payload),
         { id, ...payload, success: true } as any
    );
};

export const deleteIssue = async (id: string) => {
    return safeExecute(
        () => linearClient.deleteIssue(id),
         { success: true } as any
    );
};

export const getIssue = async (id: string) => {
    return safeExecute(
        () => linearClient.issue(id),
        { id, title: 'Mock Issue', description: 'Mock Description' } as any
    );
};

// --- Projects ---

export const createProject = async (payload: any) => {
     return safeExecute(
        () => linearClient.createProject(payload),
        {
            id: 'mock-proj-' + Date.now(),
            name: payload.name || 'Mock Project',
            slugId: 'MP-' + Math.floor(Math.random() * 1000),
            description: payload.description,
            state: payload.state || 'planning',
            teamIds: payload.teamIds,
            success: true
        } as any
    );
};

export const updateProject = async (id: string, payload: any) => {
    return safeExecute(
        () => linearClient.updateProject(id, payload),
        {
            id,
            name: payload.name || 'Mock Project Updated',
            description: payload.description,
            state: payload.state,
            teamIds: payload.teamIds,
            success: true
        } as any
    );
};

export const getProject = async (id: string) => {

    return safeExecute(
        () => linearClient.project(id),
        MOCK_PROJECT as any
    );
};

export const getProjects = async () => {
    return safeExecute(
        () => linearClient.projects(),
        { nodes: [MOCK_PROJECT] } as any
    );
};

// --- Roadmaps ---

export const createRoadmap = async (payload: any) => {
    return safeExecute(
        () => linearClient.createRoadmap({ name: payload.name }),
        MOCK_ROADMAP as any
    );
};

export const getRoadmap = async (id: string) => {
    return safeExecute(
        () => linearClient.roadmap(id),
        MOCK_ROADMAP as any
    );
};

export const getRoadmaps = async () => {
    return safeExecute(
         () => linearClient.roadmaps(),
         { nodes: [MOCK_ROADMAP] } as any
    );
};

// --- Teams & Users ---

export const getTeams = async () => {
    return safeExecute(
        () => linearClient.teams(),
        { nodes: [MOCK_TEAM] } as any
    );
};

export const getFirstTeam = async () => {
    const teams = await getTeams();
    return teams.nodes[0] || null;
};

export const getTeamByName = async (name: string) => {
    const teams = await getTeams();
    const match = teams.nodes.find((t: any) => t.name.toLowerCase() === name.toLowerCase());
    return match || null;
};

export const getUsers = async () => {
    return safeExecute(
        () => linearClient.users(),
        { nodes: [MOCK_USER] } as any
    );
};
