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
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 px-3 py-3 md:px-4 md:py-4 min-w-0">
      <div className="text-[11px] md:text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-lg md:text-xl font-semibold tabular-nums text-white tracking-tight">{value}</div>
      {hint ? <p className="mt-1.5 text-[11px] md:text-xs text-zinc-500 leading-snug">{hint}</p> : null}
    </div>
  );
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

  return (
    <>
      <Helmet>
        <title>{profile.name ? `${profile.name} · Creator portal` : 'Creator portal'} · Drift &amp; Dwells</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <Shell>
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8 md:mb-10 lg:mb-12 max-w-5xl">
          <div className="min-w-0 space-y-2">
            <p className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300/90">
              Read-only partner view
            </p>
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-white tracking-tight">
              {profile.name || 'Creator portal'}
            </h1>
            <p className="text-sm text-zinc-400 max-w-2xl">
              Performance and commission summaries. Edits and payouts are managed by Drift &amp; Dwells only.
            </p>
          </div>
          <button
            type="button"
            disabled={logoutBusy}
            onClick={handleLogout}
            className="shrink-0 self-start md:self-center px-4 py-2.5 rounded-xl text-sm font-medium border border-white/15 bg-white/5 text-zinc-100 hover:bg-white/10 disabled:opacity-50"
          >
            {logoutBusy ? 'Signing out…' : 'Log out'}
          </button>
        </header>

        <div className="space-y-6 md:space-y-8">
          <Card title="Profile" subtitle="How you appear in our partner systems.">
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-zinc-500">Status</dt>
                <dd className="mt-1 font-medium text-white capitalize">{profile.status || '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Referral code</dt>
                <dd className="mt-1 font-mono text-zinc-100">{profile.referralCode || '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Promo code</dt>
                <dd className="mt-1 font-mono text-zinc-100">{profile.promoCode || '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Commission rate</dt>
                <dd className="mt-1 font-semibold text-white">
                  {profile.commissionRatePercent != null ? `${profile.commissionRatePercent}%` : '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-zinc-500">Commission timing</dt>
                <dd className="mt-1 text-zinc-200">Eligible {humanEligibleAfter(profile.eligibleAfter)}.</dd>
              </div>
            </dl>
          </Card>

          <Card
            title="Metrics"
            subtitle="Attributed activity and conservative money labels — not a withdrawal balance."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
              <Metric label="Visits" value={String(metrics.visits ?? 0)} />
              <Metric label="Unique visitors" value={String(metrics.uniqueVisitors ?? 0)} />
              <Metric label="Attributed bookings" value={String(metrics.bookings ?? 0)} />
              <Metric label="Paid bookings" value={String(metrics.paidBookings ?? 0)} />
              <Metric
                label="Attributed booking value"
                value={formatMoney(metrics.attributedBookingValue)}
                hint="Attributed for visibility; not the same as cash collected."
              />
              <Metric label="Paid stay revenue" value={formatMoney(metrics.paidStayRevenue)} />
              <Metric label="Gift voucher sales (count)" value={String(metrics.giftVoucherSales ?? 0)} />
              <Metric label="Gift voucher revenue" value={formatMoney(gvRev.amount, gvRev.currency)} />
              <Metric label="Gift voucher commission (ledger mix)" value={formatMoney(gvComm.amount, gvComm.currency)} />
              <Metric
                label="Projected commission"
                value={formatMoney(pc.amount, pc.currency)}
                hint="Estimate only — not payable yet. Becomes payable only after the stay is completed and approved per your agreement."
              />
              <Metric label="Approved commission" value={formatMoney(approved.amount, approved.currency)} />
              <Metric label="Paid commission" value={formatMoney(paid.amount, paid.currency)} />
            </div>
            {pc.notPayable ? (
              <p className="mt-4 text-xs md:text-sm text-zinc-500 border-t border-white/10 pt-4 max-w-3xl">
                <span className="text-zinc-300 font-medium">Projected</span> amounts are not cash you can withdraw.
                Approved and paid lines follow the manual workflow managed by Drift &amp; Dwells.
              </p>
            ) : null}
          </Card>

          <Card title="Recent stay bookings" subtitle="Attributed stays only — no guest contact details.">
            {recentBookings.length === 0 ? (
              <p className="text-sm text-zinc-500">No attributed bookings yet.</p>
            ) : (
              <div className="space-y-3 md:hidden">
                {recentBookings.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-xl border border-white/10 bg-zinc-900/50 p-3 text-sm space-y-1.5"
                  >
                    <div className="flex justify-between gap-2 text-zinc-300">
                      <span>{formatDate(b.checkIn)} → {formatDate(b.checkOut)}</span>
                      <span className="capitalize text-zinc-400">{b.status || '—'}</span>
                    </div>
                    <div className="text-white font-medium">{b.propertyLabel || 'Property'}</div>
                    <div className="text-xs text-zinc-500 flex flex-wrap gap-x-3 gap-y-1">
                      <span>Source: {b.attributionSource || '—'}</span>
                      <span>Value: {formatMoney(b.bookingValue)}</span>
                      <span>Commission: {b.commissionStatus || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {recentBookings.length > 0 ? (
              <div className="hidden md:block overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-zinc-900/80 text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Stay</th>
                      <th className="px-3 py-2 font-medium">Property</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                      <th className="px-3 py-2 font-medium">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {recentBookings.map((b) => (
                      <tr key={b.id} className="text-zinc-200">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDate(b.checkIn)} – {formatDate(b.checkOut)}
                        </td>
                        <td className="px-3 py-2 text-white">{b.propertyLabel || '—'}</td>
                        <td className="px-3 py-2 capitalize">{b.status || '—'}</td>
                        <td className="px-3 py-2">{b.attributionSource || '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{formatMoney(b.bookingValue)}</td>
                        <td className="px-3 py-2">{b.commissionStatus || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          <Card title="Recent gift voucher sales" subtitle="Voucher purchases attributed to you.">
            {giftSales.length === 0 ? (
              <p className="text-sm text-zinc-500">No voucher sales yet.</p>
            ) : (
              <ul className="divide-y divide-white/10 rounded-xl border border-white/10 overflow-hidden">
                {giftSales.map((g, idx) => (
                  <li
                    key={`gv-${idx}-${g.date ? String(g.date) : idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 bg-zinc-900/40 text-sm"
                  >
                    <span className="text-zinc-300">{formatDateTime(g.date)}</span>
                    <span className="capitalize text-zinc-400">{g.status || '—'}</span>
                    <span className="font-medium tabular-nums text-white">
                      {formatMoney((Number(g.amountOriginalCents) || 0) / 100)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent commission rows" subtitle="Ledger snapshots — read only.">
            {recentCommission.length === 0 ? (
              <p className="text-sm text-zinc-500">No commission rows yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-zinc-900/80 text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Booking ref</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {recentCommission.map((c) => (
                      <tr key={c.id} className="text-zinc-200">
                        <td className="px-3 py-2 capitalize">{c.status || '—'}</td>
                        <td className="px-3 py-2">{c.source || '—'}</td>
                        <td className="px-3 py-2 tabular-nums font-medium text-white">
                          {formatMoney(c.amount, c.currency)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                          {c.bookingId ? String(c.bookingId) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </Shell>
    </>
  );
}
