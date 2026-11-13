import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, BarChart3, Filter } from 'lucide-react';
import { DISTRICT_NAMES } from '../../../shared/assamGeo';
import type { Severity, SosRequest } from '../../../shared/types';
import { useAppData } from '../auth/AuthContext';

type Granularity = 'daily' | 'weekly';
type StreamFilter = 'all' | 'sos' | 'reports';
type DistrictSplitMode = 'severity' | 'source';

interface UnifiedEvent {
  id: string;
  source: 'sos' | 'report';
  district: string;
  severity: Severity;
  createdAt: number;
  escalated?: boolean;
}

interface TrendBucket {
  key: string;
  label: string;
  startTs: number;
  endTs: number;
  CRITICAL: number;
  HIGH: number;
  MODERATE: number;
  LOW: number;
  sosCount: number;
  reportCount: number;
  total: number;
}

interface DistrictBucket {
  district: string;
  shortName: string;
  CRITICAL: number;
  HIGH: number;
  MODERATE: number;
  LOW: number;
  sosCount: number;
  reportCount: number;
  total: number;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MODERATE: '#eab308',
  LOW: '#10b981',
};

function mapSosSeverity(sos: SosRequest): Severity {
  if (sos.escalated || sos.status === 'NEW') return 'CRITICAL';
  if (sos.status === 'ACKNOWLEDGED' || sos.status === 'IN_PROGRESS') return 'HIGH';
  return 'LOW';
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfLocalWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sun
  const diffToMon = (day + 6) % 7;
  d.setDate(d.getDate() - diffToMon);
  return d.getTime();
}

function abbreviateDistrict(name: string): string {
  if (name === 'Kamrup Metropolitan') return 'Kamrup M.';
  if (name === 'South Salmara-Mankachar') return 'S. Salmara';
  if (name === 'West Karbi Anglong') return 'W. Karbi';
  return name.length > 13 ? `${name.slice(0, 12)}…` : name;
}

interface CustomTooltipPayloadItem {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string;
  payload?: TrendBucket | DistrictBucket;
}

const TrendsTooltip: React.FC<{
  active?: boolean;
  payload?: CustomTooltipPayloadItem[];
  label?: string;
}> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  const displayTitle =
    row && 'district' in row ? row.district : label || (row && 'label' in row ? row.label : '');

  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/95 text-slate-100 px-3.5 py-2.5 shadow-xl text-xs space-y-1.5 min-w-[180px]">
      <p className="font-bold text-white border-b border-slate-700/80 pb-1">{displayTitle}</p>
      {row && (
        <div className="flex items-center justify-between gap-4 text-[11px] font-mono text-slate-300 pb-1 border-b border-slate-800">
          <span className="text-sky-400">SOS: {row.sosCount}</span>
          <span className="text-purple-400">Reports: {row.reportCount}</span>
          <span className="text-white font-semibold">Total: {row.total}</span>
        </div>
      )}
      <div className="space-y-1">
        {(['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as Severity[]).map((sev) => {
          const val = row ? row[sev] : 0;
          if (!val) return null;
          return (
            <div key={sev} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: SEVERITY_COLORS[sev] }}
                />
                <span>{sev}</span>
              </span>
              <span className="font-mono font-semibold tabular-nums">{val}</span>
            </div>
          );
        })}
        {row && row.total === 0 && (
          <p className="text-slate-400 text-[11px]">No incidents recorded in this period.</p>
        )}
      </div>
    </div>
  );
};

