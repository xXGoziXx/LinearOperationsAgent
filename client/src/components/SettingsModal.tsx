import React, { useState } from 'react';
import { X, Save, Key } from 'lucide-react';

interface SettingsModalProps {
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const [linearKey, setLinearKey] = useState(() => localStorage.getItem('linear_api_key') || '');
    const [openAIKey, setOpenAIKey] = useState(() => localStorage.getItem('openai_api_key') || '');
    const [saved, setSaved] = useState(false);

    const handleSave = () => {
        if (linearKey) localStorage.setItem('linear_api_key', linearKey);
        if (openAIKey) localStorage.setItem('openai_api_key', openAIKey);

        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        setTimeout(() => onClose(), 1000); // Auto close goodness
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
                <button
                    onClick={onClose}
                    title="Close"
                    className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>

                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <SettingsIcon /> API Configuration
                </h2>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm text-slate-400 mb-1">Linear API Key</label>
                        <div className="relative">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                            <input
                                type="password"
                                value={linearKey}
                                onChange={(e) => setLinearKey(e.target.value)}
                                placeholder="lin_api_..."
                                className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">Required for fetching teams and creating issues.</p>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-400 mb-1">OpenAI API Key</label>
                        <div className="relative">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                            <input
                                type="password"
                                value={openAIKey}
                                onChange={(e) => setOpenAIKey(e.target.value)}
                                placeholder="sk-..."
                                className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">Required for AI agent.</p>
                    </div>
                </div>

                <div className="mt-8">
                    <button
                        onClick={handleSave}
                        className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg font-medium transition-all ${saved
                            ? 'bg-emerald-600 text-white'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}
                    >
                        {saved ? (
                            <>Saved Successfully!</>
                        ) : (
                            <>
                                <Save size={18} /> Save Credentials
                            </>
                        )}
                    </button>
                    <p className="text-center text-[10px] text-slate-600 mt-2">
                        Keys are stored locally in your browser and sent securely to the server.
                    </p>
                </div>
            </div>
        </div>
    );
};

// Helper icon
const SettingsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
        <circle cx="12" cy="12" r="3"></circle>
    </svg>
);
