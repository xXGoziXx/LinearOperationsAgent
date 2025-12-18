import React, { useState } from 'react';
import { Upload, FileText, Check, AlertCircle } from 'lucide-react';
import { uploadFile } from '../services/api';
import type { ApiResponse } from '../types/agent';



interface FileUploaderProps {
    onActionReceived?: (data: ApiResponse) => void;
    selectedTeamId: string;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onActionReceived, selectedTeamId }) => {
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [statusMsg, setStatusMsg] = useState('');

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        setStatus('idle');

        try {
            const fileArray = Array.from(files);
            const res = await uploadFile(fileArray, selectedTeamId);
            console.log("Upload Res:", res);
            setStatus('success');
            setStatusMsg(`Planned ${res.results.length} actions.`);

            // Pass the plan to the inspector
            if (onActionReceived) {
                onActionReceived(res);
            }

        } catch (error) {
            console.error("Upload Error:", error);
            setStatus('error');
            setStatusMsg("Failed to upload/parse files.");
        } finally {
            setUploading(false);
            // Reset input
            e.target.value = '';
        }
    };

    return (
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <FileText size={16} /> Batch Import Issues and Projects
            </h3>

            <div className="relative">
                <input
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    accept=".json,.md"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={uploading}
                    aria-label='Upload JSON/MD'
                />

                <div className={`
                    border-2 border-dashed rounded-lg p-6 text-center transition-colors
                    ${uploading ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/50'}
                `}>
                    {uploading ? (
                        <div className="flex flex-col items-center">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-400 mb-2"></div>
                            <span className="text-xs text-indigo-300">Planning...</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center">
                            <Upload className="w-6 h-6 text-slate-400 mb-2" />
                            <span className="text-sm text-slate-300">Click to upload files</span>
                        </div>
                    )}
                </div>
            </div>

            {
                status !== 'idle' && (
                    <div className={`mt-3 text-xs flex items-center gap-2 ${status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {status === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                        <span>{statusMsg}</span>
                    </div>
                )
            }
        </div >
    );
};

