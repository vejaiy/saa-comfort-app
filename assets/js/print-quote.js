/* ============================================================
   SAA Comfort Air LLC — formal printable quote
   Builds a standalone letterhead-style quote document (company
   header, itemized pricing, payment terms, terms & conditions,
   signature block) in a new window and opens the print dialog —
   instead of printing the employee-tools page itself.
   ============================================================ */

const SAA_QUOTE_INFO = {
  name: "SAA Comfort Air LLC",
  phone: "713-955-6242",
  email: "saacomfortair@gmail.com",
  address: "27703 Yorkshire Brook Lane, Fulshear, TX 77441",
  license: "TDLR Lic #12360480",
};

function _saaQuoteRef(date) {
  // Fallback only — used when no Quote # was entered on the worksheet page.
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const stamp = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `${y}-${stamp}`;
}

function _saaEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * opts: {
 *   jobTitle: "Replacement" | "New Installation" | ...
 *   customer, address, date (string as typed on the page),
 *   quoteNumber: string (from the Quote # field on the page),
 *   lineItems: [{ name, desc, price }]   // only the toggled-on items
 *   grandTotal: number
 * }
 */
function printFormalQuote(opts) {
  const info = SAA_QUOTE_INFO;
  const ref = (opts.quoteNumber || "").trim() || _saaQuoteRef();
  const deposit = (opts.grandTotal || 0) / 2;
  const itemsHtml = (opts.lineItems || []).filter(li => li && li.price > 0).map(li => `
        <tr>
          <td>
            <div class="li-name">${_saaEsc(li.name)}</div>
            ${li.desc ? `<div class="li-desc">${_saaEsc(li.desc)}</div>` : ""}
          </td>
          <td class="num">${fmtMoney(li.price)}</td>
        </tr>`).join("") || `<tr><td class="muted">No line items selected.</td><td class="num">$0.00</td></tr>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Quotation ${ref} — ${info.name}</title>
<style>
  @page { size: letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2733; font-size: 13px; line-height: 1.5; margin: 0; }
  h1, h2, h3 { margin: 0; }
  .rule { border-top: 2px solid #1a6b5a; margin: 6px 0 10px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
  .header .mark { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 44px; border-radius: 8px; background: #0f2439; color: #fff; font-weight: 800; font-size: .82rem; letter-spacing: -0.2px; margin-bottom: 6px; }
  .header h1 { font-size: 1.25rem; color: #0f2439; }
  .header .sub { color: #55636e; font-size: .85rem; }
  .header .contact { text-align: right; font-size: .82rem; color: #55636e; }
  .meta-row { display: flex; justify-content: space-between; gap: 24px; margin: 14px 0 18px; }
  .meta-box { flex: 1; }
  .meta-box .label { text-transform: uppercase; font-size: .68rem; letter-spacing: .4px; color: #55636e; font-weight: 700; margin-bottom: 3px; }
  .meta-box .val { font-size: .92rem; }
  section { margin-bottom: 18px; }
  section h2 { font-size: .95rem; color: #1a6b5a; text-transform: uppercase; letter-spacing: .3px; margin-bottom: 4px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.items th { text-align: left; font-size: .68rem; text-transform: uppercase; letter-spacing: .3px; color: #55636e; border-bottom: 1px solid #cfd8de; padding: 6px 4px; }
  table.items td { padding: 8px 4px; border-bottom: 1px solid #e7ecef; vertical-align: top; }
  table.items td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .li-name { font-weight: 700; }
  .li-desc { color: #55636e; font-size: .82rem; margin-top: 2px; }
  .total-row td { border-top: 2px solid #0f2439; border-bottom: none; font-weight: 800; font-size: 1.05rem; padding-top: 10px; }
  ul.terms { margin: 6px 0 0; padding-left: 18px; }
  ul.terms li { margin-bottom: 6px; }
  .disclaimer { color: #55636e; font-size: .78rem; font-style: italic; margin-top: 8px; }
  .footer { display: flex; justify-content: space-between; color: #55636e; font-size: .76rem; border-top: 1px solid #cfd8de; padding-top: 8px; margin-top: 20px; }
  .accept { margin-top: 26px; page-break-inside: avoid; }
  .sig-row { display: flex; gap: 40px; margin-top: 34px; }
  .sig-line { flex: 1; border-top: 1px solid #1a2733; padding-top: 4px; font-size: .82rem; color: #55636e; }
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

  <div class="meta-row">
    <div class="meta-box">
      <div class="label">Quotation</div>
      <div class="val">${ref}</div>
    </div>
    <div class="meta-box">
      <div class="label">Date</div>
      <div class="val">${_saaEsc(opts.date || "")}</div>
    </div>
    <div class="meta-box">
      <div class="label">Job Type</div>
      <div class="val">${_saaEsc(opts.jobTitle || "")}</div>
    </div>
  </div>

  <div class="meta-row">
    <div class="meta-box">
      <div class="label">Customer</div>
      <div class="val">${_saaEsc(opts.customer) || "&mdash;"}</div>
      ${opts.phone ? `<div class="val" style="font-size:.8rem;color:#55636e;margin-top:2px">${_saaEsc(opts.phone)}</div>` : ""}
    </div>
    <div class="meta-box">
      <div class="label">Job Address</div>
      <div class="val">${_saaEsc(opts.address) || "&mdash;"}</div>
    </div>
  </div>

  <section>
    <h2>1. Itemized Price</h2>
    <table class="items">
      <thead><tr><th>Description</th><th class="num">Price</th></tr></thead>
      <tbody>
        ${itemsHtml}
        <tr class="total-row"><td>Quote Total</td><td class="num">${fmtMoney(opts.grandTotal || 0)}</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>2. Scope of Work</h2>
    <ul class="terms">
      <li>Removal of existing equipment</li>
      <li>Installation of new equipment</li>
      <li>Pressure test</li>
      <li>Evacuation</li>
      <li>Refrigerant charge</li>
      <li>Startup and commissioning</li>
    </ul>
  </section>

  <section>
    <h2>3. Items Not Included in This Quote</h2>
    <ul class="terms">
      <li>Refrigerant line-set replacement, if required, is not included in this quote and will be replaced at additional cost.</li>
      <li>Airflow duct replacement, if required, is not included in this quote and will be replaced at additional cost.</li>
    </ul>
  </section>

  <section>
    <h2>4. Warranty</h2>
    <p class="muted" style="margin:2px 0"><strong>Parts Warranty:</strong> 10-Year Manufacturer Limited Warranty (upon online equipment registration within 60 days).</p>
    <p class="muted" style="margin:2px 0"><strong>Labor Warranty:</strong> 1-Year Installation Workmanship Warranty from SAA Comfort Air LLC.</p>
  </section>

  <section>
    <h2>5. Payment Terms</h2>
    <ul class="terms">
      <li>50% deposit required upon signing this quote/agreement (${fmtMoney(deposit)}).</li>
      <li>Remaining 50% due upon satisfactory completion of the project.</li>
      <li>Final invoiced amount will reflect the fixed price above unless a written Change Order is signed for additional work not covered by this scope.</li>
    </ul>
  </section>

  <section>
    <h2>6. Other Terms &amp; Conditions</h2>
    <ul class="terms">
      <li><strong>Permits:</strong> SAA Comfort Air LLC will obtain all required mechanical permits for the applicable jurisdiction and schedule required inspections. Permit fees are included in the pricing above unless noted otherwise.</li>
      <li><strong>Change Orders:</strong> Any change to scope, equipment, or price after acceptance must be documented in a written Change Order signed by both parties, except where immediate action is needed to prevent damage to the property or equipment.</li>
      <li><strong>Right to Cancel:</strong> If this quote is accepted and signed away from SAA Comfort Air LLC's place of business (e.g., at the customer's home), the customer may cancel without penalty within 3 business days per the FTC Cooling-Off Rule. A separate Notice of Cancellation form will be provided at signing.</li>
      <li><strong>Limitation of Liability:</strong> Except in cases of gross negligence or willful misconduct, SAA Comfort Air LLC's total liability arising from this project is limited to the amount paid by the customer under the resulting agreement.</li>
      <li><strong>Governing Agreement:</strong> This quotation is a good-faith estimate. Work will not begin until the customer signs SAA Comfort Air LLC's formal HVAC Service &amp; Installation Agreement, which contains the complete, binding terms and conditions for this project.</li>
      <li><strong>Dispute Resolution:</strong> Governed by the laws of the State of Texas; venue in the county where the property is located.</li>
    </ul>
    <div class="disclaimer">This document reflects general trade and business practice as of this writing. It is a quotation only, not a legal contract — please review SAA Comfort Air LLC's full HVAC Service &amp; Installation Agreement, provided separately, for the binding terms of this project before work begins.</div>
  </section>

  <div class="footer">
    <div>${info.name} &mdash; Quotation ${ref}</div>
    <div>${info.address}</div>
  </div>

  <div class="accept">
    <h2 style="font-size:.95rem;color:#1a6b5a;text-transform:uppercase;letter-spacing:.3px">7. Acceptance</h2>
    <p class="muted">By signing below, the customer accepts this quotation as the basis for proceeding with a formal Service &amp; Installation Agreement with SAA Comfort Air LLC.</p>
    <div class="sig-row">
      <div class="sig-line">Customer Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
    </div>
    <div class="sig-row">
      <div class="sig-line">Vijayan Subramanian, Owner &mdash; SAA Comfort Air LLC &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
    </div>
  </div>

<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 150); };
</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print the formal quote."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
