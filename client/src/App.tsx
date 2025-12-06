import { useState } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { ActionInspector } from './components/ActionInspector';
import { FileUploader } from './components/FileUploader';
import { Zap } from 'lucide-react';

import type { ApiResponse } from './types/agent';

function App() {
  const [latestAction, setLatestAction] = useState<ApiResponse | null>(null);

  return (
    <div className="min-h-screen bg-slate-950 p-6 flex flex-col gap-6 text-slate-200">
      {/* Header */}
      <header className="flex items-center gap-3 px-2">
        <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-500/20">
          <Zap className="text-white fill-white" size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
            Linear Ops Agent
          </h1>
          <p className="text-xs text-slate-500 font-mono">AI-POWERED WORKFLOW AUTOMATION</p>
        </div>
      </header>

      {/* Main Content Info Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-140px)]">

        {/* Left Column: Chat */}
        <div className="lg:col-span-2 h-full">
          <ChatInterface onActionReceived={setLatestAction} />
        </div>

        {/* Right Column: Tools & Inspector */}
        <div className="flex flex-col gap-6 h-full">
          {/* File Upload Section */}
          <div className="flex-none">
            <FileUploader onActionReceived={setLatestAction} />
          </div>

          {/* Inspector Section */}
          <div className="flex-1 min-h-0">
            <ActionInspector data={latestAction} />
          </div>
        </div>

      </main>
    </div>
  );
}

export default App;
