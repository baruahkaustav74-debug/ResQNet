export type Role = 'viewer' | 'volunteer' | 'admin';
export type UserStatus = 'pending' | 'active' | 'deactivated';
export type Severity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
export type DisasterType = 'flood' | 'landslide' | 'storm' | 'earthquake' | 'fire' | 'lightning';
export type ReportStatus = 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
export type SosStatus = 'NEW' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED';
export type ShelterStatus = 'open' | 'full' | 'closed';
export type LanguageCode = 'en' | 'as' | 'hi';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  district: string | null;
  assignedShelterId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ShelterFacilities {
  food: boolean;
  water: boolean;
  medical: boolean;
  power: boolean;
}

export interface Shelter {
  id: string;
  name: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  capacity: number;
  occupied: number;
  contactName: string;
  contactPhone: string;
  facilities: ShelterFacilities;
  status: ShelterStatus;
  assignedVolunteerId: string | null;
  assignedVolunteerName?: string | null;
  updatedAt: number;
}

export interface DisasterReport {
  id: string;
  reporterId: string;
  reporterName: string;
  district: string;
  disasterType: DisasterType;
  severity: Severity;
  peopleAffected: number;
  urgentHelp: string;
  description: string;
  lat: number | null;
  lng: number | null;
  photoUrls: string[];
  status: ReportStatus;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: number | null;
  createdAt: number;
}

export interface SosRequest {
  id: string;
  userId: string;
  userName: string;
  phone: string | null;
  district: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  locationSource: 'gps' | 'pin';
  note: string;
  status: SosStatus;
  assignedVolunteerId: string | null;
  assignedVolunteerName: string | null;
  escalated: boolean;
  escalatedAt: number | null;
  escalatedDistricts: string[];
  acknowledgedAt: number | null;
  inProgressAt: number | null;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface EarlyAlert {
  id: string;
  title: string;
  message: string;
  severity: Severity;
  districts: string[];
  expiresAt: number;
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: 'sos' | 'report' | 'alert' | 'system';
  title: string;
  body: string;
  severity: Severity;
  district: string | null;
  refId: string | null;
  isRead: boolean;
  createdAt: number;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: number;
}

export interface WeatherAdvisory {
  station: string;
  district: string;
  lat: number;
  lng: number;
  temperatureC: number;
  precipitationMm: number;
  rain24hMm: number;
  windKmh: number;
  advisoryLevel: Severity;
  summary: string;
  updatedAt: number;
}

export interface RealtimeEvent {
  type:
    | 'connected'
    | 'sos:created'
    | 'sos:updated'
    | 'sos:escalated'
    | 'report:created'
    | 'report:updated'
    | 'shelter:updated'
    | 'alert:created'
    | 'notification:created'
    | 'user:updated'
    | 'demo:reset';
  payload: unknown;
}

export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MODERATE: 2,
  LOW: 1,
};

export const OFFICIAL_EMERGENCY_NUMBERS = [
  { label: 'National Emergency (ERSS)', number: '112', description: 'Police, Fire & Rescue Dispatch' },
  { label: 'Assam State Disaster Control (ASDMA)', number: '1070', description: '24x7 State Emergency Operation Centre' },
  { label: 'District Disaster Helpline (DEOC)', number: '1077', description: 'Toll-Free District Control Room' },
  { label: 'Emergency Ambulance (Mrityunjoy)', number: '108', description: 'Medical & Trauma Evacuation' },
] as const;

export type GroundingMode = 'auto' | 'maps' | 'search';

export interface MapGroundingLink {
  title: string;
  uri: string;
  snippet?: string;
}

export interface WebGroundingLink {
  title: string;
  uri: string;
}

export interface LiveAssamBrief {
  summary: string;
  webSources: WebGroundingLink[];
  modelUsed: string;
  updatedAt: number;
}

export type OfflineActionType =
  | 'SOS_PRESS'
  | 'SOS_QUEUED'
  | 'SOS_SMS_FALLBACK'
  | 'REPORT_QUEUED'
  | 'PIN_ADJUSTED';

export type OfflineLogStatus = 'logged' | 'queued' | 'syncing' | 'synced' | 'failed';

export interface OfflineActionLog {
  id: string;
  refLocalId?: string;
  actionType: OfflineActionType;
  title: string;
  detail: string;
  district?: string;
  offlineWhenTriggered: boolean;
  status: OfflineLogStatus;
  errorMessage?: string;
  serverId?: string;
  createdAt: number;
  syncedAt?: number;
}

export interface SyncProgressState {
  active: boolean;
  phase: 'idle' | 'syncing' | 'completed' | 'partial_error';
  total: number;
  completed: number;
  failed: number;
  currentLabel: string | null;
  lastCompletedAt: number | null;
}

