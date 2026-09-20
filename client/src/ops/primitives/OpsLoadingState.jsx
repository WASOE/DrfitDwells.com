import { opsCx } from './opsCx';

export default function OpsLoadingState({ label = 'Loading', className, ...rest }) {
  return (
    <div className={opsCx('ops-loading', className)} role="status" aria-live="polite" {...rest}>
      {label}
    </div>
  );
}
