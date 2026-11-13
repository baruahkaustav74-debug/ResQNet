import React, { useMemo } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  Building2,
  CloudRain,
  Compass,
  FileWarning,
  Navigation,
  PhoneCall,
  Radio,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { SEVERITY_RANK, OFFICIAL_EMERGENCY_NUMBERS, type LanguageCode, type Severity, type SosRequest } from '../../../shared/types';
import { DISASTER_TYPE_LABELS, TRANSLATIONS } from '../../i18n/translations';
import { SeverityIndicator } from '../../components/SeverityIndicator';
import { useAppData } from '../auth/AuthContext';
import { apiFetch } from '../../lib/api';
import heroImg from '../../assets/images/assam_command_hero_1794555485122.jpg';
import shelterImg from '../../assets/images/assam_relief_shelter_1794555485404.jpg';

interface DashboardViewProps {
  lang: LanguageCode;
  lowDataMode: boolean;
  onNavigate: (
    tab: 'dashboard' | 'map' | 'sos' | 'shelters' | 'reports' | 'alerts' | 'admin' | 'notifications'
  ) => void;
  onOpenAuth: (tab?: 'login' | 'register' | 'demo' | 'bootstrap') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  lang,
  lowDataMode,
  onNavigate,
  onOpenAuth,
}) => {
  const { user, hasAdmin, shelters, reports, sosList, alerts, weather, dataLoading, dataError, refreshAll } =
    useAppData();
  const t = TRANSLATIONS[lang];

  const now = Date.now();
  const activeAlerts = alerts.filter((a) => a.expiresAt > now);
  const visibleReports = reports.filter((r) => r.status !== 'REJECTED');

  const severityCounts: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MODERATE: 0,
    LOW: 0,
  };
  for (const r of visibleReports) {
    severityCounts[r.severity] += 1;
  }
  for (const s of sosList) {
    if (s.status !== 'RESOLVED') severityCounts.CRITICAL += 1;
  }

  // Top affected Assam districts summary
  const districtHotspots = useMemo(() => {
    const map = new Map<
      string,
      { district: string; severity: Severity; reports: number; affected: number; openBeds: number }
    >();

    for (const r of visibleReports) {
      const cur = map.get(r.district) || {
        district: r.district,
        severity: r.severity,
        reports: 0,
        affected: 0,
        openBeds: 0,
      };
      cur.reports += 1;
      cur.affected += r.peopleAffected;
      if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[cur.severity]) {
        cur.severity = r.severity;
      }
      map.set(r.district, cur);
    }

    for (const s of shelters) {
      if (s.status === 'open') {
        const cur = map.get(s.district);
        if (cur) {
          cur.openBeds += Math.max(0, s.capacity - s.occupied);
        }
      }
    }

    return Array.from(map.values())
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.affected - a.affected)
      .slice(0, 6);
  }, [visibleReports, shelters]);

  const totalOpenBeds = shelters
    .filter((s) => s.status === 'open')
    .reduce((acc, s) => acc + Math.max(0, s.capacity - s.occupied), 0);

  const myShelter = user?.assignedShelterId
    ? shelters.find((s) => s.id === user.assignedShelterId) ||
      shelters.find((s) => s.assignedVolunteerId === user.id)
    : shelters.find((s) => s.district === (user?.district || 'Kamrup Metropolitan') && s.status === 'open') ||
      shelters.find((s) => s.status === 'open');

  const activeSosInbox = sosList.filter((s) => s.status !== 'RESOLVED').slice(0, 5);

  const handleQuickSosAction = async (sos: SosRequest, nextStatus: 'ACKNOWLEDGED' | 'IN_PROGRESS') => {
    try {
      await apiFetch(`/api/sos/${sos.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch {
      // Errors handled on SOS view
    }
  };

  if (dataLoading && shelters.length === 0) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800/70" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-200 dark:bg-slate-800/70" />
          ))}
        </div>
      </div>
    );
  }

  if (dataError && shelters.length === 0) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">{dataError}</p>
        <button
          type="button"
          onClick={refreshAll}
          className="min-h-[44px] px-5 rounded-xl bg-red-600 text-white text-sm font-semibold"
        >
          Retry Sync
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Split Documentary Command Hero */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-sky-600 dark:text-sky-400">Assam State Disaster Network</span>
              <span aria-hidden="true">·</span>
              <span>35 Districts</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{totalOpenBeds} Shelter Beds Open</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white text-balance leading-tight">
              {t.tagline}
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              {user
                ? `Active session: ${user.name} (${user.role.toUpperCase()}) · ${user.district || 'Assam'}. Real-time SOS routing, shelter capacity, and district alerts are synchronized.`
                : 'Coordinate flood, landslide, and storm response across all 35 districts of Assam. Trigger GPS-verified SOS alerts, locate open relief camps, or inspect verified field intelligence.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('sos')}
              className="min-h-[48px] px-5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm inline-flex items-center gap-2 shadow-sm transition-colors whitespace-nowrap"
            >
              <AlertOctagon className="w-5 h-5" aria-hidden="true" />
              <span>{t.sosButton}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('map')}
              className="min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold text-sm inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <Compass className="w-4 h-4" aria-hidden="true" />
              <span>{t.navMap}</span>
            </button>
            {!user && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuth('demo')}
                  className="min-h-[48px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Users className="w-4 h-4" aria-hidden="true" />
                  <span>Try Demo Mode</span>
                </button>
                {!hasAdmin && (
                  <button
                    type="button"
                    onClick={() => onOpenAuth('bootstrap')}
                    className="min-h-[48px] px-4 rounded-xl border border-sky-500/40 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 font-semibold text-sm whitespace-nowrap transition-colors"
                  >
                    Initialize First Admin
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 relative min-h-[220px] lg:min-h-full bg-slate-900 overflow-hidden">
          {!lowDataMode ? (
            <img
              src={heroImg}
              alt="Assam Brahmaputra river rescue boat and relief staging camp at dusk"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center p-6 text-xs text-slate-400">
              Low-Data Mode — Imagery paused
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-5 text-white">
            <p className="text-xs font-mono text-sky-300">24x7 RESPONSE NETWORK</p>
            <p className="text-sm font-bold mt-0.5">
              Point-in-polygon SOS routing &amp; 5-minute cross-district escalation
            </p>
          </div>
        </div>
      </section>

      {/* Live Severity Counts */}
      <section aria-label="Live incident severity counts" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(
          [
            { key: 'CRITICAL' as Severity, count: severityCounts.CRITICAL, color: 'text-red-600 dark:text-red-400', label: t.critical },
            { key: 'HIGH' as Severity, count: severityCounts.HIGH, color: 'text-orange-600 dark:text-orange-400', label: t.high },
            { key: 'MODERATE' as Severity, count: severityCounts.MODERATE, color: 'text-amber-600 dark:text-amber-400', label: t.moderate },
            { key: 'LOW' as Severity, count: severityCounts.LOW, color: 'text-emerald-600 dark:text-emerald-400', label: t.low },
          ]
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onNavigate('reports')}
            className="text-left rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 p-4 sm:p-5 flex flex-col justify-between transition-colors"
          >
            <SeverityIndicator severity={item.key} lang={lang} />
            <div className="mt-3 flex items-baseline justify-between">
              <span className={`text-3xl font-bold font-mono tabular-nums ${item.color}`}>
                {item.count}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <span>{item.label}</span>
                <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </span>
            </div>
          </button>
        ))}
      </section>

      {/* Assam District Hotspot Strip */}
      {districtHotspots.length > 0 && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Active Assam District Situation
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Highest-priority districts ranked by active field severity and population impacted.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('map')}
              className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
            >
              Full 35-District Map
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {districtHotspots.map((d) => (
              <button
                key={d.district}
                type="button"
                onClick={() => onNavigate('map')}
                className="text-left rounded-xl border border-slate-200 dark:border-slate-800 hover:border-sky-500/40 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{d.district}</p>
                  <SeverityIndicator severity={d.severity} lang={lang} />
                </div>
                <div className="text-right text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">
                  <div>{d.reports} report(s)</div>
                  <div>{d.affected} affected</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Main 3-Column Operational Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Volunteer SOS Inbox + Recent Reports */}
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-red-500" aria-hidden="true" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {user?.role === 'viewer' ? 'My Active SOS Requests' : t.sosInbox}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('sos')}
                className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline min-h-[36px] px-2"
              >
                Open SOS Desk
              </button>
            </div>

            {!user ? (
              <div className="p-6 text-sm text-slate-600 dark:text-slate-400 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <span>Sign in or launch Demo Mode to send an SOS or manage district dispatches.</span>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenAuth('demo')}
                    className="min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                  >
                    Demo Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="min-h-[44px] px-4 rounded-xl bg-sky-600 text-white text-xs font-semibold"
                  >
                    {t.signIn}
                  </button>
                </div>
              </div>
            ) : activeSosInbox.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                No active unresolved SOS alerts in your scope right now.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {activeSosInbox.map((sos) => (
                  <div key={sos.id} className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-red-600 dark:text-red-400">{sos.status.replace('_', ' ')}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{sos.district}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {new Date(sos.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {sos.escalated && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-orange-500">Escalated</span>
                          </>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {sos.userName} — {sos.note || 'Emergency rescue requested'}
                      </p>
                      {sos.phone && (
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          Tel: {sos.phone}
                          {sos.lat !== null && sos.lng !== null ? ` · ${sos.lat.toFixed(4)}, ${sos.lng.toFixed(4)}` : ''}
                        </p>
                      )}
                    </div>

                    {(user.role === 'volunteer' || user.role === 'admin') && user.status === 'active' && (
                      <div className="flex items-center gap-2 shrink-0">
                        {sos.status === 'NEW' && (
                          <button
                            type="button"
                            onClick={() => handleQuickSosAction(sos, 'ACKNOWLEDGED')}
                            className="min-h-[44px] px-3.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold whitespace-nowrap"
                          >
                            Acknowledge
                          </button>
                        )}
                        {sos.status === 'ACKNOWLEDGED' && (
                          <button
                            type="button"
                            onClick={() => handleQuickSosAction(sos, 'IN_PROGRESS')}
                            className="min-h-[44px] px-3.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold whitespace-nowrap"
                          >
                            Dispatch Team
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent Field Reports */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileWarning className="w-4 h-4 text-orange-500" aria-hidden="true" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.recentReports}</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline min-h-[36px] px-2"
              >
                View All ({visibleReports.length})
              </button>
            </div>
            {visibleReports.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400">No verified reports yet.</div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {visibleReports.slice(0, 5).map((r) => (
                  <div key={r.id} className="p-4 sm:px-5 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <SeverityIndicator severity={r.severity} lang={lang} />
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{r.district}</span>
                        <span aria-hidden="true">·</span>
                        <span>{DISASTER_TYPE_LABELS[lang][r.disasterType]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{r.status}</span>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {r.peopleAffected} affected
                      </span>
                    </div>
                    <p className="text-sm text-slate-800 dark:text-slate-200">{r.description}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Urgent need: {r.urgentHelp} · By {r.reporterName}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: My Shelter + Weather Watch + Active Alerts + Helplines */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {!lowDataMode && (
              <div className="h-32 w-full bg-slate-800 overflow-hidden relative">
                <img
                  src={shelterImg}
                  alt="Organized relief shelter camp with medical aid and clean drinking water"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              </div>
            )}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-sky-500" aria-hidden="true" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {user?.assignedShelterId ? t.myShelter : t.nearestShelter}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('shelters')}
                  className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                >
                  All Shelters
                </button>
              </div>

              {myShelter ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{myShelter.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {myShelter.district} · {myShelter.address}
                    </p>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-mono tabular-nums mb-1.5">
                      <span className="text-slate-600 dark:text-slate-300">
                        {myShelter.occupied} / {myShelter.capacity} occupied
                      </span>
                      <span
                        className={`font-semibold uppercase ${
                          myShelter.status === 'open'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : myShelter.status === 'full'
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {myShelter.status}
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          myShelter.occupied >= myShelter.capacity ? 'bg-orange-500' : 'bg-emerald-500'
                        }`}
                        style={{
                          width: `${Math.min(100, Math.round((myShelter.occupied / Math.max(1, myShelter.capacity)) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('map')}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
                  >
                    <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Route on Disaster Map</span>
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">No shelter data available.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden="true" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.navAlerts}</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('alerts')}
                className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
              >
                View All ({activeAlerts.length})
              </button>
            </div>
            {activeAlerts.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No active warnings.</p>
            ) : (
              <div className="space-y-3">
                {activeAlerts.slice(0, 3).map((al) => (
                  <div
                    key={al.id}
                    className="pt-2 border-t first:border-t-0 first:pt-0 border-slate-100 dark:border-slate-800"
                  >
                    <SeverityIndicator severity={al.severity} lang={lang} />
                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{al.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{al.districts.join(', ')}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CloudRain className="w-4 h-4 text-sky-500" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.weatherWatch}</h2>
            </div>
            <div className="space-y-2.5">
              {weather.slice(0, 4).map((w) => (
                <div
                  key={w.district}
                  className="flex items-center justify-between text-xs py-1.5 border-b last:border-b-0 border-slate-100 dark:border-slate-800"
                >
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{w.district}</p>
                    <p className="text-slate-500 dark:text-slate-400">{w.advisoryLevel}</p>
                  </div>
                  <div className="text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    <div>{w.rain24hMm}mm / 24h</div>
                    <div className="text-slate-500 dark:text-slate-400">{w.temperatureC}°C</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2.5">
            <div className="flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-red-500" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.emergencyNumbers}</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {OFFICIAL_EMERGENCY_NUMBERS.map((num) => (
                <a
                  key={num.number}
                  href={`tel:${num.number}`}
                  className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-800 hover:border-red-500/50 px-3 py-2 flex flex-col justify-center transition-colors"
                >
                  <span className="text-sm font-bold font-mono text-red-600 dark:text-red-400">{num.number}</span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{num.label}</span>
                </a>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
