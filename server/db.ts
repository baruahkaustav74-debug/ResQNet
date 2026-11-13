import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { hashPassword } from './security.ts';
import type {
  AuditLogEntry,
  DisasterReport,
  DisasterType,
  EarlyAlert,
  NotificationItem,
  ReportStatus,
  Role,
  Severity,
  Shelter,
  ShelterFacilities,
  ShelterStatus,
  SosRequest,
  SosStatus,
  User,
  UserStatus,
} from '../shared/types.ts';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'disasterguard.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('viewer', 'volunteer', 'admin')),
      status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'deactivated')),
      district TEXT,
      assigned_shelter_id TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shelters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      district TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      capacity INTEGER NOT NULL,
      occupied INTEGER NOT NULL DEFAULT 0,
      contact_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      facilities_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open', 'full', 'closed')),
      assigned_volunteer_id TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      reporter_name TEXT NOT NULL,
      district TEXT NOT NULL,
      disaster_type TEXT NOT NULL CHECK(disaster_type IN ('flood', 'landslide', 'storm', 'earthquake', 'fire', 'lightning')),
      severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'HIGH', 'MODERATE', 'LOW')),
      people_affected INTEGER NOT NULL DEFAULT 0,
      urgent_help TEXT NOT NULL,
      description TEXT NOT NULL,
      lat REAL,
      lng REAL,
      photo_urls_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUBMITTED', 'VERIFIED', 'REJECTED')),
      reviewed_by TEXT,
      reviewed_by_name TEXT,
      reviewed_at INTEGER,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sos_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      district TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy REAL,
      location_source TEXT NOT NULL CHECK(location_source IN ('gps', 'pin')),
      note TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED')),
      assigned_volunteer_id TEXT,
      assigned_volunteer_name TEXT,
      escalated INTEGER NOT NULL DEFAULT 0,
      escalated_at INTEGER,
      escalated_districts_json TEXT NOT NULL DEFAULT '[]',
      acknowledged_at INTEGER,
      in_progress_at INTEGER,
      resolved_at INTEGER,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'HIGH', 'MODERATE', 'LOW')),
      districts_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('sos', 'report', 'alert', 'system')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'HIGH', 'MODERATE', 'LOW')),
      district TEXT,
      ref_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_district ON reports(district);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_sos_district ON sos_requests(district);
    CREATE INDEX IF NOT EXISTS idx_sos_user ON sos_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_requests(status);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);
}

