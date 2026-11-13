import { useEffect, useState } from 'react';
import type {
  DisasterType,
  OfflineActionLog,
  OfflineActionType,
  OfflineLogStatus,
  Severity,
} from '../../../shared/types';

export interface QueuedReportPayload {
  localId: string;
  district: string;
  disasterType: DisasterType;
  severity: Severity;
  peopleAffected: number;
  urgentHelp: string;
  description: string;
  lat: number | null;
  lng: number | null;
  compressedDataUrls: string[];
  queuedAt: number;
}

export interface QueuedSosPayload {
  localId: string;
  consent: boolean;
  phone: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  locationSource: 'gps' | 'pin';
  note: string;
  detectedDistrict: string;
  queuedAt: number;
}

const DB_NAME = 'disasterguard_offline_v1';
const DB_VERSION = 2;
const REPORT_STORE = 'queued_reports';
const SOS_STORE = 'queued_sos';
const ACTION_LOG_STORE = 'action_logs';

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(REPORT_STORE)) {
        db.createObjectStore(REPORT_STORE, { keyPath: 'localId' });
      }
      if (!db.objectStoreNames.contains(SOS_STORE)) {
        db.createObjectStore(SOS_STORE, { keyPath: 'localId' });
      }
      if (!db.objectStoreNames.contains(ACTION_LOG_STORE)) {
        const logStore = db.createObjectStore(ACTION_LOG_STORE, { keyPath: 'id' });
        logStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOfflineReport(item: QueuedReportPayload): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(REPORT_STORE, 'readwrite');
    tx.objectStore(REPORT_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listOfflineReports(): Promise<QueuedReportPayload[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REPORT_STORE, 'readonly');
    const req = tx.objectStore(REPORT_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []) as QueuedReportPayload[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOfflineReport(localId: string): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(REPORT_STORE, 'readwrite');
    tx.objectStore(REPORT_STORE).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueueOfflineSos(item: QueuedSosPayload): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SOS_STORE, 'readwrite');
    tx.objectStore(SOS_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listOfflineSos(): Promise<QueuedSosPayload[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOS_STORE, 'readonly');
    const req = tx.objectStore(SOS_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []) as QueuedSosPayload[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOfflineSos(localId: string): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SOS_STORE, 'readwrite');
    tx.objectStore(SOS_STORE).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function recordOfflineActionLog(params: {
  actionType: OfflineActionType;
  title: string;
  detail: string;
  district?: string;
  refLocalId?: string;
  status?: OfflineLogStatus;
}): Promise<OfflineActionLog> {
  const entry: OfflineActionLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    refLocalId: params.refLocalId,
    actionType: params.actionType,
    title: params.title,
    detail: params.detail,
    district: params.district,
    offlineWhenTriggered: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    status: params.status || 'logged',
    createdAt: Date.now(),
  };

  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTION_LOG_STORE, 'readwrite');
    tx.objectStore(ACTION_LOG_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return entry;
}

export async function updateOfflineActionLog(
  id: string,
  patch: Partial<Pick<OfflineActionLog, 'status' | 'errorMessage' | 'serverId' | 'syncedAt'>>
): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTION_LOG_STORE, 'readwrite');
    const store = tx.objectStore(ACTION_LOG_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as OfflineActionLog | undefined;
      if (existing) {
        store.put({ ...existing, ...patch });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateOfflineActionLogByRef(
  refLocalId: string,
  patch: Partial<Pick<OfflineActionLog, 'status' | 'errorMessage' | 'serverId' | 'syncedAt'>>
): Promise<void> {
  const logs = await listOfflineActionLogs();
  const matches = logs.filter((l) => l.refLocalId === refLocalId);
  for (const m of matches) {
    await updateOfflineActionLog(m.id, patch);
  }
}

export async function listOfflineActionLogs(limit = 60): Promise<OfflineActionLog[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTION_LOG_STORE, 'readonly');
    const req = tx.objectStore(ACTION_LOG_STORE).getAll();
    req.onsuccess = () => {
      const all = ((req.result || []) as OfflineActionLog[]).sort((a, b) => b.createdAt - a.createdAt);
      resolve(all.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearSyncedActionLogs(): Promise<void> {
  const logs = await listOfflineActionLogs(200);
  const toDelete = logs.filter((l) => l.status === 'synced').map((l) => l.id);
  if (toDelete.length === 0) return;
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTION_LOG_STORE, 'readwrite');
    const store = tx.objectStore(ACTION_LOG_STORE);
    for (const id of toDelete) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Client-side image compression before upload (max 1024px edge, JPEG ~0.72 quality)
 */
export async function compressImageFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas compression unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.72);
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);
    setIsIOS(/iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return { isInstallable: !!deferredPrompt, isInstalled, isIOS, install };
}
