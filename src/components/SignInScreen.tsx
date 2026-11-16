import React, { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  FileCheck2,
  HardDriveUpload,
  KeyRound,
  LogIn,
  ScanLine,
  ShieldCheck,
  Truck,
  UserCheck,
} from 'lucide-react';
import { getAuthLoginConfig } from '../lib/firestoreStore';

interface SignInScreenProps {
  loading: boolean;
  error: string | null;
  onLogin: (userId: string, password: string) => Promise<void> | void;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({ loading, error, onLogin }) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isDefaultAdmin, setIsDefaultAdmin] = useState(true);
  const [adminUserIdHint, setAdminUserIdHint] = useState('admin');
  const [quickHint, setQuickHint] = useState<string | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    getAuthLoginConfig().then((cfg) => {
      if (!active) return;
      setIsDefaultAdmin(cfg.isDefaultAdmin);
      setAdminUserIdHint(cfg.adminUserIdHint || 'admin');
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setQuickHint(null);
    await onLogin(userId.trim(), password);
  };

  const handleQuickAdminLogin = async () => {
    if (loading) return;
    if (isDefaultAdmin) {
      setQuickHint(null);
      setUserId('admin');
      setPassword('admin123');
      await onLogin('admin', 'admin123');
    } else {
      setUserId(adminUserIdHint);
      setPassword('');
      setQuickHint(`Enter your updated Master Admin password for "${adminUserIdHint}" and click Sign In.`);
      passwordInputRef.current?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0D47A1] via-[#1565C0] to-[#0F172A] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12 border border-blue-200/40">
        {/* Left Brand Panel */}
        <div className="md:col-span-5 bg-gradient-to-b from-[#0D47A1] to-[#1E3A8A] text-white p-7 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <img
                src="/pwa-192x192.png"
                alt="Dolphin Road Carrier Official DRC Logo"
                className="w-14 h-14 rounded-xl bg-white p-1 object-contain shadow-sm border border-blue-200/40"
              />
              <div>
                <h1 className="text-lg font-extrabold tracking-tight leading-tight">
                  DOLPHIN ROAD CARRIERS
                </h1>
                <p className="text-xs text-blue-200 font-medium">Fast · Safe · Reliable</p>
              </div>
            </div>

            <p className="text-sm text-blue-100 leading-relaxed mb-6">
              Cargo &amp; Logistics ERP for Consignment Notes, Tax Invoices, Section 194C
              Declarations, POD Payment Locks, Accounting Ledgers &amp; Google Drive Cloud Backup.
            </p>

            <div className="space-y-3 text-xs text-blue-100">
              <div className="flex items-center gap-2.5">
                <ScanLine className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>LR Scan-to-Bill OCR &amp; 3-Copy Print Engine</span>
              </div>
              <div className="flex items-center gap-2.5">
                <FileCheck2 className="w-4 h-4 text-orange-300 shrink-0" />
                <span>Strict POD Scanner &amp; Lorry Balance Payment Lock</span>
              </div>
              <div className="flex items-center gap-2.5">
                <HardDriveUpload className="w-4 h-4 text-purple-300 shrink-0" />
                <span>6-Folder Google Drive Cloud Backup + Switcher</span>
              </div>
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-sky-300 shrink-0" />
                <span>1 Master Admin + 50+ Branch Staff Logins with RBAC</span>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-white/15 mt-8 text-xs text-blue-200">
            30/1/29 N.C. Das Road, Kolkata - 700090 · PAN: DOTPS3540M
          </div>
        </div>

        {/* Right Custom User ID & Password Login Panel */}
        <div className="md:col-span-7 p-7 sm:p-10 flex flex-col justify-center bg-white">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700 mb-2">
            <Truck className="w-4 h-4" />
            <span>Kolkata Head Office &amp; Multi-Branch ERP Portal</span>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 mb-1.5">
            Sign in to Logistics Workspace
          </h2>
          <p className="text-sm text-slate-600 mb-6">
            Enter your Master Admin or Staff User ID and Password to access live branch operations
            across Windows PC and Android.
          </p>

          {(error || quickHint) && (
            <div
              className={`mb-4 p-3 rounded-lg border text-xs font-medium ${
                error
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              {error || quickHint}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="drc-login-userid"
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                User ID
              </label>
              <div className="relative">
                <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="drc-login-userid"
                  type="text"
                  required
                  autoComplete="username"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="admin or DRC-STAFF-01"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="drc-login-password"
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  ref={passwordInputRef}
                  id="drc-login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-1 flex flex-col sm:flex-row gap-2.5">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#0D47A1] to-[#1565C0] hover:from-[#0A3882] hover:to-[#0D47A1] text-white font-bold text-sm shadow-sm transition-colors disabled:opacity-60 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>{loading ? 'Signing in...' : 'Sign In'}</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={handleQuickAdminLogin}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Quick Login as Admin</span>
              </button>
            </div>
          </form>

          <div className="mt-6 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
            <p className="font-bold text-slate-800">Default Access Credentials</p>
            <p>
              Master Admin: User ID{' '}
              <span className="font-mono-num font-bold text-[#0D47A1]">{adminUserIdHint}</span>{' '}
              {isDefaultAdmin ? (
                <>
                  &bull; Password <span className="font-mono-num font-bold text-[#0D47A1]">admin123</span>
                </>
              ) : (
                <span className="text-slate-500">(Custom password configured in Settings)</span>
              )}
            </p>
            <p className="text-[11px] text-slate-500">
              Staff members can sign in from Windows PC or Android directly using the User ID &amp;
              Password created in <strong>Settings</strong> (sample:{' '}
              <span className="font-mono-num">DRC-STAFF-01</span> /{' '}
              <span className="font-mono-num">1234</span>).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
