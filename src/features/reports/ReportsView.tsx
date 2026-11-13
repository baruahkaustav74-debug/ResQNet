import React, { useEffect, useState } from 'react';
import { Camera, CheckCircle2, CloudOff, LocateFixed, MapPin, XCircle } from 'lucide-react';
import { DISTRICT_NAMES, detectDistrictByPoint, getDistrictSeed } from '../../../shared/assamGeo';
import type { DisasterReport, DisasterType, LanguageCode, Severity } from '../../../shared/types';
import { DISASTER_TYPE_LABELS, TRANSLATIONS } from '../../i18n/translations';
import { SeverityIndicator } from '../../components/SeverityIndicator';
import { GooglePinPicker } from '../../components/GooglePinPicker';
import { apiFetch } from '../../lib/api';
import { useAppData } from '../auth/AuthContext';
import {
  compressImageFile,
  enqueueOfflineReport,
  listOfflineReports,
  type QueuedReportPayload,
} from '../offline/offlineQueue';

export const ReportsView: React.FC<{ lang: LanguageCode; lowDataMode: boolean }> = ({
  lang,
  lowDataMode,
}) => {
  const { user, reports, isOnline, refreshAll, refreshPendingCount, logOfflineAction } = useAppData();
  const t = TRANSLATIONS[lang];

  const canSubmit =
    user && (user.role === 'admin' || (user.role === 'volunteer' && user.status === 'active'));

  const [disasterType, setDisasterType] = useState<DisasterType>('flood');
  const [severity, setSeverity] = useState<Severity>('HIGH');
  const [peopleAffected, setPeopleAffected] = useState(25);
  const [urgentHelp, setUrgentHelp] = useState('');
  const [description, setDescription] = useState('');
  const [district, setDistrict] = useState(user?.district || 'Kamrup Metropolitan');
  const [coords, setCoords] = useState<{ lat: number; lng: number }>(() => {
    const seed = getDistrictSeed(user?.district || 'Kamrup Metropolitan');
    return { lat: seed?.lat || 26.1445, lng: seed?.lng || 91.7362 };
  });
  const [showMap, setShowMap] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queuedReports, setQueuedReports] = useState<QueuedReportPayload[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED'>('ALL');
  const [loadedPhotosMap, setLoadedPhotosMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (user?.district) {
      setDistrict(user.district);
      const seed = getDistrictSeed(user.district);
      if (seed) setCoords({ lat: seed.lat, lng: seed.lng });
    }
  }, [user?.district]);

  useEffect(() => {
    listOfflineReports().then(setQueuedReports).catch(() => {});
  }, [isOnline, reports.length]);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 3 - photos.length);
    if (files.length === 0) return;
    setCompressing(true);
    setError(null);
    try {
      const compressed = await Promise.all(files.map(compressImageFile));
      setPhotos((prev) => [...prev, ...compressed].slice(0, 3));
    } catch {
      setError('Failed to compress selected image.');
    } finally {
      setCompressing(false);
      e.target.value = '';
    }
  };

  const locateGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        if (user?.role === 'admin') {
          setDistrict(detectDistrictByPoint(lat, lng).district);
        }
      },
      () => setError('GPS unavailable; click on the map to drop a pin.')
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setNotice(null);

    if (description.trim().length < 10) {
      setError('Description must be at least 10 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (!navigator.onLine) {
        const localId = `rep-${Date.now()}`;
        const targetDistrict = user.role === 'volunteer' && user.district ? user.district : district;
        await enqueueOfflineReport({
          localId,
          district: targetDistrict,
          disasterType,
          severity,
          peopleAffected,
          urgentHelp: urgentHelp.trim() || 'Field support',
          description: description.trim(),
          lat: coords.lat,
          lng: coords.lng,
          compressedDataUrls: photos,
          queuedAt: Date.now(),
        });
        await logOfflineAction({
          actionType: 'REPORT_QUEUED',
          refLocalId: localId,
          title: `Queued ${severity} ${disasterType} report (${targetDistrict})`,
          detail: `${peopleAffected} affected · ${photos.length} photo(s) · ${description.trim().slice(0, 70)}`,
          district: targetDistrict,
          status: 'queued',
        });
        await refreshPendingCount();
        setQueuedReports(await listOfflineReports());
        setNotice('Offline: Report saved locally with Pending Sync badge. It will auto-upload when online.');
        setDescription('');
        setUrgentHelp('');
        setPhotos([]);
        return;
      }

      const photoUrls: string[] = [];
      for (const dataUrl of photos) {
        const up = await apiFetch<{ url: string }>('/api/uploads', {
          method: 'POST',
          body: JSON.stringify({ dataUrl }),
        });
        photoUrls.push(up.url);
      }

      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          district: user.role === 'volunteer' && user.district ? user.district : district,
          disasterType,
          severity,
          peopleAffected,
          urgentHelp: urgentHelp.trim() || 'Field support',
          description: description.trim(),
          lat: coords.lat,
          lng: coords.lng,
          photoUrls,
        }),
      });

      setNotice('Field report submitted for admin verification.');
      setDescription('');
      setUrgentHelp('');
      setPhotos([]);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (rep: DisasterReport, status: 'VERIFIED' | 'REJECTED') => {
    try {
      await apiFetch(`/api/reports/${rep.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review action failed.');
    }
  };

  const visibleReports = reports.filter((r) => statusFilter === 'ALL' || r.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Volunteer Submission Form */}
        <section className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">{t.submitReport}</h1>

          {!canSubmit ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {user?.role === 'volunteer' && user.status === 'pending'
                ? 'Your volunteer account is awaiting administrator approval before you can submit field reports.'
                : 'Field reports can only be submitted by approved district volunteers and administrators. Citizens can browse verified incident reports on the right.'}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Disaster Type
                  </label>
                  <select
                    value={disasterType}
                    onChange={(e) => setDisasterType(e.target.value as DisasterType)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                  >
                    {(['flood', 'landslide', 'storm', 'earthquake', 'fire', 'lightning'] as DisasterType[]).map((d) => (
                      <option key={d} value={d}>
                        {DISASTER_TYPE_LABELS[lang][d]}
                      </option>
                    ))}
                  </select>
                </div>
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    District
                  </label>
                  <select
                    value={district}
                    disabled={user.role === 'volunteer' && Boolean(user.district)}
                    onChange={(e) => setDistrict(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm disabled:opacity-60"
                  >
                    {DISTRICT_NAMES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    People Affected
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    value={peopleAffected}
                    onChange={(e) => setPeopleAffected(Number(e.target.value))}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Urgent Help Needed
                </label>
                <input
                  type="text"
                  value={urgentHelp}
                  onChange={(e) => setUrgentHelp(e.target.value)}
                  placeholder="Boats, tarpaulins, medical kit, clean water..."
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Field Description
                </label>
                <textarea
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Water depth, road blockage, affected wards..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-sm"
                />
              </div>

              {/* GPS / Pin */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    Pin: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={locateGps}
                      className="min-h-[36px] px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <LocateFixed className="w-3.5 h-3.5" /> GPS
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowMap((v) => !v)}
                      className="min-h-[36px] px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <MapPin className="w-3.5 h-3.5" /> {showMap ? 'Hide Map' : 'Map Pin'}
                    </button>
                  </div>
                </div>
                {showMap && (
                  <div className="h-44 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700">
                    <GooglePinPicker
                      lat={coords.lat}
                      lng={coords.lng}
                      pinColor="#F97316"
                      lowDataMode={lowDataMode}
                      isOnline={isOnline}
                      onPick={(lat, lng) => setCoords({ lat, lng })}
                    />
                  </div>
                )}
              </div>

              {/* Up to 3 photos compressed client-side */}
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Camera className="w-4 h-4" />
                  <span>
                    {compressing
                      ? 'Compressing...'
                      : `Attach Field Photos (${photos.length}/3)`}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={photos.length >= 3 || compressing}
                    onChange={handlePhotoSelect}
                    className="hidden"
                  />
                </label>
                {photos.length > 0 && (
                  <div className="flex gap-2">
                    {photos.map((src, i) => (
                      <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-700">
                        <img src={src} alt={`Upload preview ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                          className="absolute top-0.5 right-0.5 bg-black/70 text-white rounded-full w-5 h-5 text-[10px]"
                          aria-label="Remove photo"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-sm"
              >
                {submitting ? 'Submitting...' : isOnline ? t.submitReport : 'Queue Report Offline'}
              </button>
            </form>
          )}

          {/* Pending Offline Sync Queue */}
          {queuedReports.length > 0 && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400">
                <CloudOff className="w-4 h-4" aria-hidden="true" />
                <span>
                  {t.pendingSync} ({queuedReports.length})
                </span>
              </div>
              {queuedReports.map((q) => (
                <div
                  key={q.localId}
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-1"
                >
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {q.district} · {q.disasterType} · {q.severity}
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 truncate">{q.description}</p>
                  <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    {t.pendingSync} — auto-uploads when online
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right: Field Reports Feed & Admin Verification */}
        <section className="lg:col-span-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Field Reports ({visibleReports.length})
            </h2>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
              {(['ALL', 'SUBMITTED', 'VERIFIED', 'REJECTED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`min-h-[34px] px-2.5 rounded-lg font-medium transition-colors ${
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

          {visibleReports.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No reports match the current filter.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleReports.map((rep) => (
                <article
                  key={rep.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <SeverityIndicator severity={rep.severity} lang={lang} />
                      <span aria-hidden="true">·</span>
                      <span className="font-bold text-slate-900 dark:text-white">{rep.district}</span>
                      <span aria-hidden="true">·</span>
                      <span>{DISASTER_TYPE_LABELS[lang][rep.disasterType]}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{rep.peopleAffected} affected</span>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        rep.status === 'VERIFIED'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : rep.status === 'REJECTED'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {rep.status}
                    </span>
                  </div>

                  <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">{rep.description}</p>

                  <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                    <div>
                      Urgent Need: <span className="text-slate-700 dark:text-slate-300">{rep.urgentHelp}</span>
                    </div>
                    <div>
                      Reported by {rep.reporterName} · {new Date(rep.createdAt).toLocaleString()}
                      {rep.reviewedByName && rep.reviewedAt
                        ? ` · Reviewed by ${rep.reviewedByName} (${new Date(rep.reviewedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
                        : ''}
                    </div>
                  </div>

                  {rep.photoUrls.length > 0 && (
                    <div>
                      {lowDataMode && !loadedPhotosMap[rep.id] ? (
                        <button
                          type="button"
                          onClick={() => setLoadedPhotosMap((m) => ({ ...m, [rep.id]: true }))}
                          className="text-xs text-sky-600 dark:text-sky-400 underline"
                        >
                          Low-Data Mode: Tap to load {rep.photoUrls.length} field photo(s)
                        </button>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {rep.photoUrls.map((url, idx) => (
                            <img
                              key={idx}
                              src={url}
                              alt={`${rep.district} ${rep.disasterType} evidence ${idx + 1}`}
                              className="w-24 h-24 rounded-xl object-cover border border-slate-200 dark:border-slate-800"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {user?.role === 'admin' && rep.status === 'SUBMITTED' && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleReview(rep, 'VERIFIED')}
                        className="min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Verify Report
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReview(rep, 'REJECTED')}
                        className="min-h-[44px] px-4 rounded-xl border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
