import React, { useState, useEffect } from 'react';
import { Terminal, CheckCircle, XCircle, Activity, Play, Ban, CheckCheck, XSquare, Loader2, ChevronRight } from 'lucide-react';
import { executeAction, executeBatch, type ExecutableBatchItem } from '../services/api';
import type { AgentActionPayload, ApiResponse, BatchItem } from '../types/agent';
import { IssueModal } from './IssueModal';

interface ActionInspectorProps {
    data: ApiResponse | null;
}

export const ActionInspector: React.FC<ActionInspectorProps> = ({ data }) => {
    const [localData, setLocalData] = useState<ApiResponse | null>(null);
    const [executing, setExecuting] = useState(false);
    const [selectedItem, setSelectedItem] = useState<BatchItem | { action: string; payload: AgentActionPayload; status: string } | null>(null);

    useEffect(() => {
        setLocalData(data);
    }, [data]);

    if (!localData) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 bg-slate-800 rounded-xl border border-slate-700 p-8">
                <Activity className="w-12 h-12 mb-4 opacity-20" />
                <p>No actions processed yet.</p>
                <p className="text-sm opacity-60">Agent operations will appear here.</p>
            </div>
        );
    }

    const { agent, result, results, status: rootStatus } = localData;

    // --- BATCH LOGIC ---
    if (results && results.length > 0) {
        const pendingCount = results.filter(r => r.status === 'pending').length;

        const handleAcceptAll = async () => {
            if (!localData.results) return;
            setExecuting(true);
            try {
                // Filter only pending items for execution
                const pendingItems = localData.results.filter(r => r.status === 'pending');
                if (pendingItems.length === 0) return;

                const executablePendingItems: ExecutableBatchItem[] = pendingItems
                    .filter((batchItem): batchItem is BatchItem & { action: string; payload: AgentActionPayload } => {
                        return typeof batchItem.action === 'string' && !!batchItem.payload;
                    })
                    .map(batchItem => ({ action: batchItem.action, payload: batchItem.payload }));

                const res = await executeBatch(executablePendingItems);

                // Update local state with results
                const updatedResults = localData.results.map(item => {
                    const resultItem = res.results.find((r: BatchItem) => r.file === item.file && r.action === item.action);
                    return resultItem ? { ...item, ...resultItem } : item;
                });

                setLocalData({ ...localData, results: updatedResults });
            } catch (error) {
                console.error("Batch Execution Failed", error);
            } finally {
                setExecuting(false);
            }
        };

        const handleDeclineAll = () => {
            if (!localData.results) return;
            const updatedResults = localData.results.map(item =>
                item.status === 'pending' ? { ...item, status: 'skipped' as const, reason: 'Declined by user' } : item
            );
            setLocalData({ ...localData, results: updatedResults });
        };

        const handleSingleAction = async (index: number, type: 'accept' | 'decline', payloadOverride?: AgentActionPayload) => {
            if (!localData.results) return;
            const item = localData.results[index];

            if (type === 'decline') {
                const newResults = [...localData.results];
                newResults[index] = { ...item, status: 'skipped', reason: 'Declined by user' };
                setLocalData({ ...localData, results: newResults });
                return;
            }

            // Accept single
            setExecuting(true);
            try {
                if (!item.action || !item.payload) return;
                const payloadToUse = payloadOverride ?? item.payload;
                const res = await executeAction(item.action, payloadToUse);

                const newResults = [...localData.results];
                newResults[index] = { ...item, payload: payloadToUse, status: 'success', data: res.data };
                setLocalData({ ...localData, results: newResults });

            } catch (e: unknown) {
                const newResults = [...localData.results];
                newResults[index] = { ...item, status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' };
                setLocalData({ ...localData, results: newResults });
            } finally {
                setExecuting(false);
            }
        };


        return (
            <div className="h-full flex flex-col bg-slate-900 rounded-xl overflow-hidden shadow-xl border border-slate-700">
                <div className="bg-slate-800 p-3 border-b border-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Terminal size={18} className="text-accent" />
                        <h3 className="font-semibold text-slate-200">Batch Results ({results.length})</h3>
                    </div>
                    {pendingCount > 0 && (
                        <div className="flex gap-2">
                            <button
                                onClick={handleDeclineAll}
                                disabled={executing}
                                className="p-1.5 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                                title="Decline All Pending"
                            >
                                <XSquare size={18} />
                            </button>
                            <button
                                onClick={handleAcceptAll}
                                disabled={executing}
                                className="p-1.5 hover:bg-emerald-500/20 text-emerald-400 rounded transition-colors"
                                title="Accept All Pending"
                            >
                                {executing ? <Loader2 size={18} className="animate-spin" /> : <CheckCheck size={18} />}
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex-1 overflow-auto p-4 space-y-2 font-mono text-sm">
                    {results.map((res: BatchItem, idx: number) => (
                        <div
                            key={idx}
                            className={`bg-slate-950 rounded-lg border transition-all cursor-pointer hover:bg-slate-900 ${res.status === 'pending' ? 'border-yellow-500/30 hover:border-yellow-500/50' :
                                res.status === 'success' ? 'border-emerald-500/30 hover:border-emerald-500/50' :
                                    res.status === 'failed' ? 'border-red-500/30 hover:border-red-500/50' :
                                        'border-slate-800 hover:border-slate-700'
                                }`}
                            onClick={() => setSelectedItem(res)}
                        >
                            <div className="flex items-center justify-between p-3">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <ChevronRight size={16} className="text-slate-500 flex-shrink-0" />
                                    <div className="flex flex-col min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-purple-400 font-semibold">{res.action || 'Action'}</span>
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                                                res.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                                    res.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                                                        'bg-slate-500/20 text-slate-400'
                                                }`}>
                                                {res.status.toUpperCase()}
                                            </span>
                                        </div>
                                        <span className="text-xs text-slate-500 truncate" title={res.file}>{res.file}</span>
                                    </div>
                                </div>
                                {res.status === 'pending' && (
                                    <div className="flex gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={() => handleSingleAction(idx, 'decline')}
                                            className="p-1.5 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                                            title="Decline"
                                        >
                                            <Ban size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleSingleAction(idx, 'accept')}
                                            className="p-1.5 hover:bg-emerald-500/20 text-emerald-400 rounded transition-colors"
                                            title="Accept"
                                        >
                                            <Play size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                {selectedItem && 'file' in selectedItem && (
                    <IssueModal
                        isOpen={true}
                        onClose={() => setSelectedItem(null)}
                        item={selectedItem as BatchItem}
                        onSave={(updatedPayload) => {
                            if (!localData.results) return;
                            const idx = localData.results.findIndex(r => r === selectedItem);
                            if (idx === -1) return;
                            const updatedItem = { ...localData.results[idx], payload: updatedPayload };
                            const newResults = [...localData.results];
                            newResults[idx] = updatedItem;
                            setLocalData({ ...localData, results: newResults });
                            setSelectedItem(updatedItem);
                        }}
                        onAccept={async (payloadOverride) => {
                            const idx = results.findIndex(r => r === selectedItem);
                            if (idx !== -1) {
                                await handleSingleAction(idx, 'accept', payloadOverride ?? (selectedItem as BatchItem).payload);
                                setSelectedItem(null);
                            }
                        }}
                        onDecline={() => {
                            const idx = results.findIndex(r => r === selectedItem);
                            if (idx !== -1) {
                                handleSingleAction(idx, 'decline');
                                setSelectedItem(null);
                            }
                        }}
                        executing={executing}
                    />
                )}
            </div>
        );
    }

    // --- SINGLE ACTION LOGIC ---
    // If we have an agent response but status is pending, show verification
    const isPending = rootStatus === 'pending' || (agent && !result && !localData.status); // fallback check
    const isError = agent?.action === 'error' || (result && typeof result === 'object' && 'error' in result);

    const handleSingleAccept = async (payloadOverride?: AgentActionPayload) => {
        if (!agent) return;
        setExecuting(true);
        try {
            const payloadToUse = payloadOverride ?? agent.payload;
            const res = await executeAction(agent.action, payloadToUse);
            setLocalData((prev) => {
                if (!prev || !prev.agent) return prev;
                return { ...prev, agent: { ...prev.agent, payload: payloadToUse }, result: res.data, status: 'success' };
            });
        } catch (e: unknown) {
            setLocalData((prev) => {
                if (!prev) return prev;
                return { ...prev, result: { error: e instanceof Error ? e.message : 'Unknown error' }, status: 'failed' };
            });
        } finally {
            setExecuting(false);
        }
    };

    const handleSingleDecline = () => {
        setLocalData({ ...localData, status: 'failed', result: { message: "Declined by user" } });
    };

    return (
        <div className="h-full flex flex-col bg-slate-900 rounded-xl overflow-hidden shadow-xl border border-slate-700">
            <div className="bg-slate-800 p-3 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Terminal size={18} className="text-accent" />
                    <h3 className="font-semibold text-slate-200">Action Inspector</h3>
                </div>
                {isPending && agent?.action !== 'error' && (
                    <div className="flex gap-2">
                        <span className="text-xs text-yellow-500 font-bold self-center mr-2 uppercase tracking-wider">Reviewing</span>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-2 font-mono text-sm">

                {agent && (
                    <div
                        className={`bg-slate-950 rounded-lg border transition-all cursor-pointer hover:bg-slate-900 ${isPending ? 'border-yellow-500/30 hover:border-yellow-500/50' :
                            isError ? 'border-red-500/30 hover:border-red-500/50' :
                                'border-emerald-500/30 hover:border-emerald-500/50'
                            }`}
                        onClick={() => setSelectedItem({ action: agent.action, payload: agent.payload, status: rootStatus || 'pending' })}
                    >
                        <div className="flex items-center justify-between p-3">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <ChevronRight size={16} className="text-slate-500 flex-shrink-0" />
                                <div className="flex flex-col min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-purple-400 font-semibold">{agent.action}</span>
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${rootStatus === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                                            rootStatus === 'failed' || isError ? 'bg-red-500/20 text-red-400' :
                                                'bg-yellow-500/20 text-yellow-400'
                                            }`}>
                                            {rootStatus?.toUpperCase() || 'PENDING'}
                                        </span>
                                    </div>
                                    <span className="text-xs text-slate-500 truncate">
                                        {('title' in agent.payload && typeof agent.payload.title === 'string' ? agent.payload.title : '') || ('name' in agent.payload && typeof agent.payload.name === 'string' ? agent.payload.name : '') || 'Click to view details'}
                                    </span>
                                </div>
                            </div>
                            {isPending && agent.action !== 'error' && (
                                <div className="flex gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={handleSingleDecline}
                                        className="p-1.5 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                                        title="Decline"
                                    >
                                        <Ban size={14} />
                                    </button>
                                    <button
                                        onClick={() => void handleSingleAccept()}
                                        className="p-1.5 hover:bg-emerald-500/20 text-emerald-400 rounded transition-colors"
                                        title="Accept"
                                        disabled={executing}
                                    >
                                        {executing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Post-Execution Result */}
                {result !== undefined && result !== null && (
                    <div className={`bg-slate-950 rounded-lg p-4 border ${isError ? 'border-red-900/50' : 'border-emerald-900/50'}`}>
                        <div className="flex items-center gap-2 mb-2">
                            {isError ? <XCircle size={16} className="text-red-500" /> : <CheckCircle size={16} className="text-emerald-500" />}
                            <span className={`font-bold ${isError ? 'text-red-400' : 'text-emerald-400'}`}>
                                EXECUTION RESULT
                            </span>
                        </div>
                        <pre className="text-xs text-slate-300 overflow-x-auto">
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    </div>
                )}

                {selectedItem && !('file' in selectedItem) && (
                    <IssueModal
                        isOpen={true}
                        onClose={() => setSelectedItem(null)}
                        item={selectedItem as { action: string; payload: AgentActionPayload; status: string }}
                        onSave={(updatedPayload) => {
                            setLocalData((prev) => {
                                if (!prev || !prev.agent) return prev;
                                return { ...prev, agent: { ...prev.agent, payload: updatedPayload } };
                            });
                            setSelectedItem((prev) => {
                                if (!prev || 'file' in prev) return prev;
                                return { ...prev, payload: updatedPayload };
                            });
                        }}
                        onAccept={isPending && agent?.action !== 'error' ? async (payloadOverride) => {
                            await handleSingleAccept(payloadOverride);
                            setSelectedItem(null);
                        } : undefined}
                        onDecline={isPending && agent?.action !== 'error' ? () => {
                            handleSingleDecline();
                            setSelectedItem(null);
                        } : undefined}
                        executing={executing}
                    />
                )}
            </div>
        </div>
    );
};
