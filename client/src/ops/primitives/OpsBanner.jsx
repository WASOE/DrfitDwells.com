import { opsCx } from './opsCx';

const TONES = {
  info: { className: 'ops-banner--info', role: 'status' },
  success: { className: 'ops-banner--success', role: 'status' },
  warning: { className: 'ops-banner--warning', role: 'alert' },
  danger: { className: 'ops-banner--danger', role: 'alert' }
};

export default function OpsBanner({ tone = 'info', title, body, action, className, ...rest }) {
  const config = TONES[tone] || TONES.info;
  return (
    <div
      className={opsCx('ops-banner', config.className, className)}
      role={config.role}
      {...rest}
    >
      {title ? <p className="ops-banner__title">{title}</p> : null}
      {body ? <p className="ops-banner__body">{body}</p> : null}
      {action}
    </div>
  );
}
