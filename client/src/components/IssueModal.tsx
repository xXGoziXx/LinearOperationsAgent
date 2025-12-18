import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, CheckCircle, Ban, Loader2, FileText, Zap, AlertCircle, Save, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BatchItem } from '../types/agent';
import { type UnknownRecord } from '../types/common';
import { getProjectMilestones, getTeamMetadata, getTeams } from '../services/api';
import { toTitleCase, asRecord, asString, asNumber } from '../utils/helpers';
interface ExtendedBatchItem {
    action: string;
    payload: UnknownRecord;
    status: string;
    file?: string;
    error?: string;
    data?: unknown;
    reason?: string;
    originalPayload?: UnknownRecord; // Added
}

interface IssueModalProps {
    isOpen: boolean;
    onClose: () => void;
    item: BatchItem | ExtendedBatchItem;
    onAccept?: (payloadOverride?: UnknownRecord) => void;
    onDecline?: () => void;
    onSave?: (payload: UnknownRecord) => void;
    executing?: boolean;
}

type TeamMetadata = {
    team: { id: string; name: string };
    projects: Array<{ id: string; name: string; state?: string }>;
    labels: Array<{
        id: string;
        name: string;
        color?: string;
        parentId?: string;
        parentName?: string;
        isGroup?: boolean;
    }>;
};

type ProjectMilestone = { id: string; name: string };
type TeamSummary = { id: string; name: string };

