function formatMoney(amount, currency = 'EUR') {
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const symbol = currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${n.toFixed(2)}`;
}

export default function OpsCleaningLineItemsTable({ lineItems = [], currency = 'EUR', totalAmount = 0 }) {
  const rows = Array.isArray(lineItems) ? lineItems : [];

  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Line items</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No line items for this day.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Item</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Qty</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Unit</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rows.map((item, idx) => (
                <tr key={`${item.ruleKey || item.label}-${idx}`}>
                  <td className="px-3 py-2 text-gray-900">
                    {item.label}
                    {item.cabinName ? (
                      <span className="block text-xs text-gray-500">{item.cabinName}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{item.quantity ?? 1}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {typeof item.unitAmountEUR === 'number'
                      ? formatMoney(item.unitAmountEUR, currency)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                    {formatMoney(item.amountEUR, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-500">
                  Total
                </td>
                <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-gray-900">
                  {formatMoney(totalAmount, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export { formatMoney };
