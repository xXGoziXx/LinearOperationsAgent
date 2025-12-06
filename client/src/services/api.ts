import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:3000/api',
});

export const sendAgentMessage = async (message: string) => {
    const response = await api.post('/agent', { message });
    return response.data;
};

export const getTeams = async () => {
    const response = await api.get('/teams');
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
export const executeAction = async (action: string, payload: any) => {
    const response = await api.post('/execute', { action, payload });
    return response.data;
};

export const executeBatch = async (batch: any[]) => {
    const response = await api.post('/execute', { batch });
    return response.data;
};
