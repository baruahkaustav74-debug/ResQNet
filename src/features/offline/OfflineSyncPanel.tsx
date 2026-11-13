import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudOff,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useAppData } from '../auth/AuthContext';

export const OfflineSyncPanel: React.FC = () => {
  const {
    user,
    isOnline,
    pendingSyncCount,
    offlineLogs,
    syncProgress,
    syncOfflineQueue,
    clearCompletedSyncLogs,
    dismissSyncSummary,
  } = useAppData();
  const [expanded, setExpanded] = useState(false);

  const hasSyncedHistory = offlineLogs.some((l) => l.status === 'synced');
  const shouldShowBanner =
    !isOnline ||
    pendingSyncCount > 0 ||
    syncProgress.active ||
    syncProgress.phase === 'completed' ||
    syncProgress.phase === 'partial_error';

  if (!shouldShowBanner && offlineLogs.length === 0) return null;
  if (!shouldShowBanner && !expanded) return null;

  const pct =
    syncProgress.total > 0
      ? Math.min(
          100,
          Math.round(((syncProgress.completed + syncProgress.failed) / syncProgress.total) * 100)
        )
      : syncProgress.phase === 'completed'
        ? 100
        : 0;

  return (
    <div className="px-4 sm:px-6 pt-3">
      <div
        className={`rounded-2xl border px-4 py-3 text-xs transition-colors ${
          syncProgress.phase === 'completed' && !syncProgress.active && isOnline && pendingSyncCount === 0
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
            : syncProgress.phase === 'partial_error'
              ? 'border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {syncProgress.active ? (
              <Loader2 className="w-4 h-4 animate-spin text-sky-500 shrink-0" aria-hidden="true" />
            ) : !isOnline ? (
              <CloudOff className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
            ) : syncProgress.phase === 'completed' && pendingSyncCount === 0 ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
            )}

            <div className="min-w-0">
              <p className="font-semibold">
                {syncProgress.active
                  ? `Synchronizing offline activity (${syncProgress.completed}/${syncProgress.total} · ${pct}%)`
                  : !isOnline
                    ? `Offline Mode — Actions logged locally (${pendingSyncCount} pending sync)`
                    : syncProgress.phase === 'completed' && pendingSyncCount === 0
                      ? `Back online — All ${syncProgress.completed} offline action(s) synchronized`
                      : syncProgress.phase === 'partial_error'
                        ? `Sync completed with ${syncProgress.failed} failed item(s)`
                        : `${pendingSyncCount} offline action(s) queued for background sync`}
              </p>
              {syncProgress.currentLabel && (
                <p className="text-[11px] opacity-85 truncate mt-0.5">{syncProgress.currentLabel}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isOnline && pendingSyncCount > 0 && !syncProgress.active && user && (
              <button
                type="button"
                onClick={() => syncOfflineQueue()}
                className="min-h-[34px] px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sync Now</span>
              </button>
            )}

            {offlineLogs.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="min-h-[34px] px-3 rounded-xl border border-current/25 font-semibold inline-flex items-center gap-1"
                aria-expanded={expanded}
              >
                <span>Activity Log ({offlineLogs.length})</span>
                {expanded ? (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            )}

            {!syncProgress.active && syncProgress.phase === 'completed' && pendingSyncCount === 0 && (
              <button
                type="button"
                onClick={dismissSyncSummary}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl hover:bg-black/10"
                aria-label="Dismiss sync banner"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Sync Progress Visualization Bar */}
        {(syncProgress.active ||
          syncProgress.phase === 'completed' ||
          syncProgress.phase === 'partial_error' ||
          (!isOnline && pendingSyncCount > 0)) && (
          <div className="mt-2.5 space-y-1">
            <div
              className="h-2 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden"
              role="progressbar"
              aria-valuenow={syncProgress.active || syncProgress.phase === 'completed' ? pct : 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full transition-all duration-300 ${
                  syncProgress.phase === 'completed'
                    ? 'bg-emerald-500'
                    : syncProgress.phase === 'partial_error'
                      ? 'bg-red-500'
                      : syncProgress.active
                        ? 'bg-sky-500'
                        : 'bg-amber-500'
                }`}
                style={{
                  width: `${
                    syncProgress.active || syncProgress.phase === 'completed' || syncProgress.phase === 'partial_error'
                      ? Math.max(8, pct)
                      : 15
                  }%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums opacity-80">
              <span>
                {syncProgress.active
                  ? `Step ${Math.min(syncProgress.total, syncProgress.completed + syncProgress.failed + 1)} of ${syncProgress.total}`
                  : syncProgress.phase === 'completed'
                    ? `${syncProgress.completed}/${syncProgress.total} synced`
                    : !isOnline
                      ? 'Waiting for connectivity...'
                      : `${pendingSyncCount} waiting`}
              </span>
              <span>{syncProgress.active || syncProgress.phase === 'completed' ? `${pct}%` : 'Queued'}</span>
            </div>
          </div>
        )}

        {/* Expandable Offline Action Log */}
        {expanded && offlineLogs.length > 0 && (
          <div className="mt-3 pt-3 border-t border-current/15 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold uppercase tracking-wide text-[11px]">
                Local Offline Action Log
              </span>
              {hasSyncedHistory && (
                <button
                  type="button"
                  onClick={() => clearCompletedSyncLogs()}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  <span>Clear Synced</span>
                </button>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {offlineLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl bg-white/75 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 px-3 py-2 flex items-start justify-between gap-3 text-slate-800 dark:text-slate-200"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[10px] font-bold uppercase text-sky-600 dark:text-sky-400">
                        {log.actionType.replace(/_/g, ' ')}
                      </span>
                      {log.district && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          · {log.district}
                        </span>
                      )}
                      {log.offlineWhenTriggered && (
                        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                          (offline)
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-xs truncate">{log.title}</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2">
                      {log.detail}
                    </p>
                    {log.errorMessage && (
                      <p className="text-[11px] text-red-600 dark:text-red-400">{log.errorMessage}</p>
                    )}
                  </div>

                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="inline-flex items-center gap-1 text-[11px] font-bold uppercase">
                      {log.status === 'syncing' ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-sky-500" />
                          <span className="text-sky-600 dark:text-sky-400">Syncing</span>
                        </>
                      ) : log.status === 'synced' ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Synced</span>
                        </>
                      ) : log.status === 'failed' ? (
                        <>
                          <AlertTriangle className="w-3 h-3 text-red-500" />
                          <span className="text-red-600 dark:text-red-400">Failed</span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-3 h-3 text-amber-500" />
                          <span className="text-amber-600 dark:text-amber-400">
                            {log.status === 'queued' ? 'Queued' : 'Logged'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {new Date(log.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
