import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  DisasterReport,
  EarlyAlert,
  NotificationItem,
  OfflineActionLog,
  OfflineActionType,
  OfflineLogStatus,
  RealtimeEvent,
  Shelter,
  SosRequest,
  SyncProgressState,
  User,
  WeatherAdvisory,
} from '../../../shared/types';
import {
  apiFetch,
  connectRealtimeSocket,
  playUrgentAlertSound,
  showBrowserNotification,
} from '../../lib/api';
import {
  clearSyncedActionLogs,
  listOfflineActionLogs,
  listOfflineReports,
  listOfflineSos,
  recordOfflineActionLog,
  removeOfflineReport,
  removeOfflineSos,
  updateOfflineActionLog,
  updateOfflineActionLogByRef,
  useOnlineStatus,
} from '../offline/offlineQueue';

interface AppDataContextValue {
  user: User | null;
  hasAdmin: boolean;
  authLoading: boolean;
  wsConnected: boolean;
  isOnline: boolean;
  shelters: Shelter[];
  reports: DisasterReport[];
  sosList: SosRequest[];
  alerts: EarlyAlert[];
  notifications: NotificationItem[];
  weather: WeatherAdvisory[];
  pendingSyncCount: number;
  offlineLogs: OfflineActionLog[];
  syncProgress: SyncProgressState;
  dataLoading: boolean;
  dataError: string | null;
  refreshAll: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;
  logOfflineAction: (params: {
    actionType: OfflineActionType;
    title: string;
    detail: string;
    district?: string;
    refLocalId?: string;
    status?: OfflineLogStatus;
  }) => Promise<OfflineActionLog>;
  clearCompletedSyncLogs: () => Promise<void>;
  dismissSyncSummary: () => void;
  syncOfflineQueue: () => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  setHasAdmin: React.Dispatch<React.SetStateAction<boolean>>;
  logout: () => Promise<void>;
}

