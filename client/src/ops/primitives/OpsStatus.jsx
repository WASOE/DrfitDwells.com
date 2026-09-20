import { useOpsSession } from '../../context/OpsSessionContext';
import { resolveOpsUiLanguage } from '../i18n/opsUiLanguage';
import { getOpsStatusByKey, resolveOpsStatus } from '../status/opsStatusRegistry';
import { opsCx } from './opsCx';

function resolveEntry({ name, domain, value }) {
  if (name) {
    const known = getOpsStatusByKey(name);
    if (known) return known;
    const dot = String(name).indexOf('.');
    if (dot > 0) {
      return resolveOpsStatus(name.slice(0, dot), name.slice(dot + 1));
    }
    return resolveOpsStatus('', name);
  }
  return resolveOpsStatus(domain, value);
}

function labelForEntry(entry, session) {
  const language = resolveOpsUiLanguage(session);
  if (language === 'bg' && entry.label?.bg) {
    return entry.label.bg;
  }
  return entry.label?.en || 'Unknown';
}

export default function OpsStatus({ name, domain, value, className, ...rest }) {
  const session = useOpsSession();
  const entry = resolveEntry({ name, domain, value });
  const label = labelForEntry(entry, session);

  return (
    <span
      className={opsCx(
        'ops-status',
        `ops-status--${entry.family || 'neutral'}`,
        `ops-status--${entry.loudness || 'normal'}`,
        className
      )}
      data-ops-status-key={entry.key}
      data-ops-status-unknown={entry.unknown ? 'true' : undefined}
      {...rest}
    >
      {label}
    </span>
  );
}
