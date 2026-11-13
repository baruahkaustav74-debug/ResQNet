import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  LocateFixed,
  MapPin,
  MessageSquareShare,
  PhoneCall,
  ShieldAlert,
  BellRing,
} from 'lucide-react';
import { detectDistrictByPoint, getDistrictSeed } from '../../../shared/assamGeo';
import { OFFICIAL_EMERGENCY_NUMBERS, type LanguageCode, type SosRequest, type SosStatus } from '../../../shared/types';
import { TRANSLATIONS } from '../../i18n/translations';
import { apiFetch } from '../../lib/api';
import { useAppData } from '../auth/AuthContext';
import { GooglePinPicker } from '../../components/GooglePinPicker';
import { enqueueOfflineSos, listOfflineSos, type QueuedSosPayload } from '../offline/offlineQueue';

const SOS_STEPS: SosStatus[] = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED'];

export const SosView: React.FC<{
  lang: LanguageCode;
  lowDataMode: boolean;
  onOpenAuth: () => void;
}> = ({ lang, lowDataMode, onOpenAuth }) => {
  const { user, sosList, isOnline, refreshPendingCount, refreshAll, logOfflineAction } = useAppData();
  const t = TRANSLATIONS[lang];

  const [phone, setPhone] = useState(user?.phone || '');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number | null; source: 'gps' | 'pin' }>(() => {
    const seed = getDistrictSeed(user?.district || 'Kamrup Metropolitan');
    return { lat: seed?.lat || 26.1445, lng: seed?.lng || 91.7362, accuracy: null, source: 'pin' };
  });
  const [showPinMap, setShowPinMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [queuedSos, setQueuedSos] = useState<QueuedSosPayload[]>([]);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    if (user?.phone && !phone) setPhone(user.phone);
  }, [user?.phone, phone]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    listOfflineSos().then(setQueuedSos).catch(() => {});
  }, [isOnline, sosList.length]);

  const detected = detectDistrictByPoint(coords.lat, coords.lng);

  const fetchBestGps = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError('GPS not supported on this device. Use the Map Pin fallback below.');
      setShowPinMap(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 25),
          source: 'gps',
        });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setError(`GPS unavailable (${err.message}). Drop a map pin below as fallback.`);
        setShowPinMap(true);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy || 25),
            source: 'gps',
          });
        },
        () => {
          // Keep district centroid pin fallback silently until user interacts
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }
  }, []);

  const normalizedDigits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  const phoneValid = /^[6-9]\d{9}$/.test(normalizedDigits);

  const smsHref = `sms:112?body=${encodeURIComponent(
    `SOS EMERGENCY (${detected.district}, Assam). Phone: ${normalizedDigits || 'N/A'}. Location: https://maps.google.com/?q=${coords.lat.toFixed(5)},${coords.lng.toFixed(5)} Note: ${note || 'Immediate rescue needed'}`
  )}`;

  const handleSendSos = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (!navigator.onLine) {
      await logOfflineAction({
        actionType: 'SOS_PRESS',
        title: `SOS button pressed (${detected.district})`,
        detail: `Coords ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} · Note: ${note.trim() || 'Emergency alert'}`,
        district: detected.district,
        status: 'logged',
      });
    }

    if (!user) {
      onOpenAuth();
      return;
    }
    if (!consent) {
      setError('Please confirm emergency location & phone sharing consent before sending SOS.');
      return;
    }
    if (!phoneValid) {
      setError('Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      return;
    }

    setSubmitting(true);
    try {
      if (!navigator.onLine) {
        const localId = `sos-${Date.now()}`;
        await enqueueOfflineSos({
          localId,
          consent: true,
          phone: normalizedDigits,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
          locationSource: coords.source,
          note: note.trim(),
          detectedDistrict: detected.district,
          queuedAt: Date.now(),
        });
        await logOfflineAction({
          actionType: 'SOS_QUEUED',
          refLocalId: localId,
          title: `Queued SOS dispatch (${detected.district})`,
          detail: `Phone ${normalizedDigits} · ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
          district: detected.district,
          status: 'queued',
        });
        await refreshPendingCount();
        setQueuedSos(await listOfflineSos());
        setFeedback('You are offline. SOS logged & queued for auto-sync — use the "Send via SMS" button below immediately.');
        setNote('');
        return;
      }

      const res = await apiFetch<{ sos: SosRequest }>('/api/sos', {
        method: 'POST',
        body: JSON.stringify({
          consent: true,
          phone: normalizedDigits,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
          locationSource: coords.source,
          note: note.trim(),
        }),
      });
      setFeedback(
        res.sos.escalated
          ? `SOS dispatched and auto-escalated to state command & nearby districts (no volunteer currently assigned in ${res.sos.district}).`
          : `SOS routed in real time to ${res.sos.district} volunteers.`
      );
      setNote('');
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send SOS.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusUpdate = async (sosId: string, nextStatus: SosStatus) => {
    setError(null);
    try {
      await apiFetch(`/api/sos/${sosId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update SOS status.');
    }
  };

  const enableBrowserNotifications = async () => {
    if ('Notification' in window) {
      await Notification.requestPermission();
    }
  };

  return (
    <div className="space-y-6">
      {/* Always-available Official Emergency Bar */}
      <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-bold text-red-700 dark:text-red-300">{t.emergencyNumbers}</p>
          <p className="text-xs text-red-700/80 dark:text-red-200/80">
            Tap any number for immediate voice dispatch if life-threatening or internet drops.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {OFFICIAL_EMERGENCY_NUMBERS.map((item) => (
            <a
              key={item.number}
              href={`tel:${item.number}`}
              className="min-h-[44px] px-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {item.number} · {item.label.split(' ')[0]}
              </span>
            </a>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* SOS Trigger Panel */}
        <section className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Emergency SOS Dispatch</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.sosSubtitle}</p>
          </div>

          {!user && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2.5">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Sign in so volunteers can track your live SOS status and protect your phone &amp; GPS privacy.
              </p>
              <button
                type="button"
                onClick={onOpenAuth}
                className="min-h-[44px] px-4 rounded-xl bg-amber-600 text-white text-xs font-semibold"
              >
                {t.signIn} / Demo Mode
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {feedback && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
              {feedback}
            </div>
          )}

          <form onSubmit={handleSendSos} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Indian Mobile Number (10 digits, starts 6–9)
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9864012345"
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm font-mono"
              />
              {phone && !phoneValid && (
                <p className="mt-1 text-xs text-red-500">Must be 10 digits starting with 6, 7, 8, or 9.</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Detected District: </span>
                  <strong className="text-slate-900 dark:text-white">{detected.district}</strong>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {coords.source.toUpperCase()}
                  {coords.accuracy ? ` ±${coords.accuracy}m` : ''}
                </span>
              </div>
              <p className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={fetchBestGps}
                  disabled={locating}
                  className="min-h-[40px] px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <LocateFixed className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{locating ? 'Getting GPS...' : 'Refresh GPS Fix'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPinMap((v) => !v)}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{showPinMap ? 'Hide Pin Map' : 'Adjust Map Pin'}</span>
                </button>
              </div>

              {showPinMap && (
                <div className="h-48 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700">
                  <GooglePinPicker
                    lat={coords.lat}
                    lng={coords.lng}
                    pinColor="#EF4444"
                    lowDataMode={lowDataMode}
                    isOnline={isOnline}
                    onPick={(lat, lng) => {
                      setCoords({ lat, lng, accuracy: null, source: 'pin' });
                      if (!navigator.onLine) {
                        logOfflineAction({
                          actionType: 'PIN_ADJUSTED',
                          title: `Updated offline SOS pin (${detectDistrictByPoint(lat, lng).district})`,
                          detail: `Pin moved to ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                          district: detectDistrictByPoint(lat, lng).district,
                          status: 'logged',
                        }).catch(() => {});
                      }
                    }}
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Situation / People Trapped / Medical Needs
              </label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g., 4 people on roof, rising water, infant needs medical support"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-sm"
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded accent-red-600 shrink-0"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                I consent to share my phone number and live coordinates with assigned {detected.district} rescue volunteers and emergency administrators.
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[60px] rounded-2xl bg-red-600 hover:bg-red-500 active:scale-[0.99] disabled:opacity-60 text-white font-extrabold text-base tracking-wide flex items-center justify-center gap-2.5 shadow-lg shadow-red-600/20 transition-all"
            >
              <AlertOctagon className="w-6 h-6" aria-hidden="true" />
              <span>{submitting ? 'DISPATCHING...' : t.sosButton}</span>
            </button>

            {/* Offline SMS Fallback */}
            <a
              href={smsHref}
              onClick={() => {
                if (!navigator.onLine) {
                  logOfflineAction({
                    actionType: 'SOS_SMS_FALLBACK',
                    title: `SMS SOS fallback opened (${detected.district})`,
                    detail: `Prepared SMS to 112 with location ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
                    district: detected.district,
                    status: 'logged',
                  }).catch(() => {});
                }
              }}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-2"
            >
              <MessageSquareShare className="w-4 h-4" aria-hidden="true" />
              <span>Offline Fallback: Send SOS via SMS with Map Link</span>
            </a>
          </form>

          {queuedSos.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              {queuedSos.length} SOS request(s) queued offline ({t.pendingSync}). Will auto-send when connection restores.
            </div>
          )}
        </section>

        {/* Live SOS Feed / Volunteer Dispatch / Status Tracker */}
        <section className="lg:col-span-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {user?.role === 'volunteer' || user?.role === 'admin'
                  ? `Live SOS Dispatch (${user.role === 'admin' ? 'All Districts' : user.district})`
                  : 'My SOS Status Tracker'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Unacknowledged SOS alerts auto-escalate after 5 minutes to admins and neighboring districts.
              </p>
            </div>
            {(user?.role === 'volunteer' || user?.role === 'admin') &&
              typeof Notification !== 'undefined' &&
              Notification.permission !== 'granted' && (
                <button
                  type="button"
                  onClick={enableBrowserNotifications}
                  className="min-h-[40px] px-3 rounded-xl border border-sky-500/40 text-xs font-semibold text-sky-600 dark:text-sky-400 inline-flex items-center gap-1.5"
                >
                  <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Enable Push Alerts</span>
                </button>
              )}
          </div>

          {!user ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Sign in to view your personal SOS status tracker or district dispatch queue.
            </div>
          ) : sosList.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No SOS requests found for your account/district.
            </div>
          ) : (
            <div className="space-y-4">
              {sosList.map((sos) => {
                const elapsedMs = Math.max(0, nowTick - sos.createdAt);
                const remainingSec = Math.max(0, Math.ceil((5 * 60 * 1000 - elapsedMs) / 1000));
                const showEscalated = sos.escalated || (sos.status === 'NEW' && remainingSec === 0);
                const currentStepIdx = SOS_STEPS.indexOf(sos.status);

                return (
                  <article
                    key={sos.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-bold text-red-600 dark:text-red-400">{sos.district}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {new Date(sos.createdAt).toLocaleString()}
                          </span>
                          {sos.assignedVolunteerName && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Assigned: {sos.assignedVolunteerName}</span>
                            </>
                          )}
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">
                          {sos.userName}
                        </h3>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {sos.note || 'Immediate emergency assistance requested.'}
                        </p>
                      </div>

                      <span
                        className={`text-xs font-bold uppercase tracking-wide ${
                          sos.status === 'RESOLVED'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : sos.status === 'NEW'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-sky-600 dark:text-sky-400'
                        }`}
                      >
                        {sos.status.replace('_', ' ')}
                      </span>
                    </div>

                    {/* Protected PII Row (visible only to owner, assigned volunteer, or admin) */}
                    {sos.phone && sos.lat !== null && sos.lng !== null ? (
                      <div className="flex flex-wrap items-center gap-3 text-xs font-mono bg-slate-50 dark:bg-slate-950/70 rounded-xl px-3.5 py-2.5 border border-slate-200 dark:border-slate-800">
                        <a href={`tel:${sos.phone}`} className="text-sky-600 dark:text-sky-400 font-semibold hover:underline">
                          Tel: {sos.phone}
                        </a>
                        <span aria-hidden="true">·</span>
                        <a
                          href={`https://www.google.com/maps?q=${sos.lat},${sos.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-700 dark:text-slate-300 hover:underline"
                        >
                          GPS: {sos.lat.toFixed(5)}, {sos.lng.toFixed(5)}
                        </a>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                        Phone &amp; GPS protected — assigned to {sos.assignedVolunteerName || 'another responder'}.
                      </p>
                    )}

                    {/* Status Progression Stepper */}
                    <div className="grid grid-cols-4 gap-2 pt-1">
                      {SOS_STEPS.map((step, idx) => {
                        const done = idx <= currentStepIdx;
                        const ts =
                          step === 'NEW'
                            ? sos.createdAt
                            : step === 'ACKNOWLEDGED'
                              ? sos.acknowledgedAt
                              : step === 'IN_PROGRESS'
                                ? sos.inProgressAt
                                : sos.resolvedAt;
                        return (
                          <div key={step} className="space-y-1">
                            <div
                              className={`h-1.5 rounded-full ${
                                done ? 'bg-sky-500' : 'bg-slate-200 dark:bg-slate-800'
                              }`}
                            />
                            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">
                              {step.replace('_', ' ')}
                            </div>
                            {ts && (
                              <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Escalation Timer / Active Escalation Banner */}
                    {sos.status === 'NEW' && !showEscalated && (
                      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 font-mono tabular-nums">
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          Auto-escalation to State Admin &amp; nearby districts in{' '}
                          {Math.floor(remainingSec / 60)}m {String(remainingSec % 60).padStart(2, '0')}s
                        </span>
                      </div>
                    )}

                    {showEscalated && sos.status !== 'RESOLVED' && (
                      <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 p-3.5 space-y-2.5">
                        <div className="flex items-center gap-2 text-xs font-bold text-orange-700 dark:text-orange-300">
                          <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>
                            ESCALATED: State Command &amp; nearby districts notified
                            {sos.escalatedDistricts.length > 0
                              ? ` (${sos.escalatedDistricts.join(', ')})`
                              : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href="tel:112"
                            className="min-h-[40px] px-3 rounded-xl bg-red-600 text-white text-xs font-bold inline-flex items-center gap-1.5"
                          >
                            <PhoneCall className="w-3.5 h-3.5" /> Call 112 (Emergency)
                          </a>
                          <a
                            href="tel:1070"
                            className="min-h-[40px] px-3 rounded-xl bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5"
                          >
                            <PhoneCall className="w-3.5 h-3.5" /> Call 1070 (ASDMA State Control)
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Volunteer / Admin Action Buttons */}
                    {(user.role === 'volunteer' || user.role === 'admin') &&
                      user.status === 'active' &&
                      sos.status !== 'RESOLVED' && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {sos.status === 'NEW' && (
                            <button
                              type="button"
                              onClick={() => handleStatusUpdate(sos.id, 'ACKNOWLEDGED')}
                              className="min-h-[44px] px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                            >
                              Acknowledge SOS
                            </button>
                          )}
                          {(sos.status === 'ACKNOWLEDGED' || user.role === 'admin') &&
                            sos.status !== 'IN_PROGRESS' && (
                              <button
                                type="button"
                                onClick={() => handleStatusUpdate(sos.id, 'IN_PROGRESS')}
                                className="min-h-[44px] px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                              >
                                Mark In Progress
                              </button>
                            )}
                          {(sos.status === 'IN_PROGRESS' || sos.status === 'ACKNOWLEDGED' || user.role === 'admin') && (
                            <button
                              type="button"
                              onClick={() => handleStatusUpdate(sos.id, 'RESOLVED')}
                              className="min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>Mark Resolved</span>
                            </button>
                          )}
                        </div>
                      )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
