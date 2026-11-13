import React, { useEffect, useState } from 'react';
import { ShieldCheck, X, UserPlus, LogIn, KeyRound, Compass } from 'lucide-react';
import { DISTRICT_NAMES } from '../../../shared/assamGeo';
import type { User } from '../../../shared/types';
import { apiFetch } from '../../lib/api';
import { useAppData } from './AuthContext';

interface AuthModalProps {
  open: boolean;
  initialTab?: AuthTab;
  onClose: () => void;
}

export type AuthTab = 'login' | 'register' | 'demo' | 'bootstrap';

export const AuthModal: React.FC<AuthModalProps> = ({ open, initialTab, onClose }) => {
  const { hasAdmin, setUser, setHasAdmin } = useAppData();
  const [tab, setTab] = useState<AuthTab>(initialTab || 'login');

  useEffect(() => {
    if (open) {
      setTab(initialTab || (hasAdmin ? 'login' : 'demo'));
      setError(null);
    }
  }, [open, initialTab, hasAdmin]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'viewer' | 'volunteer'>('viewer');
  const [district, setDistrict] = useState('Kamrup Metropolitan');
  const [demoRole, setDemoRole] = useState<'viewer' | 'volunteer'>('viewer');
  const [demoDistrict, setDemoDistrict] = useState('Kamrup Metropolitan');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSuccess = (data: { user: User; token: string }) => {
    sessionStorage.setItem('dg_session_token', data.token);
    setUser(data.user);
    onClose();
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch<{ user: User; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      handleSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch<{ user: User; token: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, phone: phone || undefined, password, role, district }),
      });
      handleSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch<{ user: User; token: string }>('/api/auth/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify({ name: name || 'State Command Admin', email, password, district }),
      });
      setHasAdmin(true);
      handleSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin setup failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitDemoSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch<{ user: User; token: string }>('/api/auth/demo-session', {
        method: 'POST',
        body: JSON.stringify({ role: demoRole, district: demoDistrict }),
      });
      handleSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-red-500" aria-hidden="true" />
            <h2 id="auth-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              DisasterGuard Access
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            aria-label="Close sign in dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className={`grid ${!hasAdmin ? 'grid-cols-4' : 'grid-cols-3'} gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-xs font-medium`}>
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
              }}
              className={`min-h-[40px] rounded-lg transition-colors whitespace-nowrap px-2 ${
                tab === 'login'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError(null);
              }}
              className={`min-h-[40px] rounded-lg transition-colors whitespace-nowrap px-2 ${
                tab === 'register'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('demo');
                setError(null);
              }}
              className={`min-h-[40px] rounded-lg transition-colors whitespace-nowrap px-2 ${
                tab === 'demo'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Demo
            </button>
            {!hasAdmin && (
              <button
                type="button"
                onClick={() => {
                  setTab('bootstrap');
                  setError(null);
                }}
                className={`min-h-[40px] rounded-lg transition-colors whitespace-nowrap px-2 ${
                  tab === 'bootstrap'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                Admin Setup
              </button>
            )}
          </div>
        </div>

        <div className="p-6 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={submitLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Email or 10-Digit Mobile Number
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="name@example.com or 9876543210"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
              </button>
            </form>
          )}

          {tab === 'register' && (
            <form onSubmit={submitRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Indian Mobile (10 digits, optional for citizens)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9864012345"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Account Role
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'viewer' | 'volunteer')}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                  >
                    <option value="viewer">Citizen (Viewer)</option>
                    <option value="volunteer">Field Volunteer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Assam District
                  </label>
                  <select
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                  >
                    {DISTRICT_NAMES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {role === 'volunteer' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Volunteer accounts require administrator approval before accessing district SOS &amp; report tools.
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? 'Creating account...' : 'Create Account'}</span>
              </button>
            </form>
          )}

          {tab === 'bootstrap' && (
            <form onSubmit={submitBootstrapAdmin} className="space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                No administrator exists yet. Create the primary State Command Administrator account now. This setup locks permanently once created.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Administrator Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ASDMA Command Officer"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Admin Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@assam-response.org"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                <span>{submitting ? 'Initializing...' : 'Initialize First Admin'}</span>
              </button>
            </form>
          )}

          {tab === 'demo' && (
            <form onSubmit={submitDemoSession} className="space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Explore DisasterGuard using fictional Assam demo data (8 district volunteers, 10 shelters, 15 reports, 3 SOS requests) without creating a permanent account.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Demo Persona
                </label>
                <select
                  value={demoRole}
                  onChange={(e) => setDemoRole(e.target.value as 'viewer' | 'volunteer')}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                >
                  <option value="viewer">Citizen (Rituraj Hazarika · Demo)</option>
                  <option value="volunteer">District Volunteer (Active Demo Roster)</option>
                </select>
              </div>
              {demoRole === 'volunteer' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Demo Volunteer District
                  </label>
                  <select
                    value={demoDistrict}
                    onChange={(e) => setDemoDistrict(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                  >
                    <option value="Kamrup Metropolitan">Kamrup Metropolitan (Ananya Bora)</option>
                    <option value="Dibrugarh">Dibrugarh (Bikram Kalita)</option>
                    <option value="Cachar">Cachar (Chandan Das)</option>
                    <option value="Jorhat">Jorhat (Dipika Gogoi)</option>
                    <option value="Barpeta">Barpeta (Farhan Ahmed)</option>
                    <option value="Nagaon">Nagaon (Gitali Sarmah)</option>
                    <option value="Dhemaji">Dhemaji (Hemanta Baruah)</option>
                  </select>
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Compass className="w-4 h-4" />
                <span>{submitting ? 'Entering Demo...' : 'Enter Fictional Demo Mode'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
