import React, { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import type { LanguageCode, NotificationItem } from '../../../shared/types';
import { SeverityIndicator } from '../../components/SeverityIndicator';
import { apiFetch } from '../../lib/api';
import { useAppData } from '../auth/AuthContext';

export const NotificationsView: React.FC<{ lang: LanguageCode }> = ({ lang }) => {
  const { user, notifications, refreshAll } = useAppData();
  const [filter, setFilter] = useState<'ALL' | NotificationItem['type']>('ALL');

  const markRead = async (id: string, isRead: boolean) => {
    await apiFetch(`/api/notifications/${id}/read`, {
      method: 'PATCH',
      body: JSON.stringify({ isRead }),
    });
    await refreshAll();
  };

  const markAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    await refreshAll();
  };

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
        Sign in to view your unified notification inbox.
      </div>
    );
  }

  const filtered = notifications.filter((n) => filter === 'ALL' || n.type === filter);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-sky-500" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Notifications Center ({unreadCount} unread)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Unified live feed for SOS dispatches, field report updates, and district alerts.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
            {(['ALL', 'sos', 'report', 'alert', 'system'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`min-h-[34px] px-2.5 rounded-lg uppercase font-semibold ${
                  filter === f
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <CheckCheck className="w-4 h-4" /> Mark all read
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
          No notifications in this category.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800 overflow-hidden">
          {filtered.map((n) => (
            <div
              key={n.id}
              className={`p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                n.isRead ? 'opacity-70' : 'bg-sky-500/5'
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <SeverityIndicator severity={n.severity} lang={lang} />
                  <span aria-hidden="true">·</span>
                  <span className="uppercase font-semibold">{n.type}</span>
                  {n.district && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{n.district}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{n.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300">{n.body}</p>
              </div>
              <button
                type="button"
                onClick={() => markRead(n.id, !n.isRead)}
                className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold shrink-0 self-start sm:self-center"
              >
                {n.isRead ? 'Mark Unread' : 'Mark Read'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
