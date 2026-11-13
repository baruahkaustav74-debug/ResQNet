import { getNearbyDistricts } from '../shared/assamGeo.ts';
import { createNotificationForUser, db, mapSosRow, recordAudit } from './db.ts';
import { realtimeHub } from './realtime.ts';

const ESCALATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function escalateSosById(sosId: string, reason: string): boolean {
  const row = db.prepare(`SELECT * FROM sos_requests WHERE id = ?`).get(sosId) as
    | Record<string, unknown>
    | undefined;
  if (!row || row.status !== 'NEW' || row.escalated) {
    return false;
  }

  const now = Date.now();
  const district = String(row.district);
  const nearby = getNearbyDistricts(district, 4);

  db.prepare(
    `UPDATE sos_requests
     SET escalated = 1, escalated_at = ?, escalated_districts_json = ?, updated_at = ?
     WHERE id = ? AND status = 'NEW' AND escalated = 0`
  ).run(now, JSON.stringify(nearby), now, sosId);

  const updatedRow = db.prepare(`SELECT * FROM sos_requests WHERE id = ?`).get(sosId) as Record<string, unknown>;
  const sos = mapSosRow(updatedRow, false);

  // Notify all active admins
  const admins = db
    .prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`)
    .all() as Array<{ id: string }>;
  for (const admin of admins) {
    const notif = createNotificationForUser(
      admin.id,
      'sos',
      `SOS Escalated in ${district}`,
      `${sos.userName} SOS unacknowledged (${reason}). Nearby districts notified: ${nearby.join(', ')}.`,
      'CRITICAL',
      district,
      sos.id
    );
    realtimeHub.broadcastNotification(notif);
  }

  // Notify active volunteers in nearby districts
  if (nearby.length > 0) {
    const placeholders = nearby.map(() => '?').join(',');
    const nearbyVols = db
      .prepare(
        `SELECT id, district FROM users WHERE role = 'volunteer' AND status = 'active' AND district IN (${placeholders})`
      )
      .all(...nearby) as Array<{ id: string; district: string }>;

    for (const v of nearbyVols) {
      const notif = createNotificationForUser(
        v.id,
        'sos',
        `Escalated SOS from Neighboring ${district}`,
        `Urgent backup requested in ${district}: ${sos.note || 'Citizen requires immediate rescue.'}`,
        'CRITICAL',
        district,
        sos.id
      );
      realtimeHub.broadcastNotification(notif);
    }
  }

  // Notify the SOS citizen that escalation has fired
  const citizenNotif = createNotificationForUser(
    sos.userId,
    'sos',
    'SOS Escalated to State Command & Nearby Districts',
    `No district volunteer responded yet (${reason}). State admins and neighboring teams (${nearby.join(', ')}) have been alerted. Please call 112 or 1070 if life-threatening.`,
    'CRITICAL',
    district,
    sos.id
  );
  realtimeHub.broadcastNotification(citizenNotif);

  recordAudit(
    { id: 'system-escalation', name: 'SOS Auto-Escalation', role: 'admin' },
    'SOS_ESCALATED',
    'sos',
    sos.id,
    `Escalated ${district} SOS (${reason}) -> ${nearby.join(', ')}`
  );

  realtimeHub.broadcastSos('sos:escalated', sos);
  return true;
}

export function startEscalationWatcher(): NodeJS.Timeout {
  const check = () => {
    const cutoff = Date.now() - ESCALATION_TIMEOUT_MS;
    const candidates = db
      .prepare(
        `SELECT id FROM sos_requests
         WHERE status = 'NEW' AND escalated = 0 AND created_at <= ?`
      )
      .all(cutoff) as Array<{ id: string }>;

    for (const c of candidates) {
      escalateSosById(c.id, '5-minute response timeout');
    }
  };

  return setInterval(check, 15000);
}
