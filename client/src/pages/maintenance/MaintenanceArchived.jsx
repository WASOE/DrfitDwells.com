import { Link } from 'react-router-dom';

export default function MaintenanceArchived() {
  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-white">Archived &amp; fixture data</h2>
      <p className="text-sm text-slate-400 leading-relaxed">
        Public, OPS, and default admin lists intentionally hide archived inventory and validation fixtures. In this
        maintenance area, use explicit toggles on the Cabins and Reservations pages to include archived rows and
        fixture/test records.
      </p>
      <ul className="list-disc list-inside text-sm text-slate-300 space-y-2">
        <li>
          <Link className="text-amber-400 hover:underline" to="/maintenance/cabins">
            Cabins
          </Link>{' '}
          — enable &quot;Show fixture-named cabins&quot; and/or &quot;Show archived cabins&quot;.
        </li>
        <li>
          <Link className="text-amber-400 hover:underline" to="/maintenance/reservations">
            Reservations
          </Link>{' '}
          — enable &quot;Show test / fixture-pattern reservations&quot; and/or &quot;Show archived reservations&quot;.
        </li>
      </ul>
      <p className="text-xs text-slate-500">
        Hard deletes are limited to fixture-named cabins and fixture/test bookings. Live business entities should be
        archived or cancelled through OPS where applicable.
      </p>
    </div>
  );
}
