import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { ASSAM_DISTRICTS, DISTRICT_NAMES, detectDistrictByPoint } from './shared/assamGeo.ts';
import type { DisasterType, GroundingMode, LanguageCode, Role, Severity, ShelterStatus, SosStatus, User } from './shared/types.ts';
import {
  bootstrapEnvAdmin,
  createNotificationForUser,
  db,
  initSchema,
  mapAlertRow,
  mapAuditRow,
  mapNotificationRow,
  mapReportRow,
  mapShelterRow,
  mapSosRow,
  mapUserRow,
  recordAudit,
  seedDemoData,
} from './server/db.ts';
import {
  clearAuthCookie,
  createRateLimiter,
  extractTokenFromRequest,
  hashPassword,
  isValidEmail,
  normalizeIndianPhone,
  sanitizeText,
  setAuthCookie,
  signToken,
  verifyPassword,
  verifyToken,
} from './server/security.ts';
import { realtimeHub } from './server/realtime.ts';
import { escalateSosById, startEscalationWatcher } from './server/escalation.ts';
import { getAssamWeatherAdvisories } from './server/weather.ts';
import { askRescueAssistant, getAssamLiveSearchBrief } from './server/chat.ts';

interface AuthedRequest extends Request {
  user?: User;
}

const VALID_DISASTERS: DisasterType[] = ['flood', 'landslide', 'storm', 'earthquake', 'fire', 'lightning'];
const VALID_SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];
const VALID_SHELTER_STATUSES: ShelterStatus[] = ['open', 'full', 'closed'];
const VALID_SOS_STATUSES: SosStatus[] = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED'];

function loadRequestUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!token) {
    next();
    return;
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    next();
    return;
  }
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(decoded.sub) as
    | Record<string, unknown>
    | undefined;
  if (row) {
    const user = mapUserRow(row);
    if (user.status !== 'deactivated') {
      req.user = user;
    }
  }
  next();
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.status === 'deactivated') {
    res.status(403).json({ error: 'Your account has been deactivated by an administrator.' });
    return;
  }
  next();
}

function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions for this action.' });
      return;
    }
    if (req.user.role === 'volunteer' && req.user.status !== 'active') {
      res.status(403).json({ error: 'Your volunteer account is awaiting admin approval.' });
      return;
    }
    next();
  };
}

