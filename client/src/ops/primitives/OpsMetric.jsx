import { opsCx } from './opsCx';

export function OpsMetricGroup({ className, children, ...rest }) {
  return (
    <div className={opsCx('ops-metric-group', className)} {...rest}>
      {children}
    </div>
  );
}

export default function OpsMetric({ label, value, meta, className, ...rest }) {
  return (
    <div className={opsCx('ops-metric', className)} {...rest}>
      <p className="ops-metric__label">{label}</p>
      <p className="ops-metric__value">{value}</p>
      {meta ? <p className="ops-metric__meta">{meta}</p> : null}
    </div>
  );
}
