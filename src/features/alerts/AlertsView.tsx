import React, { useCallback, useEffect, useState } from 'react';
import { CloudRain, ExternalLink, Globe, Megaphone, RefreshCw } from 'lucide-react';
import { DISTRICT_NAMES } from '../../../shared/assamGeo';
import type { LanguageCode, LiveAssamBrief, Severity } from '../../../shared/types';
import { TRANSLATIONS } from '../../i18n/translations';
import { SeverityIndicator } from '../../components/SeverityIndicator';
import { apiFetch } from '../../lib/api';
import { useAppData } from '../auth/AuthContext';

export const AlertsView: React.FC<{ lang: LanguageCode }> = ({ lang }) => {
  const { user, alerts, weather, refreshAll } = useAppData();
  const t = TRANSLATIONS[lang];

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<Severity>('HIGH');
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>(['Kamrup Metropolitan']);
  const [hours, setHours] = useState(24);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveBrief, setLiveBrief] = useState<LiveAssamBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const loadLiveBrief = useCallback(async (force = false) => {
    setBriefLoading(true);
    try {
      const res = await apiFetch<{ brief: LiveAssamBrief }>(
        `/api/alerts/live-brief${force ? '?refresh=1' : ''}`
      );
      setLiveBrief(res.brief);
    } catch {
      // ignore transient offline fetch failure
    } finally {
      setBriefLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLiveBrief(false);
  }, [loadLiveBrief]);

  const now = Date.now();

  const toggleDistrict = (d: string) => {
    setSelectedDistricts((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const publishAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/api/alerts', {
        method: 'POST',
        body: JSON.stringify({
          title,
          message,
          severity,
          districts: selectedDistricts,
          hours,
        }),
      });
      setTitle('');
      setMessage('');
      setNotice('Early alert broadcast sent to selected districts.');
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish alert.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Early Warnings Feed */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Early Warnings &amp; River Advisories
            </h1>
          </div>

          {alerts.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
              No early warning bulletins published.
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((al) => {
                const expired = al.expiresAt <= now;
                return (
                  <article
                    key={al.id}
                    className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2 ${
                      expired ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SeverityIndicator severity={al.severity} lang={lang} />
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {expired
                          ? 'Expired'
                          : `Expires ${new Date(al.expiresAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`}
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">{al.title}</h2>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{al.message}</p>
                    <div className="text-xs text-slate-500 dark:text-slate-400 pt-1">
                      Target Districts: <span className="text-slate-800 dark:text-slate-200 font-medium">{al.districts.join(', ')}</span> · Issued by {al.createdByName}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Weather & Rainfall Stations */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <CloudRain className="w-4 h-4 text-sky-500" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.weatherWatch}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {weather.map((w) => (
                <div
                  key={w.district}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{w.station}</span>
                    <SeverityIndicator severity={w.advisoryLevel} lang={lang} />
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{w.summary}</p>
                  <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 pt-1">
                    24h Rain: {w.rain24hMm}mm · Wind: {w.windKmh} km/h · {w.temperatureC}°C
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Search-Grounded Assam Official Brief */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Live Assam Flood &amp; IMD Brief (Google Search)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => loadLiveBrief(true)}
                disabled={briefLoading}
                className="min-h-[36px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${briefLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>{briefLoading ? 'Checking...' : 'Refresh'}</span>
              </button>
            </div>

            {liveBrief ? (
              <div className="space-y-3">
                <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {liveBrief.summary}
                </div>
                {liveBrief.webSources.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-2">
                    {liveBrief.webSources.map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:border-emerald-500"
                      >
                        <span>{src.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                )}
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Updated {new Date(liveBrief.updatedAt).toLocaleTimeString()} · Source: {liveBrief.modelUsed}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {briefLoading ? 'Fetching latest Assam flood & meteorological citations...' : 'Tap Refresh to load web-grounded bulletins.'}
              </p>
            )}
          </section>
        </div>

        {/* Admin Alert Publisher */}
        <aside className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 h-fit">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-red-500" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Publish Early Alert</h2>
          </div>

          {user?.role !== 'admin' ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Only authorized administrators can broadcast state or district early warning alerts.
            </p>
          ) : (
            <form onSubmit={publishAlert} className="space-y-3.5">
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

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Alert Title
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Brahmaputra Above Danger Level"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Severity
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as Severity)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                  >
                    <option value="CRITICAL">{t.critical}</option>
                    <option value="HIGH">{t.high}</option>
                    <option value="MODERATE">{t.moderate}</option>
                    <option value="LOW">{t.low}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Expiry (Hours)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Advisory Message
                </label>
                <textarea
                  rows={3}
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Actionable evacuation and safety guidance..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Target Districts ({selectedDistricts.length} selected)
                </label>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-300 dark:border-slate-700 p-2 grid grid-cols-1 gap-1 text-xs">
                  {DISTRICT_NAMES.map((d) => (
                    <label key={d} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedDistricts.includes(d)}
                        onChange={() => toggleDistrict(d)}
                        className="accent-red-600"
                      />
                      <span>{d}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || selectedDistricts.length === 0}
                className="w-full min-h-[48px] rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold text-sm"
              >
                {submitting ? 'Broadcasting...' : 'Broadcast Alert Now'}
              </button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
};
