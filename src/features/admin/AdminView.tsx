import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { DISTRICT_NAMES } from '../../../shared/assamGeo';
import type { AuditLogEntry, User } from '../../../shared/types';
import { apiFetch } from '../../lib/api';
import { useAppData } from '../auth/AuthContext';
import { AdminTrendsChart } from './AdminTrendsChart';

export const AdminView: React.FC = () => {
  const { user, shelters, refreshAll } = useAppData();
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const loadAdminData = useCallback(async () => {
    if (user?.role !== 'admin') return;
    setLoading(true);
    setError(null);
    try {
      const [uRes, lRes] = await Promise.all([
        apiFetch<{ users: User[] }>('/api/admin/users'),
        apiFetch<{ logs: AuditLogEntry[] }>('/api/admin/audit-logs'),
      ]);
      setUsers(uRes.users);
      setLogs(lRes.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin console.');
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  if (user?.role !== 'admin') {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
        Administrator access required.
      </div>
    );
  }

  const updateUser = async (
    targetId: string,
    patch: { status?: User['status']; district?: string; assignedShelterId?: string | null; role?: User['role'] }
  ) => {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/users/${targetId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setNotice('User assignment updated.');
      await Promise.all([loadAdminData(), refreshAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user.');
    }
  };

  const resetDemo = async () => {
    setResetting(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/api/admin/reset-demo', { method: 'POST' });
      setNotice('Demo dataset reset (8 volunteers, 10 shelters, 15 reports, 3 SOS, 3 alerts).');
      await Promise.all([loadAdminData(), refreshAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset demo data.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-sky-500" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">State Command Admin</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Approve field volunteers, assign districts &amp; shelters, manage user access, and inspect audit logs.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={resetDemo}
          disabled={resetting}
          className="min-h-[44px] px-4 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
        >
          <RefreshCw className={`w-4 h-4 ${resetting ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{resetting ? 'Resetting...' : 'Reset Demo Data'}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {/* Daily & Weekly SOS & Report Trends Visualization */}
      <AdminTrendsChart />

      {/* Volunteer & User Roster */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Users &amp; Volunteer Roster ({users.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading users...</div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {users.map((u) => (
              <div
                key={u.id}
                className="p-4 sm:px-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{u.name}</span>
                    <span className="font-semibold uppercase text-sky-600 dark:text-sky-400">{u.role}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-semibold uppercase ${
                        u.status === 'active'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : u.status === 'pending'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {u.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {u.email} {u.phone ? `· ${u.phone}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Assign district for ${u.name}`}
                    value={u.district || 'Kamrup Metropolitan'}
                    onChange={(e) => updateUser(u.id, { district: e.target.value })}
                    className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs"
                  >
                    {DISTRICT_NAMES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label={`Assign shelter for ${u.name}`}
                    value={u.assignedShelterId || ''}
                    onChange={(e) => updateUser(u.id, { assignedShelterId: e.target.value || null })}
                    className="min-h-[40px] max-w-[210px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs"
                  >
                    <option value="">No Shelter Assigned</option>
                    {shelters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.district}: {s.name}
                      </option>
                    ))}
                  </select>

                  {u.status !== 'active' && (
                    <button
                      type="button"
                      onClick={() => updateUser(u.id, { status: 'active' })}
                      className="min-h-[40px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Approve
                    </button>
                  )}
                  {u.id !== user.id && u.status !== 'deactivated' && (
                    <button
                      type="button"
                      onClick={() => updateUser(u.id, { status: 'deactivated' })}
                      className="min-h-[40px] px-3 rounded-xl border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <UserX className="w-3.5 h-3.5" /> Deactivate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Audit Log */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Command Audit Log</h2>
        </div>
        <div className="max-h-96 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
          {logs.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No audit entries recorded yet.</div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="px-5 py-3 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div>
                  <span className="font-mono font-bold text-sky-600 dark:text-sky-400">{l.action}</span>{' '}
                  <span className="text-slate-800 dark:text-slate-200 font-medium">by {l.actorName}</span>{' '}
                  <span className="text-slate-500 dark:text-slate-400">({l.actorRole})</span>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">{l.details}</p>
                </div>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                  {new Date(l.createdAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
