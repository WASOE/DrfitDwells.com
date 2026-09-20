import { opsCx } from './opsCx';

export default function OpsTable({ className, children, caption, ...rest }) {
  return (
    <div className={opsCx('ops-table-wrap', className)}>
      <table className="ops-table" {...rest}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function OpsTableHead({ children, ...rest }) {
  return <thead {...rest}>{children}</thead>;
}

export function OpsTableBody({ children, ...rest }) {
  return <tbody {...rest}>{children}</tbody>;
}

export function OpsTableRow({ children, ...rest }) {
  return <tr {...rest}>{children}</tr>;
}

export function OpsTableHeader({ align, numeric = false, className, children, ...rest }) {
  return (
    <th
      className={opsCx(
        align === 'end' && 'ops-table__cell--end',
        numeric && 'ops-table__cell--numeric',
        className
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function OpsTableCell({ align, numeric = false, className, children, ...rest }) {
  return (
    <td
      className={opsCx(
        align === 'end' && 'ops-table__cell--end',
        numeric && 'ops-table__cell--numeric',
        className
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
