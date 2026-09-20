function formatMoney(amount, currency = 'EUR') {
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const symbol = currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${n.toFixed(2)}`;
}

export default function OpsCleaningLineItemsTable({ lineItems = [], currency = 'EUR', totalAmount = 0 }) {
  const rows = Array.isArray(lineItems) ? lineItems : [];

  return (
    <div className="ops-cleaning-pay__lines">
      <p className="ops-cleaning-pay__lines-title">Line items</p>
      {rows.length === 0 ? (
        <p className="ops-cleaning-pay__muted">No line items for this day.</p>
      ) : (
        <div className="ops-cleaning-pay__table-wrap">
          <table className="ops-cleaning-pay__table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, idx) => (
                <tr key={`${item.ruleKey || item.label}-${idx}`}>
                  <td>
                    {item.label}
                    {item.cabinName ? <span className="ops-cleaning-pay__cabin">{item.cabinName}</span> : null}
                  </td>
                  <td>{item.quantity ?? 1}</td>
                  <td>
                    {typeof item.unitAmountEUR === 'number'
                      ? formatMoney(item.unitAmountEUR, currency)
                      : '—'}
                  </td>
                  <td>{formatMoney(item.amountEUR, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td>{formatMoney(totalAmount, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export { formatMoney };
