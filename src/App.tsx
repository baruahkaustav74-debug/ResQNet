import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  Bell,
  Bot,
  Building2,
  FileWarning,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Moon,
  PhoneCall,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { OFFICIAL_EMERGENCY_NUMBERS, type LanguageCode } from '../shared/types';
import { LANGUAGE_LABELS, TRANSLATIONS } from './i18n/translations';
import { AppDataProvider, useAppData } from './features/auth/AuthContext';
import { AuthModal, type AuthTab } from './features/auth/AuthModal';
import { DashboardView } from './features/dashboard/DashboardView';
import { DisasterMapView } from './features/map/DisasterMapView';
import { SosView } from './features/sos/SosView';
import { SheltersView } from './features/shelters/SheltersView';
import { ReportsView } from './features/reports/ReportsView';
import { AlertsView } from './features/alerts/AlertsView';
import { AdminView } from './features/admin/AdminView';
import { NotificationsView } from './features/notifications/NotificationsView';
import { RescueChatDrawer } from './features/chat/RescueChatDrawer';
import { PWAInstallButton } from './features/offline/PWAInstallButton';
import { OfflineSyncPanel } from './features/offline/OfflineSyncPanel';

type ActiveTab =
  | 'dashboard'
  | 'map'
  | 'sos'
  | 'shelters'
  | 'reports'
  | 'alerts'
  | 'notifications'
  | 'admin';