const INITIAL_SYNC_PROGRESS: SyncProgressState = {
  active: false,
  phase: 'idle',
  total: 0,
  completed: 0,
  failed: 0,
  currentLabel: null,
  lastCompletedAt: null,
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [hasAdmin, setHasAdmin] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const isOnline = useOnlineStatus();

  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [reports, setReports] = useState<DisasterReport[]>([]);
  const [sosList, setSosList] = useState<SosRequest[]>([]);
  const [alerts, setAlerts] = useState<EarlyAlert[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [weather, setWeather] = useState<WeatherAdvisory[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [offlineLogs, setOfflineLogs] = useState<OfflineActionLog[]>([]);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState>(INITIAL_SYNC_PROGRESS);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const userRef = useRef<User | null>(null);
  userRef.current = user;
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const [repQ, sosQ, logs] = await Promise.all([
        listOfflineReports(),
        listOfflineSos(),
        listOfflineActionLogs(),
      ]);
      const unsyncedLogs = logs.filter(
        (l) => !l.refLocalId && (l.status === 'logged' || l.status === 'failed')
      );
      setPendingSyncCount(repQ.length + sosQ.length + unsyncedLogs.length);
      setOfflineLogs(logs);
    } catch {
      setPendingSyncCount(0);
    }
  }, []);

  const logOfflineAction = useCallback(
    async (params: {
      actionType: OfflineActionType;
      title: string;
      detail: string;
      district?: string;
      refLocalId?: string;
      status?: OfflineLogStatus;
    }) => {
      const entry = await recordOfflineActionLog(params);
      await refreshPendingCount();
      return entry;
    },
    [refreshPendingCount]
  );

  const clearCompletedSyncLogs = useCallback(async () => {
    await clearSyncedActionLogs();
    await refreshPendingCount();
    setSyncProgress((prev) =>
      prev.phase === 'completed' ? { ...INITIAL_SYNC_PROGRESS } : prev
    );
  }, [refreshPendingCount]);

  const dismissSyncSummary = useCallback(() => {
    setSyncProgress((prev) => (prev.active ? prev : { ...INITIAL_SYNC_PROGRESS }));
  }, []);

  const refreshAll = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [shRes, repRes, alRes, wxRes] = await Promise.all([
        apiFetch<{ shelters: Shelter[] }>('/api/shelters'),
        apiFetch<{ reports: DisasterReport[] }>('/api/reports'),
        apiFetch<{ alerts: EarlyAlert[] }>('/api/alerts'),
        apiFetch<{ advisories: WeatherAdvisory[] }>('/api/weather/assam').catch(() => ({
          advisories: [],
        })),
      ]);
      setShelters(shRes.shelters);
      setReports(repRes.reports);
      setAlerts(alRes.alerts);
      setWeather(wxRes.advisories);

      if (userRef.current) {
        const [sosRes, notifRes] = await Promise.all([
          apiFetch<{ sosList: SosRequest[] }>('/api/sos').catch(() => ({ sosList: [] })),
          apiFetch<{ notifications: NotificationItem[] }>('/api/notifications').catch(() => ({
            notifications: [],
          })),
        ]);
        setSosList(sosRes.sosList);
        setNotifications(notifRes.notifications);
      } else {
        setSosList([]);
        setNotifications([]);
      }
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to load live disaster data.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  const syncOfflineQueue = useCallback(async () => {
    if (!navigator.onLine || !userRef.current || syncingRef.current) return;
    syncingRef.current = true;

    try {
      const [queuedReports, queuedSos, allLogs] = await Promise.all([
        listOfflineReports(),
        listOfflineSos(),
        listOfflineActionLogs(),
      ]);
      const standaloneLogs = allLogs.filter(
        (l) => !l.refLocalId && (l.status === 'logged' || l.status === 'failed')
      );

      const total = queuedReports.length + queuedSos.length + standaloneLogs.length;
      if (total === 0) {
        await refreshPendingCount();
        return;
      }

      let completed = 0;
      let failed = 0;
      let mutatedServerData = false;

      setSyncProgress({
        active: true,
        phase: 'syncing',
        total,
        completed: 0,
        failed: 0,
        currentLabel: 'Reconnected — starting background sync...',
        lastCompletedAt: null,
      });

      // 1. Sync queued SOS requests first (highest priority)
      for (const s of queuedSos) {
        setSyncProgress({
          active: true,
          phase: 'syncing',
          total,
          completed,
          failed,
          currentLabel: `Dispatching offline SOS (${s.detectedDistrict})...`,
          lastCompletedAt: null,
        });
        await updateOfflineActionLogByRef(s.localId, { status: 'syncing', errorMessage: undefined });
        setOfflineLogs(await listOfflineActionLogs());

        try {
          const res = await apiFetch<{ sos: SosRequest }>('/api/sos', {
            method: 'POST',
            body: JSON.stringify({
              consent: s.consent,
              phone: s.phone,
              lat: s.lat,
              lng: s.lng,
              accuracy: s.accuracy,
              locationSource: s.locationSource,
              note: s.note,
            }),
          });
          await removeOfflineSos(s.localId);
          await updateOfflineActionLogByRef(s.localId, {
            status: 'synced',
            serverId: res.sos.id,
            syncedAt: Date.now(),
          });
          completed += 1;
          mutatedServerData = true;
        } catch (err) {
          failed += 1;
          await updateOfflineActionLogByRef(s.localId, {
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : 'SOS sync failed',
          });
        }
        setOfflineLogs(await listOfflineActionLogs());
        await sleep(160);
      }

      // 2. Sync queued Field Reports
      for (const item of queuedReports) {
        setSyncProgress({
          active: true,
          phase: 'syncing',
          total,
          completed,
          failed,
          currentLabel: `Uploading report (${item.district} · ${item.disasterType})...`,
          lastCompletedAt: null,
        });
        await updateOfflineActionLogByRef(item.localId, {
          status: 'syncing',
          errorMessage: undefined,
        });
        setOfflineLogs(await listOfflineActionLogs());

        try {
          const uploadedUrls: string[] = [];
          for (const dataUrl of item.compressedDataUrls) {
            const up = await apiFetch<{ url: string }>('/api/uploads', {
              method: 'POST',
              body: JSON.stringify({ dataUrl }),
            });
            uploadedUrls.push(up.url);
          }
          const res = await apiFetch<{ report: DisasterReport }>('/api/reports', {
            method: 'POST',
            body: JSON.stringify({
              district: item.district,
              disasterType: item.disasterType,
              severity: item.severity,
              peopleAffected: item.peopleAffected,
              urgentHelp: item.urgentHelp,
              description: item.description,
              lat: item.lat,
              lng: item.lng,
              photoUrls: uploadedUrls,
            }),
          });
          await removeOfflineReport(item.localId);
          await updateOfflineActionLogByRef(item.localId, {
            status: 'synced',
            serverId: res.report.id,
            syncedAt: Date.now(),
          });
          completed += 1;
          mutatedServerData = true;
        } catch (err) {
          failed += 1;
          await updateOfflineActionLogByRef(item.localId, {
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : 'Report sync failed',
          });
        }
        setOfflineLogs(await listOfflineActionLogs());
        await sleep(160);
      }

      // 3. Sync standalone offline action telemetry logs (e.g., SOS button presses, SMS fallbacks, pin changes)
      for (const log of standaloneLogs) {
        setSyncProgress({
          active: true,
          phase: 'syncing',
          total,
          completed,
          failed,
          currentLabel: `Syncing activity log: ${log.title}...`,
          lastCompletedAt: null,
        });
        await updateOfflineActionLog(log.id, { status: 'syncing', errorMessage: undefined });
        setOfflineLogs(await listOfflineActionLogs());

        try {
          const res = await apiFetch<{ ok: boolean; serverId?: string }>('/api/offline-sync-log', {
            method: 'POST',
            body: JSON.stringify({
              actionType: log.actionType,
              detail: `${log.title} — ${log.detail}`,
              refLocalId: log.id,
            }),
          });
          await updateOfflineActionLog(log.id, {
            status: 'synced',
            serverId: res.serverId || log.id,
            syncedAt: Date.now(),
          });
          completed += 1;
        } catch (err) {
          failed += 1;
          await updateOfflineActionLog(log.id, {
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : 'Telemetry sync failed',
          });
        }
        setOfflineLogs(await listOfflineActionLogs());
        await sleep(120);
      }

      setSyncProgress({
        active: false,
        phase: failed > 0 ? 'partial_error' : 'completed',
        total,
        completed,
        failed,
        currentLabel: null,
        lastCompletedAt: Date.now(),
      });

      if (mutatedServerData) {
        await refreshAll();
      }
    } finally {
      syncingRef.current = false;
      await refreshPendingCount();
    }
  }, [refreshAll, refreshPendingCount]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [setupRes, meRes] = await Promise.all([
          apiFetch<{ hasAdmin: boolean }>('/api/auth/setup-status'),
          apiFetch<{ user: User | null }>('/api/auth/me'),
        ]);
        if (!active) return;
        setHasAdmin(setupRes.hasAdmin);
        setUser(meRes.user);
      } catch {
        // Offline boot fallback
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authLoading) {
      refreshAll();
      refreshPendingCount();
    }
  }, [authLoading, user?.id, user?.role, user?.status, user?.district, refreshAll, refreshPendingCount]);

  useEffect(() => {
    if (isOnline && user) {
      syncOfflineQueue();
    }
  }, [isOnline, user, syncOfflineQueue]);

  // Real-time WebSocket subscription
  useEffect(() => {
    if (authLoading) return;
    const disconnect = connectRealtimeSocket(
      (event: RealtimeEvent) => {
        if (event.type === 'shelter:updated') {
          const updated = event.payload as Shelter;
          setShelters((prev) => {
            const idx = prev.findIndex((s) => s.id === updated.id);
            if (idx === -1) return [updated, ...prev];
            const copy = [...prev];
            copy[idx] = updated;
            return copy;
          });
        } else if (event.type === 'report:created' || event.type === 'report:updated') {
          const rep = event.payload as DisasterReport;
          setReports((prev) => {
            const idx = prev.findIndex((r) => r.id === rep.id);
            if (idx === -1) return [rep, ...prev];
            const copy = [...prev];
            copy[idx] = rep;
            return copy;
          });
        } else if (
          event.type === 'sos:created' ||
          event.type === 'sos:updated' ||
          event.type === 'sos:escalated'
        ) {
          const sos = event.payload as SosRequest;
          setSosList((prev) => {
            const idx = prev.findIndex((s) => s.id === sos.id);
            if (idx === -1) return [sos, ...prev];
            const copy = [...prev];
            copy[idx] = sos;
            return copy;
          });
          if (
            (event.type === 'sos:created' || event.type === 'sos:escalated') &&
            (userRef.current?.role === 'volunteer' || userRef.current?.role === 'admin')
          ) {
            playUrgentAlertSound();
            showBrowserNotification(
              event.type === 'sos:escalated'
                ? `ESCALATED SOS: ${sos.district}`
                : `NEW SOS ALERT: ${sos.district}`,
              `${sos.userName}: ${sos.note || 'Immediate emergency assistance requested.'}`,
              `sos-${sos.id}`
            );
          }
        } else if (event.type === 'alert:created') {
          const alert = event.payload as EarlyAlert;
          setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)]);
          const uDist = userRef.current?.district;
          if (!uDist || alert.districts.includes(uDist)) {
            playUrgentAlertSound();
            showBrowserNotification(
              `Early Warning (${alert.severity}): ${alert.title}`,
              alert.message,
              `alert-${alert.id}`
            );
          }
        } else if (event.type === 'notification:created') {
          const notif = event.payload as NotificationItem;
          setNotifications((prev) => [notif, ...prev.filter((n) => n.id !== notif.id)]);
        } else if (event.type === 'user:updated') {
          const payload = event.payload as { userId?: string };
          if (payload.userId && payload.userId === userRef.current?.id) {
            apiFetch<{ user: User | null }>('/api/auth/me')
              .then((r) => setUser(r.user))
              .catch(() => {});
          }
        } else if (event.type === 'demo:reset') {
          refreshAll();
        }
      },
      setWsConnected
    );
    return disconnect;
  }, [authLoading, user?.id, user?.role, user?.district, refreshAll]);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    sessionStorage.removeItem('dg_session_token');
    setUser(null);
  }, []);

  return (
    <AppDataContext.Provider
      value={{
        user,
        hasAdmin,
        authLoading,
        wsConnected,
        isOnline,
        shelters,
        reports,
        sosList,
        alerts,
        notifications,
        weather,
        pendingSyncCount,
        offlineLogs,
        syncProgress,
        dataLoading,
        dataError,
        refreshAll,
        refreshPendingCount,
        logOfflineAction,
        clearCompletedSyncLogs,
        dismissSyncSummary,
        syncOfflineQueue,
        setUser,
        setHasAdmin,
        logout,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
};

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider');
  return ctx;
}
