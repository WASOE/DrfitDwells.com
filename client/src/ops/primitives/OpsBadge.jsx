import { opsCx } from './opsCx';

const TONES = {
  neutral: 'ops-badge--neutral',
  info: 'ops-badge--info'
};

export default function OpsBadge({ tone = 'neutral', className, children, ...rest }) {
  const toneClass = TONES[tone] || TONES.neutral;
  return (
    <span className={opsCx('ops-badge', toneClass, className)} {...rest}>
      {children}
    </span>
  );
}
