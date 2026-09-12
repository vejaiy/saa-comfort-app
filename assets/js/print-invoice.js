/* ============================================================
   SAA Comfort Air LLC — formal printable invoice
   Same letterhead system as print-quote.js's printFormalQuote, but
   for a job's invoice: one clean charge line (what the customer
   owes), plus payments received and balance due. Deliberately does
   NOT itemize internal cost fields (material/labor/other) on the
   customer-facing document — those stay in the Job Card for the
   office's own profit tracking.
   ============================================================ */

const SAA_INVOICE_INFO = {
  name: "SAA Comfort Air LLC",
  phone: "713-955-6242",
  email: "saacomfortair@gmail.com",
  address: "27703 Yorkshire Brook Lane, Fulshear, TX 77441",
  license: "TDLR Lic #12360480",
};

function _saaInvEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * opts: {
 *   invoiceNumber, issueDate, dueDate, status,
 *   customer, phone, address,
 *   jobTitle, description,
 *   amountTotal, amountPaid,
 *   payments: [{ payment_date, amount, method }]
 * }
 */
function printFormalInvoice(opts) {
  const info = SAA_INVOICE_INFO;
  const total = Number(opts.amountTotal || 0);
  const paid = Number(opts.amountPaid || 0);
  const balance = Math.max(total - paid, 0);

  const paymentsHtml = (opts.payments || []).length
    ? opts.payments.map((p) => `
        <tr>
          <td>${_saaInvEsc(p.payment_date)}</td>
          <td>${_saaInvEsc((p.method || "").replace(/^\w/, (c) => c.toUpperCase()))}</td>
          <td class="num">${fmtMoney(Number(p.amount || 0))}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="muted">No payments recorded yet.</td></tr>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice ${_saaInvEsc(opts.invoiceNumber)} — ${info.name}</title>
<style>
  @page { size: letter; margin: 0.55in 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2733; font-size: 12px; line-height: 1.4; margin: 0; }
  h1, h2, h3 { margin: 0; }
  .rule { border-top: 2px solid #1a6b5a; margin: 6px 0 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header .mark { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 36px; border-radius: 7px; background: #0f2439; color: #fff; font-weight: 800; font-size: .74rem; letter-spacing: -0.2px; margin-bottom: 5px; }
  .header h1 { font-size: 1.2rem; color: #0f2439; }
  .header .sub { color: #55636e; font-size: .8rem; }
  .header .contact { text-align: right; font-size: .8rem; color: #55636e; }
  .title-row { display: flex; justify-content: space-between; align-items: baseline; margin: 6px 0 14px; }
  .title-row h2 { font-size: 1.4rem; color: #1a6b5a; text-transform: uppercase; letter-spacing: .5px; }
  .status-pill { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; background: #eef3f6; color: #55636e; }
  .status-pill.paid { background: #e3f6ee; color: #1a6b5a; }
  .meta-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
  .meta-box { flex: 1; }
  .meta-box .label { text-transform: uppercase; font-size: .64rem; letter-spacing: .4px; color: #55636e; font-weight: 700; margin-bottom: 2px; }
  .meta-box .val { font-size: .88rem; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.items th { text-align: left; font-size: .66rem; text-transform: uppercase; letter-spacing: .3px; color: #55636e; border-bottom: 1px solid #cfd8de; padding: 5px 4px; }
  table.items td { padding: 7px 4px; border-bottom: 1px solid #e7ecef; vertical-align: top; }
  table.items td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .summary { margin-top: 10px; width: 100%; max-width: 300px; margin-left: auto; }
  .summary-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: .88rem; }
  .summary-row.total { border-top: 2px solid #0f2439; font-weight: 800; font-size: 1.05rem; padding-top: 8px; margin-top: 4px; }
  .summary-row.balance { font-weight: 800; color: #b3401a; }
  .summary-row.balance.zero { color: #1a6b5a; }
  section { margin: 20px 0; }
  section h3 { font-size: .78rem; color: #1a6b5a; text-transform: uppercase; letter-spacing: .3px; margin-bottom: 6px; }
  .footer { display: flex; justify-content: space-between; color: #55636e; font-size: .74rem; border-top: 1px solid #cfd8de; padding-top: 6px; margin-top: 24px; }
  .muted { color: #55636e; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

  <div class="header">
    <div>
      <div class="mark">SAA</div>
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
    <h2>Invoice</h2>
    <span class="status-pill ${opts.status === "paid" ? "paid" : ""}">${_saaInvEsc((opts.status || "").toUpperCase())}</span>
  </div>

  <div class="meta-row">
    <div class="meta-box">
      <div class="label">Invoice #</div>
      <div class="val">${_saaInvEsc(opts.invoiceNumber)}</div>
    </div>
    <div class="meta-box">
      <div class="label">Issue Date</div>
      <div class="val">${_saaInvEsc(opts.issueDate)}</div>
    </div>
    <div class="meta-box" style="text-align:right">
      <div class="label">Due Date</div>
      <div class="val">${_saaInvEsc(opts.dueDate) || "&mdash;"}</div>
    </div>
  </div>

  <div class="meta-row">
    <div class="meta-box">
      <div class="label">Bill To</div>
      <div class="val">${_saaInvEsc(opts.customer) || "&mdash;"}</div>
      ${opts.phone ? `<div class="val" style="font-size:.82rem;color:#55636e;margin-top:2px">${_saaInvEsc(saaFormatPhone(opts.phone))}</div>` : ""}
    </div>
    <div class="meta-box">
      <div class="label">Service Address</div>
      <div class="val">${_saaInvEsc(opts.address) || "&mdash;"}</div>
    </div>
  </div>

  <table class="items">
    <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>
          <div style="font-weight:700">${_saaInvEsc(opts.jobTitle || "HVAC Service")}</div>
          ${opts.description ? `<div class="muted" style="font-size:.82rem;margin-top:2px">${_saaInvEsc(opts.description)}</div>` : ""}
        </td>
        <td class="num">${fmtMoney(total)}</td>
      </tr>
    </tbody>
  </table>

  <div class="summary">
    <div class="summary-row total"><span>Total Due</span><span>${fmtMoney(total)}</span></div>
    <div class="summary-row"><span>Amount Paid</span><span>${fmtMoney(paid)}</span></div>
    <div class="summary-row balance ${balance <= 0 ? "zero" : ""}"><span>Balance Due</span><span>${fmtMoney(balance)}</span></div>
  </div>

  <section>
    <h3>Payments Received</h3>
    <table class="items">
      <thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
      <tbody>${paymentsHtml}</tbody>
    </table>
  </section>

  <div class="footer">
    <div>${info.name} &mdash; Invoice ${_saaInvEsc(opts.invoiceNumber)}</div>
    <div>${info.address}</div>
  </div>

<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 150); };
</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print the invoice."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
