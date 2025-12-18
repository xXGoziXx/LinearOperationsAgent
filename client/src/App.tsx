import { useState } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { ActionInspector } from './components/ActionInspector';
import { FileUploader } from './components/FileUploader';
import { SettingsModal } from './components/SettingsModal';
import { getTeams, getTeamMetadata } from './services/api';
import { Zap, Settings as SettingsIcon } from 'lucide-react';
import type { ApiResponse } from './types/agent';

function App() {
  const [latestAction, setLatestAction] = useState<ApiResponse | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Global Team State
  const [teams, setTeams] = useState<Array<{ id: string, name: string }>>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  // Fetch teams on mount
  useState(() => {
    getTeams().then(res => {
      if (res && res.nodes) {
        setTeams(res.nodes);
        if (res.nodes.length > 0) {
          const pref = res.nodes.find((t: { name: string; id: string }) => t.name.includes("Voice App"));
          setSelectedTeamId(pref ? pref.id : res.nodes[0].id);
        }
      }
    }).catch(err => console.error("Failed to fetch teams", err));
  });

  // Warm metadata cache
  if (selectedTeamId) {
    // Fire and forget, cache inside service/server handles dedupe
    getTeamMetadata(selectedTeamId).catch(() => { });
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 flex flex-col gap-6 text-slate-200">
      {/* Header */}
      <header className="flex items-center justify-between px-2">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-500/20">
            <Zap className="text-white fill-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
              Linear Ops Agent
            </h1>
            <p className="text-xs text-slate-500 font-mono font-normal">AI-POWERED WORKFLOW AUTOMATION</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Global Team Selector */}
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-700">
            <span className="text-xs text-slate-400">Target Team:</span>
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="bg-transparent text-sm text-slate-200 outline-none cursor-pointer"
              disabled={teams.length === 0}
              title="Select a team"
            >
              {teams.length === 0 && <option>Loading...</option>}
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white"
            title="Settings"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>

        {/* Main Content Info Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-140px)]">

        {/* Left Column: Chat */}
        <div className="lg:col-span-2 h-full min-h-0">
          <ChatInterface onActionReceived={setLatestAction} selectedTeamId={selectedTeamId} />
        </div>

        {/* Right Column: Tools & Inspector */}
        <div className="flex flex-col gap-6 h-full">
          {/* File Upload Section */}
          <div className="flex-none">
            <FileUploader onActionReceived={setLatestAction} selectedTeamId={selectedTeamId} />
          </div>

          {/* Inspector Section */}
          <div className="flex-1 min-h-0">
            <ActionInspector data={latestAction} />
          </div>
        </div>

      </main>

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </div>
  );
}

export default App;
