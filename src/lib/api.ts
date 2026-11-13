import type { RealtimeEvent } from '../../shared/types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = sessionStorage.getItem('dg_session_token');
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const errMsg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(errMsg, res.status);
  }

  return data as T;
}

export function playUrgentAlertSound(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [880, 1046.5, 880, 1174.6];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.16 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.15);
    });
  } catch {
    // Ignore audio blocked before user gesture
  }
}

export async function showBrowserNotification(title: string, body: string, tag?: string): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/pwa-192x192.png',
        tag: tag || `dg-${Date.now()}`,
      });
    } catch {
      // Fallback if restricted inside iframe
    }
  }
}

export function connectRealtimeSocket(
  onEvent: (event: RealtimeEvent) => void,
  onStatusChange: (connected: boolean) => void
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retryDelay = 1000;
  let timer: number | null = null;

  const connect = () => {
    if (closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = sessionStorage.getItem('dg_session_token');
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    ws = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);

    ws.onopen = () => {
      retryDelay = 1000;
      onStatusChange(true);
    };

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as RealtimeEvent;
        onEvent(parsed);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      onStatusChange(false);
      if (!closed) {
        timer = window.setTimeout(() => {
          retryDelay = Math.min(15000, retryDelay * 1.5);
          connect();
        }, retryDelay);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();

  return () => {
    closed = true;
    if (timer !== null) window.clearTimeout(timer);
    ws?.close();
  };
}
