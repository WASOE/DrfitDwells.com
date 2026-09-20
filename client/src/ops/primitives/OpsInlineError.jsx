import { opsCx } from './opsCx';

export default function OpsInlineError({ className, children, ...rest }) {
  return (
    <p className={opsCx('ops-inline-error', className)} role="alert" {...rest}>
      {children}
    </p>
  );
}
