import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { creatorPortalAPI } from '../../services/creatorPortalApi';

function formatMoney(amount, currency = 'EUR') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currency || 'EUR').toUpperCase(),
      maximumFractionDigits: 2
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return '—';
  }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function humanEligibleAfter(v) {
  if (v === 'manual_approval') return 'after manual approval';
  if (v === 'stay_completed') return 'after the stay is completed and approved';
  return String(v || '').replace(/_/g, ' ') || '—';
}

function buildReferralLink(code) {
  if (!code) return '';
  if (typeof window === 'undefined' || !window.location?.origin) return '';
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
}

function useCopyToClipboard() {
  const [copiedKey, setCopiedKey] = useState('');
  async function copy(key, value) {
    if (!value) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(value));
      } else {
        return;
      }
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((cur) => (cur === key ? '' : cur));
      }, 1800);
    } catch {
      /* silently ignore; user can long-press to copy */
    }
  }
  return { copiedKey, copy };
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 relative overflow-x-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        aria-hidden
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(236, 72, 153, 0.25), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(168, 85, 247, 0.18), transparent 50%), radial-gradient(ellipse 50% 35% at 0% 20%, rgba(251, 146, 60, 0.12), transparent 45%)'
        }}
      />
      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8 md:py-12 lg:py-14">{children}</div>
    </div>
  );
}

