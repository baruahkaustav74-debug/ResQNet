import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { db, mapUserRow } from './db.ts';
import { parseCookies, verifyToken } from './security.ts';
import type {
  DisasterReport,
  NotificationItem,
  RealtimeEvent,
  Role,
  SosRequest,
  User,
} from '../shared/types.ts';

import { liveVoiceHub } from './liveVoice.ts';

interface ClientMeta {
  ws: WebSocket;
  userId: string | null;
  role: Role | null;
  status: string | null;
  district: string | null;
}

class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientMeta>();

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/ws') {
        this.wss?.handleUpgrade(req, socket, head, (ws) => {
          this.wss?.emit('connection', ws, req);
        });
      } else if (url.pathname === '/ws/live') {
        liveVoiceHub.handleUpgrade(req, socket, head);
      }
    });

    this.wss.on('connection', (ws, req) => {
      const cookies = parseCookies(req.headers.cookie);
      const url = new URL(req.url || '/', 'http://localhost');
      const token = url.searchParams.get('token') || cookies['dg_token'] || null;

      let user: User | null = null;
      if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
          const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(decoded.sub) as
            | Record<string, unknown>
            | undefined;
          if (row) {
            user = mapUserRow(row);
          }
        }
      }

      const meta: ClientMeta = {
        ws,
        userId: user?.id ?? null,
        role: user?.role ?? null,
        status: user?.status ?? null,
        district: user?.district ?? null,
      };
      this.clients.add(meta);

      this.sendToClient(ws, {
        type: 'connected',
        payload: { userId: meta.userId, role: meta.role, district: meta.district, ts: Date.now() },
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw));
          if (msg?.type === 'auth:refresh') {
            // Re-sync user metadata from DB if user switched or updated
            const refreshToken = typeof msg.token === 'string' ? msg.token : token;
            if (refreshToken) {
              const decoded = verifyToken(refreshToken);
              if (decoded) {
                const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(decoded.sub) as
                  | Record<string, unknown>
                  | undefined;
                if (row) {
                  const u = mapUserRow(row);
                  meta.userId = u.id;
                  meta.role = u.role;
                  meta.status = u.status;
                  meta.district = u.district;
                }
              }
            }
          }
        } catch {
          // ignore malformed frames
        }
      });

      ws.on('close', () => {
        this.clients.delete(meta);
      });

      ws.on('error', () => {
        this.clients.delete(meta);
      });
    });
  }

  private sendToClient(ws: WebSocket, event: RealtimeEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  broadcastAll(event: RealtimeEvent): void {
    for (const c of this.clients) {
      this.sendToClient(c.ws, event);
    }
  }

  broadcastNotification(notification: NotificationItem): void {
    for (const c of this.clients) {
      if (c.userId === notification.userId) {
        this.sendToClient(c.ws, { type: 'notification:created', payload: notification });
      }
    }
  }

  /**
   * RBAC-enforced SOS broadcast:
   * - Owner receives full own SOS
   * - Admins receive full SOS
   * - Active volunteers in the SOS district (or escalated districts) receive full SOS ONLY if unassigned or assigned to them;
   *   if assigned to another volunteer, phone/GPS are redacted.
   * - Other viewers and volunteers in unrelated districts receive NOTHING.
   */
  broadcastSos(type: 'sos:created' | 'sos:updated' | 'sos:escalated', sos: SosRequest): void {
    for (const c of this.clients) {
      if (!c.userId || c.status !== 'active') continue;

      if (c.role === 'admin' || c.userId === sos.userId) {
        this.sendToClient(c.ws, { type, payload: sos });
        continue;
      }

      if (c.role === 'volunteer' && c.district) {
        const inDistrict =
          c.district === sos.district ||
          (sos.escalated && sos.escalatedDistricts.includes(c.district));
        if (!inDistrict) continue;

        const isAssignedOrClaimable =
          !sos.assignedVolunteerId || sos.assignedVolunteerId === c.userId;

        const safePayload: SosRequest = isAssignedOrClaimable
          ? sos
          : { ...sos, phone: null, lat: null, lng: null, accuracy: null };
        this.sendToClient(c.ws, { type, payload: safePayload });
      }
    }
  }

  /**
   * RBAC-enforced Report broadcast:
   * - Admins receive all reports
   * - Active volunteers receive reports in their own district (and verified reports)
   * - Viewers receive ONLY VERIFIED reports with coarsened GPS
   */
  broadcastReport(type: 'report:created' | 'report:updated', report: DisasterReport): void {
    for (const c of this.clients) {
      if (c.role === 'admin') {
        this.sendToClient(c.ws, { type, payload: report });
        continue;
      }

      if (c.role === 'volunteer' && c.status === 'active' && c.district === report.district) {
        this.sendToClient(c.ws, { type, payload: report });
        continue;
      }

      if (report.status === 'VERIFIED') {
        const coarsened: DisasterReport = {
          ...report,
          lat: report.lat !== null ? Math.round(report.lat * 100) / 100 : null,
          lng: report.lng !== null ? Math.round(report.lng * 100) / 100 : null,
        };
        this.sendToClient(c.ws, { type, payload: coarsened });
      }
    }
  }
}

export const realtimeHub = new RealtimeHub();