export function mapUserRow(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: row.phone ? String(row.phone) : null,
    role: row.role as Role,
    status: row.status as UserStatus,
    district: row.district ? String(row.district) : null,
    assignedShelterId: row.assigned_shelter_id ? String(row.assigned_shelter_id) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function mapShelterRow(row: Record<string, unknown>): Shelter {
  let facilities: ShelterFacilities = { food: false, water: false, medical: false, power: false };
  try {
    facilities = JSON.parse(String(row.facilities_json || '{}'));
  } catch {
    // ignore
  }
  return {
    id: String(row.id),
    name: String(row.name),
    district: String(row.district),
    address: String(row.address),
    lat: Number(row.lat),
    lng: Number(row.lng),
    capacity: Number(row.capacity),
    occupied: Number(row.occupied),
    contactName: String(row.contact_name),
    contactPhone: String(row.contact_phone),
    facilities,
    status: row.status as ShelterStatus,
    assignedVolunteerId: row.assigned_volunteer_id ? String(row.assigned_volunteer_id) : null,
    assignedVolunteerName: row.assigned_volunteer_name ? String(row.assigned_volunteer_name) : null,
    updatedAt: Number(row.updated_at),
  };
}

export function mapReportRow(row: Record<string, unknown>, redactSensitive = false): DisasterReport {
  let photoUrls: string[] = [];
  try {
    photoUrls = JSON.parse(String(row.photo_urls_json || '[]'));
  } catch {
    photoUrls = [];
  }
  const lat = row.lat !== null && row.lat !== undefined ? Number(row.lat) : null;
  const lng = row.lng !== null && row.lng !== undefined ? Number(row.lng) : null;
  return {
    id: String(row.id),
    reporterId: String(row.reporter_id),
    reporterName: String(row.reporter_name),
    district: String(row.district),
    disasterType: row.disaster_type as DisasterType,
    severity: row.severity as Severity,
    peopleAffected: Number(row.people_affected),
    urgentHelp: String(row.urgent_help),
    description: String(row.description),
    lat: redactSensitive && lat !== null ? Math.round(lat * 100) / 100 : lat,
    lng: redactSensitive && lng !== null ? Math.round(lng * 100) / 100 : lng,
    photoUrls,
    status: row.status as ReportStatus,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedByName: row.reviewed_by_name ? String(row.reviewed_by_name) : null,
    reviewedAt: row.reviewed_at ? Number(row.reviewed_at) : null,
    createdAt: Number(row.created_at),
  };
}

export function mapSosRow(row: Record<string, unknown>, redactSensitive = false): SosRequest {
  let escalatedDistricts: string[] = [];
  try {
    escalatedDistricts = JSON.parse(String(row.escalated_districts_json || '[]'));
  } catch {
    escalatedDistricts = [];
  }
  return {
    id: String(row.id),
    userId: String(row.user_id),
    userName: String(row.user_name),
    phone: redactSensitive ? null : String(row.phone),
    district: String(row.district),
    lat: redactSensitive ? null : Number(row.lat),
    lng: redactSensitive ? null : Number(row.lng),
    accuracy: redactSensitive || row.accuracy === null ? null : Number(row.accuracy),
    locationSource: row.location_source as 'gps' | 'pin',
    note: String(row.note),
    status: row.status as SosStatus,
    assignedVolunteerId: row.assigned_volunteer_id ? String(row.assigned_volunteer_id) : null,
    assignedVolunteerName: row.assigned_volunteer_name ? String(row.assigned_volunteer_name) : null,
    escalated: Boolean(row.escalated),
    escalatedAt: row.escalated_at ? Number(row.escalated_at) : null,
    escalatedDistricts,
    acknowledgedAt: row.acknowledged_at ? Number(row.acknowledged_at) : null,
    inProgressAt: row.in_progress_at ? Number(row.in_progress_at) : null,
    resolvedAt: row.resolved_at ? Number(row.resolved_at) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function mapAlertRow(row: Record<string, unknown>): EarlyAlert {
  let districts: string[] = [];
  try {
    districts = JSON.parse(String(row.districts_json || '[]'));
  } catch {
    districts = [];
  }
  return {
    id: String(row.id),
    title: String(row.title),
    message: String(row.message),
    severity: row.severity as Severity,
    districts,
    expiresAt: Number(row.expires_at),
    createdBy: String(row.created_by),
    createdByName: String(row.created_by_name),
    createdAt: Number(row.created_at),
  };
}

export function mapNotificationRow(row: Record<string, unknown>): NotificationItem {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: row.type as NotificationItem['type'],
    title: String(row.title),
    body: String(row.body),
    severity: row.severity as Severity,
    district: row.district ? String(row.district) : null,
    refId: row.ref_id ? String(row.ref_id) : null,
    isRead: Boolean(row.is_read),
    createdAt: Number(row.created_at),
  };
}

export function mapAuditRow(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(row.id),
    actorId: String(row.actor_id),
    actorName: String(row.actor_name),
    actorRole: row.actor_role as Role,
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    details: String(row.details),
    createdAt: Number(row.created_at),
  };
}

export function recordAudit(
  actor: { id: string; name: string; role: Role },
  action: string,
  targetType: string,
  targetId: string,
  details: string
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_name, actor_role, action, target_type, target_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), actor.id, actor.name, actor.role, action, targetType, targetId, details, Date.now());
}

export function createNotificationForUser(
  userId: string,
  type: NotificationItem['type'],
  title: string,
  body: string,
  severity: Severity,
  district: string | null,
  refId: string | null
): NotificationItem {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, severity, district, ref_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(id, userId, type, title, body, severity, district, refId, createdAt);
  return {
    id,
    userId,
    type,
    title,
    body,
    severity,
    district,
    refId,
    isRead: false,
    createdAt,
  };
}

