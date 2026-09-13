/* ============================================================
   SAA Comfort Air LLC — printable Year-End Mileage Tax Summary
   Same letterhead system as print-quote.js/print-invoice.js's printFormal*
   functions, but for a full year's mileage: one row per technician with
   their total miles for the year, plus a company grand total. Meant to
   be handed to an accountant or attached to a tax return (round 11
   follow-up, 2026-09-13).
   ============================================================ */

const SAA_MILEAGE_INFO = {
  name: "SAA Comfort Air LLC",
  phone: "713-955-6242",
  email: "saacomfortair@gmail.com",
  address: "27703 Yorkshire Brook Lane, Fulshear, TX 77441",
  license: "TDLR Lic #TACLB167405E",
};

function _saaMileageSumEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * opts: {
 *   year, generatedOn,
 *   rows: [{ technicianName, tripCount, miles }],
 *   grandTotal, tripCountTotal
 * }
 */
function printMileageSummary(opts) {
  const info = SAA_MILEAGE_INFO;
  const rowsHtml = (opts.rows || []).length
    ? opts.rows.map((r) => `
        <tr>
          <td>${_saaMileageSumEsc(r.technicianName)}</td>
          <td class="num">${r.tripCount}</td>
          <td class="num">${Number(r.miles).toFixed(1)}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="muted">No mileage logged for this year.</td></tr>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${opts.year} Mileage Tax Summary — ${info.name}</title>
<style>
  @page { size: letter; margin: 0.55in 0.6in; }
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
  table.items tfoot td { border-bottom: none; border-top: 2px solid #0f2439; font-weight: 800; padding-top: 9px; }
  .muted { color: #55636e; }
  .footer { display: flex; justify-content: space-between; color: #55636e; font-size: .74rem; border-top: 1px solid #cfd8de; padding-top: 6px; margin-top: 24px; }
  .note { margin-top: 18px; font-size: .78rem; color: #55636e; }
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
    <h2>${opts.year} Mileage Summary</h2>
    <div class="sub">Generated ${_saaMileageSumEsc(opts.generatedOn)} &mdash; for tax-return / reimbursement records</div>
  </div>

  <table class="items">
    <thead><tr><th>Technician</th><th class="num">Trips</th><th class="num">Total Miles</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr><td>Company Total</td><td class="num">${opts.tripCountTotal}</td><td class="num">${Number(opts.grandTotal).toFixed(1)}</td></tr>
    </tfoot>
  </table>

  <p class="note">Totals reflect every mileage entry on file for ${opts.year} (auto-calculated and manually-entered trips alike). Consult your tax preparer for how these miles apply to your return.</p>

  <div class="footer">
    <div>${info.name} &mdash; ${opts.year} Mileage Summary</div>
    <div>${info.address}</div>
  </div>

<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 150); };
</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print the mileage summary."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
