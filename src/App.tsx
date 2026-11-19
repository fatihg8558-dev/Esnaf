import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  Archive,
  Building2,
  FilePlus2,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { auth, googleProvider } from './firebase';
import type {
  Account,
  ActiveTab,
  BusinessProfile,
  CheckNote,
  DvSessionState,
  ETebligatItem,
  ExpenseCategory,
  GibCredential,
  GibSessionState,
  Invoice,
  ReceivedInvoice,
  SavedItem,
  Transaction,
} from './types';
import {
  approveInvoiceAndReflect,
  cancelInvoice,
  createAccount,
  createCheckNote,
  createDraftInvoice,
  createExpenseCategory,
  createManualETebligat,
  createSavedItem,
  createTransaction,
  deleteAccount,
  deleteCheckNote,
  deleteETebligat,
  deleteExpenseCategory,
  deleteGibCredential,
  deleteInvoice,
  deleteReceivedInvoice,
  deleteSavedItem,
  deleteTransaction,
  reflectReceivedInvoiceToExpense,
  saveBusinessProfile,
  saveGibCredential,
  subscribeAccounts,
  subscribeBusinessProfile,
  subscribeChecksNotes,
  subscribeETebligatlar,
  subscribeExpenseCategories,
  subscribeGibCredential,
  subscribeInvoices,
  subscribeReceivedInvoices,
  subscribeSavedItems,
  subscribeTransactions,
  toggleETebligatRead,
  updateAccount,
  updateCheckNoteStatus,
  updateGibAutoConnect,
  updateTransaction,
  upsertETebligatlar,
  upsertReceivedInvoices,
} from './services/firestoreService';
import { dvLogout, gibLoginSaved, gibLogout, gibLogoutBeacon } from './services/gibClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardView } from './components/DashboardView';
import { LedgerView } from './components/LedgerView';
import { AccountsView } from './components/AccountsView';
import { InvoiceBuilderView } from './components/InvoiceBuilderView';
import { ArchiveView } from './components/ArchiveView';
import { ReceivedInvoicesView } from './components/ReceivedInvoicesView';
import { ETebligatView } from './components/ETebligatView';
import { SettingsView } from './components/SettingsView';
import { ProfileModal } from './components/ProfileModal';
import { InvoicePreviewModal } from './components/InvoicePreviewModal';

const NAV_ITEMS: { id: ActiveTab; label: string; mobileLabel: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Özet Panel', mobileLabel: 'Özet', icon: LayoutDashboard },
  { id: 'ledger', label: 'Gelir-Gider', mobileLabel: 'Kasa', icon: Wallet },
  { id: 'accounts', label: 'Cari Takip', mobileLabel: 'Cari', icon: Users },
  { id: 'invoice', label: 'e-Arşiv Fatura', mobileLabel: 'Fatura', icon: FilePlus2 },
  { id: 'archive', label: 'Fatura Arşivi', mobileLabel: 'Arşiv', icon: Archive },
  { id: 'received', label: 'Alınan Faturalar', mobileLabel: 'Alınan', icon: Inbox },
  { id: 'etebligat', label: 'e-Tebligat', mobileLabel: 'Tebligat', icon: Mail },
  { id: 'settings', label: 'Ayarlar', mobileLabel: 'Ayarlar', icon: Settings },
];

