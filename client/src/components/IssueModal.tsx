import React, { useEffect } from 'react';
import { X, CheckCircle, Ban, Loader2, FileText, Zap, AlertCircle } from 'lucide-react';
import type { BatchItem, AgentResponse } from '../types/agent';

interface IssueModalProps {
    isOpen: boolean;
    onClose: () => void;
    item: BatchItem | { action: string; payload: any; status: string };
    onAccept?: () => void;
    onDecline?: () => void;
    executing?: boolean;
}

export const IssueModal: React.FC<IssueModalProps> = ({
    isOpen,
    onClose,
    item,
    onAccept,
    onDecline,
    executing = false
}) => {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const isPending = item.status === 'pending';
    const isSuccess = item.status === 'success';
    const isFailed = item.status === 'failed';
    const isSkipped = item.status === 'skipped';

    // Extract payload data
    const payload = item.payload || {};
    const title = (payload as any).title || (payload as any).name || 'Untitled';
    const description = (payload as any).description || '';
    const teamId = (payload as any).teamId || '';
    const priority = (payload as any).priority;
    const labels = (payload as any).labelIds || [];

    // Status styling
    const statusConfig = {
        pending: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: AlertCircle },
        success: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: CheckCircle },
        failed: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: AlertCircle },
        skipped: { color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30', icon: Ban }
    };

    const config = statusConfig[item.status as keyof typeof statusConfig] || statusConfig.pending;
    const StatusIcon = config.icon;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-3xl max-h-[90vh] bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-700 bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <Zap className="w-5 h-5 text-purple-400" />
                        <h2 className="text-xl font-semibold text-slate-100">
                            {item.action || 'Action Details'}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-200"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Status Badge */}
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${config.bg} ${config.border} border`}>
                        <StatusIcon size={16} className={config.color} />
                        <span className={`text-sm font-semibold uppercase tracking-wide ${config.color}`}>
                            {item.status}
                        </span>
                    </div>

                    {/* File Info (for batch items) */}
                    {'file' in item && item.file && (
                        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                                <FileText size={14} />
                                <span className="font-medium">Source File</span>
                            </div>
                            <div className="text-slate-200 font-mono text-sm">{item.file}</div>
                        </div>
                    )}

                    {/* Title Section */}
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Title</label>
                        <div className="text-2xl font-semibold text-slate-100">{title}</div>
                    </div>

                    {/* Description Section */}
                    {description && (
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Description</label>
                            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                                <div className="text-slate-300 whitespace-pre-wrap prose prose-invert prose-sm max-w-none">
                                    {description}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {teamId && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Team</label>
                                <div className="text-slate-200 font-mono text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700">
                                    {teamId}
                                </div>
                            </div>
                        )}
                        {priority !== undefined && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Priority</label>
                                <div className="text-slate-200 font-mono text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700">
                                    {priority}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Full Payload (Collapsible) */}
                    <details className="group">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-300 transition-colors">
                            Full Payload
                        </summary>
                        <div className="mt-2 bg-slate-950 rounded-lg p-4 border border-slate-800">
                            <pre className="text-xs text-green-400 overflow-x-auto font-mono">
                                {JSON.stringify(payload, null, 2)}
                            </pre>
                        </div>
                    </details>

                    {/* Error/Result Display */}
                    {(item as any).error && (
                        <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4">
                            <div className="text-red-400 font-semibold mb-2">Error</div>
                            <div className="text-red-300 text-sm font-mono">{(item as any).error}</div>
                        </div>
                    )}

                    {(item as any).data && (
                        <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-lg p-4">
                            <div className="text-emerald-400 font-semibold mb-2">Result</div>
                            <pre className="text-emerald-300 text-xs font-mono overflow-x-auto">
                                {JSON.stringify((item as any).data, null, 2)}
                            </pre>
                        </div>
                    )}

                    {(item as any).reason && (
                        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                            <div className="text-slate-400 font-semibold mb-2">Reason</div>
                            <div className="text-slate-300 text-sm">{(item as any).reason}</div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                {isPending && onAccept && onDecline && (
                    <div className="p-6 border-t border-slate-700 bg-slate-800/30 flex gap-3 justify-end">
                        <button
                            onClick={onDecline}
                            disabled={executing}
                            className="px-5 py-2.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20 transition-colors flex items-center gap-2 font-medium"
                        >
                            <Ban size={16} />
                            Decline
                        </button>
                        <button
                            onClick={onAccept}
                            disabled={executing}
                            className="px-5 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/20 transition-colors flex items-center gap-2 font-medium"
                        >
                            {executing ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <CheckCircle size={16} />
                            )}
                            Approve & Execute
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
