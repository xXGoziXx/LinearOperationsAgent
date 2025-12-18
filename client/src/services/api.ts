import axios from 'axios';

// Type definitions for API requests
type ActionPayload = Record<string, unknown>;
export type ExecutableBatchItem = { action: string; payload: ActionPayload };

const api = axios.create({
    baseURL: 'http://localhost:3000/api',
});

// Inject headers from local storage
api.interceptors.request.use((config) => {
    const linearKey = localStorage.getItem('linear_api_key');
    const openAIKey = localStorage.getItem('openai_api_key');

    if (linearKey) {
        config.headers['x-linear-api-key'] = linearKey;
    }
    if (openAIKey) {
        config.headers['x-openai-api-key'] = openAIKey;
    }
    return config;
});

// Normalize API errors so UI can display server-provided messages.
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const message = error?.response?.data?.error;
        if (typeof message === 'string' && message.trim().length > 0) {
            return Promise.reject(new Error(message));
        }
        return Promise.reject(error);
    }
);

export const sendAgentMessage = async (
    message: string,
    teamId?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
) => {
    const response = await api.post('/agent', { message, teamId, history });
    return response.data;
};

export const getTeams = async () => {
    const response = await api.get('/teams');
    return response.data;
};

export const getTeamMetadata = async (teamId: string) => {
    const response = await api.get(`/team/${teamId}/metadata`);
    return response.data;
};

export const getProjectMilestones = async (projectId: string) => {
    const response = await api.get(`/project/${projectId}/milestones`);
    return response.data;
};

export const uploadFile = async (files: File[], teamId?: string) => {
    const formData = new FormData();
    files.forEach(file => {
        formData.append('files', file);
    });

    if (teamId) {
        formData.append('teamId', teamId);
    }

    const response = await api.post('/upload', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
    return response.data;
};
export const executeAction = async (action: string, payload: ActionPayload) => {
    const response = await api.post('/execute', { action, payload });
    return response.data;
};

export const executeBatch = async (batch: ExecutableBatchItem[]) => {
    const response = await api.post('/execute', { batch });
    return response.data;
};