const Shell: React.FC = () => {
  const {
    user,
    hasAdmin,
    wsConnected,
    isOnline,
    alerts,
    notifications,
    pendingSyncCount,
    logout,
  } = useAppData();

  const [tab, setTab] = useState<ActiveTab>('dashboard');
  const [lang, setLang] = useState<LanguageCode>(
    () => (localStorage.getItem('dg_lang') as LanguageCode) || 'en'
  );
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('dg_theme');
    return saved ? saved === 'dark' : true;
  });
  const [lowDataMode, setLowDataMode] = useState<boolean>(
    () => localStorage.getItem('dg_lowdata') === 'true'
  );
  const [authOpen, setAuthOpen] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState<AuthTab | undefined>(undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dismissedAlertId, setDismissedAlertId] = useState<string | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  const t = TRANSLATIONS[lang];

  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  useEffect(() => {
    localStorage.setItem('dg_lang', lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('dg_theme', dark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', dark);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', dark ? '#0B1120' : '#F8FAFC');
    }
  }, [dark]);

  useEffect(() => {
    localStorage.setItem('dg_lowdata', String(lowDataMode));
  }, [lowDataMode]);

  const now = Date.now();
  const activeDistrictAlert = alerts.find(
    (a) =>
      a.expiresAt > now &&
      a.id !== dismissedAlertId &&
      (!user?.district || a.districts.includes(user.district))
  );

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const navItems: Array<{ id: ActiveTab; label: string; icon: React.FC<{ className?: string }>; badge?: number }> = [
    { id: 'dashboard', label: t.navDashboard, icon: LayoutDashboard },
    { id: 'map', label: t.navMap, icon: MapIcon },
    { id: 'sos', label: t.navSos, icon: AlertOctagon },
    { id: 'shelters', label: t.navShelters, icon: Building2 },
    { id: 'reports', label: t.navReports, icon: FileWarning },
    { id: 'alerts', label: t.navAlerts, icon: ShieldAlert },
    { id: 'notifications', label: t.navNotifications, icon: Bell, badge: unreadCount },
    ...(user?.role === 'admin' ? [{ id: 'admin' as const, label: t.navAdmin, icon: ShieldCheck }] : []),
  ];

  const selectTab = (next: ActiveTab) => {
    setTab(next);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openAuth = (requestedTab?: AuthTab) => {
    setAuthInitialTab(requestedTab);
    setAuthOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95">
        <div className="h-14 px-5 flex items-center border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => selectTab('dashboard')}
            className="font-display text-lg font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap"
          >
            {t.appName}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center justify-between text-sm font-semibold transition-colors ${
                  active
                    ? item.id === 'sos'
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-900 text-white dark:bg-sky-600'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="font-mono text-xs font-bold text-red-500 dark:text-red-300">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-medium">
              {isOnline ? (
                <>
                  <Wifi className={`w-3.5 h-3.5 ${wsConnected ? 'text-emerald-500' : 'text-amber-500'}`} />
                  <span>{wsConnected ? t.online : 'Connecting...'}</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-amber-500">{t.offline}</span>
                </>
              )}
            </span>
            {pendingSyncCount > 0 && (
              <span className="font-mono font-bold text-amber-500">
                {pendingSyncCount} {t.pendingSync}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="Language"
              value={lang}
              onChange={(e) => setLang(e.target.value as LanguageCode)}
              className="min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 text-xs font-medium"
            >
              {(Object.keys(LANGUAGE_LABELS) as LanguageCode[]).map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[code]}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className="min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 px-2.5 flex items-center justify-center gap-1.5 font-medium"
            >
              {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{dark ? t.lightMode : t.darkMode}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setLowDataMode((v) => !v)}
            className={`w-full min-h-[38px] rounded-xl border px-3 text-xs font-semibold transition-colors ${
              lowDataMode
                ? 'border-sky-500 bg-sky-500/15 text-sky-600 dark:text-sky-300'
                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
            }`}
          >
            {t.lowDataMode}: {lowDataMode ? 'ON' : 'OFF'}
          </button>

          <PWAInstallButton label={t.installApp} />

          {user ? (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-slate-900 dark:text-white truncate">{user.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {user.role} · {user.district || 'Assam'}
                </p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                aria-label={t.signOut}
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="w-full min-h-[44px] rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
            >
              {hasAdmin ? t.signIn : 'Sign In / Demo / Setup'}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 pb-20 lg:pb-0">
        {/* Clean 3-Zone Top Bar */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 bg-white/90 dark:bg-[#0B1120]/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => selectTab('dashboard')}
              className="font-display text-base font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 lg:hidden"
            >
              {t.appName}
            </button>
            <span className="hidden lg:inline text-sm font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0">
              {navItems.find((n) => n.id === tab)?.label || t.navDashboard}
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-600 dark:text-slate-400">
            <button type="button" onClick={() => selectTab('map')} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
              {t.navMap}
            </button>
            <button type="button" onClick={() => selectTab('shelters')} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
              {t.navShelters}
            </button>
            <button type="button" onClick={() => selectTab('reports')} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
              {t.navReports}
            </button>
            <button type="button" onClick={() => selectTab('alerts')} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
              {t.navAlerts}
            </button>
            <button type="button" onClick={() => setChatOpen(true)} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
              {t.rescueAssistant}
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => (user ? selectTab('sos') : openAuth('login'))}
              className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold whitespace-nowrap shrink-0"
            >
              {user ? t.sosButton : t.signIn}
            </button>
          </div>
        </header>

        {/* Google Maps Platform Quota Exceeded Banner (Demo Key Specialization) */}
        {mapsQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}

        {/* Offline Activity Logging & Reconnect Sync Progress Visualization */}
        <OfflineSyncPanel />

        {/* Active District Early Warning Banner */}
        {activeDistrictAlert && (
          <div className="px-4 sm:px-6 pt-3">
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start justify-between gap-3">
              <div className="space-y-0.5 text-xs">
                <p className="font-bold text-red-700 dark:text-red-300">
                  {activeDistrictAlert.severity} ALERT · {activeDistrictAlert.title}
                </p>
                <p className="text-red-700/90 dark:text-red-200/90">
                  {activeDistrictAlert.message} ({activeDistrictAlert.districts.join(', ')})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDismissedAlertId(activeDistrictAlert.id)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-600 dark:text-red-300 shrink-0"
                aria-label="Dismiss alert banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {tab === 'dashboard' && (
            <DashboardView
              lang={lang}
              lowDataMode={lowDataMode}
              onNavigate={selectTab}
              onOpenAuth={openAuth}
            />
          )}
          {tab === 'map' && <DisasterMapView lang={lang} lowDataMode={lowDataMode} />}
          {tab === 'sos' && (
            <SosView lang={lang} lowDataMode={lowDataMode} onOpenAuth={() => openAuth('login')} />
          )}
          {tab === 'shelters' && <SheltersView lang={lang} />}
          {tab === 'reports' && <ReportsView lang={lang} lowDataMode={lowDataMode} />}
          {tab === 'alerts' && <AlertsView lang={lang} />}
          {tab === 'notifications' && <NotificationsView lang={lang} />}
          {tab === 'admin' && <AdminView />}
        </main>

        {/* Proper Website Footer */}
        <footer className="mt-8 border-t border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 px-4 sm:px-6 py-8">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            <div className="space-y-2">
              <p className="font-display text-sm font-bold text-slate-900 dark:text-white">
                {t.appName} — Assam
              </p>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Real-time emergency coordination platform connecting citizens, field volunteers, and disaster control authorities across all 35 districts of Assam.
              </p>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-slate-800 dark:text-slate-200">{t.emergencyNumbers}</p>
              <div className="grid grid-cols-2 gap-2">
                {OFFICIAL_EMERGENCY_NUMBERS.map((n) => (
                  <a
                    key={n.number}
                    href={`tel:${n.number}`}
                    className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-red-500"
                  >
                    <PhoneCall className="w-3 h-3 text-red-500 shrink-0" />
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-200">{n.number}</span>
                    <span className="truncate">{n.label.split(' ')[0]}</span>
                  </a>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-slate-800 dark:text-slate-200">Quick Access</p>
              <div className="flex flex-wrap gap-3 text-slate-600 dark:text-slate-400">
                <button type="button" onClick={() => selectTab('map')} className="hover:underline">
                  District Map
                </button>
                <button type="button" onClick={() => selectTab('shelters')} className="hover:underline">
                  Relief Camps
                </button>
                <button type="button" onClick={() => openAuth('demo')} className="hover:underline">
                  Demo Mode
                </button>
                {!hasAdmin && (
                  <button type="button" onClick={() => openAuth('bootstrap')} className="hover:underline text-sky-500">
                    Admin Setup
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-500 pt-1">{t.disclaimer}</p>
            </div>
          </div>
        </footer>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center"
        aria-label="Mobile Bottom Navigation"
      >
        {(
          [
            { id: 'dashboard' as const, label: t.navDashboard, icon: LayoutDashboard },
            { id: 'map' as const, label: t.navMap, icon: MapIcon },
            { id: 'sos' as const, label: t.navSos, icon: AlertOctagon },
            { id: 'shelters' as const, label: t.navShelters, icon: Building2 },
            { id: 'reports' as const, label: t.navReports, icon: FileWarning },
          ]
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectTab(item.id)}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
                active
                  ? item.id === 'sos'
                    ? 'text-red-500'
                    : 'text-sky-600 dark:text-sky-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              <span className="truncate max-w-[64px]">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile Slide-Over Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm">
          <div className="w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full p-4 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-bold">{t.appName}</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectTab(item.id)}
                      className={`w-full min-h-[44px] px-3 rounded-xl flex items-center justify-between text-sm font-semibold ${
                        tab === item.id ? 'bg-sky-600 text-white' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="font-mono text-xs">{item.badge}</span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setChatOpen(true);
                  }}
                  className="w-full min-h-[44px] px-3 rounded-xl flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-300"
                >
                  <Bot className="w-4 h-4" />
                  <span>{t.rescueAssistant}</span>
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="Language"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as LanguageCode)}
                  className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2"
                >
                  {(Object.keys(LANGUAGE_LABELS) as LanguageCode[]).map((code) => (
                    <option key={code} value={code}>
                      {LANGUAGE_LABELS[code]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setDark((d) => !d)}
                  className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-1.5"
                >
                  {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  <span>{dark ? t.lightMode : t.darkMode}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setLowDataMode((v) => !v)}
                className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 font-semibold"
              >
                {t.lowDataMode}: {lowDataMode ? 'ON' : 'OFF'}
              </button>
              <PWAInstallButton label={t.installApp} />
              {user ? (
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-red-500/40 text-red-500 font-semibold"
                >
                  {t.signOut} ({user.name})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openAuth('login');
                  }}
                  className="w-full min-h-[44px] rounded-xl bg-sky-600 text-white font-semibold"
                >
                  {t.signIn}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Rescue Assistant Button */}
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-30 min-h-[48px] px-4 rounded-full bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs shadow-lg flex items-center gap-2 transition-transform active:scale-95"
        aria-label={t.rescueAssistant}
      >
        <Bot className="w-4 h-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t.rescueAssistant}</span>
      </button>

      <AuthModal
        open={authOpen}
        initialTab={authInitialTab}
        onClose={() => setAuthOpen(false)}
      />
      <RescueChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} lang={lang} />
    </div>
  );
};

export default function App() {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  );
}