function Card({ title, subtitle, children, className = '' }) {
  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm shadow-lg shadow-black/20 p-4 md:p-6 ${className}`}
    >
      {title ? (
        <header className="mb-4 md:mb-5">
          <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs md:text-sm text-zinc-400 max-w-2xl">{subtitle}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-4 md:px-5 md:py-5 min-w-0">
      <div className="text-[11px] md:text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl md:text-3xl font-semibold tabular-nums text-white tracking-tight leading-none">
        {value}
      </div>
      {hint ? <p className="mt-2 text-[11px] md:text-xs text-zinc-500 leading-snug">{hint}</p> : null}
    </div>
  );
}

function BigStat({ label, value, accent = false, hint }) {
  return (
    <div
      className={`rounded-2xl border px-5 py-5 md:px-6 md:py-6 min-w-0 ${
        accent
          ? 'border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/15 via-rose-500/10 to-amber-500/10'
          : 'border-white/10 bg-zinc-900/60'
      }`}
    >
      <div
        className={`text-[11px] md:text-xs font-medium uppercase tracking-[0.16em] ${
          accent ? 'text-fuchsia-200/90' : 'text-zinc-500'
        }`}
      >
        {label}
      </div>
      <div className="mt-2 text-3xl md:text-4xl font-semibold tabular-nums text-white tracking-tight leading-none">
        {value}
      </div>
      {hint ? (
        <p className={`mt-3 text-xs md:text-sm leading-snug ${accent ? 'text-fuchsia-100/80' : 'text-zinc-500'}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Chip({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'border-white/15 bg-white/5 text-zinc-200',
    active: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    paused: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    archived: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
    accent: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100'
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium tracking-wide ${
        tones[tone] || tones.neutral
      }`}
    >
      {children}
    </span>
  );
}

function CopyButton({ onCopy, copied, label = 'Copy', size = 'md' }) {
  const padding = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
  return (
    <button
      type="button"
      onClick={onCopy}
      className={`shrink-0 rounded-full border border-white/15 bg-white/5 ${padding} font-medium text-zinc-100 hover:bg-white/10 transition-colors`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function CodeRow({ label, value, onCopy, copied, mono = true, copyLabel = 'Copy' }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-zinc-900/50 px-3 py-3 md:px-4 md:py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{label}</div>
        <div
          className={`mt-1 text-base md:text-lg text-white break-all leading-snug ${
            mono ? 'font-mono' : 'font-medium'
          }`}
        >
          {value}
        </div>
      </div>
      <CopyButton onCopy={onCopy} copied={copied} label={copyLabel} />
    </div>
  );
}

function statusTone(s) {
  if (s === 'active') return 'active';
  if (s === 'paused') return 'paused';
  if (s === 'archived') return 'archived';
  return 'neutral';
}

function LoadingSkeleton() {
  return (
    <Shell>
      <div className="space-y-6 animate-pulse max-w-4xl mx-auto">
        <div className="h-10 w-48 rounded-lg bg-white/10" />
        <div className="h-36 rounded-2xl bg-white/5 border border-white/10" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((k) => (
            <div key={k} className="h-24 rounded-xl bg-white/5 border border-white/10" />
          ))}
        </div>
      </div>
    </Shell>
  );
}

export default function CreatorPortal() {
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPath = location.pathname.replace(/\/$/, '') === '/creator/login';
  const portalLinkProblem =
    isLoginPath && new URLSearchParams(location.search).get('portal_error') === '1';

  const [phase, setPhase] = useState('boot');
  const [me, setMe] = useState(null);
  const [fatalMessage, setFatalMessage] = useState('');
  const [meError, setMeError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);

  const [requestEmail, setRequestEmail] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestError, setRequestError] = useState('');

  // Custom hook must be at the top level — never after an early return (React #310).
  const { copiedKey, copy } = useCopyToClipboard();

  const load = useCallback(async () => {
    setPhase('boot');
    setMe(null);
    setMeError('');
    setFatalMessage('');
    try {
      const sRes = await creatorPortalAPI.session();
      const authenticated = !!sRes.data?.data?.authenticated;
      if (!authenticated) {
        setPhase('guest');
        return;
      }
      setPhase('session-ok');
      try {
        const mRes = await creatorPortalAPI.me();
        const data = mRes.data?.data;
        if (!data) {
          setMeError('No dashboard data returned.');
          setPhase('me-error');
          return;
        }
        setMe(data);
        setPhase('ready');
      } catch {
        setMeError('We could not load your dashboard. Please try again in a moment.');
        setPhase('me-error');
      }
    } catch {
      setFatalMessage('Unable to reach the portal. Check your connection and try again.');
      setPhase('fatal');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (phase === 'ready' && isLoginPath) {
      navigate('/creator', { replace: true });
    }
  }, [phase, isLoginPath, navigate]);

  async function handleLogout() {
    setLogoutBusy(true);
    try {
      await creatorPortalAPI.logout();
    } catch {
      /* still treat as logged out locally */
    }
    setMe(null);
    setLogoutBusy(false);
    setPhase('guest');
  }

  async function handleRequestLink(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (requestBusy || requestSent) return;
    const value = String(requestEmail || '').trim();
    if (!value) {
      setRequestError('Enter your email to receive a sign-in link.');
      return;
    }
    if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setRequestError('Enter a valid email address.');
      return;
    }
    setRequestError('');
    setRequestBusy(true);
    try {
      await creatorPortalAPI.requestLink(value);
    } catch {
      /* generic UX: never reveal failure */
    }
    setRequestBusy(false);
    setRequestSent(true);
  }

  if (phase === 'boot' || phase === 'session-ok') {
    return (
      <>
        <Helmet>
          <title>Creator portal · Drift &amp; Dwells</title>
          <meta name="robots" content="noindex,nofollow" />
        </Helmet>
        <LoadingSkeleton />
      </>
    );
  }

  if (phase === 'fatal') {
    return (
      <>
        <Helmet>
          <title>Creator portal · Drift &amp; Dwells</title>
          <meta name="robots" content="noindex,nofollow" />
        </Helmet>
        <Shell>
          <div className="max-w-xl mx-auto text-center space-y-4">
            <h1 className="text-xl md:text-2xl font-semibold text-white">Creator portal</h1>
            <p className="text-sm text-zinc-400">{fatalMessage}</p>
            <button
              type="button"
              onClick={() => load()}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-medium bg-white/10 border border-white/15 text-white hover:bg-white/15"
            >
              Retry
            </button>
          </div>
        </Shell>
      </>
    );
  }

  if (phase === 'guest' || phase === 'me-error') {
    return (
      <>
        <Helmet>
          <title>Creator portal · Drift &amp; Dwells</title>
          <meta name="robots" content="noindex,nofollow" />
        </Helmet>
        <Shell>
          <div className="max-w-xl mx-auto space-y-6 text-center md:text-left">
            <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Private access
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">Creator portal</h1>
            {portalLinkProblem ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 text-left">
                This sign-in link is invalid, expired, or has already been used. Ask your Drift &amp; Dwells contact
                for a new portal link.
              </div>
            ) : null}
            <p className="text-sm md:text-base text-zinc-400 leading-relaxed">
              This portal is available through your private creator link from Drift &amp; Dwells. There is no public
              login or password here.
            </p>

            <form
              onSubmit={handleRequestLink}
              className="text-left rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm shadow-lg shadow-black/20 p-4 md:p-6 space-y-3"
              noValidate
            >
              <div>
                <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">
                  Email me a sign-in link
                </h2>
                <p className="mt-1 text-xs md:text-sm text-zinc-400 leading-relaxed">
                  Enter the email Drift &amp; Dwells has on file for you. We&apos;ll send your private sign-in link.
                </p>
              </div>
              <label className="block">
                <span className="sr-only">Email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={requestEmail}
                  onChange={(ev) => setRequestEmail(ev.target.value)}
                  disabled={requestBusy || requestSent}
                  maxLength={254}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-3 text-sm md:text-base text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/40 disabled:opacity-60"
                />
              </label>
              {requestError ? (
                <p className="text-sm text-rose-200">{requestError}</p>
              ) : null}
              <button
                type="submit"
                disabled={requestBusy || requestSent}
                className="inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium border border-white/15 bg-gradient-to-br from-fuchsia-500/20 via-rose-500/15 to-amber-500/15 text-white hover:from-fuchsia-500/30 hover:to-amber-500/20 disabled:opacity-60"
              >
                {requestSent ? 'Sent' : requestBusy ? 'Sending…' : 'Send sign-in link'}
              </button>
              {requestSent ? (
                <p className="text-xs md:text-sm text-emerald-200/90 leading-relaxed">
                  If this email is linked to a creator account, we&apos;ll send a private sign-in link.
                </p>
              ) : (
                <p className="text-[11px] md:text-xs text-zinc-500 leading-relaxed">
                  We never share or display this email. Sign-in links expire after a short time and can be used once.
                </p>
              )}
            </form>

            <p className="text-xs md:text-sm text-zinc-500 leading-relaxed">
              Don&apos;t have an email on file? Ask your Drift &amp; Dwells contact for a new portal link.
            </p>

            {phase === 'me-error' && meError ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 text-left">
                {meError}
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => load()}
                    className="text-amber-200 underline text-sm font-medium hover:text-white"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    disabled={logoutBusy}
                    onClick={handleLogout}
                    className="text-sm font-medium text-white/90 hover:text-white disabled:opacity-50"
                  >
                    {logoutBusy ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </Shell>
      </>
    );
  }

  const profile = me?.profile || {};
  const metrics = me?.metrics || {};
  const recentBookings = Array.isArray(me?.recentBookings) ? me.recentBookings : [];
  const giftSales = Array.isArray(me?.recentGiftVoucherSales) ? me.recentGiftVoucherSales : [];
  const recentCommission = Array.isArray(me?.recentCommission) ? me.recentCommission : [];

  const pc = metrics.projectedCommission || {};
  const approved = metrics.approvedCommission || {};
  const paid = metrics.paidCommission || {};
  const gvRev = metrics.giftVoucherRevenue || {};
  const gvComm = metrics.giftVoucherCommission || {};

  const gvCount = Number(metrics.giftVoucherSales) || 0;
  const gvRevAmount = Number(gvRev.amount) || 0;
  const gvCommAmount = Number(gvComm.amount) || 0;
  const giftVoucherIsEmpty =
    gvCount === 0 && gvRevAmount === 0 && gvCommAmount === 0 && giftSales.length === 0;

  const referralLink = buildReferralLink(profile.referralCode);
  const ratePercent =
    profile.commissionRatePercent != null && Number.isFinite(Number(profile.commissionRatePercent))
      ? `${profile.commissionRatePercent}%`
      : null;

  return (
    <>
      <Helmet>
        <title>{profile.name ? `${profile.name} · Creator portal` : 'Creator portal'} · Drift &amp; Dwells</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <Shell>
        <div className="max-w-5xl mx-auto space-y-6 md:space-y-8">
          {/* Hero */}
          <header className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.22em] text-fuchsia-300/90">
                Creator dashboard
              </p>
              <button
                type="button"
                disabled={logoutBusy}
                onClick={handleLogout}
                className="shrink-0 px-3.5 py-2 rounded-full text-xs font-medium border border-white/15 bg-white/5 text-zinc-100 hover:bg-white/10 disabled:opacity-50"
              >
                {logoutBusy ? 'Signing out…' : 'Log out'}
              </button>
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold text-white tracking-tight leading-[1.05]">
              {profile.name || 'Welcome'}
            </h1>
            <p className="text-sm md:text-base text-zinc-400 max-w-xl leading-relaxed">
              Track your visits, bookings, and commission.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {profile.status ? (
                <Chip tone={statusTone(profile.status)}>
                  <span className="capitalize">{profile.status}</span>
                </Chip>
              ) : null}
              {ratePercent ? <Chip tone="accent">{ratePercent} commission</Chip> : null}
            </div>
            <p className="text-xs md:text-sm text-zinc-500 max-w-xl">
              Commission becomes payable {humanEligibleAfter(profile.eligibleAfter)}.
            </p>
          </header>

          {/* Your code / share link */}
          <Card
            title="Your code"
            subtitle="Share your link or give guests your checkout code. Both help us track bookings from you."
          >
            <div className="space-y-3">
              {referralLink ? (
                <CodeRow
                  label="Share link"
                  value={referralLink}
                  mono={false}
                  copyLabel="Copy link"
                  onCopy={() => copy('link', referralLink)}
                  copied={copiedKey === 'link'}
                />
              ) : null}
              {profile.promoCode ? (
                <CodeRow
                  label="Checkout code"
                  value={profile.promoCode}
                  onCopy={() => copy('promo', profile.promoCode)}
                  copied={copiedKey === 'promo'}
                />
              ) : null}
              {!referralLink && !profile.promoCode ? (
                <p className="text-sm text-zinc-500">
                  No share link or checkout code assigned yet. Drift &amp; Dwells will set this up for you.
                </p>
              ) : null}
              <p className="text-[11px] md:text-xs text-zinc-500 leading-relaxed">
                Use the share link for posts, stories, and DMs. Use the checkout code for guests who
                book directly and enter it at checkout.
              </p>
            </div>
          </Card>

          {/* Performance */}
          <section className="space-y-3 md:space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Performance</h2>
              <p className="text-xs text-zinc-500">Last 90 days of activity</p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              <Metric label="Visits" value={String(metrics.visits ?? 0)} />
              <Metric label="Unique visitors" value={String(metrics.uniqueVisitors ?? 0)} />
              <Metric label="Bookings generated" value={String(metrics.bookings ?? 0)} />
              <Metric label="Paid bookings" value={String(metrics.paidBookings ?? 0)} />
            </div>
          </section>

          {/* Commission */}
          <section className="space-y-3 md:space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Your commission</h2>
              {ratePercent ? (
                <p className="text-xs text-zinc-500">At {ratePercent} of eligible bookings</p>
              ) : null}
            </div>
            <BigStat
              label="Projected commission"
              value={formatMoney(pc.amount, pc.currency)}
              accent
              hint="Estimate only. Becomes payable after the stay is completed and approved."
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
              <Metric
                label="Approved commission"
                value={formatMoney(approved.amount, approved.currency)}
                hint="Approved for payout."
              />
              <Metric
                label="Paid commission"
                value={formatMoney(paid.amount, paid.currency)}
                hint="Already paid."
              />
            </div>
            {recentCommission.length > 0 ? (
              <Card title="Recent commission activity" subtitle="Latest updates from your commission records.">
                <ul className="space-y-2.5">
                  {recentCommission.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-900/50 px-3.5 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <Chip tone={c.status === 'paid' ? 'active' : c.status === 'approved' ? 'accent' : 'neutral'}>
                          <span className="capitalize">{c.status || '—'}</span>
                        </Chip>
                        <span className="text-zinc-400 text-xs">via {c.source || '—'}</span>
                      </div>
                      <span className="font-medium tabular-nums text-white">
                        {formatMoney(c.amount, c.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </section>

          {/* Recent bookings */}
          <Card title="Recent bookings" subtitle="Stays attributed to your code or link.">
            {recentBookings.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No bookings yet. Once someone books with your code, you&apos;ll see it here.
              </p>
            ) : (
              <ul className="space-y-3">
                {recentBookings.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-3.5 md:px-5 md:py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-white font-medium text-sm md:text-base truncate">
                          {b.propertyLabel || 'Stay'}
                        </div>
                        <div className="mt-0.5 text-xs md:text-sm text-zinc-400">
                          {formatDate(b.checkIn)} → {formatDate(b.checkOut)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm md:text-base font-semibold text-white tabular-nums">
                          {formatMoney(b.bookingValue)}
                        </div>
                        <div className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500 capitalize">
                          {b.status || '—'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Chip>via {b.attributionSource || 'none'}</Chip>
                      <Chip tone={b.commissionStatus === 'paid' ? 'active' : 'neutral'}>
                        Commission: {b.commissionStatus || 'pending'}
                      </Chip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Booking value (supporting context for commission) */}
          <Card
            title="Booking value"
            subtitle="Supporting context for your commission. These are the booking totals tracked through your code, before costs, taxes, fees, and operations."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
              <Metric
                label="Booking value generated"
                value={formatMoney(metrics.attributedBookingValue)}
                hint="Total value of bookings made through your code or link."
              />
              <Metric
                label="Tracked booking value"
                value={formatMoney(metrics.paidStayRevenue)}
                hint="Value of bookings that have already been paid by the guest."
              />
            </div>
          </Card>

          {/* Gift voucher performance */}
          {giftVoucherIsEmpty ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 md:px-5 md:py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-zinc-200">Gift voucher performance</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">No voucher sales tracked yet.</p>
                </div>
                <Chip>0 sales</Chip>
              </div>
            </div>
          ) : (
            <Card
              title="Gift voucher performance"
              subtitle="Voucher purchases attributed to your code."
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                <Metric label="Voucher sales" value={String(gvCount)} />
                <Metric label="Voucher revenue" value={formatMoney(gvRevAmount, gvRev.currency)} />
                <Metric label="Gift voucher commission" value={formatMoney(gvCommAmount, gvComm.currency)} />
              </div>
              {giftSales.length > 0 ? (
                <ul className="mt-5 space-y-2.5">
                  {giftSales.map((g, idx) => (
                    <li
                      key={`gv-${idx}-${g.date ? String(g.date) : idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-zinc-900/50 px-3.5 py-3 text-sm"
                    >
                      <span className="text-zinc-300">{formatDateTime(g.date)}</span>
                      <span className="capitalize text-zinc-400 text-xs">{g.status || '—'}</span>
                      <span className="font-medium tabular-nums text-white">
                        {formatMoney((Number(g.amountOriginalCents) || 0) / 100)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          )}

          {/* Trust footer */}
          <p className="text-xs md:text-sm text-zinc-500 leading-relaxed text-center md:text-left max-w-2xl pt-4 pb-2">
            Projected amounts are estimates. Approved and paid commission are managed manually by
            Drift &amp; Dwells.
          </p>
        </div>
      </Shell>
    </>
  );
}