function hexToRgba(hex: string, alpha: number): string | undefined {
    const raw = hex.trim().replace(/^#/, '');
    const normalized = raw.length === 3
        ? raw.split('').map(c => c + c).join('')
        : raw;

    if (!/^[0-9a-f]{6}$/i.test(normalized)) return undefined;

    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function coerceStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function enforceExclusiveChildLabelIds(labelIds: string[], labels: TeamMetadata['labels'] | undefined): string[] {
    if (!labels || labels.length === 0 || labelIds.length < 2) return labelIds;

    const byId = new Map(labels.map(l => [l.id, l] as const));
    const usedParents = new Set<string>();
    const seen = new Set<string>();
    const out: string[] = [];

    for (const id of labelIds) {
        if (seen.has(id)) continue;
        seen.add(id);

        const parentId = byId.get(id)?.parentId;
        if (parentId) {
            if (usedParents.has(parentId)) continue;
            usedParents.add(parentId);
        }

        out.push(id);
    }

    return out;
}

export const IssueModal: React.FC<IssueModalProps> = ({
    isOpen,
    onClose,
    item,
    onAccept,
    onDecline,
    onSave,
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

    const isPending = item.status === 'pending';
    const action = asString((item as { action?: unknown }).action);
    const isIssueAction = action === 'createIssue' || action === 'updateIssue';
    const isProjectAction = action === 'createProject' || action === 'updateProject';
    const canEdit = isPending && (isIssueAction || isProjectAction);

    // Extract payload data
    const payload = useMemo(() => asRecord((item as { payload?: unknown }).payload), [item]);
    // Original payload for friendly names
    const originalPayload = useMemo(() => asRecord((item as ExtendedBatchItem).originalPayload || {}), [item]);

    const [draftPayload, setDraftPayload] = useState<UnknownRecord>({});
    const [isDirty, setIsDirty] = useState(false);
    const [descriptionMode, setDescriptionMode] = useState<'preview' | 'edit'>('preview');

    const effectivePayload = canEdit ? draftPayload : payload;
    const effectiveTitle = asString(effectivePayload.title) || asString(effectivePayload.name) || 'Untitled';
    const effectiveDescription = asString(effectivePayload.description);
    const effectiveTeamId = asString(effectivePayload.teamId);
    const effectivePriority = asNumber(effectivePayload.priority);
    const effectiveProjectId = asString(effectivePayload.projectId);
    const effectiveProjectMilestoneId = asString(effectivePayload.projectMilestoneId);
    const effectiveLabelIds = coerceStringArray(effectivePayload.labelIds);
    const effectiveTeamIds = coerceStringArray(effectivePayload.teamIds);
    const effectiveProjectState = asString(effectivePayload.state);
    const effectiveLeadId = asString(effectivePayload.leadId);

    const draftTitleValue = isProjectAction
        ? (asString(draftPayload.name) || asString(draftPayload.title))
        : (asString(draftPayload.title) || asString(draftPayload.name));
    const draftDescriptionValue = asString(draftPayload.description);
    const draftTeamId = asString(draftPayload.teamId);
    const draftPriority = asNumber(draftPayload.priority);
    const draftProjectId = asString(draftPayload.projectId);
    const draftProjectMilestoneId = asString(draftPayload.projectMilestoneId);
    const draftLabelIds = coerceStringArray(draftPayload.labelIds);
    const draftTeamIds = coerceStringArray(draftPayload.teamIds);
    const draftProjectState = asString(draftPayload.state);
    const draftLeadId = asString(draftPayload.leadId);

    const [metadata, setMetadata] = useState<TeamMetadata | null>(null);
    const [metadataLoading, setMetadataLoading] = useState(false);
    const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
    const [milestonesLoading, setMilestonesLoading] = useState(false);
    const [teams, setTeams] = useState<TeamSummary[]>([]);
    const [teamsLoading, setTeamsLoading] = useState(false);

    const metadataProjects = metadata?.projects ?? [];
    const metadataLabels = metadata?.labels ?? [];

    const labelOptions = useMemo(() => {
        return metadataLabels
            .filter(l => !l.isGroup)
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [metadataLabels]);

    const projectOptions = useMemo(() => {
        return metadataProjects.slice().sort((a, b) => a.name.localeCompare(b.name));
    }, [metadataProjects]);

    const projectName = useMemo(() => {
        const projectId = canEdit ? draftProjectId : effectiveProjectId;
        if (!projectId) return '';
        return projectOptions.find(p => p.id === projectId)?.name || '';
    }, [canEdit, draftProjectId, effectiveProjectId, projectOptions]);

    const milestoneName = useMemo(() => {
        const milestoneId = canEdit ? draftProjectMilestoneId : effectiveProjectMilestoneId;
        if (!milestoneId) return '';
        return milestones.find(m => m.id === milestoneId)?.name || '';
    }, [canEdit, draftProjectMilestoneId, effectiveProjectMilestoneId, milestones]);

    const teamName = useMemo(() => {
        const nameFromPayload = asString(originalPayload.teamName || payload.teamName);
        if (metadata?.team?.name) return metadata.team.name;
        if (nameFromPayload) return nameFromPayload;
        return draftTeamId;
    }, [draftTeamId, metadata?.team?.name, originalPayload.teamName, payload.teamName]);

    const statusName = asString(originalPayload.state || originalPayload.stateId || payload.state || payload.stateId);

    const errorMessage = (item as ExtendedBatchItem).error;
    const hasErrorMessage = typeof errorMessage === 'string' && errorMessage.length > 0;

    const resultData = (item as ExtendedBatchItem).data;
    const hasResultData = resultData !== undefined && resultData !== null;

    const reasonMessage = (item as ExtendedBatchItem).reason;
    const hasReasonMessage = typeof reasonMessage === 'string' && reasonMessage.length > 0;

    // Status styling
    const statusConfig = {
        pending: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: AlertCircle },
        success: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: CheckCircle },
        failed: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: AlertCircle },
        skipped: { color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30', icon: Ban }
    };

    const config = statusConfig[item.status as keyof typeof statusConfig] || statusConfig.pending;
    const StatusIcon = config.icon;

    const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
    const [labelQuery, setLabelQuery] = useState('');
    const labelPickerRef = useRef<HTMLDivElement | null>(null);
    const labelQueryInputRef = useRef<HTMLInputElement | null>(null);
    const [isTeamPickerOpen, setIsTeamPickerOpen] = useState(false);
    const [teamQuery, setTeamQuery] = useState('');
    const teamPickerRef = useRef<HTMLDivElement | null>(null);
    const teamQueryInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setDraftPayload({ ...payload });
        setIsDirty(false);
        setDescriptionMode('preview');
        setIsLabelPickerOpen(false);
        setLabelQuery('');
        setIsTeamPickerOpen(false);
        setTeamQuery('');
    }, [isOpen, payload]);

    useEffect(() => {
        if (!isOpen || !isLabelPickerOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setIsLabelPickerOpen(false);
            }
        };

        const handleMouseDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            const container = labelPickerRef.current;
            if (container && !container.contains(target)) {
                setIsLabelPickerOpen(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleMouseDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [isLabelPickerOpen, isOpen]);

    useEffect(() => {
        if (!isOpen || !isTeamPickerOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setIsTeamPickerOpen(false);
            }
        };

        const handleMouseDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            const container = teamPickerRef.current;
            if (container && !container.contains(target)) {
                setIsTeamPickerOpen(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleMouseDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [isTeamPickerOpen, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        if (!isLabelPickerOpen) return;
        // Focus after mount.
        setTimeout(() => labelQueryInputRef.current?.focus(), 0);
    }, [isLabelPickerOpen, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        if (!isTeamPickerOpen) return;
        setTimeout(() => teamQueryInputRef.current?.focus(), 0);
    }, [isTeamPickerOpen, isOpen]);

    useEffect(() => {
        if (!isOpen || !isIssueAction) return;
        if (!draftTeamId) {
            setMetadata(null);
            return;
        }

        let cancelled = false;
        setMetadataLoading(true);
        getTeamMetadata(draftTeamId)
            .then((res) => {
                if (cancelled) return;
                setMetadata(res as TeamMetadata);
            })
            .catch(() => {
                if (cancelled) return;
                setMetadata(null);
            })
            .finally(() => {
                if (cancelled) return;
                setMetadataLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [draftTeamId, isIssueAction, isOpen]);

    useEffect(() => {
        if (!isOpen || !isProjectAction) return;

        let cancelled = false;
        setTeamsLoading(true);
        getTeams()
            .then((res) => {
                if (cancelled) return;
                const nodes = (res && typeof res === 'object' && 'nodes' in (res as any)) ? (res as any).nodes : res;
                if (Array.isArray(nodes)) {
                    setTeams(nodes.filter((t: any) => t && typeof t.id === 'string' && typeof t.name === 'string'));
                } else {
                    setTeams([]);
                }
            })
            .catch(() => {
                if (cancelled) return;
                setTeams([]);
            })
            .finally(() => {
                if (cancelled) return;
                setTeamsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, isProjectAction]);

    useEffect(() => {
        if (!isOpen || !isIssueAction) return;
        if (!draftProjectId) {
            setMilestones([]);
            return;
        }

        let cancelled = false;
        setMilestonesLoading(true);
        getProjectMilestones(draftProjectId)
            .then((res) => {
                if (cancelled) return;
                const nodes = (res && typeof res === 'object' && 'nodes' in (res as any)) ? (res as any).nodes : res;
                if (Array.isArray(nodes)) {
                    setMilestones(nodes.filter((m: any) => m && typeof m.id === 'string' && typeof m.name === 'string'));
                } else {
                    setMilestones([]);
                }
            })
            .catch(() => {
                if (cancelled) return;
                setMilestones([]);
            })
            .finally(() => {
                if (cancelled) return;
                setMilestonesLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [draftProjectId, isIssueAction, isOpen]);

    const setDraftValue = (key: string, value: unknown) => {
        setDraftPayload((prev) => {
            const next = { ...prev };
            if (value === undefined) {
                delete next[key];
            } else {
                next[key] = value;
            }
            return next;
        });
        setIsDirty(true);
    };

    const handleSave = () => {
        if (!onSave || !canEdit) return;
        onSave(draftPayload);
        setIsDirty(false);
    };

    const handleApprove = () => {
        if (!onAccept) return;
        if (isIssueAction || isProjectAction) {
            onAccept(draftPayload);
            return;
        }
        onAccept();
    };

    const selectedLabelBadges = useMemo(() => {
        const ids = canEdit ? draftLabelIds : effectiveLabelIds;
        if (!ids || ids.length === 0) return [];
        const byId = new Map(labelOptions.map(l => [l.id, l] as const));
        return ids
            .map(id => byId.get(id))
            .filter((l): l is NonNullable<typeof l> => !!l);
    }, [canEdit, draftLabelIds, effectiveLabelIds, labelOptions]);

    const labelById = useMemo(() => new Map(labelOptions.map(l => [l.id, l] as const)), [labelOptions]);

    const unknownLabelIds = useMemo(() => {
        const ids = canEdit ? draftLabelIds : effectiveLabelIds;
        return ids.filter(id => !labelById.has(id));
    }, [canEdit, draftLabelIds, effectiveLabelIds, labelById]);

    const filteredLabelOptions = useMemo(() => {
        const selected = new Set(draftLabelIds);
        const q = labelQuery.trim().toLowerCase();
        return labelOptions.filter((l) => {
            if (selected.has(l.id)) return false;
            if (!q) return true;
            const hay = `${l.parentName ? `${l.parentName} ` : ''}${l.name}`.toLowerCase();
            return hay.includes(q);
        });
    }, [draftLabelIds, labelOptions, labelQuery]);

    const canShowDescription = isIssueAction || isProjectAction || effectiveDescription.trim().length > 0;

    const displayedPayload = canEdit ? draftPayload : payload;
    const hasAnyLabels = effectiveLabelIds.length > 0;
    const hasAnyProject = effectiveProjectId.trim().length > 0;
    const hasAnyMilestone = effectiveProjectMilestoneId.trim().length > 0;
    const hasAnyTeams = effectiveTeamIds.length > 0;
    const hasProjectState = effectiveProjectState.trim().length > 0;
    const hasProjectLead = effectiveLeadId.trim().length > 0;
    const effectiveProjectStateNormalized = effectiveProjectState === 'inProgress' ? 'started' : effectiveProjectState;
    const draftProjectStateNormalized = draftProjectState === 'inProgress' ? 'started' : draftProjectState;

    const showIssueLabels = isIssueAction && (canEdit || hasAnyLabels);
    const showIssueProject = isIssueAction && (canEdit || hasAnyProject);
    const showIssueMilestone = isIssueAction && (canEdit || hasAnyMilestone);
    const showIssueStatus = isIssueAction && statusName.trim().length > 0;

    const teamById = useMemo(() => new Map(teams.map(t => [t.id, t] as const)), [teams]);
    const selectedTeamBadges = useMemo(() => {
        const ids = canEdit ? draftTeamIds : effectiveTeamIds;
        if (!ids || ids.length === 0) return [];
        return ids
            .map(id => teamById.get(id))
            .filter((t): t is NonNullable<typeof t> => !!t);
    }, [canEdit, draftTeamIds, effectiveTeamIds, teamById]);

    const unknownTeamIds = useMemo(() => {
        const ids = canEdit ? draftTeamIds : effectiveTeamIds;
        return ids.filter(id => !teamById.has(id));
    }, [canEdit, draftTeamIds, effectiveTeamIds, teamById]);

    const filteredTeamOptions = useMemo(() => {
        const selected = new Set(draftTeamIds);
        const q = teamQuery.trim().toLowerCase();
        return teams
            .filter(t => !selected.has(t.id))
            .filter(t => {
                if (!q) return true;
                return t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
            })
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [draftTeamIds, teamQuery, teams]);

    const addTeamId = (id: string) => {
        if (!canEdit) return;
        const next = Array.from(new Set([...draftTeamIds.filter(x => x !== id), id]));
        setDraftValue('teamIds', next.length > 0 ? next : undefined);
    };

    const removeTeamId = (id: string) => {
        if (!canEdit) return;
        const next = draftTeamIds.filter(x => x !== id);
        setDraftValue('teamIds', next.length > 0 ? next : undefined);
    };

    const addLabelId = (id: string) => {
        if (!canEdit) return;
        const current = draftLabelIds;
        const meta = labelById.get(id);

        let next = current.filter(existingId => existingId !== id);

        if (meta?.parentId) {
            next = next.filter(existingId => labelById.get(existingId)?.parentId !== meta.parentId);
        }

        next.push(id);
        next = enforceExclusiveChildLabelIds(next, metadataLabels);
        setDraftValue('labelIds', next.length > 0 ? next : undefined);
    };

    const removeLabelId = (id: string) => {
        if (!canEdit) return;
        const next = draftLabelIds.filter(x => x !== id);
        setDraftValue('labelIds', next.length > 0 ? next : undefined);
    };

    if (!isOpen) return null;

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
                            {toTitleCase(item.action || 'Action Details')}
                        </h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {canEdit && onSave && (
                            <button
                                onClick={handleSave}
                                disabled={executing || !isDirty}
                                className="px-3 py-2 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/20 disabled:opacity-50 disabled:hover:bg-indigo-500/10 transition-colors flex items-center gap-2 text-sm font-medium"
                                title={isDirty ? 'Save edits' : 'No changes to save'}
                            >
                                <Save size={16} />
                                Save edits
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-200"
                            title="Close"
                        >
                            <X size={20} />
                        </button>
                    </div>
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
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            {isProjectAction ? 'Name' : 'Title'}
                        </label>
                        {canEdit ? (
                            <input
                                value={draftTitleValue}
                                onChange={(e) => setDraftValue(isProjectAction ? 'name' : 'title', e.target.value)}
                                placeholder={isProjectAction ? 'Project name' : 'Issue title'}
                                className="w-full text-2xl font-semibold bg-transparent text-slate-100 placeholder:text-slate-600 outline-none border-b border-slate-700 focus:border-indigo-500/60 pb-2"
                            />
                        ) : (
                            <div className="text-2xl font-semibold text-slate-100">{effectiveTitle}</div>
                        )}
                    </div>

                    {/* Description Section */}
                    {canShowDescription && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Description</label>
                                {canEdit && (
                                    <div className="flex items-center bg-slate-800/60 border border-slate-700 rounded-lg p-1">
                                        <button
                                            onClick={() => setDescriptionMode('preview')}
                                            className={`px-2 py-1 text-xs rounded-md transition-colors ${descriptionMode === 'preview'
                                                ? 'bg-slate-700 text-slate-100'
                                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                                }`}
                                            type="button"
                                        >
                                            Preview
                                        </button>
                                        <button
                                            onClick={() => setDescriptionMode('edit')}
                                            className={`px-2 py-1 text-xs rounded-md transition-colors ${descriptionMode === 'edit'
                                                ? 'bg-slate-700 text-slate-100'
                                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                                }`}
                                            type="button"
                                        >
                                            Markdown
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
                                {canEdit && descriptionMode === 'edit' ? (
                                    <textarea
                                        value={draftDescriptionValue}
                                        onChange={(e) => setDraftValue('description', e.target.value)}
                                        placeholder="Write markdown..."
                                        className="w-full min-h-[180px] bg-transparent text-slate-200 placeholder:text-slate-600 outline-none p-4 font-mono text-xs leading-relaxed"
                                    />
                                ) : (
                                    <div className="p-4">
                                        <div className="prose prose-invert prose-sm max-w-none text-slate-200">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {effectiveDescription || '_No description_'}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {isIssueAction && effectiveTeamId && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Team</label>
                                <div className="text-slate-200 text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700 truncate" title={effectiveTeamId}>
                                    {teamName || effectiveTeamId}
                                </div>
                            </div>
                        )}
                        {isIssueAction && (effectivePriority !== undefined || canEdit) && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Priority</label>
                                {canEdit ? (
                                    <select
                                        value={draftPriority !== undefined ? String(draftPriority) : ''}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (!v) {
                                                setDraftValue('priority', undefined);
                                                return;
                                            }
                                            setDraftValue('priority', Number(v));
                                        }}
                                        className="w-full text-slate-200 text-sm bg-slate-950/70 rounded-lg px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                                    >
                                        <option value="">Unset</option>
                                        <option value="0">0 — None</option>
                                        <option value="1">1 — Urgent</option>
                                        <option value="2">2 — High</option>
                                        <option value="3">3 — Normal</option>
                                        <option value="4">4 — Low</option>
                                    </select>
                                ) : (
                                    <div className="text-slate-200 font-mono text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700">
                                        {effectivePriority !== undefined ? String(effectivePriority) : '—'}
                                    </div>
                                )}
                            </div>
                        )}
                        {isProjectAction && (canEdit || hasProjectState) && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">State</label>
                                {canEdit ? (
                                    <select
                                        value={draftProjectStateNormalized || ''}
                                        onChange={(e) => setDraftValue('state', e.target.value || undefined)}
                                        className="w-full text-slate-200 text-sm bg-slate-950/70 rounded-lg px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                                    >
                                        <option value="">Unset</option>
                                        <option value="backlog">Backlog</option>
                                        <option value="planned">Planned</option>
                                        <option value="started">In Progress</option>
                                        <option value="paused">Paused</option>
                                        <option value="completed">Completed</option>
                                        <option value="canceled">Canceled</option>
                                    </select>
                                ) : (
                                    <div className="text-slate-200 text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700 truncate" title={effectiveProjectState}>
                                        {effectiveProjectStateNormalized || '—'}
                                    </div>
                                )}
                            </div>
                        )}
                        {isProjectAction && (canEdit || hasProjectLead) && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Lead</label>
                                {canEdit ? (
                                    <input
                                        value={draftLeadId}
                                        onChange={(e) => setDraftValue('leadId', e.target.value || undefined)}
                                        placeholder="Lead user ID"
                                        className="w-full bg-slate-950/70 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors font-mono"
                                    />
                                ) : (
                                    <div className="text-slate-200 font-mono text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700 truncate" title={effectiveLeadId}>
                                        {effectiveLeadId || '—'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Extended Metadata Grid */}
                    <div className="grid gap-4">
                        {/* Project Teams */}
                        {isProjectAction && (canEdit || hasAnyTeams) && (
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Teams</label>
                                <div ref={teamPickerRef} className="relative">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {selectedTeamBadges.length === 0 && unknownTeamIds.length === 0 && (
                                            <span className="text-xs text-slate-500">
                                                {teamsLoading ? 'Loading teams…' : 'No teams'}
                                            </span>
                                        )}
                                        {selectedTeamBadges.map((t) => (
                                            <span
                                                key={t.id}
                                                className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs border bg-slate-800/50 border-slate-700 text-slate-100"
                                                title={t.id}
                                            >
                                                <span className="truncate max-w-[260px]">{t.name}</span>
                                                {canEdit && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeTeamId(t.id)}
                                                        className="text-slate-200/70 hover:text-slate-100"
                                                        title="Remove"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                )}
                                            </span>
                                        ))}
                                        {unknownTeamIds.map((id) => (
                                            <span
                                                key={id}
                                                className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs border bg-slate-800/50 border-slate-700 text-slate-200 font-mono"
                                                title={id}
                                            >
                                                <span className="truncate max-w-[260px]">{id}</span>
                                                {canEdit && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeTeamId(id)}
                                                        className="text-slate-200/70 hover:text-slate-100"
                                                        title="Remove"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                )}
                                            </span>
                                        ))}

                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsLabelPickerOpen(false);
                                                    setIsTeamPickerOpen(v => !v);
                                                }}
                                                className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-slate-950/70 border border-slate-700 text-slate-300 hover:text-slate-100 hover:bg-slate-900/70 transition-colors"
                                                title="Add team"
                                            >
                                                <Plus size={14} />
                                            </button>
                                        )}
                                    </div>

                                    {canEdit && isTeamPickerOpen && (
                                        <div className="absolute z-20 mt-2 w-full max-w-md bg-slate-950 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                                            <div className="p-2 border-b border-slate-800">
                                                <input
                                                    ref={teamQueryInputRef}
                                                    value={teamQuery}
                                                    onChange={(e) => setTeamQuery(e.target.value)}
                                                    placeholder="Search teams…"
                                                    className="w-full bg-slate-900/70 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                                                />
                                            </div>
                                            <div className="max-h-64 overflow-auto p-1">
                                                {teamsLoading ? (
                                                    <div className="px-3 py-2 text-sm text-slate-500">Loading…</div>
                                                ) : filteredTeamOptions.length === 0 ? (
                                                    <div className="px-3 py-2 text-sm text-slate-500">No matching teams</div>
                                                ) : (
                                                    filteredTeamOptions.slice(0, 40).map((t) => (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            onClick={() => {
                                                                addTeamId(t.id);
                                                                setTeamQuery('');
                                                                teamQueryInputRef.current?.focus();
                                                            }}
                                                            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/60 text-slate-200 transition-colors"
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="text-sm truncate">{t.name}</div>
                                                                <div className="text-[11px] text-slate-500 truncate font-mono">{t.id}</div>
                                                            </div>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Labels */}
                        {showIssueLabels && (
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Labels</label>
                                {labelOptions.length > 0 ? (
                                    <>
                                        <div ref={labelPickerRef} className="relative">
                                            <div className="flex flex-wrap items-center gap-2">
                                                {selectedLabelBadges.length === 0 && unknownLabelIds.length === 0 && (
                                                    <span className="text-xs text-slate-500">No labels</span>
                                                )}
                                                {selectedLabelBadges.map((label) => {
                                                    const bg = label.color ? hexToRgba(label.color, 0.16) : undefined;
                                                    const border = label.color ? hexToRgba(label.color, 0.35) : undefined;
                                                    const dot = label.color || '#6366f1';
                                                    return (
                                                        <span
                                                            key={label.id}
                                                            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs border bg-indigo-500/15 border-indigo-500/30 text-slate-100"
                                                            style={{
                                                                backgroundColor: bg,
                                                                borderColor: border
                                                            }}
                                                            title={label.parentName ? `${label.parentName} / ${label.name}` : label.name}
                                                        >
                                                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dot }} />
                                                            <span className="truncate max-w-[240px]">
                                                                {label.parentName ? `${label.parentName}: ${label.name}` : label.name}
                                                            </span>
                                                            {canEdit && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeLabelId(label.id)}
                                                                    className="text-slate-200/70 hover:text-slate-100"
                                                                    title="Remove"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            )}
                                                        </span>
                                                    );
                                                })}
                                                {unknownLabelIds.map((id) => (
                                                    <span
                                                        key={id}
                                                        className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs border bg-slate-800/50 border-slate-700 text-slate-200 font-mono"
                                                        title={id}
                                                    >
                                                        <span className="truncate max-w-[240px]">{id}</span>
                                                        {canEdit && (
                                                            <button
                                                                type="button"
                                                                onClick={() => removeLabelId(id)}
                                                                className="text-slate-200/70 hover:text-slate-100"
                                                                title="Remove"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        )}
                                                    </span>
                                                ))}

                                                {canEdit && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setIsTeamPickerOpen(false);
                                                            setIsLabelPickerOpen((v) => !v);
                                                        }}
                                                        className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-slate-950/70 border border-slate-700 text-slate-300 hover:text-slate-100 hover:bg-slate-900/70 transition-colors"
                                                        title="Add label"
                                                    >
                                                        <Plus size={14} />
                                                    </button>
                                                )}
                                            </div>

                                            {canEdit && isLabelPickerOpen && (
                                                <div className="absolute z-20 mt-2 w-full max-w-md bg-slate-950 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                                                    <div className="p-2 border-b border-slate-800">
                                                        <input
                                                            ref={labelQueryInputRef}
                                                            value={labelQuery}
                                                            onChange={(e) => setLabelQuery(e.target.value)}
                                                            placeholder="Search labels…"
                                                            className="w-full bg-slate-900/70 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                                                        />
                                                    </div>
                                                    <div className="max-h-64 overflow-auto p-1">
                                                        {filteredLabelOptions.length === 0 ? (
                                                            <div className="px-3 py-2 text-sm text-slate-500">No matching labels</div>
                                                        ) : (
                                                            filteredLabelOptions.slice(0, 80).map((l) => (
                                                                <button
                                                                    key={l.id}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        addLabelId(l.id);
                                                                        setLabelQuery('');
                                                                        labelQueryInputRef.current?.focus();
                                                                    }}
                                                                    className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/60 text-slate-200 transition-colors"
                                                                >
                                                                    <span
                                                                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                                        style={{ backgroundColor: l.color || '#6366f1' }}
                                                                    />
                                                                    <div className="min-w-0">
                                                                        <div className="text-sm truncate">
                                                                            {l.name}
                                                                        </div>
                                                                        {l.parentName && (
                                                                            <div className="text-[11px] text-slate-500 truncate">
                                                                                {l.parentName}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </button>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                                        <div className="text-xs text-slate-500 mb-2">
                                            {metadataLoading ? 'Loading labels…' : 'No label metadata available.'}
                                        </div>
                                        {!canEdit && hasAnyLabels && (
                                            <div className="text-slate-200 text-xs font-mono break-all">
                                                {effectiveLabelIds.join(', ')}
                                            </div>
                                        )}
                                        {canEdit && (
                                            <input
                                                value={draftLabelIds.join(', ')}
                                                onChange={(e) => {
                                                    const ids = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                                    setDraftValue('labelIds', ids.length > 0 ? ids : undefined);
                                                }}
                                                placeholder="Comma-separated label IDs"
                                                className="w-full bg-slate-900 text-slate-200 text-sm rounded px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 font-mono"
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Project */}
                        {showIssueProject && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Project</label>
                                {canEdit ? (
                                    projectOptions.length > 0 ? (
                                        <select
                                            value={draftProjectId || ''}
                                            onChange={(e) => {
                                                const nextProjectId = e.target.value || undefined;
                                                setDraftValue('projectId', nextProjectId);
                                                setDraftValue('projectMilestoneId', undefined);
                                            }}
                                            className="w-full text-slate-200 text-sm bg-slate-950/70 rounded-lg px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                                        >
                                            <option value="">None</option>
                                            {projectOptions.map((p) => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            value={draftProjectId}
                                            onChange={(e) => setDraftValue('projectId', e.target.value || undefined)}
                                            placeholder="Project ID"
                                            className="w-full bg-slate-900 text-slate-200 text-sm rounded px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 font-mono"
                                        />
                                    )
                                ) : (
                                    <div className="text-slate-200 font-mono text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700 truncate" title={effectiveProjectId}>
                                        {projectName || effectiveProjectId || '—'}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Milestone */}
                        {showIssueMilestone && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Milestone</label>
                                {canEdit ? (
                                    <select
                                        value={draftProjectMilestoneId || ''}
                                        onChange={(e) => setDraftValue('projectMilestoneId', e.target.value || undefined)}
                                        disabled={!draftProjectId || milestonesLoading}
                                        className="w-full text-slate-200 text-sm bg-slate-950/70 rounded-lg px-3 py-2 border border-slate-700 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors disabled:opacity-50"
                                        title={!draftProjectId ? 'Select a project first' : ''}
                                    >
                                        <option value="">
                                            {!draftProjectId ? 'Select a project first' : (milestonesLoading ? 'Loading…' : 'None')}
                                        </option>
                                        {milestones.map((m) => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="text-slate-200 font-mono text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700 truncate" title={effectiveProjectMilestoneId}>
                                        {milestoneName || effectiveProjectMilestoneId || '—'}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Status */}
                        {showIssueStatus && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</label>
                                <div className="text-slate-200 font-mono text-sm bg-slate-800/50 rounded px-3 py-2 border border-slate-700 truncate">
                                    {statusName}
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
                                {JSON.stringify(displayedPayload, null, 2)}
                            </pre>
                        </div>
                    </details>

                    {/* Error/Result Display */}
                    {hasErrorMessage && (
                        <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4">
                            <div className="text-red-400 font-semibold mb-2">Error</div>
                            <div className="text-red-300 text-sm font-mono">{errorMessage}</div>
                        </div>
                    )}

                    {hasResultData && (
                        <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-lg p-4">
                            <div className="text-emerald-400 font-semibold mb-2">Result</div>
                            <pre className="text-emerald-300 text-xs font-mono overflow-x-auto">
                                {JSON.stringify(resultData, null, 2)}
                            </pre>
                        </div>
                    )}

                    {hasReasonMessage && (
                        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                            <div className="text-slate-400 font-semibold mb-2">Reason</div>
                            <div className="text-slate-300 text-sm">{reasonMessage}</div>
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
                            onClick={handleApprove}
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
