import React, { useState } from 'react';
import { Building2, Droplets, HeartPulse, Minus, Plus, Utensils, Zap } from 'lucide-react';
import { DISTRICT_NAMES } from '../../../shared/assamGeo';
import type { LanguageCode, Shelter, ShelterStatus } from '../../../shared/types';
import { TRANSLATIONS } from '../../i18n/translations';
import { apiFetch } from '../../lib/api';
import { useAppData } from '../auth/AuthContext';

export const SheltersView: React.FC<{ lang: LanguageCode }> = ({ lang }) => {
  const { user, shelters, refreshAll } = useAppData();
  const t = TRANSLATIONS[lang];

  const [districtFilter, setDistrictFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ShelterStatus>('ALL');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = shelters.filter((s) => {
    if (districtFilter !== 'ALL' && s.district !== districtFilter) return false;
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
    return true;
  });

  const canEditShelter = (s: Shelter): boolean => {
    if (!user || user.status !== 'active') return false;
    if (user.role === 'admin') return true;
    if (user.role === 'volunteer') {
      return s.assignedVolunteerId === user.id || user.assignedShelterId === s.id;
    }
    return false;
  };

  const updateShelter = async (
    s: Shelter,
    patch: { occupied?: number; status?: ShelterStatus; facilities?: Shelter['facilities'] }
  ) => {
    setUpdatingId(s.id);
    setError(null);
    try {
      await apiFetch(`/api/shelters/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update shelter.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.navShelters}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live relief camp capacity and facilities. Occupancy auto-marks camps as Full at 100% capacity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter shelters by district"
            value={districtFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
            className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-medium"
          >
            <option value="ALL">All Assam Districts</option>
            {DISTRICT_NAMES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
            {(['ALL', 'open', 'full', 'closed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`min-h-[34px] px-2.5 rounded-lg uppercase font-semibold ${
                  statusFilter === st
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No shelters match the selected filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => {
            const pct = Math.min(100, Math.round((s.occupied / Math.max(1, s.capacity)) * 100));
            const editable = canEditShelter(s);
            const busy = updatingId === s.id;

            return (
              <article
                key={s.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <Building2 className="w-3.5 h-3.5 text-sky-500 shrink-0" aria-hidden="true" />
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{s.district}</span>
                      </div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">{s.name}</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.address}</p>
                    </div>
                    <span
                      className={`text-xs font-bold uppercase shrink-0 ${
                        s.status === 'open'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : s.status === 'full'
                            ? 'text-orange-600 dark:text-orange-400'
                            : 'text-slate-500'
                      }`}
                    >
                      {s.status === 'open' ? t.open : s.status === 'full' ? t.full : t.closed}
                    </span>
                  </div>

                  {/* Capacity Bar */}
                  <div>
                    <div className="flex justify-between text-xs font-mono tabular-nums mb-1.5">
                      <span className="text-slate-700 dark:text-slate-300">
                        {s.occupied} / {s.capacity} beds
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">{pct}%</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          s.status === 'closed'
                            ? 'bg-slate-500'
                            : pct >= 100
                              ? 'bg-orange-500'
                              : pct >= 80
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Facilities */}
                  <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-400">
                    <span className={`inline-flex items-center gap-1 ${s.facilities.food ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'opacity-40'}`}>
                      <Utensils className="w-3.5 h-3.5" aria-hidden="true" /> Food
                    </span>
                    <span className={`inline-flex items-center gap-1 ${s.facilities.water ? 'text-sky-600 dark:text-sky-400 font-medium' : 'opacity-40'}`}>
                      <Droplets className="w-3.5 h-3.5" aria-hidden="true" /> Water
                    </span>
                    <span className={`inline-flex items-center gap-1 ${s.facilities.medical ? 'text-red-500 font-medium' : 'opacity-40'}`}>
                      <HeartPulse className="w-3.5 h-3.5" aria-hidden="true" /> Medical
                    </span>
                    <span className={`inline-flex items-center gap-1 ${s.facilities.power ? 'text-amber-500 font-medium' : 'opacity-40'}`}>
                      <Zap className="w-3.5 h-3.5" aria-hidden="true" /> Power
                    </span>
                  </div>

                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Lead: {s.assignedVolunteerName || s.contactName} ·{' '}
                    <a href={`tel:${s.contactPhone}`} className="font-mono text-sky-600 dark:text-sky-400 hover:underline">
                      {s.contactPhone}
                    </a>
                  </div>
                </div>

                {/* Live Edit Controls (only assigned volunteer or admin) */}
                {editable && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Update Occupancy
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy || s.occupied <= 0}
                          onClick={() => updateShelter(s, { occupied: Math.max(0, s.occupied - 5) })}
                          className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-300 dark:border-slate-700 flex items-center justify-center disabled:opacity-40"
                          aria-label="Decrease occupancy by 5"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || s.occupied <= 0}
                          onClick={() => updateShelter(s, { occupied: Math.max(0, s.occupied - 1) })}
                          className="min-h-[40px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-mono disabled:opacity-40"
                        >
                          -1
                        </button>
                        <button
                          type="button"
                          disabled={busy || s.occupied >= s.capacity}
                          onClick={() => updateShelter(s, { occupied: Math.min(s.capacity, s.occupied + 1) })}
                          className="min-h-[40px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-mono disabled:opacity-40"
                        >
                          +1
                        </button>
                        <button
                          type="button"
                          disabled={busy || s.occupied >= s.capacity}
                          onClick={() => updateShelter(s, { occupied: Math.min(s.capacity, s.occupied + 5) })}
                          className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-300 dark:border-slate-700 flex items-center justify-center disabled:opacity-40"
                          aria-label="Increase occupancy by 5"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Camp Status</span>
                      <select
                        aria-label={`Change status for ${s.name}`}
                        disabled={busy}
                        value={s.status}
                        onChange={(e) => updateShelter(s, { status: e.target.value as ShelterStatus })}
                        className="min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-semibold"
                      >
                        <option value="open">Open</option>
                        <option value="full">Full</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
