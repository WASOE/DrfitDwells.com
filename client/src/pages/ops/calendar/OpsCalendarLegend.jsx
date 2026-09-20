import { INDEX_LEGEND_ITEMS } from './calendarVisualTokens';
import { opsCx } from '../../../ops/primitives/opsCx';
import './OpsCalendar.css';

/**
 * Compact inline legend for calendar index preview strips and month Gantt view.
 */
export default function OpsCalendarLegend({ className = '', ariaLabel = 'Calendar legend' }) {
  return (
    <div className={opsCx('ops-cal-legend', className)} aria-label={ariaLabel}>
      {INDEX_LEGEND_ITEMS.map((item) => (
        <span key={item.key} className="ops-cal-legend__item" data-ops-cal-legend={item.key}>
          <span className={item.dot} aria-hidden="true" />
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}
