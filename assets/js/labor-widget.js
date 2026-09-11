/* Reusable Labor calculator — used standalone and embedded in the
   New Install / Replacement master quote builders. Requires
   pricing-data.js (LABOR_ROWS) and worksheet.js (fmtMoney) first. */
function initLaborWidget(mountEl) {
  mountEl.innerHTML = `
    <div class="worksheet-wrap">
      <table class="worksheet">
        <thead><tr><th>Role</th><th>Cost / Hr</th><th>Hours</th><th>Total</th></tr></thead>
        <tbody class="lw-body"></tbody>
        <tfoot><tr><td colspan="3">Subtotal</td><td class="num lw-total">$0.00</td></tr></tfoot>
      </table>
    </div>`;
  const tbody = mountEl.querySelector(".lw-body");
  tbody.innerHTML = LABOR_ROWS.map((r, i) => `
    <tr data-row="${i}">
      <td class="item-name">${r.role}</td>
      <td class="num"><input type="number" step="any" class="lw-costhr" name="${mountEl.id}__costhr__${i}" value="${r.costHr}"></td>
      <td class="num"><input type="number" step="any" class="lw-hours" name="${mountEl.id}__hours__${i}" value="${r.hours}"></td>
      <td class="num lw-total-row">${fmtMoney(r.costHr * r.hours)}</td>
    </tr>`).join("");

  function recalc() {
    let sum = 0;
    tbody.querySelectorAll("tr").forEach(tr => {
      const costHr = parseFloat(tr.querySelector(".lw-costhr").value) || 0;
      const hours = parseFloat(tr.querySelector(".lw-hours").value) || 0;
      const total = costHr * hours;
      tr.querySelector(".lw-total-row").textContent = fmtMoney(total);
      sum += total;
    });
    mountEl.querySelector(".lw-total").textContent = fmtMoney(sum);
    const totals = { total: sum };
    if (typeof mountEl._onTotal === "function") mountEl._onTotal(totals);
    return totals;
  }
  mountEl.addEventListener("input", recalc);
  recalc();
  return { getTotal: recalc, onTotal: (fn) => { mountEl._onTotal = fn; } };
}