export const AdminTrendsChart: React.FC = () => {
  const { sosList, reports } = useAppData();

  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [stream, setStream] = useState<StreamFilter>('all');
  const [districtFilter, setDistrictFilter] = useState<string>('ALL');
  const [districtSplitMode, setDistrictSplitMode] = useState<DistrictSplitMode>('severity');

  const allEvents = useMemo<UnifiedEvent[]>(() => {
    const sosEvents: UnifiedEvent[] = sosList.map((s) => ({
      id: `sos-${s.id}`,
      source: 'sos',
      district: s.district,
      severity: mapSosSeverity(s),
      createdAt: s.createdAt,
      escalated: s.escalated,
    }));
    const reportEvents: UnifiedEvent[] = reports.map((r) => ({
      id: `rep-${r.id}`,
      source: 'report',
      district: r.district,
      severity: r.severity,
      createdAt: r.createdAt,
    }));
    return [...sosEvents, ...reportEvents];
  }, [sosList, reports]);

  const activeDistrictsInEvents = useMemo(() => {
    const set = new Set(allEvents.map((e) => e.district));
    const ordered = DISTRICT_NAMES.filter((d) => set.has(d));
    const rest = DISTRICT_NAMES.filter((d) => !set.has(d));
    return { active: ordered, all: [...ordered, ...rest] };
  }, [allEvents]);

  const filteredEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (stream === 'sos' && e.source !== 'sos') return false;
      if (stream === 'reports' && e.source !== 'report') return false;
      if (districtFilter !== 'ALL' && e.district !== districtFilter) return false;
      return true;
    });
  }, [allEvents, stream, districtFilter]);

  const timeBuckets = useMemo<TrendBucket[]>(() => {
    const now = Date.now();
    const buckets: TrendBucket[] = [];

    if (granularity === 'daily') {
      const days = 14;
      const todayStart = startOfLocalDay(now);
      for (let i = days - 1; i >= 0; i--) {
        const startTs = todayStart - i * 24 * 3600 * 1000;
        const endTs = startTs + 24 * 3600 * 1000;
        const label =
          i === 0
            ? 'Today'
            : new Date(startTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        buckets.push({
          key: `d-${startTs}`,
          label,
          startTs,
          endTs,
          CRITICAL: 0,
          HIGH: 0,
          MODERATE: 0,
          LOW: 0,
          sosCount: 0,
          reportCount: 0,
          total: 0,
        });
      }
    } else {
      const weeks = 6;
      const thisWeekStart = startOfLocalWeek(now);
      for (let i = weeks - 1; i >= 0; i--) {
        const startTs = thisWeekStart - i * 7 * 24 * 3600 * 1000;
        const endTs = startTs + 7 * 24 * 3600 * 1000;
        const label =
          i === 0
            ? 'This Wk'
            : `Wk ${new Date(startTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
        buckets.push({
          key: `w-${startTs}`,
          label,
          startTs,
          endTs,
          CRITICAL: 0,
          HIGH: 0,
          MODERATE: 0,
          LOW: 0,
          sosCount: 0,
          reportCount: 0,
          total: 0,
        });
      }
    }

    for (const ev of filteredEvents) {
      const bucket = buckets.find((b) => ev.createdAt >= b.startTs && ev.createdAt < b.endTs);
      if (!bucket) continue;
      bucket[ev.severity] += 1;
      if (ev.source === 'sos') bucket.sosCount += 1;
      else bucket.reportCount += 1;
      bucket.total += 1;
    }

    return buckets;
  }, [filteredEvents, granularity]);

  const districtBuckets = useMemo<DistrictBucket[]>(() => {
    const windowDays = granularity === 'daily' ? 14 : 42;
    const cutoff = Date.now() - windowDays * 24 * 3600 * 1000;
    const map = new Map<string, DistrictBucket>();

    for (const ev of filteredEvents) {
      if (ev.createdAt < cutoff) continue;
      let b = map.get(ev.district);
      if (!b) {
        b = {
          district: ev.district,
          shortName: abbreviateDistrict(ev.district),
          CRITICAL: 0,
          HIGH: 0,
          MODERATE: 0,
          LOW: 0,
          sosCount: 0,
          reportCount: 0,
          total: 0,
        };
        map.set(ev.district, b);
      }
      b[ev.severity] += 1;
      if (ev.source === 'sos') b.sosCount += 1;
      else b.reportCount += 1;
      b.total += 1;
    }

    return Array.from(map.values())
      .sort((a, b) => b.total - a.total || b.CRITICAL - a.CRITICAL)
      .slice(0, 8);
  }, [filteredEvents, granularity]);

  const summary = useMemo(() => {
    const windowDays = granularity === 'daily' ? 14 : 42;
    const cutoff = Date.now() - windowDays * 24 * 3600 * 1000;
    const scoped = filteredEvents.filter((e) => e.createdAt >= cutoff);
    const totalSos = scoped.filter((e) => e.source === 'sos').length;
    const escalatedSos = scoped.filter((e) => e.source === 'sos' && e.escalated).length;
    const totalReports = scoped.filter((e) => e.source === 'report').length;
    const highUrgency = scoped.filter((e) => e.severity === 'CRITICAL' || e.severity === 'HIGH').length;
    const highShare = scoped.length > 0 ? Math.round((highUrgency / scoped.length) * 100) : 0;
    const peakDistrict = districtBuckets[0]?.district || 'None';
    const peakCount = districtBuckets[0]?.total || 0;

    return {
      totalSos,
      escalatedSos,
      totalReports,
      highUrgency,
      highShare,
      peakDistrict,
      peakCount,
      totalEvents: scoped.length,
    };
  }, [filteredEvents, districtBuckets, granularity]);

  return (
    <section
      aria-labelledby="admin-trends-heading"
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5"
    >
      {/* Header + Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-start gap-2.5">
          <BarChart3 className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 id="admin-trends-heading" className="text-base font-bold text-slate-900 dark:text-white">
              SOS &amp; Incident Trends Analytics
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live daily &amp; weekly SOS dispatches and incident reports categorized by Assam district and severity.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Granularity Toggle */}
          <div
            role="group"
            aria-label="Timeframe granularity"
            className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs"
          >
            <button
              type="button"
              onClick={() => setGranularity('daily')}
              className={`min-h-[36px] px-3 rounded-lg font-semibold transition-colors ${
                granularity === 'daily'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Daily (14d)
            </button>
            <button
              type="button"
              onClick={() => setGranularity('weekly')}
              className={`min-h-[36px] px-3 rounded-lg font-semibold transition-colors ${
                granularity === 'weekly'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Weekly (6w)
            </button>
          </div>

          {/* Stream Filter */}
          <select
            aria-label="Filter incident stream"
            value={stream}
            onChange={(e) => setStream(e.target.value as StreamFilter)}
            className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-medium text-slate-800 dark:text-slate-200"
          >
            <option value="all">All (SOS + Reports)</option>
            <option value="sos">SOS Calls Only</option>
            <option value="reports">Incident Reports Only</option>
          </select>

          {/* District Filter */}
          <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 min-h-[40px]">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <select
              aria-label="Filter by Assam district"
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none max-w-[170px]"
            >
              <option value="ALL">All Districts ({activeDistrictsInEvents.active.length} active)</option>
              {activeDistrictsInEvents.all.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            SOS Calls ({granularity === 'daily' ? '14d' : '6w'})
          </p>
          <p className="text-2xl font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-1">
            {summary.totalSos}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {summary.escalatedSos} escalated
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Incident Reports ({granularity === 'daily' ? '14d' : '6w'})
          </p>
          <p className="text-2xl font-bold font-mono tabular-nums text-purple-600 dark:text-purple-400 mt-1">
            {summary.totalReports}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {summary.totalEvents} total events
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Critical + High Share
          </p>
          <p className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400 mt-1">
            {summary.highShare}%
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {summary.highUrgency} high-urgency events
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Highest Volume District
          </p>
          <p className="text-base font-bold text-slate-900 dark:text-white mt-1.5 truncate">
            {summary.peakDistrict}
          </p>
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            {summary.peakCount} SOS + reports
          </p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Chart 1: Daily / Weekly Trend by Severity + SOS vs Reports Lines */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>
                  {granularity === 'daily' ? 'Daily Trend (Last 14 Days)' : 'Weekly Trend (Last 6 Weeks)'}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Stacked by severity with SOS vs. Incident Report trajectories
              </p>
            </div>
          </div>

          <div className="w-full h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeBuckets} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" strokeOpacity={0.25} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={{ stroke: '#475569', strokeOpacity: 0.4 }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<TrendsTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="CRITICAL" name="Critical" stackId="sev" fill={SEVERITY_COLORS.CRITICAL} radius={[0, 0, 0, 0]} />
                <Bar dataKey="HIGH" name="High" stackId="sev" fill={SEVERITY_COLORS.HIGH} />
                <Bar dataKey="MODERATE" name="Moderate" stackId="sev" fill={SEVERITY_COLORS.MODERATE} />
                <Bar dataKey="LOW" name="Low" stackId="sev" fill={SEVERITY_COLORS.LOW} radius={[4, 4, 0, 0]} />
                {stream !== 'reports' && (
                  <Line
                    type="monotone"
                    dataKey="sosCount"
                    name="SOS Calls"
                    stroke="#38bdf8"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#38bdf8' }}
                    activeDot={{ r: 5 }}
                  />
                )}
                {stream !== 'sos' && (
                  <Line
                    type="monotone"
                    dataKey="reportCount"
                    name="Incident Reports"
                    stroke="#a855f7"
                    strokeWidth={2.5}
                    strokeDasharray="4 3"
                    dot={{ r: 3, fill: '#a855f7' }}
                    activeDot={{ r: 5 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: District Categorization by Severity or SOS vs Reports */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                District Breakdown ({granularity === 'daily' ? '14 Days' : '6 Weeks'})
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Top active districts categorized by {districtSplitMode === 'severity' ? 'severity' : 'SOS vs. reports'}
              </p>
            </div>

            <div className="inline-flex rounded-lg bg-slate-200/80 dark:bg-slate-800 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setDistrictSplitMode('severity')}
                className={`min-h-[30px] px-2.5 rounded-md font-semibold ${
                  districtSplitMode === 'severity'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                By Severity
              </button>
              <button
                type="button"
                onClick={() => setDistrictSplitMode('source')}
                className={`min-h-[30px] px-2.5 rounded-md font-semibold ${
                  districtSplitMode === 'source'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                SOS vs Reports
              </button>
            </div>
          </div>

          {districtBuckets.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              No SOS calls or incident reports match the current district/stream filter.
            </div>
          ) : (
            <div className="w-full h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={districtBuckets} margin={{ top: 8, right: 10, left: -18, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" strokeOpacity={0.25} />
                  <XAxis
                    dataKey="shortName"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={{ stroke: '#475569', strokeOpacity: 0.4 }}
                    tickLine={false}
                    interval={0}
                    angle={districtBuckets.length > 5 ? -20 : 0}
                    textAnchor={districtBuckets.length > 5 ? 'end' : 'middle'}
                    height={districtBuckets.length > 5 ? 46 : 30}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<TrendsTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                  {districtSplitMode === 'severity' ? (
                    <>
                      <Bar dataKey="CRITICAL" name="Critical" stackId="dsev" fill={SEVERITY_COLORS.CRITICAL} />
                      <Bar dataKey="HIGH" name="High" stackId="dsev" fill={SEVERITY_COLORS.HIGH} />
                      <Bar dataKey="MODERATE" name="Moderate" stackId="dsev" fill={SEVERITY_COLORS.MODERATE} />
                      <Bar dataKey="LOW" name="Low" stackId="dsev" fill={SEVERITY_COLORS.LOW} radius={[4, 4, 0, 0]} />
                    </>
                  ) : (
                    <>
                      <Bar dataKey="sosCount" name="SOS Calls" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="reportCount" name="Incident Reports" fill="#a855f7" radius={[4, 4, 0, 0]} />
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        SOS severity classification: New / Escalated → Critical · Acknowledged / In Progress → High · Resolved → Low. Incident reports use their assigned severity. Updates live as new alerts arrive.
      </p>
    </section>
  );
};
