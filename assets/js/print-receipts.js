/* ============================================================
   SAA Comfort Air LLC — printable Receipts export (Receipts / Tools /
   Supplies buckets, employee/receipts.html)
   Same letterhead system as print-tool-list.js, print-bom.js, and
   print-mileage-summary.js. Round 53 (2026-09-25), per Vijayan's request:
   "add download feature in excel or pdf format in receipts by month or
   year, tools and supplies." Prints whatever line items were selected on
   screen (already narrowed to one bucket + optional month/year period).
   ============================================================ */

const SAA_RECEIPTS_PRINT_INFO = {
  name: "SAA Comfort Air LLC",
  phone: "713-955-6242",
  email: "saacomfortair@gmail.com",
  address: "27703 Yorkshire Brook Lane, Fulshear, TX 77441",
  license: "TDLR Lic #TACLB167405E",
};

function _saaReceiptsPrintEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function _saaReceiptsPrintMoney(n) {
  if (n == null || n === "") return "";
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * opts: { bucketLabel, periodLabel, generatedOn,
 *         rows: [{ r_received_at, r_vendor, item_description, category,
 *                   projectLabel, qty, item_total, sales_tax, subtotal }] }
 * rows are pre-sorted and already carry a resolved `projectLabel` and
 * `subtotal` (see _rcRowsForExport in receipts-page.js) so this file stays
 * a pure renderer, same division of labor as printToolList.
 */
function printReceipts(opts) {
  const info = SAA_RECEIPTS_PRINT_INFO;
  const rows = opts.rows || [];
  const totals = rows.reduce((acc, r) => ({
    item_total: acc.item_total + (Number(r.item_total) || 0),
    sales_tax: acc.sales_tax + (Number(r.sales_tax) || 0),
    subtotal: acc.subtotal + (Number(r.subtotal) || 0),
  }), { item_total: 0, sales_tax: 0, subtotal: 0 });

  const rowsHtml = rows.length
    ? rows.map((r) => `
        <tr>
          <td>${_saaReceiptsPrintEsc(r.dateLabel)}</td>
          <td>${_saaReceiptsPrintEsc(r.r_vendor)}</td>
          <td>${_saaReceiptsPrintEsc(r.item_description)}</td>
          <td>${_saaReceiptsPrintEsc(r.category) || "Uncategorized"}</td>
          <td>${_saaReceiptsPrintEsc(r.projectLabel)}</td>
          <td class="num">${r.qty == null ? "" : _saaReceiptsPrintEsc(r.qty)}</td>
          <td class="num">${_saaReceiptsPrintMoney(r.item_total)}</td>
          <td class="num">${_saaReceiptsPrintMoney(r.sales_tax)}</td>
          <td class="num">${_saaReceiptsPrintMoney(r.subtotal)}</td>
        </tr>`).join("")
    : `<tr><td colspan="9" class="muted">No line items in this selection.</td></tr>`;

  const totalsRow = rows.length ? `
        <tr class="total-row">
          <td colspan="5"><strong>Total</strong></td>
          <td></td>
          <td class="num"><strong>${_saaReceiptsPrintMoney(totals.item_total)}</strong></td>
          <td class="num"><strong>${_saaReceiptsPrintMoney(totals.sales_tax)}</strong></td>
          <td class="num"><strong>${_saaReceiptsPrintMoney(totals.subtotal)}</strong></td>
        </tr>` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Receipts — ${_saaReceiptsPrintEsc(opts.bucketLabel)} — ${info.name}</title>
<style>
  @page { size: letter landscape; margin: 0.55in 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2733; font-size: 12px; line-height: 1.4; margin: 0; }
  h1, h2, h3 { margin: 0; }
  .rule { border-top: 2px solid #1a6b5a; margin: 6px 0 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header h1 { font-size: 1.2rem; color: #0f2439; }
  .header .sub { color: #55636e; font-size: .8rem; }
  .header .contact { text-align: right; font-size: .8rem; color: #55636e; }
  .title-row { margin: 6px 0 14px; }
  .title-row h2 { font-size: 1.4rem; color: #1a6b5a; text-transform: uppercase; letter-spacing: .5px; }
  .title-row .sub { color: #55636e; font-size: .84rem; margin-top: 2px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.items th { text-align: left; font-size: .66rem; text-transform: uppercase; letter-spacing: .3px; color: #55636e; border-bottom: 1px solid #cfd8de; padding: 5px 4px; }
  table.items td { padding: 7px 4px; border-bottom: 1px solid #e7ecef; vertical-align: top; }
  table.items td.num, table.items th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.items tr.total-row td { border-top: 2px solid #1a6b5a; border-bottom: none; padding-top: 8px; }
  .muted { color: #55636e; }
  .footer { display: flex; justify-content: space-between; color: #55636e; font-size: .74rem; border-top: 1px solid #cfd8de; padding-top: 6px; margin-top: 24px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

  <div class="header">
    <div>
      <h1>${info.name}</h1>
      <div class="sub">${info.license}</div>
    </div>
    <div class="contact">
      ${info.phone}<br>
      ${info.email}<br>
      ${info.address}
    </div>
  </div>
  <div class="rule"></div>

  <div class="title-row">
    <h2>Receipts — ${_saaReceiptsPrintEsc(opts.bucketLabel)}</h2>
    <div class="sub">Generated ${_saaReceiptsPrintEsc(opts.generatedOn)} &mdash; ${_saaReceiptsPrintEsc(opts.periodLabel)}</div>
  </div>

  <table class="items">
    <thead><tr>
      <th>Date</th><th>Vendor</th><th>Item Description</th><th>Category</th><th>Job / Project</th>
      <th class="num">Qty</th><th class="num">Item Total</th><th class="num">Sales Tax</th><th class="num">Subtotal</th>
    </tr></thead>
    <tbody>${rowsHtml}${totalsRow}</tbody>
  </table>

  <div class="footer">
    <div>${info.name} &mdash; Receipts (${_saaReceiptsPrintEsc(opts.bucketLabel)})</div>
    <div>${info.address}</div>
  </div>

<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 150); };
</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print Receipts."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
