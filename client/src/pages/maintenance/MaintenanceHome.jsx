import { Link } from 'react-router-dom';

const cards = [
  {
    to: '/maintenance/cabins',
    title: 'Cabins',
    body: 'Archive inventory or remove fixture-named cabins. Hard delete is limited to fixture names.'
  },
  {
    to: '/maintenance/reservations',
    title: 'Reservations',
    body: 'Archive or delete fixture/test reservations. Live stays should be cancelled in OPS.'
  },
  {
    to: '/maintenance/sync',
    title: 'Sync',
    body: 'Configure iCal feed URL and run manual sync (admin-only).'
  },
  {
    to: '/maintenance/cleanup',
    title: 'Cleanup',
    body: 'Previews and batch repair: fixture contamination, stale reservation blocks, ICS signals.'
  },
  {
    to: '/maintenance/archived',
    title: 'Archived / fixtures',
    body: 'How to browse hidden data with explicit filters and toggles.'
  }
];

export default function MaintenanceHome() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div className="rounded-xl border border-amber-900/40 bg-slate-900/50 p-6 md:p-8">
        <h2 className="text-lg font-semibold text-white">Maintenance overview</h2>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          This area is reserved for structural repair, fixture cleanup, and destructive actions. Operators cannot access
          these routes. Every action requires a written reason and is audited.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="block rounded-xl border border-slate-700/80 bg-slate-900/40 p-5 hover:border-amber-800/60 hover:bg-slate-900/70 transition-colors"
          >
            <h3 className="text-sm font-semibold text-amber-100">{c.title}</h3>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
