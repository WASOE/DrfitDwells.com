import { INDEX_LEGEND_ITEMS } from './calendarVisualTokens';

/**
 * Compact inline legend for calendar index preview strips and month Gantt view.
 */
export default function OpsCalendarLegend({ className = '', ariaLabel = 'Calendar legend' }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {INDEX_LEGEND_ITEMS.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${item.dot}`} />
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}