export async function bootstrapEnvAdmin(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password || password.length < 8) return;

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existing) return;

  const now = Date.now();
  const hash = await hashPassword(password);
  db.prepare(
    `INSERT INTO users (id, name, email, phone, password_hash, role, status, district, assigned_shelter_id, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 'admin', 'active', 'Kamrup Metropolitan', NULL, 0, ?, ?)`
  ).run(crypto.randomUUID(), 'State Command Admin', email, hash, now, now);
}

export function seedDemoData(forceReset = false): void {
  const shelterCount = (db.prepare(`SELECT COUNT(*) as c FROM shelters`).get() as { c: number }).c;
  if (!forceReset && shelterCount > 0) {
    return;
  }

  const now = Date.now();
  const h = (hrs: number) => now - hrs * 3600 * 1000;
  const unloginableHash = '!' + crypto.randomBytes(32).toString('hex');

  const tx = db.transaction(() => {
    if (forceReset) {
      db.prepare(`DELETE FROM notifications WHERE ref_id LIKE 'demo-%'`).run();
      db.prepare(`DELETE FROM sos_requests WHERE is_demo = 1`).run();
      db.prepare(`DELETE FROM reports WHERE is_demo = 1`).run();
      db.prepare(`DELETE FROM alerts WHERE is_demo = 1`).run();
      db.prepare(`DELETE FROM shelters WHERE is_demo = 1`).run();
      db.prepare(`DELETE FROM users WHERE is_demo = 1`).run();
    }

    // 8 Fictional Demo Volunteers across different Assam districts (fake placeholder phones, no hardcoded passwords)
    const demoVolunteers = [
      { id: 'demo-vol-1', name: 'Ananya Bora', email: 'ananya.demo@disasterguard.local', phone: '9000000001', district: 'Kamrup Metropolitan', shelter: 'demo-sh-1', status: 'active' },
      { id: 'demo-vol-2', name: 'Bikram Kalita', email: 'bikram.demo@disasterguard.local', phone: '9000000002', district: 'Dibrugarh', shelter: 'demo-sh-2', status: 'active' },
      { id: 'demo-vol-3', name: 'Chandan Das', email: 'chandan.demo@disasterguard.local', phone: '9000000003', district: 'Cachar', shelter: 'demo-sh-3', status: 'active' },
      { id: 'demo-vol-4', name: 'Dipika Gogoi', email: 'dipika.demo@disasterguard.local', phone: '9000000004', district: 'Jorhat', shelter: 'demo-sh-4', status: 'active' },
      { id: 'demo-vol-5', name: 'Farhan Ahmed', email: 'farhan.demo@disasterguard.local', phone: '9000000005', district: 'Barpeta', shelter: 'demo-sh-5', status: 'active' },
      { id: 'demo-vol-6', name: 'Gitali Sarmah', email: 'gitali.demo@disasterguard.local', phone: '9000000006', district: 'Nagaon', shelter: 'demo-sh-6', status: 'active' },
      { id: 'demo-vol-7', name: 'Hemanta Baruah', email: 'hemanta.demo@disasterguard.local', phone: '9000000007', district: 'Dhemaji', shelter: 'demo-sh-7', status: 'active' },
      { id: 'demo-vol-8', name: 'Indrani Nath', email: 'indrani.demo@disasterguard.local', phone: '9000000008', district: 'Dima Hasao', shelter: 'demo-sh-8', status: 'pending' },
    ];

    const insertUser = db.prepare(
      `INSERT OR REPLACE INTO users (id, name, email, phone, password_hash, role, status, district, assigned_shelter_id, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'volunteer', ?, ?, ?, 1, ?, ?)`
    );
    for (const v of demoVolunteers) {
      insertUser.run(v.id, v.name, v.email, v.phone, unloginableHash, v.status, v.district, v.shelter, h(48), now);
    }

    // Also create 1 fictional demo citizen for the 3 demo SOS items
    db.prepare(
      `INSERT OR REPLACE INTO users (id, name, email, phone, password_hash, role, status, district, assigned_shelter_id, is_demo, created_at, updated_at)
       VALUES ('demo-citizen-1', 'Rituraj Hazarika (Demo)', 'citizen.demo@disasterguard.local', '9000000100', ?, 'viewer', 'active', 'Kamrup Metropolitan', NULL, 1, ?, ?)`
    ).run(unloginableHash, h(72), now);

    // 10 Demo Shelters
    const demoShelters = [
      { id: 'demo-sh-1', name: 'Guwahati Sarusajai Relief Camp', district: 'Kamrup Metropolitan', address: 'Sarusajai Stadium Complex, NH-27, Guwahati', lat: 26.1156, lng: 91.7589, cap: 450, occ: 312, cname: 'Ananya Bora', cphone: '9000000001', fac: { food: true, water: true, medical: true, power: true }, status: 'open', vol: 'demo-vol-1' },
      { id: 'demo-sh-2', name: 'Dibrugarh Govt Boys HS Shelter', district: 'Dibrugarh', address: 'Thana Chariali, Dibrugarh', lat: 27.4798, lng: 94.9145, cap: 220, occ: 220, cname: 'Bikram Kalita', cphone: '9000000002', fac: { food: true, water: true, medical: true, power: false }, status: 'full', vol: 'demo-vol-2' },
      { id: 'demo-sh-3', name: 'Silchar Polytechnic Relief Centre', district: 'Cachar', address: 'Meherpur, Silchar', lat: 24.7982, lng: 92.7891, cap: 300, occ: 185, cname: 'Chandan Das', cphone: '9000000003', fac: { food: true, water: true, medical: true, power: true }, status: 'open', vol: 'demo-vol-3' },
      { id: 'demo-sh-4', name: 'Jorhat District Library Safe House', district: 'Jorhat', address: 'AT Road, Jorhat', lat: 26.7574, lng: 94.2106, cap: 180, occ: 94, cname: 'Dipika Gogoi', cphone: '9000000004', fac: { food: true, water: true, medical: false, power: true }, status: 'open', vol: 'demo-vol-4' },
      { id: 'demo-sh-5', name: 'Barpeta Satra Community Relief Camp', district: 'Barpeta', address: 'Bazar Road, Barpeta Town', lat: 26.3256, lng: 91.0085, cap: 350, occ: 290, cname: 'Farhan Ahmed', cphone: '9000000005', fac: { food: true, water: true, medical: true, power: false }, status: 'open', vol: 'demo-vol-5' },
      { id: 'demo-sh-6', name: 'Nagaon Nowgong College Camp', district: 'Nagaon', address: 'Old AT Road, Nagaon', lat: 26.3514, lng: 92.6901, cap: 260, occ: 140, cname: 'Gitali Sarmah', cphone: '9000000006', fac: { food: true, water: true, medical: true, power: true }, status: 'open', vol: 'demo-vol-6' },
      { id: 'demo-sh-7', name: 'Dhemaji Flood Elevated Platform', district: 'Dhemaji', address: 'NH-15 Chariali, Dhemaji', lat: 27.4841, lng: 94.5612, cap: 200, occ: 178, cname: 'Hemanta Baruah', cphone: '9000000007', fac: { food: true, water: true, medical: false, power: false }, status: 'open', vol: 'demo-vol-7' },
      { id: 'demo-sh-8', name: 'Haflong Cultural Hall Shelter', district: 'Dima Hasao', address: 'Station Road, Haflong', lat: 25.1665, lng: 93.0168, cap: 150, occ: 42, cname: 'Control Desk Haflong', cphone: '9000000008', fac: { food: true, water: true, medical: true, power: true }, status: 'open', vol: 'demo-vol-8' },
      { id: 'demo-sh-9', name: 'Majuli Kamalabari High Ground Camp', district: 'Majuli', address: 'Kamalabari Chariali, Majuli', lat: 26.9512, lng: 94.1654, cap: 160, occ: 152, cname: 'Dipika Gogoi', cphone: '9000000004', fac: { food: true, water: true, medical: true, power: false }, status: 'open', vol: 'demo-vol-4' },
      { id: 'demo-sh-10', name: 'Dhubri Bilasipara Flood Shelter', district: 'Dhubri', address: 'College Nagar, Dhubri', lat: 26.0278, lng: 89.9854, cap: 240, occ: 0, cname: 'Farhan Ahmed', cphone: '9000000005', fac: { food: false, water: true, medical: false, power: false }, status: 'closed', vol: 'demo-vol-5' },
    ];

    const insertShelter = db.prepare(
      `INSERT OR REPLACE INTO shelters (id, name, district, address, lat, lng, capacity, occupied, contact_name, contact_phone, facilities_json, status, assigned_volunteer_id, is_demo, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    for (const s of demoShelters) {
      insertShelter.run(
        s.id, s.name, s.district, s.address, s.lat, s.lng, s.cap, s.occ,
        s.cname, s.cphone, JSON.stringify(s.fac), s.status, s.vol, h(2)
      );
    }

    // 15 Demo Reports across districts and disaster types
    const demoReports: Array<{
      id: string; repId: string; repName: string; district: string; type: DisasterType;
      sev: Severity; affected: number; help: string; desc: string; lat: number; lng: number;
      status: ReportStatus; hrsAgo: number;
    }> = [
      { id: 'demo-rep-1', repId: 'demo-vol-2', repName: 'Bikram Kalita', district: 'Dibrugarh', type: 'flood', sev: 'CRITICAL', affected: 420, help: 'Rescue boats & drinking water', desc: 'Brahmaputra embankment breach near Maijan; 6 wards submerged above 4ft.', lat: 27.495, lng: 94.938, status: 'VERIFIED', hrsAgo: 1.5 },
      { id: 'demo-rep-2', repId: 'demo-vol-7', repName: 'Hemanta Baruah', district: 'Dhemaji', type: 'flood', sev: 'CRITICAL', affected: 310, help: 'Inflatable boats & baby food', desc: 'Jiadhal river flash flood cut off 4 village approach roads.', lat: 27.468, lng: 94.525, status: 'VERIFIED', hrsAgo: 4.5 },
      { id: 'demo-rep-3', repId: 'demo-vol-8', repName: 'Indrani Nath', district: 'Dima Hasao', type: 'landslide', sev: 'CRITICAL', affected: 85, help: 'Earthmovers & medical evacuation', desc: 'Heavy mudslide blocked Haflong-Silchar hill road near Jatinga.', lat: 25.134, lng: 93.042, status: 'VERIFIED', hrsAgo: 9 },
      { id: 'demo-rep-4', repId: 'demo-vol-3', repName: 'Chandan Das', district: 'Cachar', type: 'flood', sev: 'HIGH', affected: 260, help: 'Tarpaulins & chlorine tablets', desc: 'Barak river crossing danger mark at Annapurna Ghat; low-lying areas inundated.', lat: 24.841, lng: 92.796, status: 'VERIFIED', hrsAgo: 18 },
      { id: 'demo-rep-5', repId: 'demo-vol-5', repName: 'Farhan Ahmed', district: 'Barpeta', type: 'flood', sev: 'HIGH', affected: 190, help: 'Dry rations & fodder', desc: 'Beki river overflow affecting Mandia and Baghbar revenue circles.', lat: 26.298, lng: 90.965, status: 'VERIFIED', hrsAgo: 34 },
      { id: 'demo-rep-6', repId: 'demo-vol-1', repName: 'Ananya Bora', district: 'Kamrup Metropolitan', type: 'landslide', sev: 'HIGH', affected: 48, help: 'Hillside evacuation & sandbags', desc: 'Soil slippage reported along Kahilipara hill slope after sustained rain.', lat: 26.136, lng: 91.771, status: 'VERIFIED', hrsAgo: 52 },
      { id: 'demo-rep-7', repId: 'demo-vol-4', repName: 'Dipika Gogoi', district: 'Majuli', type: 'flood', sev: 'HIGH', affected: 175, help: 'Solar lanterns & ORS', desc: 'Erosion and backwater flooding near Garamur and Salmora.', lat: 26.961, lng: 94.185, status: 'VERIFIED', hrsAgo: 76 },
      { id: 'demo-rep-8', repId: 'demo-vol-6', repName: 'Gitali Sarmah', district: 'Nagaon', type: 'flood', sev: 'MODERATE', affected: 130, help: 'Medical camp & mosquito nets', desc: 'Kopili river water entering Kampur agricultural fields.', lat: 26.161, lng: 92.651, status: 'VERIFIED', hrsAgo: 102 },
      { id: 'demo-rep-9', repId: 'demo-vol-1', repName: 'Ananya Bora', district: 'Kamrup', type: 'storm', sev: 'MODERATE', affected: 65, help: 'Power line repair & tin sheets', desc: 'Pre-monsoon squall uprooted 12 trees and damaged roofs near Palashbari.', lat: 26.127, lng: 91.522, status: 'VERIFIED', hrsAgo: 128 },
      { id: 'demo-rep-10', repId: 'demo-vol-4', repName: 'Dipika Gogoi', district: 'Jorhat', type: 'lightning', sev: 'MODERATE', affected: 14, help: 'Trauma ambulance & transformer check', desc: 'Lightning strike damaged rural feeder near Titabor.', lat: 26.601, lng: 94.198, status: 'VERIFIED', hrsAgo: 158 },
      { id: 'demo-rep-11', repId: 'demo-vol-6', repName: 'Gitali Sarmah', district: 'Hojai', type: 'flood', sev: 'MODERATE', affected: 95, help: 'Water tankers', desc: 'Jamuna tributary waterlogging in Doboka low-lying wards.', lat: 26.112, lng: 92.852, status: 'VERIFIED', hrsAgo: 196 },
      { id: 'demo-rep-12', repId: 'demo-vol-2', repName: 'Bikram Kalita', district: 'Tinsukia', type: 'fire', sev: 'HIGH', affected: 32, help: 'Fire tenders & burn dressings', desc: 'Short-circuit market fire contained near Makum road; 6 shops damaged.', lat: 27.498, lng: 95.442, status: 'VERIFIED', hrsAgo: 248 },
      { id: 'demo-rep-13', repId: 'demo-vol-3', repName: 'Chandan Das', district: 'Karimganj', type: 'flood', sev: 'LOW', affected: 40, help: 'Drainage clearing', desc: 'Kushiara river levels rising steadily; precautionary watch active.', lat: 24.864, lng: 92.362, status: 'VERIFIED', hrsAgo: 312 },
      { id: 'demo-rep-14', repId: 'demo-vol-5', repName: 'Farhan Ahmed', district: 'Goalpara', type: 'earthquake', sev: 'LOW', affected: 0, help: 'Structural inspection', desc: 'Mild 3.6 magnitude tremor felt; no structural collapse reported.', lat: 26.168, lng: 90.619, status: 'VERIFIED', hrsAgo: 408 },
      { id: 'demo-rep-15', repId: 'demo-vol-7', repName: 'Hemanta Baruah', district: 'Lakhimpur', type: 'flood', sev: 'HIGH', affected: 210, help: 'Verification pending - boat dispatch', desc: 'Subansiri rising rapidly near Chauldhowa ghat; field team assessing.', lat: 27.321, lng: 94.254, status: 'SUBMITTED', hrsAgo: 0.8 },
    ];

    const insertReport = db.prepare(
      `INSERT OR REPLACE INTO reports (id, reporter_id, reporter_name, district, disaster_type, severity, people_affected, urgent_help, description, lat, lng, photo_urls_json, status, reviewed_by, reviewed_by_name, reviewed_at, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 1, ?)`
    );
    for (const r of demoReports) {
      const reviewed = r.status === 'VERIFIED';
      insertReport.run(
        r.id, r.repId, r.repName, r.district, r.type, r.sev, r.affected, r.help, r.desc,
        r.lat, r.lng, r.status,
        reviewed ? 'system-seed' : null,
        reviewed ? 'State Command Admin' : null,
        reviewed ? h(r.hrsAgo - 0.2) : null,
        h(r.hrsAgo)
      );
    }

    // 3 Demo SOS Requests
    const demoSos = [
      {
        id: 'demo-sos-1', userId: 'demo-citizen-1', userName: 'Rituraj Hazarika (Demo)', phone: '9000000101',
        district: 'Kamrup Metropolitan', lat: 26.152, lng: 91.748, acc: 18, source: 'gps',
        note: 'Water entering ground floor in Zoo Road lane, elderly parent needs wheelchair evacuation.',
        status: 'NEW', volId: null, volName: null, esc: 0, escAt: null, escDists: '[]',
        ackAt: null, progAt: null, resAt: null, created: now - 90 * 1000,
      },
      {
        id: 'demo-sos-2', userId: 'demo-citizen-1', userName: 'Pranjal Saikia (Demo)', phone: '9000000102',
        district: 'Dibrugarh', lat: 27.484, lng: 94.922, acc: 25, source: 'gps',
        note: 'Family of 4 stranded on rooftop near Maijan embankment.',
        status: 'IN_PROGRESS', volId: 'demo-vol-2', volName: 'Bikram Kalita', esc: 0, escAt: null, escDists: '[]',
        ackAt: h(0.8), progAt: h(0.5), resAt: null, created: h(1.0),
      },
      {
        id: 'demo-sos-3', userId: 'demo-citizen-1', userName: 'Nandita Dey (Demo)', phone: '9000000103',
        district: 'Cachar', lat: 24.828, lng: 92.781, acc: 40, source: 'pin',
        note: 'Need drinking water & insulin supply; road submerged waist-deep.',
        status: 'ACKNOWLEDGED', volId: 'demo-vol-3', volName: 'Chandan Das', esc: 0, escAt: null, escDists: '[]',
        ackAt: h(0.2), progAt: null, resAt: null, created: h(0.4),
      },
    ];

    const insertSos = db.prepare(
      `INSERT OR REPLACE INTO sos_requests (id, user_id, user_name, phone, district, lat, lng, accuracy, location_source, note, status, assigned_volunteer_id, assigned_volunteer_name, escalated, escalated_at, escalated_districts_json, acknowledged_at, in_progress_at, resolved_at, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    for (const s of demoSos) {
      insertSos.run(
        s.id, s.userId, s.userName, s.phone, s.district, s.lat, s.lng, s.acc, s.source,
        s.note, s.status, s.volId, s.volName, s.esc, s.escAt, s.escDists,
        s.ackAt, s.progAt, s.resAt, s.created, now
      );
    }

    // 3 Demo Early Alerts
    const demoAlerts = [
      {
        id: 'demo-alert-1',
        title: 'Red Flood Warning — Upper Assam Brahmaputra Basin',
        message: 'River levels in Dibrugarh and Dhemaji have crossed danger marks. Move livestock and families to elevated relief camps immediately.',
        severity: 'CRITICAL',
        districts: ['Dibrugarh', 'Dhemaji', 'Lakhimpur', 'Majuli'],
        expiresAt: now + 24 * 3600 * 1000,
      },
      {
        id: 'demo-alert-2',
        title: 'Landslide & Flash Flood Watch — Dima Hasao & Barak Valley',
        message: 'Heavy rainfall (>115mm/24h) forecast. Avoid hill road travel after dusk and stay clear of steep slopes.',
        severity: 'HIGH',
        districts: ['Dima Hasao', 'Cachar', 'Karimganj', 'Hailakandi'],
        expiresAt: now + 18 * 3600 * 1000,
      },
      {
        id: 'demo-alert-3',
        title: 'Urban Waterlogging Advisory — Guwahati & Lower Assam',
        message: 'Localized squalls and drainage overflow expected in low-lying wards. Keep emergency kits and phone power banks charged.',
        severity: 'MODERATE',
        districts: ['Kamrup Metropolitan', 'Kamrup', 'Barpeta', 'Nalbari'],
        expiresAt: now + 12 * 3600 * 1000,
      },
    ];

    const insertAlert = db.prepare(
      `INSERT OR REPLACE INTO alerts (id, title, message, severity, districts_json, expires_at, created_by, created_by_name, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'system-seed', 'ASDMA Warning Desk', 1, ?)`
    );
    for (const a of demoAlerts) {
      insertAlert.run(a.id, a.title, a.message, a.severity, JSON.stringify(a.districts), a.expiresAt, h(1));
    }
  });

  tx();
}