function PortalShell() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [savedGibCred, setSavedGibCred] = useState<GibCredential | null>(null);
  const [customExpenseCategories, setCustomExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [checksNotes, setChecksNotes] = useState<CheckNote[]>([]);
  const [receivedInvoices, setReceivedInvoices] = useState<ReceivedInvoice[]>([]);
  const [eTebligatlar, setETebligatlar] = useState<ETebligatItem[]>([]);

  const [gibSession, setGibSession] = useState<GibSessionState>({
    connected: false,
    sessionId: null,
    mode: 'live',
    userCode: '',
  });
  const [dvSession, setDvSession] = useState<DvSessionState>({
    connected: false,
    dvSessionId: null,
    userCode: '',
  });
  const [gibAutoConnecting, setGibAutoConnecting] = useState(false);
  const [manualGibLogout, setManualGibLogout] = useState(false);
  const [gibAutoError, setGibAutoError] = useState<string | null>(null);
  const attemptedCredKeyRef = useRef<string | null>(null);

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [ledgerExternalModal, setLedgerExternalModal] = useState(false);
  const [preselectedAccount, setPreselectedAccount] = useState<Account | null>(null);
  const [focusAccountId, setFocusAccountId] = useState<string | null>(null);
  const [dashboardPreviewInvoice, setDashboardPreviewInvoice] = useState<Invoice | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setAccounts([]);
      setTransactions([]);
      setSavedItems([]);
      setInvoices([]);
      setSavedGibCred(null);
      setCustomExpenseCategories([]);
      setChecksNotes([]);
      setReceivedInvoices([]);
      setETebligatlar([]);
      setGibAutoError(null);
      setManualGibLogout(false);
      attemptedCredKeyRef.current = null;
      return;
    }

    const unsubProfile = subscribeBusinessProfile(user.uid, setProfile);
    const unsubAccounts = subscribeAccounts(user.uid, setAccounts);
    const unsubTx = subscribeTransactions(user.uid, setTransactions);
    const unsubSaved = subscribeSavedItems(user.uid, setSavedItems);
    const unsubInvoices = subscribeInvoices(user.uid, setInvoices);
    const unsubGibCred = subscribeGibCredential(user.uid, setSavedGibCred);
    const unsubExpCats = subscribeExpenseCategories(user.uid, setCustomExpenseCategories);
    const unsubChecks = subscribeChecksNotes(user.uid, setChecksNotes);
    const unsubReceived = subscribeReceivedInvoices(user.uid, setReceivedInvoices);
    const unsubTebligat = subscribeETebligatlar(user.uid, setETebligatlar);

    return () => {
      unsubProfile();
      unsubAccounts();
      unsubTx();
      unsubSaved();
      unsubInvoices();
      unsubGibCred();
      unsubExpCats();
      unsubChecks();
      unsubReceived();
      unsubTebligat();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !savedGibCred || !savedGibCred.autoConnect) return;
    if (gibSession.connected || manualGibLogout) return;

    const credKey = `${savedGibCred.userCode}:${savedGibCred.encryptedSecret}`;
    if (attemptedCredKeyRef.current === credKey) return;
    attemptedCredKeyRef.current = credKey;

    let cancelled = false;
    setGibAutoConnecting(true);
    setGibAutoError(null);

    gibLoginSaved({
      mode: 'live',
      userCode: savedGibCred.userCode,
      encryptedSecret: savedGibCred.encryptedSecret,
      profileFallback: profile
        ? {
            title: profile.title,
            taxId: profile.taxId,
            taxOffice: profile.taxOffice,
            address: profile.address,
            city: profile.city,
            district: profile.district,
          }
        : undefined,
    })
      .then((resp) => {
        if (cancelled) return;
        if (resp.ok && resp.sessionId) {
          setGibSession({
            connected: true,
            sessionId: resp.sessionId,
            mode: 'live',
            userCode: resp.userCode || savedGibCred.userCode,
            sellerInfo: resp.sellerInfo,
          });
          showToast('Kayıtlı GİB hesabına otomatik bağlanıldı.');
        } else {
          setGibAutoError(
            resp.error ||
              'Kayıtlı GİB şifresi ile oturum açılamadı. Şifrenizi değiştirdiyseniz Ayarlar sayfasından güncelleyin.'
          );
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setGibAutoError(err?.message || 'Kayıtlı GİB bağlantısı kurulurken hata oluştu.');
      })
      .finally(() => {
        if (!cancelled) {
          setGibAutoConnecting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, savedGibCred, gibSession.connected, manualGibLogout, profile]);

  useEffect(() => {
    if (!gibSession.connected || !gibSession.sessionId) return;
    const sessionId = gibSession.sessionId;
    const handleUnload = () => {
      gibLogoutBeacon(sessionId);
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [gibSession.connected, gibSession.sessionId]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      const code = String(err?.code || '');
      const msg = String(err?.message || '');
      if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setAuthError(
          `Bu alan adı (${host}) Firebase Authentication Yetkili Alan Adları listesinde kayıtlı değil. Uygulamayı AI Studio paylaşım linkinden açın veya Firebase Console > Authentication > Settings > Authorized domains bölümüne "${host}" adresini ekleyin.`
        );
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Tarayıcınız giriş penceresini engelledi. Lütfen açılır pencerelere (pop-up) izin verip tekrar deneyin.');
      } else if (code === 'auth/popup-closed-by-user') {
        setAuthError('Google giriş penceresi tamamlanmadan kapatıldı.');
      } else {
        setAuthError(msg || 'Google ile giriş yapılamadı.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGibSafeLogout = async () => {
    setManualGibLogout(true);
    setGibAutoError(null);
    const activeId = gibSession.sessionId;
    setGibSession({
      connected: false,
      sessionId: null,
      mode: 'live',
      userCode: '',
    });
    if (activeId) {
      await gibLogout(activeId);
    }
    if (user && savedGibCred) {
      await updateGibAutoConnect(user.uid, false).catch(() => {});
    }
    showToast('GİB e-Arşiv Portalından güvenli çıkış yapıldı. Giriş bilgileriniz korundu.');
  };

  const handleSignOut = async () => {
    if (gibSession.sessionId) {
      await gibLogout(gibSession.sessionId);
      setGibSession({ connected: false, sessionId: null, mode: 'live', userCode: '' });
    }
    if (dvSession.dvSessionId) {
      await dvLogout(dvSession.dvSessionId);
      setDvSession({ connected: false, dvSessionId: null, userCode: '' });
    }
    setSavedGibCred(null);
    setManualGibLogout(false);
    attemptedCredKeyRef.current = null;
    await signOut(auth);
  };

  const liveInvoices = useMemo(
    () => invoices.filter((inv) => inv.gibMode === 'live'),
    [invoices]
  );

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          <span>Oturum kontrol ediliyor...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-[#F8FAFC] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#131C2E] border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-blue-400 text-sm font-semibold">
              <Receipt className="w-5 h-5" />
              <span>Esnaf e-Arşiv &amp; Finans</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-100 leading-tight">
              Esnaf Hesabınıza Giriş Yapın
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Gelir-gider defteriniz, cari hesaplarınız, çek-senet portföyünüz ve e-Arşiv faturalarınız tüm cihazlarınızda güvenle senkronize edilir.
            </p>
          </div>

          <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 space-y-2.5 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>GİB e-Arşiv Portal ile doğrudan SMS onaylı fatura ve PDF çıktı</span>
            </div>
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Dövizli satış, cari ekstre PDF ve çek/senet vade bildirimleri</span>
            </div>
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Özel gider kalemleri ve kapsamlı işletme özeti</span>
            </div>
          </div>

          {authError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-4 py-3">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={authLoading}
            className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors min-h-[46px]"
          >
            {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            Google Hesabı ile Giriş Yap
          </button>
        </div>
      </div>
    );
  }

  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeTab) || NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-[#0B1120] text-[#F8FAFC] flex flex-col md:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="no-print hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-[#0F172A] border-r border-slate-800/90">
        {/* Brand Wordmark */}
        <div className="h-16 px-5 flex items-center border-b border-slate-800/90">
          <div className="flex items-center gap-2.5 min-w-0">
            <Receipt className="w-5 h-5 text-blue-400 shrink-0" />
            <span className="font-display font-bold text-base tracking-tight text-slate-100 whitespace-nowrap truncate">
              Esnaf e-Arşiv
            </span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const badgeCount =
              item.id === 'etebligat'
                ? eTebligatlar.filter((t) => !t.isRead).length
                : item.id === 'received'
                ? receivedInvoices.filter((r) => !r.reflectedToExpense).length
                : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {badgeCount > 0 && (
                  <span
                    className={`text-[11px] font-mono-num font-semibold ${
                      item.id === 'etebligat' ? 'text-amber-400' : 'text-blue-400'
                    }`}
                  >
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer: Business Profile & Sign Out */}
        <div className="p-3 border-t border-slate-800/90 space-y-2">
          <button
            type="button"
            onClick={() => setProfileModalOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-[#131C2E] hover:bg-slate-800 border border-slate-800 rounded-lg text-left transition-colors"
          >
            <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-200 truncate">
                {profile?.title || 'İşletme Bilgilerini Gir'}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {profile?.taxId ? `VKN/TC: ${profile.taxId}` : 'Profil ayarları'}
              </div>
            </div>
          </button>

          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-300 truncate">
                {user.displayName || 'Esnaf Kullanıcısı'}
              </div>
              <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors shrink-0"
              title="Çıkış Yap"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen pb-20 md:pb-0">
        {/* Clean 3-Zone Top Header */}
        <header className="no-print h-14 md:h-16 px-4 sm:px-6 border-b border-slate-800/90 bg-[#0F172A]/95 backdrop-blur sticky top-0 z-30 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <Receipt className="w-5 h-5 text-blue-400 md:hidden shrink-0" />
            <span className="font-display font-bold text-sm sm:text-base text-slate-100 whitespace-nowrap truncate">
              {activeNavMeta.label}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-400 whitespace-nowrap shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="hover:text-slate-200 transition-colors"
            >
              GİB:{' '}
              <span
                className={
                  gibSession.connected
                    ? 'text-emerald-400 font-medium'
                    : gibAutoConnecting
                    ? 'text-blue-400 font-medium'
                    : 'text-slate-400'
                }
              >
                {gibSession.connected
                  ? 'Canlı Bağlı'
                  : gibAutoConnecting
                  ? 'Bağlanıyor...'
                  : 'Bağlı Değil'}
              </span>
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="hover:text-slate-200 transition-colors"
            >
              {profile?.title || 'İşletme Profili'}
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {gibSession.connected && (
              <button
                type="button"
                onClick={handleGibSafeLogout}
                title="GİB e-Arşiv Portalından Güvenli Çıkış Yap"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="sm:hidden">GİB Çıkış</span>
                <span className="hidden sm:inline">GİB Güvenli Çıkış</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('invoice')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              Fatura Kes
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="md:hidden p-2 text-slate-400 hover:text-red-400 rounded-lg"
              title="Uygulamadan Çıkış Yap"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Toast Notification */}
        {toast && (
          <div className="no-print fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 bg-[#131C2E] border border-emerald-500/40 text-emerald-200 text-xs font-medium px-4 py-3 rounded-xl shadow-xl">
            {toast}
          </div>
        )}

        {/* Active View Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              transactions={transactions}
              accounts={accounts}
              invoices={liveInvoices}
              checksNotes={checksNotes}
              receivedInvoices={receivedInvoices}
              eTebligatlar={eTebligatlar}
              onNavigate={setActiveTab}
              onOpenAccount={(accId) => {
                setFocusAccountId(accId);
                setActiveTab('accounts');
              }}
              onQuickAddTransaction={() => {
                setActiveTab('ledger');
                setLedgerExternalModal(true);
              }}
              onPreviewInvoice={(inv) => setDashboardPreviewInvoice(inv)}
              onCreateCheckNote={async (input) => {
                const id = await createCheckNote(user.uid, input);
                showToast('Çek / senet portföye eklendi.');
                return id;
              }}
              onUpdateCheckNoteStatus={async (id, status) => {
                await updateCheckNoteStatus(id, status);
                showToast('Çek / senet durumu güncellendi.');
              }}
              onDeleteCheckNote={async (id) => {
                await deleteCheckNote(id);
                showToast('Çek / senet kaydı silindi.');
              }}
            />
          )}

          {activeTab === 'ledger' && (
            <LedgerView
              transactions={transactions}
              accounts={accounts}
              customExpenseCategories={customExpenseCategories}
              onCreate={async (input) => {
                const id = await createTransaction(user.uid, input);
                showToast('Gelir/gider kaydı eklendi.');
                return id;
              }}
              onUpdate={async (id, input) => {
                await updateTransaction(id, input);
                showToast('Kayıt güncellendi.');
              }}
              onDelete={async (tx) => {
                await deleteTransaction(tx);
                showToast('Kayıt silindi.');
              }}
              externalModalOpen={ledgerExternalModal}
              onCloseExternalModal={() => setLedgerExternalModal(false)}
            />
          )}

          {activeTab === 'accounts' && (
            <AccountsView
              businessProfile={profile}
              accounts={accounts}
              transactions={transactions}
              invoices={liveInvoices}
              focusAccountId={focusAccountId}
              onClearFocusAccount={() => setFocusAccountId(null)}
              onCreateAccount={async (input) => {
                const id = await createAccount(user.uid, input);
                showToast('Cari hesap oluşturuldu.');
                return id;
              }}
              onUpdateAccount={async (id, input) => {
                await updateAccount(id, input);
                showToast('Cari bilgileri güncellendi.');
              }}
              onDeleteAccount={async (id) => {
                await deleteAccount(id);
                showToast('Cari hesap silindi.');
              }}
              onRecordPayment={async (input, opts) => {
                const id = await createTransaction(user.uid, input, opts);
                showToast('Cari hareketi işlendi.');
                return id;
              }}
              onIssueInvoiceForAccount={(acc) => {
                setPreselectedAccount(acc);
                setActiveTab('invoice');
              }}
            />
          )}

          {activeTab === 'invoice' && (
            <InvoiceBuilderView
              uid={user.uid}
              profile={profile}
              accounts={accounts}
              savedItems={savedItems}
              gibSession={gibSession}
              savedGibCred={savedGibCred}
              gibAutoConnecting={gibAutoConnecting}
              gibAutoError={gibAutoError}
              onClearGibAutoError={() => setGibAutoError(null)}
              onResetManualLogout={() => {
                setManualGibLogout(false);
                attemptedCredKeyRef.current = null;
              }}
              onEnableGibAutoConnect={async () => {
                if (savedGibCred && !savedGibCred.autoConnect) {
                  await updateGibAutoConnect(user.uid, true).catch(() => {});
                }
              }}
              onSaveGibCredential={async (cred) => {
                await saveGibCredential(user.uid, cred);
              }}
              onSafeGibLogout={handleGibSafeLogout}
              onNotify={showToast}
              preselectedAccount={preselectedAccount}
              onClearPreselectedAccount={() => setPreselectedAccount(null)}
              onGibSessionChange={setGibSession}
              onSaveItem={async (item) => {
                const id = await createSavedItem(user.uid, item);
                showToast(`"${item.name}" hızlı kalemlere kaydedildi.`);
                return id;
              }}
              onDeleteSavedItem={async (id) => {
                await deleteSavedItem(id);
                showToast('Kayıtlı kalem kaldırıldı.');
              }}
              onCreateDraftInvoice={async (inv) => createDraftInvoice(user.uid, inv)}
              onApproveInvoice={async (inv, no, at, opts) => {
                await approveInvoiceAndReflect(user.uid, inv, no, at, opts);
                showToast('e-Arşiv faturası SMS ile onaylandı ve arşive eklendi.');
              }}
              onGoToArchive={() => setActiveTab('archive')}
              onGoToSettings={() => setActiveTab('settings')}
            />
          )}

          {activeTab === 'archive' && (
            <ArchiveView
              invoices={liveInvoices}
              gibSession={gibSession}
              onCancelInvoice={async (id) => {
                await cancelInvoice(id);
                showToast('Fatura iptal edildi.');
              }}
              onDeleteInvoice={async (id) => {
                await deleteInvoice(id);
                showToast('Kayıt arşivden silindi.');
              }}
              onApproveDraft={async (inv, no, at, opts) => {
                await approveInvoiceAndReflect(user.uid, inv, no, at, opts);
                showToast('Taslak fatura SMS ile onaylandı.');
              }}
              onGoToCreate={() => setActiveTab('invoice')}
            />
          )}

          {activeTab === 'received' && (
            <ReceivedInvoicesView
              profile={profile}
              accounts={accounts}
              receivedInvoices={receivedInvoices}
              customExpenseCategories={customExpenseCategories}
              gibSession={gibSession}
              dvSession={dvSession}
              savedGibCred={savedGibCred}
              onDvSessionChange={setDvSession}
              onSaveGibCredential={async (cred) => {
                await saveGibCredential(user.uid, cred);
              }}
              onUpsertReceivedInvoices={(items) =>
                upsertReceivedInvoices(user.uid, items, receivedInvoices)
              }
              onReflectToExpense={(recInv, options) =>
                reflectReceivedInvoiceToExpense(user.uid, recInv, options)
              }
              onDeleteReceivedInvoice={(id) => deleteReceivedInvoice(id)}
              onNotify={showToast}
            />
          )}

          {activeTab === 'etebligat' && (
            <ETebligatView
              profile={profile}
              eTebligatlar={eTebligatlar}
              dvSession={dvSession}
              savedGibCred={savedGibCred}
              onDvSessionChange={setDvSession}
              onSaveGibCredential={async (cred) => {
                await saveGibCredential(user.uid, cred);
              }}
              onUpsertETebligatlar={(items) =>
                upsertETebligatlar(user.uid, items, eTebligatlar)
              }
              onCreateManualETebligat={(input) => createManualETebligat(user.uid, input)}
              onToggleRead={async (id, isRead) => {
                await toggleETebligatRead(id, isRead);
                showToast(isRead ? 'Tebligat okundu işaretlendi.' : 'Tebligat okunmadı yapıldı.');
              }}
              onDeleteETebligat={(id) => deleteETebligat(id)}
              onNotify={showToast}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              profile={profile}
              userEmail={user.email || ''}
              gibSession={gibSession}
              savedGibCred={savedGibCred}
              gibAutoConnecting={gibAutoConnecting}
              gibAutoError={gibAutoError}
              customExpenseCategories={customExpenseCategories}
              onClearGibAutoError={() => setGibAutoError(null)}
              onResetManualLogout={() => {
                setManualGibLogout(false);
                attemptedCredKeyRef.current = null;
              }}
              onEnableGibAutoConnect={async () => {
                if (savedGibCred && !savedGibCred.autoConnect) {
                  await updateGibAutoConnect(user.uid, true).catch(() => {});
                }
              }}
              onSafeGibLogout={handleGibSafeLogout}
              onGibSessionChange={setGibSession}
              onSaveGibCredential={async (cred) => {
                await saveGibCredential(user.uid, cred);
              }}
              onDeleteGibCredential={async () => {
                await deleteGibCredential(user.uid);
                setGibAutoError(null);
                showToast('Kayıtlı GİB kullanıcı bilgileri silindi.');
              }}
              onAddExpenseCategory={async (name) => {
                await createExpenseCategory(user.uid, name);
                showToast(`"${name}" gider kalemi eklendi.`);
              }}
              onDeleteExpenseCategory={async (id) => {
                await deleteExpenseCategory(id);
                showToast('Özel gider kalemi silindi.');
              }}
              onSaveBusinessProfile={async (data) => {
                await saveBusinessProfile(user.uid, data);
                showToast('İşletme bilgileri kaydedildi.');
              }}
              onNotify={showToast}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Navigation (<= 64px height, >= 44px touch targets) */}
      <nav className="no-print md:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-[#0F172A]/95 backdrop-blur border-t border-slate-800 flex items-center overflow-x-auto px-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 min-h-[44px] min-w-[68px] flex-1 shrink-0 px-2 transition-colors ${
                active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-medium whitespace-nowrap">{item.mobileLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Business Profile Modal */}
      {profileModalOpen && (
        <ProfileModal
          profile={profile}
          userEmail={user.email || ''}
          onSave={async (data) => {
            await saveBusinessProfile(user.uid, data);
            showToast('İşletme bilgileri kaydedildi.');
          }}
          onClose={() => setProfileModalOpen(false)}
        />
      )}

      {/* Quick Preview Modal from Dashboard */}
      {dashboardPreviewInvoice && (
        <InvoicePreviewModal
          invoice={dashboardPreviewInvoice}
          mode="view"
          gibSession={gibSession}
          onClose={() => setDashboardPreviewInvoice(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <PortalShell />
    </ErrorBoundary>
  );
}