async function startServer() {
  initSchema();
  await bootstrapEnvAdmin();
  seedDemoData(false);

  const uploadsDir = path.join(process.cwd(), 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));
  app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));
  app.use(loadRequestUser);

  const authRateLimit = createRateLimiter('auth', 25, 15 * 60 * 1000, (req) => req.ip || 'unknown');
  const sosRateLimit = createRateLimiter(
    'sos',
    3,
    10 * 60 * 1000,
    (req: AuthedRequest) => req.user?.id || req.ip || 'unknown'
  );
  const reportRateLimit = createRateLimiter(
    'report',
    10,
    10 * 60 * 1000,
    (req: AuthedRequest) => req.user?.id || req.ip || 'unknown'
  );
  const chatRateLimit = createRateLimiter(
    'chat',
    20,
    5 * 60 * 1000,
    (req: AuthedRequest) => req.user?.id || req.ip || 'unknown'
  );

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: Date.now() });
  });

  // Setup status
  app.get('/api/auth/setup-status', (_req, res) => {
    const adminCount = (
      db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND status = 'active'`).get() as {
        c: number;
      }
    ).c;
    res.json({ hasAdmin: adminCount > 0 });
  });

  // First-Run Admin Bootstrap (only works when 0 admins exist)
  app.post('/api/auth/bootstrap-admin', authRateLimit, async (req, res) => {
    const adminCount = (
      db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`).get() as { c: number }
    ).c;
    if (adminCount > 0) {
      res.status(403).json({ error: 'An administrator account already exists.' });
      return;
    }

    const name = sanitizeText(req.body?.name, 80) || 'State Command Admin';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const district = DISTRICT_NAMES.includes(req.body?.district) ? req.body.district : 'Kamrup Metropolitan';

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const hash = await hashPassword(password);
    try {
      db.prepare(
        `INSERT INTO users (id, name, email, phone, password_hash, role, status, district, assigned_shelter_id, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, 'admin', 'active', ?, NULL, 0, ?, ?)`
      ).run(id, name, email, hash, district, now, now);
    } catch {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const user = mapUserRow(
      db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown>
    );
    recordAudit(user, 'ADMIN_BOOTSTRAP', 'user', user.id, `Initialized first admin (${email})`);
    const token = signToken({ sub: user.id, role: user.role, status: user.status });
    setAuthCookie(req, res, token);
    res.status(201).json({ user, token });
  });

  // Register (Viewer or Volunteer)
  app.post('/api/auth/register', authRateLimit, async (req, res) => {
    const name = sanitizeText(req.body?.name, 80);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const phone = req.body?.phone ? normalizeIndianPhone(req.body.phone) : null;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const requestedRole = req.body?.role === 'volunteer' ? 'volunteer' : 'viewer';
    const district = DISTRICT_NAMES.includes(req.body?.district) ? req.body.district : 'Kamrup Metropolitan';

    if (name.length < 2) {
      res.status(400).json({ error: 'Name must be at least 2 characters.' });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Valid email address is required.' });
      return;
    }
    if (req.body?.phone && !phone) {
      res.status(400).json({ error: 'Phone must be a valid 10-digit Indian mobile number (starts 6-9).' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const status = requestedRole === 'volunteer' ? 'pending' : 'active';
    const hash = await hashPassword(password);

    db.prepare(
      `INSERT INTO users (id, name, email, phone, password_hash, role, status, district, assigned_shelter_id, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`
    ).run(id, name, email, phone, hash, requestedRole, status, district, now, now);

    const user = mapUserRow(
      db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown>
    );

    if (requestedRole === 'volunteer') {
      const admins = db
        .prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`)
        .all() as Array<{ id: string }>;
      for (const a of admins) {
        const notif = createNotificationForUser(
          a.id,
          'system',
          'New Volunteer Awaiting Approval',
          `${user.name} (${user.district}) registered as a volunteer and needs approval.`,
          'MODERATE',
          user.district,
          user.id
        );
        realtimeHub.broadcastNotification(notif);
      }
      recordAudit(user, 'VOLUNTEER_REGISTERED', 'user', user.id, `Pending approval in ${district}`);
    }

    const token = signToken({ sub: user.id, role: user.role, status: user.status });
    setAuthCookie(req, res, token);
    res.status(201).json({ user, token });
  });

  // Login (email or 10-digit phone + password)
  app.post('/api/auth/login', authRateLimit, async (req, res) => {
    const identifierRaw = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!identifierRaw || !password) {
      res.status(400).json({ error: 'Email/phone and password are required.' });
      return;
    }

    const normalizedPhone = normalizeIndianPhone(identifierRaw);
    const row = normalizedPhone
      ? (db.prepare(`SELECT * FROM users WHERE phone = ?`).get(normalizedPhone) as
          | Record<string, unknown>
          | undefined)
      : (db.prepare(`SELECT * FROM users WHERE email = ?`).get(identifierRaw.toLowerCase()) as
          | Record<string, unknown>
          | undefined);

    if (!row) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const valid = await verifyPassword(password, String(row.password_hash));
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const user = mapUserRow(row);
    if (user.status === 'deactivated') {
      res.status(403).json({ error: 'This account has been deactivated.' });
      return;
    }

    const token = signToken({ sub: user.id, role: user.role, status: user.status });
    setAuthCookie(req, res, token);
    res.json({ user, token });
  });

  // Demo sandbox sign-in (fictional viewer or district volunteer without hardcoded credentials)
  app.post('/api/auth/demo-session', authRateLimit, (req, res) => {
    const mode = req.body?.role === 'volunteer' ? 'volunteer' : 'viewer';
    const district = DISTRICT_NAMES.includes(req.body?.district) ? req.body.district : 'Kamrup Metropolitan';

    if (mode === 'viewer') {
      const row = db.prepare(`SELECT * FROM users WHERE id = 'demo-citizen-1'`).get() as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        res.status(404).json({ error: 'Demo citizen profile unavailable; reset demo data.' });
        return;
      }
      const user = mapUserRow(row);
      const token = signToken({ sub: user.id, role: user.role, status: user.status });
      setAuthCookie(req, res, token);
      res.json({ user, token });
      return;
    }

    // Find active demo volunteer for requested district or fallback to demo-vol-1
    let row = db
      .prepare(
        `SELECT * FROM users WHERE is_demo = 1 AND role = 'volunteer' AND status = 'active' AND district = ? LIMIT 1`
      )
      .get(district) as Record<string, unknown> | undefined;
    if (!row) {
      row = db
        .prepare(`SELECT * FROM users WHERE is_demo = 1 AND role = 'volunteer' AND status = 'active' LIMIT 1`)
        .get() as Record<string, unknown> | undefined;
    }
    if (!row) {
      res.status(404).json({ error: 'No active demo volunteer found.' });
      return;
    }
    const user = mapUserRow(row);
    const token = signToken({ sub: user.id, role: user.role, status: user.status });
    setAuthCookie(req, res, token);
    res.json({ user, token });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearAuthCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req: AuthedRequest, res) => {
    res.json({ user: req.user || null });
  });

  app.patch('/api/auth/profile', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const district = DISTRICT_NAMES.includes(req.body?.district) ? req.body.district : user.district;
    let phone = user.phone;
    if (req.body?.phone !== undefined) {
      if (req.body.phone === '' || req.body.phone === null) {
        phone = null;
      } else {
        const normalized = normalizeIndianPhone(req.body.phone);
        if (!normalized) {
          res.status(400).json({ error: 'Invalid 10-digit Indian phone number (starts 6-9).' });
          return;
        }
        phone = normalized;
      }
    }

    // Volunteers cannot self-reassign their district; only viewers/admins can change personal district
    const nextDistrict = user.role === 'volunteer' ? user.district : district;
    const now = Date.now();
    db.prepare(`UPDATE users SET district = ?, phone = ?, updated_at = ? WHERE id = ?`).run(
      nextDistrict,
      phone,
      now,
      user.id
    );
    const updated = mapUserRow(
      db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as Record<string, unknown>
    );
    res.json({ user: updated });
  });

  // Photo uploads (compressed client-side -> stored on disk, URLs saved in DB)
  app.post('/api/uploads', requireRole('volunteer', 'admin'), (req: AuthedRequest, res) => {
    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
    const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) {
      res.status(400).json({ error: 'Invalid image payload. Expected JPEG, PNG, or WebP.' });
      return;
    }
    const mime = match[1];
    const buf = Buffer.from(match[2], 'base64');
    if (buf.byteLength > 1.2 * 1024 * 1024) {
      res.status(400).json({ error: 'Compressed image exceeds 1.2 MB limit.' });
      return;
    }
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const filename = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buf);
    res.status(201).json({ url: `/uploads/${filename}` });
  });

  // Shelters
  app.get('/api/shelters', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT s.*, u.name AS assigned_volunteer_name
         FROM shelters s
         LEFT JOIN users u ON s.assigned_volunteer_id = u.id
         ORDER BY s.district ASC, s.name ASC`
      )
      .all() as Record<string, unknown>[];
    res.json({ shelters: rows.map(mapShelterRow) });
  });

  app.patch('/api/shelters/:id', requireRole('volunteer', 'admin'), (req: AuthedRequest, res) => {
    const user = req.user!;
    const shelterRow = db.prepare(`SELECT * FROM shelters WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!shelterRow) {
      res.status(404).json({ error: 'Shelter not found.' });
      return;
    }

    const isAssignedVol =
      user.role === 'volunteer' &&
      (shelterRow.assigned_volunteer_id === user.id || user.assignedShelterId === shelterRow.id);

    if (user.role !== 'admin' && !isAssignedVol) {
      res.status(403).json({ error: 'Only the assigned volunteer or an admin can edit this shelter.' });
      return;
    }

    const capacity =
      typeof req.body?.capacity === 'number' && req.body.capacity >= 1 && req.body.capacity <= 10000
        ? Math.floor(req.body.capacity)
        : Number(shelterRow.capacity);

    let occupied =
      typeof req.body?.occupied === 'number' && req.body.occupied >= 0
        ? Math.floor(req.body.occupied)
        : Number(shelterRow.occupied);
    if (occupied > capacity) occupied = capacity;

    let status: ShelterStatus = VALID_SHELTER_STATUSES.includes(req.body?.status)
      ? req.body.status
      : (shelterRow.status as ShelterStatus);

    // Auto "Full" state enforcement
    if (status !== 'closed') {
      status = occupied >= capacity ? 'full' : 'open';
    }

    let facilitiesJson = String(shelterRow.facilities_json);
    if (req.body?.facilities && typeof req.body.facilities === 'object') {
      facilitiesJson = JSON.stringify({
        food: Boolean(req.body.facilities.food),
        water: Boolean(req.body.facilities.water),
        medical: Boolean(req.body.facilities.medical),
        power: Boolean(req.body.facilities.power),
      });
    }

    const now = Date.now();
    db.prepare(
      `UPDATE shelters SET capacity = ?, occupied = ?, status = ?, facilities_json = ?, updated_at = ? WHERE id = ?`
    ).run(capacity, occupied, status, facilitiesJson, now, shelterRow.id);

    const updatedRow = db
      .prepare(
        `SELECT s.*, u.name AS assigned_volunteer_name
         FROM shelters s LEFT JOIN users u ON s.assigned_volunteer_id = u.id
         WHERE s.id = ?`
      )
      .get(shelterRow.id) as Record<string, unknown>;
    const shelter = mapShelterRow(updatedRow);

    recordAudit(
      user,
      'SHELTER_UPDATED',
      'shelter',
      shelter.id,
      `${shelter.name}: ${shelter.occupied}/${shelter.capacity} (${shelter.status})`
    );
    realtimeHub.broadcastAll({ type: 'shelter:updated', payload: shelter });
    res.json({ shelter });
  });

  // Reports
  app.get('/api/reports', (req: AuthedRequest, res) => {
    const user = req.user;
    if (user?.role === 'admin') {
      const rows = db.prepare(`SELECT * FROM reports ORDER BY created_at DESC`).all() as Record<
        string,
        unknown
      >[];
      res.json({ reports: rows.map((r) => mapReportRow(r, false)) });
      return;
    }

    if (user?.role === 'volunteer' && user.status === 'active') {
      // Volunteers see reports ONLY for their assigned district
      const rows = db
        .prepare(`SELECT * FROM reports WHERE district = ? ORDER BY created_at DESC`)
        .all(user.district || '') as Record<string, unknown>[];
      res.json({ reports: rows.map((r) => mapReportRow(r, false)) });
      return;
    }

    // Viewers / public see only VERIFIED reports with coarsened GPS
    const rows = db
      .prepare(`SELECT * FROM reports WHERE status = 'VERIFIED' ORDER BY created_at DESC`)
      .all() as Record<string, unknown>[];
    res.json({ reports: rows.map((r) => mapReportRow(r, true)) });
  });

  app.post('/api/reports', requireRole('volunteer', 'admin'), reportRateLimit, (req: AuthedRequest, res) => {
    const user = req.user!;
    const disasterType = req.body?.disasterType as DisasterType;
    const severity = req.body?.severity as Severity;
    const peopleAffected = Math.max(0, Math.min(1000000, Number(req.body?.peopleAffected || 0)));
    const urgentHelp = sanitizeText(req.body?.urgentHelp, 180);
    const description = sanitizeText(req.body?.description, 1500);
    const lat = typeof req.body?.lat === 'number' && Number.isFinite(req.body.lat) ? req.body.lat : null;
    const lng = typeof req.body?.lng === 'number' && Number.isFinite(req.body.lng) ? req.body.lng : null;

    if (!VALID_DISASTERS.includes(disasterType)) {
      res.status(400).json({ error: 'Invalid disaster type.' });
      return;
    }
    if (!VALID_SEVERITIES.includes(severity)) {
      res.status(400).json({ error: 'Invalid severity.' });
      return;
    }
    if (description.length < 10) {
      res.status(400).json({ error: 'Description must be at least 10 characters.' });
      return;
    }

    let district = DISTRICT_NAMES.includes(req.body?.district) ? req.body.district : '';
    if (!district && lat !== null && lng !== null) {
      district = detectDistrictByPoint(lat, lng).district;
    }
    if (!district) {
      district = user.district || 'Kamrup Metropolitan';
    }
    // Volunteers can only file for their district unless admin
    if (user.role === 'volunteer' && user.district && district !== user.district) {
      district = user.district;
    }

    const rawPhotos = Array.isArray(req.body?.photoUrls) ? req.body.photoUrls : [];
    const photoUrls = rawPhotos
      .filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('/uploads/'))
      .slice(0, 3);

    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      `INSERT INTO reports (id, reporter_id, reporter_name, district, disaster_type, severity, people_affected, urgent_help, description, lat, lng, photo_urls_json, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 0, ?)`
    ).run(
      id,
      user.id,
      user.name,
      district,
      disasterType,
      severity,
      Math.floor(peopleAffected),
      urgentHelp || 'Field assessment needed',
      description,
      lat,
      lng,
      JSON.stringify(photoUrls),
      now
    );

    const report = mapReportRow(
      db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as Record<string, unknown>,
      false
    );

    // Notify admins of new pending report
    const admins = db
      .prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`)
      .all() as Array<{ id: string }>;
    for (const a of admins) {
      const notif = createNotificationForUser(
        a.id,
        'report',
        `New ${severity} ${disasterType} report in ${district}`,
        `${user.name} submitted a report awaiting verification (${peopleAffected} affected).`,
        severity,
        district,
        report.id
      );
      realtimeHub.broadcastNotification(notif);
    }

    recordAudit(user, 'REPORT_SUBMITTED', 'report', report.id, `${disasterType}/${severity} in ${district}`);
    realtimeHub.broadcastReport('report:created', report);
    res.status(201).json({ report });
  });

  app.patch('/api/reports/:id/review', requireRole('admin'), (req: AuthedRequest, res) => {
    const admin = req.user!;
    const decision = req.body?.status === 'VERIFIED' ? 'VERIFIED' : req.body?.status === 'REJECTED' ? 'REJECTED' : null;
    if (!decision) {
      res.status(400).json({ error: 'Decision must be VERIFIED or REJECTED.' });
      return;
    }

    const existing = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const now = Date.now();
    db.prepare(
      `UPDATE reports SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ? WHERE id = ?`
    ).run(decision, admin.id, admin.name, now, req.params.id);

    const report = mapReportRow(
      db.prepare(`SELECT * FROM reports WHERE id = ?`).get(req.params.id) as Record<string, unknown>,
      false
    );

    const notif = createNotificationForUser(
      report.reporterId,
      'report',
      `Report ${decision}: ${report.district}`,
      `Your ${report.disasterType} report was marked ${decision} by ${admin.name}.`,
      report.severity,
      report.district,
      report.id
    );
    realtimeHub.broadcastNotification(notif);

    recordAudit(admin, `REPORT_${decision}`, 'report', report.id, `${report.district} (${report.disasterType})`);
    realtimeHub.broadcastReport('report:updated', report);
    res.json({ report });
  });

  // SOS Requests
  app.get('/api/sos', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role === 'admin') {
      const rows = db.prepare(`SELECT * FROM sos_requests ORDER BY created_at DESC`).all() as Record<
        string,
        unknown
      >[];
      res.json({ sosList: rows.map((r) => mapSosRow(r, false)) });
      return;
    }

    if (user.role === 'volunteer' && user.status === 'active') {
      const district = user.district || '';
      const rows = db
        .prepare(
          `SELECT * FROM sos_requests
           WHERE district = ? OR (escalated = 1 AND escalated_districts_json LIKE ?)
           ORDER BY created_at DESC`
        )
        .all(district, `%"${district}"%`) as Record<string, unknown>[];

      const sosList = rows.map((r) => {
        const assignedId = r.assigned_volunteer_id ? String(r.assigned_volunteer_id) : null;
        // Phone & exact GPS visible only to assigned volunteer (or before anyone claims it) and admins
        const redact = Boolean(assignedId && assignedId !== user.id && String(r.user_id) !== user.id);
        return mapSosRow(r, redact);
      });
      res.json({ sosList });
      return;
    }

    // Viewers see ONLY their own SOS requests
    const rows = db
      .prepare(`SELECT * FROM sos_requests WHERE user_id = ? ORDER BY created_at DESC`)
      .all(user.id) as Record<string, unknown>[];
    res.json({ sosList: rows.map((r) => mapSosRow(r, false)) });
  });

  app.post('/api/sos', requireAuth, sosRateLimit, (req: AuthedRequest, res) => {
    const user = req.user!;
    const consent = req.body?.consent === true;
    const phone = normalizeIndianPhone(req.body?.phone);
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const accuracy = typeof req.body?.accuracy === 'number' ? req.body.accuracy : null;
    const locationSource = req.body?.locationSource === 'pin' ? 'pin' : 'gps';
    const note = sanitizeText(req.body?.note, 500);

    if (!consent) {
      res.status(400).json({ error: 'Emergency location sharing consent is required.' });
      return;
    }
    if (!phone) {
      res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number starting with 6-9.' });
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 30 || lng < 88 || lng > 98) {
      res.status(400).json({ error: 'Valid Assam GPS coordinates or map pin are required.' });
      return;
    }

    // Server-side authoritative point-in-polygon district detection
    const detected = detectDistrictByPoint(lat, lng);
    const district = detected.district;
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      `INSERT INTO sos_requests (id, user_id, user_name, phone, district, lat, lng, accuracy, location_source, note, status, escalated, escalated_districts_json, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', 0, '[]', 0, ?, ?)`
    ).run(id, user.id, user.name, phone, district, lat, lng, accuracy, locationSource, note, now, now);

    let sos = mapSosRow(
      db.prepare(`SELECT * FROM sos_requests WHERE id = ?`).get(id) as Record<string, unknown>,
      false
    );

    // Notify active volunteers in this district
    const districtVols = db
      .prepare(`SELECT id FROM users WHERE role = 'volunteer' AND status = 'active' AND district = ?`)
      .all(district) as Array<{ id: string }>;

    for (const v of districtVols) {
      const notif = createNotificationForUser(
        v.id,
        'sos',
        `NEW SOS in ${district}`,
        `${user.name} triggered an SOS${note ? `: ${note}` : '.'}`,
        'CRITICAL',
        district,
        sos.id
      );
      realtimeHub.broadcastNotification(notif);
    }

    recordAudit(user, 'SOS_CREATED', 'sos', sos.id, `District: ${district} (${locationSource})`);
    realtimeHub.broadcastSos('sos:created', sos);

    // If no active volunteer is assigned in this district, escalate immediately!
    if (districtVols.length === 0) {
      escalateSosById(sos.id, `No active volunteer in ${district}`);
      sos = mapSosRow(
        db.prepare(`SELECT * FROM sos_requests WHERE id = ?`).get(id) as Record<string, unknown>,
        false
      );
    }

    res.status(201).json({ sos });
  });

  app.patch('/api/sos/:id/status', requireRole('volunteer', 'admin'), (req: AuthedRequest, res) => {
    const actor = req.user!;
    const nextStatus = req.body?.status as SosStatus;
    if (!VALID_SOS_STATUSES.includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid SOS status.' });
      return;
    }

    const row = db.prepare(`SELECT * FROM sos_requests WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'SOS request not found.' });
      return;
    }

    const currentStatus = String(row.status) as SosStatus;
    const district = String(row.district);
    let escalatedDistricts: string[] = [];
    try {
      escalatedDistricts = JSON.parse(String(row.escalated_districts_json || '[]'));
    } catch {
      escalatedDistricts = [];
    }

    if (actor.role === 'volunteer') {
      const allowedDistrict =
        actor.district === district || (Boolean(row.escalated) && escalatedDistricts.includes(actor.district || ''));
      if (!allowedDistrict) {
        res.status(403).json({ error: 'You can only respond to SOS requests in your assigned district.' });
        return;
      }
      if (row.assigned_volunteer_id && row.assigned_volunteer_id !== actor.id) {
        res.status(403).json({ error: 'Another volunteer is already assigned to this SOS.' });
        return;
      }
    }

    // Enforce step-by-step progression (unless admin)
    const allowedTransitions: Record<SosStatus, SosStatus[]> = {
      NEW: ['ACKNOWLEDGED'],
      ACKNOWLEDGED: ['IN_PROGRESS', 'RESOLVED'],
      IN_PROGRESS: ['RESOLVED'],
      RESOLVED: [],
    };
    if (actor.role !== 'admin' && !allowedTransitions[currentStatus].includes(nextStatus)) {
      res.status(400).json({ error: `Cannot transition SOS from ${currentStatus} to ${nextStatus}.` });
      return;
    }

    const now = Date.now();
    const assignedId = row.assigned_volunteer_id ? String(row.assigned_volunteer_id) : actor.id;
    const assignedName = row.assigned_volunteer_name ? String(row.assigned_volunteer_name) : actor.name;
    const ackAt = row.acknowledged_at ? Number(row.acknowledged_at) : nextStatus === 'ACKNOWLEDGED' ? now : null;
    const progAt = row.in_progress_at ? Number(row.in_progress_at) : nextStatus === 'IN_PROGRESS' ? now : null;
    const resAt = row.resolved_at ? Number(row.resolved_at) : nextStatus === 'RESOLVED' ? now : null;

    db.prepare(
      `UPDATE sos_requests
       SET status = ?, assigned_volunteer_id = ?, assigned_volunteer_name = ?,
           acknowledged_at = ?, in_progress_at = ?, resolved_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, assignedId, assignedName, ackAt, progAt, resAt, now, req.params.id);

    const sos = mapSosRow(
      db.prepare(`SELECT * FROM sos_requests WHERE id = ?`).get(req.params.id) as Record<string, unknown>,
      false
    );

    const citizenNotif = createNotificationForUser(
      sos.userId,
      'sos',
      `SOS Update: ${nextStatus.replace('_', ' ')}`,
      `${actor.name} updated your ${district} SOS to ${nextStatus.replace('_', ' ')}.`,
      nextStatus === 'RESOLVED' ? 'LOW' : 'HIGH',
      district,
      sos.id
    );
    realtimeHub.broadcastNotification(citizenNotif);

    recordAudit(actor, `SOS_${nextStatus}`, 'sos', sos.id, `${district} SOS updated by ${actor.name}`);
    realtimeHub.broadcastSos('sos:updated', sos);
    res.json({ sos });
  });

  app.post('/api/sos/:id/escalate', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const row = db.prepare(`SELECT * FROM sos_requests WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'SOS request not found.' });
      return;
    }
    if (user.role !== 'admin' && String(row.user_id) !== user.id) {
      res.status(403).json({ error: 'Unauthorized to escalate this SOS.' });
      return;
    }
    const elapsed = Date.now() - Number(row.created_at);
    if (user.role !== 'admin' && elapsed < 5 * 60 * 1000) {
      res.status(400).json({ error: 'Auto-escalation triggers after 5 minutes without acknowledgement.' });
      return;
    }
    escalateSosById(String(row.id), user.role === 'admin' ? 'Manual command escalation' : '5-minute response timeout');
    const updated = mapSosRow(
      db.prepare(`SELECT * FROM sos_requests WHERE id = ?`).get(row.id) as Record<string, unknown>,
      false
    );
    res.json({ sos: updated });
  });

  // Early Alerts
  app.get('/api/alerts', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50`).all() as Record<
      string,
      unknown
    >[];
    res.json({ alerts: rows.map(mapAlertRow) });
  });

  app.post('/api/alerts', requireRole('admin'), (req: AuthedRequest, res) => {
    const admin = req.user!;
    const title = sanitizeText(req.body?.title, 160);
    const message = sanitizeText(req.body?.message, 1000);
    const severity = req.body?.severity as Severity;
    const rawDistricts = Array.isArray(req.body?.districts) ? req.body.districts : [];
    const districts = rawDistricts.filter((d: unknown): d is string => typeof d === 'string' && DISTRICT_NAMES.includes(d));
    const hours = Math.max(1, Math.min(168, Number(req.body?.hours || 24)));

    if (title.length < 4 || message.length < 10) {
      res.status(400).json({ error: 'Title (min 4 chars) and message (min 10 chars) are required.' });
      return;
    }
    if (!VALID_SEVERITIES.includes(severity)) {
      res.status(400).json({ error: 'Invalid alert severity.' });
      return;
    }
    if (districts.length === 0) {
      res.status(400).json({ error: 'Select at least one Assam district.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + hours * 3600 * 1000;
    db.prepare(
      `INSERT INTO alerts (id, title, message, severity, districts_json, expires_at, created_by, created_by_name, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(id, title, message, severity, JSON.stringify(districts), expiresAt, admin.id, admin.name, now);

    const alert = mapAlertRow(
      db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(id) as Record<string, unknown>
    );

    const placeholders = districts.map(() => '?').join(',');
    const targetUsers = db
      .prepare(`SELECT id FROM users WHERE status = 'active' AND district IN (${placeholders})`)
      .all(...districts) as Array<{ id: string }>;

    for (const tu of targetUsers) {
      const notif = createNotificationForUser(
        tu.id,
        'alert',
        `Early Warning (${severity}): ${title}`,
        message,
        severity,
        districts[0] || null,
        alert.id
      );
      realtimeHub.broadcastNotification(notif);
    }

    recordAudit(admin, 'ALERT_PUBLISHED', 'alert', alert.id, `${severity} for ${districts.join(', ')}`);
    realtimeHub.broadcastAll({ type: 'alert:created', payload: alert });
    res.status(201).json({ alert });
  });

  // Live Assam Weather / Flood Advisories
  app.get('/api/weather/assam', async (_req, res) => {
    const advisories = await getAssamWeatherAdvisories();
    res.json({ advisories });
  });

  // Live Assam Search-Grounded Bulletin Brief (IMD / ASDMA via Gemini + googleSearch)
  app.get('/api/alerts/live-brief', chatRateLimit, async (req, res) => {
    const forceRefresh = req.query?.refresh === '1';
    const brief = await getAssamLiveSearchBrief(forceRefresh);
    res.json({ brief });
  });

  // Per-user Notifications
  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`)
      .all(req.user!.id) as Record<string, unknown>[];
    res.json({ notifications: rows.map(mapNotificationRow) });
  });

  app.patch('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    const isRead = req.body?.isRead === false ? 0 : 1;
    db.prepare(`UPDATE notifications SET is_read = ? WHERE id = ? AND user_id = ?`).run(
      isRead,
      req.params.id,
      req.user!.id
    );
    res.json({ ok: true });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user!.id);
    res.json({ ok: true });
  });

  // Admin Console Routes
  app.get('/api/admin/users', requireRole('admin'), (_req, res) => {
    const rows = db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as Record<
      string,
      unknown
    >[];
    res.json({ users: rows.map(mapUserRow) });
  });

  app.patch('/api/admin/users/:id', requireRole('admin'), (req: AuthedRequest, res) => {
    const admin = req.user!;
    const targetRow = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!targetRow) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const nextStatus = ['pending', 'active', 'deactivated'].includes(req.body?.status)
      ? req.body.status
      : String(targetRow.status);
    const nextRole = ['viewer', 'volunteer', 'admin'].includes(req.body?.role)
      ? req.body.role
      : String(targetRow.role);
    const nextDistrict = DISTRICT_NAMES.includes(req.body?.district)
      ? req.body.district
      : targetRow.district
        ? String(targetRow.district)
        : null;
    const nextShelterId =
      req.body?.assignedShelterId === null || req.body?.assignedShelterId === ''
        ? null
        : typeof req.body?.assignedShelterId === 'string'
          ? req.body.assignedShelterId
          : targetRow.assigned_shelter_id
            ? String(targetRow.assigned_shelter_id)
            : null;

    // Prevent admin from deactivating themselves accidentally
    if (targetRow.id === admin.id && nextStatus === 'deactivated') {
      res.status(400).json({ error: 'Cannot deactivate your own active admin account.' });
      return;
    }

    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE users SET status = ?, role = ?, district = ?, assigned_shelter_id = ?, updated_at = ? WHERE id = ?`
      ).run(nextStatus, nextRole, nextDistrict, nextShelterId, now, targetRow.id);

      if (nextShelterId) {
        db.prepare(`UPDATE shelters SET assigned_volunteer_id = ?, updated_at = ? WHERE id = ?`).run(
          targetRow.id,
          now,
          nextShelterId
        );
      }
    });
    tx();

    const updatedUser = mapUserRow(
      db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetRow.id) as Record<string, unknown>
    );

    const notif = createNotificationForUser(
      updatedUser.id,
      'system',
      'Account Assignment Updated',
      `Role: ${updatedUser.role} · Status: ${updatedUser.status} · District: ${updatedUser.district || 'Unassigned'}`,
      'LOW',
      updatedUser.district,
      updatedUser.id
    );
    realtimeHub.broadcastNotification(notif);

    if (nextShelterId) {
      const shRow = db
        .prepare(
          `SELECT s.*, u.name AS assigned_volunteer_name
           FROM shelters s LEFT JOIN users u ON s.assigned_volunteer_id = u.id WHERE s.id = ?`
        )
        .get(nextShelterId) as Record<string, unknown> | undefined;
      if (shRow) {
        realtimeHub.broadcastAll({ type: 'shelter:updated', payload: mapShelterRow(shRow) });
      }
    }

    recordAudit(
      admin,
      'USER_UPDATED',
      'user',
      updatedUser.id,
      `${updatedUser.name}: role=${updatedUser.role}, status=${updatedUser.status}, district=${updatedUser.district || 'none'}`
    );
    realtimeHub.broadcastAll({ type: 'user:updated', payload: { userId: updatedUser.id } });
    res.json({ user: updatedUser });
  });

  app.get('/api/admin/audit-logs', requireRole('admin'), (_req, res) => {
    const rows = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200`).all() as Record<
      string,
      unknown
    >[];
    res.json({ logs: rows.map(mapAuditRow) });
  });

  app.post('/api/admin/reset-demo', requireRole('admin'), (req: AuthedRequest, res) => {
    seedDemoData(true);
    recordAudit(req.user!, 'DEMO_DATA_RESET', 'system', 'demo', 'Reset fictional Assam demo dataset');
    realtimeHub.broadcastAll({ type: 'demo:reset', payload: { ts: Date.now() } });
    res.json({ ok: true });
  });

  // Offline Action Log Sync Endpoint (records telemetry for offline SOS presses/SMS fallbacks upon reconnect)
  app.post('/api/offline-sync-log', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const actionType = sanitizeText(req.body?.actionType, 40) || 'OFFLINE_ACTION';
    const detail = sanitizeText(req.body?.detail, 300) || 'Synced offline action';
    const refLocalId = sanitizeText(req.body?.refLocalId, 80) || crypto.randomUUID();
    recordAudit(user, `OFFLINE_${actionType}`, 'offline_log', refLocalId, detail);
    res.status(201).json({ ok: true, serverId: refLocalId });
  });

  // Rescue Assistant Chatbot (Server-side Gemini API + Google Maps Grounding)
  app.post('/api/chat', chatRateLimit, async (req: AuthedRequest, res) => {
    const message = sanitizeText(req.body?.message, 1000);
    if (!message) {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }
    const language: LanguageCode = ['en', 'as', 'hi'].includes(req.body?.language)
      ? req.body.language
      : 'en';
    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .slice(-8)
          .map((h: { role?: unknown; text?: unknown }) => ({
            role: (h.role === 'model' ? 'model' : 'user') as 'user' | 'model',
            text: sanitizeText(h.text, 800),
          }))
          .filter((h: { text: string }) => h.text.length > 0)
      : [];

    const rawLoc = req.body?.userLocation;
    const userLocation =
      rawLoc &&
      typeof rawLoc.lat === 'number' &&
      typeof rawLoc.lng === 'number' &&
      Number.isFinite(rawLoc.lat) &&
      Number.isFinite(rawLoc.lng)
        ? { lat: rawLoc.lat, lng: rawLoc.lng }
        : null;

    const groundingMode: GroundingMode = ['auto', 'maps', 'search'].includes(req.body?.groundingMode)
      ? req.body.groundingMode
      : 'auto';

    try {
      const result = await askRescueAssistant({
        message,
        history,
        language,
        userDistrict: req.user?.district || (typeof req.body?.district === 'string' ? req.body.district : null),
        userLocation,
        groundingMode,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Rescue assistant temporarily unavailable.';
      res.status(502).json({ error: msg });
    }
  });

  // Reference endpoint for Assam districts
  app.get('/api/meta/districts', (_req, res) => {
    res.json({ districts: ASSAM_DISTRICTS });
  });

  const httpServer = http.createServer(app);
  realtimeHub.attach(httpServer);
  startEscalationWatcher();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`DisasterGuard Assam server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
