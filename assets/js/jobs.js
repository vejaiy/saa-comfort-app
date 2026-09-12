/* ============================================================
   SAA Comfort Air LLC — Jobs Master List (employee/jobs.html)
   Rendering + interaction layer on top of jobs-db.js: the table,
   its filters/search, the New Job popup (customer search / inline
   create, same pattern as the Dispatch Calendar's New Service
   popup), and the full Job Card detail modal (equipment, diagnosis,
   quote link, cost/profit, invoice + payments, signature, notes).
   ============================================================ */

let _jbAllJobs = [];
let _jbTechnicians = [];
let _jbSelectedCust = null; // { id } or { isNew, customer: {...} } — New Job popup
let _jbCurrentJob = null; // the job object currently open in the detail modal
let _jbCurrentEquipment = null;
let _jbCurrentInvoice = null;
let _jbCurrentPayments = [];
let _jbNewPriority = "normal";

function _jbToast(msg, isError) {
  const el = document.getElementById("jb-toast");
  el.textContent = msg;
  el.style.background = isError ? "var(--danger)" : "var(--navy)";
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function _jbFormatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function _jbCustName(c) {
  if (!c) return "—";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
}

function _jbShortJobNum(id) {
  return "JOB-" + (id || "").slice(0, 8).toUpperCase();
}

const _jbStatusLabel = Object.fromEntries(SAA_JOBS_STATUS_OPTIONS);
const _jbPriorityLabel = Object.fromEntries(SAA_JOBS_PRIORITY_OPTIONS);
const _jbPaymentLabel = { unpaid: "Unpaid", partial: "Partially Paid", paid: "Paid" };
const _jbInvoiceLabel = { draft: "Draft", sent: "Sent", partial: "Partially Paid", paid: "Paid", overdue: "Overdue", void: "Void" };

function _jbOptionsHtml(pairs, selected) {
  return pairs.map(([v, l]) => `<option value="${v}"${v === selected ? " selected" : ""}>${l}</option>`).join("");
}

/* ============================== Table + filters ============================== */

function jbApplyFilters() {
  const q = (document.getElementById("jb-search").value || "").trim().toLowerCase();
  const type = document.getElementById("jb-filter-type").value;
  const status = document.getElementById("jb-filter-status").value;
  const priority = document.getElementById("jb-filter-priority").value;
  const tech = document.getElementById("jb-filter-tech").value;
  const payment = document.getElementById("jb-filter-payment").value;

  return _jbAllJobs.filter((j) => {
    if (type && j.job_type !== type) return false;
    if (status && j.status !== status) return false;
    if (priority && j.priority !== priority) return false;
    if (tech && j.assigned_technician_id !== tech) return false;
    if (payment && j.paymentStatus !== payment) return false;
    if (q) {
      const hay = [
        _jbCustName(j.customer), j.customer && j.customer.phone, j.job_address, j.job_city, j.job_zip, j.title,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function jbRenderTable() {
  const rows = jbApplyFilters();
  const tbody = document.getElementById("jb-tbody");
  document.getElementById("jb-empty").hidden = rows.length > 0;
  tbody.innerHTML = rows.map((j) => `
    <tr class="jb-row" data-id="${j.id}">
      <td>${_jbShortJobNum(j.id)}</td>
      <td>${_jbFormatDate(j.created_at)}</td>
      <td>${_jbCustName(j.customer)}</td>
      <td>${j.customer && j.customer.phone ? saaFormatPhone(j.customer.phone) : "—"}</td>
      <td>${[j.job_address, j.job_city].filter(Boolean).join(", ") || "—"}</td>
      <td>${saaJobTypeLabel(j.job_type)}</td>
      <td><span class="jb-badge jb-pri-${j.priority}">${_jbPriorityLabel[j.priority] || j.priority}</span></td>
      <td>${_jbFormatDate(j.scheduled_date)}</td>
      <td>${j.technician ? j.technician.name : "Unassigned"}</td>
      <td><span class="jb-badge jb-status-${j.status}">${_jbStatusLabel[j.status] || j.status}</span></td>
      <td><span class="jb-badge jb-pay-${j.paymentStatus}">${_jbPaymentLabel[j.paymentStatus]}</span></td>
    </tr>`).join("");
  tbody.querySelectorAll(".jb-row").forEach((tr) => {
    tr.addEventListener("click", () => jbOpenDetail(tr.dataset.id));
  });
}

async function jbLoadAll() {
  _jbAllJobs = await saaJobsFetchAll();
  jbRenderTable();
}

/* ============================== New Job popup ============================== */

function jbRenderCustResults(results, query) {
  const box = document.getElementById("jbn-cust-results");
  const items = (results || []).map((c) => `
    <div class="cal-cust-result" data-id="${c.id}">
      <strong>${_jbCustName(c)}</strong>
      ${c.phone ? ` &middot; ${saaFormatPhone(c.phone)}` : ""}
      ${c.billing_address ? `<div class="muted" style="font-size:.78rem">${c.billing_address}</div>` : ""}
    </div>`).join("");
  const addNew = `<div class="cal-cust-result add-new" id="jbn-add-new-cust">+ Add "${query || ""}" as a new customer</div>`;
  box.innerHTML = items + addNew;
  box.hidden = false;

  box.querySelectorAll(".cal-cust-result[data-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const c = results.find((r) => r.id === el.dataset.id);
      jbSelectCustomer({ id: c.id, customer: c });
    });
  });
  document.getElementById("jbn-add-new-cust").addEventListener("click", () => jbOpenNewCustomerForm(query));
}

function jbOpenNewCustomerForm(query) {
  document.getElementById("jbn-cust-results").hidden = true;
  const form = document.getElementById("jbn-newcust-form");
  form.hidden = false;
  const looksLikePhone = /^[\d\s\-().]{7,}$/.test((query || "").trim());
  document.getElementById("jbn-newcust-first").value = "";
  document.getElementById("jbn-newcust-last").value = "";
  document.getElementById("jbn-newcust-phone").value = looksLikePhone ? query : "";
  if (!looksLikePhone && query) {
    const parts = query.trim().split(/\s+/);
    document.getElementById("jbn-newcust-first").value = parts[0] || "";
    document.getElementById("jbn-newcust-last").value = parts.slice(1).join(" ");
  }
}

function jbSelectCustomer(sel) {
  _jbSelectedCust = sel;
  document.getElementById("jbn-cust-results").hidden = true;
  document.getElementById("jbn-newcust-form").hidden = true;
  document.getElementById("jbn-cust-search").value = "";
  const box = document.getElementById("jbn-selected-cust");
  const c = sel.customer;
  box.hidden = false;
  box.innerHTML = `<strong>${_jbCustName(c)}</strong>${sel.isNew ? ' <span class="muted">(new customer)</span>' : ""}
    ${c.phone ? ` &middot; ${saaFormatPhone(c.phone)}` : ""}
    <button type="button" class="btn btn-ghost btn-sm" id="jbn-change-cust-btn" style="margin-left:10px">Change</button>`;
  document.getElementById("jbn-change-cust-btn").addEventListener("click", () => {
    _jbSelectedCust = null;
    box.hidden = true;
  });
}

function jbUseNewCustomer() {
  const c = {
    first_name: document.getElementById("jbn-newcust-first").value.trim(),
    last_name: document.getElementById("jbn-newcust-last").value.trim(),
    phone: document.getElementById("jbn-newcust-phone").value.trim(),
    billing_address: document.getElementById("jbn-newcust-address").value.trim(),
    billing_city: document.getElementById("jbn-newcust-city").value.trim(),
    billing_zip: document.getElementById("jbn-newcust-zip").value.trim(),
  };
  if (!c.first_name && !c.last_name && !c.phone) {
    document.getElementById("jbn-status").textContent = "Enter a name or phone number.";
    return;
  }
  jbSelectCustomer({ isNew: true, customer: c });
}

function jbOpenNewJobModal() {
  _jbSelectedCust = null;
  _jbNewPriority = "normal";
  document.getElementById("jbn-cust-search").value = "";
  document.getElementById("jbn-cust-results").hidden = true;
  document.getElementById("jbn-newcust-form").hidden = true;
  document.getElementById("jbn-selected-cust").hidden = true;
  ["jbn-newcust-first", "jbn-newcust-last", "jbn-newcust-phone", "jbn-newcust-address", "jbn-newcust-city", "jbn-newcust-zip", "jbn-title", "jbn-address", "jbn-city", "jbn-zip", "jbn-date", "jbn-notes"].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("jbn-type").selectedIndex = 0;
  document.getElementById("jbn-tech").value = "";
  document.getElementById("jbn-status").textContent = "";
  jbRenderPriorityRow("jbn-priority-row", "normal", (p) => { _jbNewPriority = p; });
  document.getElementById("jb-new-modal").hidden = false;
}

function jbRenderPriorityRow(mountId, selected, onPick) {
  const mount = document.getElementById(mountId);
  mount.innerHTML = SAA_JOBS_PRIORITY_OPTIONS.map(([v, l]) =>
    `<button type="button" class="btn btn-sm ${v === selected ? "btn-navy" : "btn-ghost"}" data-val="${v}">${l}</button>`).join("");
  mount.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      mount.querySelectorAll("button").forEach((b) => b.classList.remove("btn-navy") || b.classList.add("btn-ghost"));
      btn.classList.remove("btn-ghost");
      btn.classList.add("btn-navy");
      onPick(btn.dataset.val);
    });
  });
}

async function jbSaveNewJob() {
  const statusEl = document.getElementById("jbn-status");
  if (!_jbSelectedCust) { statusEl.textContent = "Select or add a customer first."; return; }
  const payload = {
    jobType: document.getElementById("jbn-type").value,
    title: document.getElementById("jbn-title").value.trim(),
    jobAddress: document.getElementById("jbn-address").value.trim(),
    jobCity: document.getElementById("jbn-city").value.trim(),
    jobZip: document.getElementById("jbn-zip").value.trim(),
    technicianId: document.getElementById("jbn-tech").value || null,
    scheduledDate: document.getElementById("jbn-date").value || null,
    priority: _jbNewPriority,
    notes: document.getElementById("jbn-notes").value.trim(),
  };
  if (_jbSelectedCust.isNew) {
    const c = _jbSelectedCust.customer;
    payload.newCustomer = { firstName: c.first_name, lastName: c.last_name, phone: c.phone, address: c.billing_address, city: c.billing_city, zip: c.billing_zip };
  } else {
    payload.customerId = _jbSelectedCust.id;
  }
  statusEl.textContent = "Saving…";
  const res = await saaJobsCreateJob(payload);
  if (!res.ok) { statusEl.textContent = res.error; return; }
  document.getElementById("jb-new-modal").hidden = true;
  await jbLoadAll();
  _jbToast("Job created.");
}

/* ============================== Job Detail modal ============================== */

function jbComputeProfit() {
  const material = parseFloat(document.getElementById("jbd-cost-material").value) || 0;
  const labor = parseFloat(document.getElementById("jbd-cost-labor").value) || 0;
  const other = parseFloat(document.getElementById("jbd-cost-other").value) || 0;
  const approved = parseFloat(document.getElementById("jbd-approved").value) || 0;
  const quoted = parseFloat(document.getElementById("jbd-quoted").value) || 0;
  const totalActual = material + labor + other;
  const base = approved || quoted || 0;
  const profit = base - totalActual;
  const marginPct = base > 0 ? (profit / base) * 100 : 0;
  document.getElementById("jbd-profit-box").innerHTML = `
    <div class="jb-profit-row"><span>Total Actual Cost</span><strong>${fmtMoney(totalActual)}</strong></div>
    <div class="jb-profit-row"><span>Gross Profit</span><strong class="${profit < 0 ? "jb-negative" : ""}">${fmtMoney(profit)}</strong></div>
    <div class="jb-profit-row"><span>Gross Margin %</span><strong class="${marginPct < 0 ? "jb-negative" : ""}">${marginPct.toFixed(1)}%</strong></div>`;
}

async function jbRenderQuoteSection(job) {
  const linkedBox = document.getElementById("jbd-quote-linked");
  const searchWrap = document.getElementById("jbd-quote-search-wrap");
  if (job.linked_quote_id && job.linkedQuote) {
    linkedBox.hidden = false;
    searchWrap.hidden = true;
    linkedBox.innerHTML = `Linked to Quote <strong>${job.linkedQuote.quote_number || "—"}</strong> (${job.linkedQuote.quote_type || ""}) &mdash; ${fmtMoney(job.linkedQuote.total || 0)}
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-unlink-quote-btn" style="margin-left:8px">Change</button>`;
    document.getElementById("jbd-unlink-quote-btn").addEventListener("click", () => {
      linkedBox.hidden = true;
      searchWrap.hidden = false;
    });
  } else {
    linkedBox.hidden = true;
    searchWrap.hidden = false;
  }
}

async function jbSearchCustomerQuotes(job, query) {
  const quotes = await saaJobsFetchCustomerQuotes(job.customer_id);
  const q = (query || "").toLowerCase();
  const filtered = q ? quotes.filter((qt) => (qt.quote_number || "").toLowerCase().includes(q) || (qt.quote_type || "").toLowerCase().includes(q)) : quotes;
  const box = document.getElementById("jbd-quote-results");
  if (!filtered.length) {
    box.innerHTML = `<div class="muted" style="padding:8px;font-size:.82rem">No saved quotes found for this customer.</div>`;
    box.hidden = false;
    return;
  }
  box.innerHTML = filtered.map((qt) => `
    <div class="cal-cust-result" data-id="${qt.id}">
      <strong>${qt.quote_number || "(no #)"}</strong> &middot; ${qt.quote_type || ""} &middot; ${fmtMoney(qt.total || 0)}
    </div>`).join("");
  box.hidden = false;
  box.querySelectorAll(".cal-cust-result").forEach((el) => {
    el.addEventListener("click", async () => {
      const res = await saaJobsLinkQuote(job.id, el.dataset.id);
      if (res.ok) {
        job.linked_quote_id = el.dataset.id;
        job.linkedQuote = filtered.find((f) => f.id === el.dataset.id);
        document.getElementById("jbd-quoted").value = res.quotedAmount || 0;
        jbComputeProfit();
        jbRenderQuoteSection(job);
        box.hidden = true;
      }
    });
  });
}

function jbRenderInvoiceBox(job, invoice, payments) {
  const box = document.getElementById("jbd-invoice-box");
  if (!invoice) {
    box.innerHTML = `<button type="button" class="btn btn-navy btn-sm" id="jbd-gen-invoice-btn">Generate Invoice</button>
      <span class="jb-badge jb-invstatus-none" style="margin-left:8px">Not Invoiced</span>`;
    document.getElementById("jbd-gen-invoice-btn").addEventListener("click", async () => {
      const res = await saaJobsGetOrCreateInvoice(job);
      if (res.ok) {
        _jbCurrentInvoice = res.invoice;
        _jbCurrentPayments = [];
        jbRenderInvoiceBox(job, res.invoice, []);
        _jbToast("Invoice generated.");
      } else {
        _jbToast(res.error, true);
      }
    });
    return;
  }
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const paymentStatus = saaJobsPaymentStatus(invoice, paid);
  const paymentsHtml = payments.length
    ? payments.map((p) => `<div class="jb-payment-row">${_jbFormatDate(p.payment_date)} &middot; ${(p.method || "").replace(/^\w/, (c) => c.toUpperCase())} &middot; ${fmtMoney(Number(p.amount || 0))}</div>`).join("")
    : `<div class="muted" style="font-size:.8rem">No payments recorded yet.</div>`;

  box.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Invoice #</label><input type="text" value="${invoice.invoice_number || ""}" disabled></div>
      <div class="field"><label>Invoice Status</label><select id="jbd-inv-status">${_jbOptionsHtml(SAA_INVOICE_STATUS_OPTIONS, invoice.status)}</select></div>
    </div>
    <div class="field"><label>Amount Total</label><input type="number" step="0.01" id="jbd-inv-amount" value="${invoice.amount_total || 0}"></div>
    <div style="display:flex;gap:8px;margin:6px 0 10px">
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-inv-save-btn">Update Invoice</button>
      <button type="button" class="btn btn-outline btn-sm" id="jbd-inv-print-btn">Print Invoice</button>
      <span class="jb-badge jb-pay-${paymentStatus}">${_jbPaymentLabel[paymentStatus]}</span>
    </div>
    <div class="jb-payments-list">${paymentsHtml}</div>
    <div class="field-row" style="margin-top:8px">
      <div class="field"><label>Payment Amount</label><input type="number" step="0.01" id="jbd-pay-amount"></div>
      <div class="field"><label>Date</label><input type="date" id="jbd-pay-date" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Method</label><select id="jbd-pay-method">
        <option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option>
        <option value="ach">ACH</option><option value="financing">Financing</option><option value="other">Other</option>
      </select></div>
      <div class="field"><label>Reference #</label><input type="text" id="jbd-pay-ref"></div>
    </div>
    <button type="button" class="btn btn-navy btn-sm" id="jbd-pay-save-btn">Record Payment</button>
  `;

  document.getElementById("jbd-inv-save-btn").addEventListener("click", async () => {
    const res = await saaJobsUpdateInvoice(invoice.id, {
      status: document.getElementById("jbd-inv-status").value,
      amount_total: parseFloat(document.getElementById("jbd-inv-amount").value) || 0,
    });
    if (res.ok) { _jbToast("Invoice updated."); invoice.status = document.getElementById("jbd-inv-status").value; invoice.amount_total = parseFloat(document.getElementById("jbd-inv-amount").value) || 0; jbRenderInvoiceBox(job, invoice, payments); }
    else _jbToast(res.error, true);
  });
  document.getElementById("jbd-inv-print-btn").addEventListener("click", () => {
    printFormalInvoice({
      invoiceNumber: invoice.invoice_number,
      issueDate: _jbFormatDate(invoice.issue_date),
      dueDate: _jbFormatDate(invoice.due_date),
      status: invoice.status,
      customer: _jbCustName(job.customer),
      phone: job.customer && job.customer.phone,
      address: [job.job_address, job.job_city].filter(Boolean).join(", "),
      jobTitle: job.title || saaJobTypeLabel(job.job_type),
      description: job.recommended_action || "",
      amountTotal: invoice.amount_total,
      amountPaid: paid,
      payments,
    });
  });
  document.getElementById("jbd-pay-save-btn").addEventListener("click", async () => {
    const amount = parseFloat(document.getElementById("jbd-pay-amount").value) || 0;
    const res = await saaJobsRecordPayment({
      invoiceId: invoice.id,
      customerId: job.customer_id,
      amount,
      paymentDate: document.getElementById("jbd-pay-date").value,
      method: document.getElementById("jbd-pay-method").value,
      referenceNumber: document.getElementById("jbd-pay-ref").value.trim(),
    });
    if (res.ok) {
      const freshPayments = await saaJobsFetchPayments(invoice.id);
      _jbCurrentPayments = freshPayments;
      const freshInvoice = await _saaClient.from("invoices").select("*").eq("id", invoice.id).single();
      _jbCurrentInvoice = freshInvoice.data || invoice;
      jbRenderInvoiceBox(job, _jbCurrentInvoice, freshPayments);
      _jbToast("Payment recorded.");
      jbLoadAll();
    } else {
      _jbToast(res.error, true);
    }
  });
}

async function jbOpenDetail(jobId) {
  const job = _jbAllJobs.find((j) => j.id === jobId);
  if (!job) return;
  _jbCurrentJob = job;

  document.getElementById("jbd-title").textContent = job.title || saaJobTypeLabel(job.job_type);
  document.getElementById("jbd-jobnum").textContent = `${_jbShortJobNum(job.id)} · Received ${_jbFormatDate(job.created_at)}`;
  document.getElementById("jbd-customer").innerHTML = `<strong>${_jbCustName(job.customer)}</strong>
    ${job.customer && job.customer.phone ? ` &middot; <a href="tel:${job.customer.phone}">${saaFormatPhone(job.customer.phone)}</a>` : ""}
    ${job.customer && job.customer.email ? ` &middot; ${job.customer.email}` : ""}`;

  document.getElementById("jbd-type").innerHTML = _jbOptionsHtml(SAA_JOBS_TYPE_OPTIONS, job.job_type);
  document.getElementById("jbd-priority").innerHTML = _jbOptionsHtml(SAA_JOBS_PRIORITY_OPTIONS, job.priority);
  document.getElementById("jbd-status").innerHTML = _jbOptionsHtml(SAA_JOBS_STATUS_OPTIONS, job.status);
  document.getElementById("jbd-tech").innerHTML = `<option value="">Unassigned</option>` + _jbTechnicians.map((t) => `<option value="${t.id}"${t.id === job.assigned_technician_id ? " selected" : ""}>${t.name}</option>`).join("");
  document.getElementById("jbd-scheduled").value = job.scheduled_date || "";
  document.getElementById("jbd-completed").value = job.completed_date || "";
  document.getElementById("jbd-address").value = job.job_address || "";
  document.getElementById("jbd-city").value = job.job_city || "";
  document.getElementById("jbd-zip").value = job.job_zip || "";

  document.getElementById("jbd-problem").value = job.problem_description || "";
  document.getElementById("jbd-findings").value = job.inspection_findings || "";
  document.getElementById("jbd-recommend").value = job.recommended_action || "";

  document.getElementById("jbd-quoted").value = job.quoted_amount || "";
  document.getElementById("jbd-approved").value = job.approved_amount || "";
  document.getElementById("jbd-cost-material").value = job.actual_material_cost || 0;
  document.getElementById("jbd-cost-labor").value = job.actual_labor_cost || 0;
  document.getElementById("jbd-cost-other").value = job.other_cost || 0;
  jbComputeProfit();
  ["jbd-quoted", "jbd-approved", "jbd-cost-material", "jbd-cost-labor", "jbd-cost-other"].forEach((id) => {
    document.getElementById(id).oninput = jbComputeProfit;
  });

  document.getElementById("jbd-sig-name").value = job.customer_signature_name || "";
  document.getElementById("jbd-sig-date").value = job.customer_signature_date || "";
  document.getElementById("jbd-notes").value = job.notes || "";
  document.getElementById("jbd-status-msg").textContent = "";

  jbRenderQuoteSection(job);
  document.getElementById("jbd-quote-search").value = "";
  document.getElementById("jbd-quote-results").hidden = true;

  _jbCurrentEquipment = job.customer_id ? await saaJobsFetchLatestEquipment(job.customer_id) : null;
  const eq = _jbCurrentEquipment || {};
  document.getElementById("jbd-eq-brand").value = eq.brand || "";
  document.getElementById("jbd-eq-model").value = eq.model || "";
  document.getElementById("jbd-eq-serial").value = eq.serial_number || "";
  document.getElementById("jbd-eq-refrigerant").value = eq.refrigerant_type || "";

  _jbCurrentInvoice = job.invoice || null;
  _jbCurrentPayments = job.invoice ? await saaJobsFetchPayments(job.invoice.id) : [];
  jbRenderInvoiceBox(job, _jbCurrentInvoice, _jbCurrentPayments);

  document.getElementById("jb-detail-modal").hidden = false;
}

async function jbSaveDetail() {
  const job = _jbCurrentJob;
  if (!job) return;
  const statusMsg = document.getElementById("jbd-status-msg");
  statusMsg.textContent = "Saving…";

  const patch = {
    job_type: document.getElementById("jbd-type").value,
    priority: document.getElementById("jbd-priority").value,
    status: document.getElementById("jbd-status").value,
    assigned_technician_id: document.getElementById("jbd-tech").value || null,
    scheduled_date: document.getElementById("jbd-scheduled").value || null,
    completed_date: document.getElementById("jbd-completed").value || null,
    job_address: document.getElementById("jbd-address").value.trim() || null,
    job_city: document.getElementById("jbd-city").value.trim() || null,
    job_zip: document.getElementById("jbd-zip").value.trim() || null,
    problem_description: document.getElementById("jbd-problem").value.trim() || null,
    inspection_findings: document.getElementById("jbd-findings").value.trim() || null,
    recommended_action: document.getElementById("jbd-recommend").value.trim() || null,
    quoted_amount: parseFloat(document.getElementById("jbd-quoted").value) || null,
    approved_amount: parseFloat(document.getElementById("jbd-approved").value) || null,
    actual_material_cost: parseFloat(document.getElementById("jbd-cost-material").value) || 0,
    actual_labor_cost: parseFloat(document.getElementById("jbd-cost-labor").value) || 0,
    other_cost: parseFloat(document.getElementById("jbd-cost-other").value) || 0,
    customer_signature_name: document.getElementById("jbd-sig-name").value.trim() || null,
    customer_signature_date: document.getElementById("jbd-sig-date").value || null,
    notes: document.getElementById("jbd-notes").value.trim() || null,
  };

  const res = await saaJobsUpdateJob(job.id, patch);
  if (!res.ok) { statusMsg.textContent = res.error; return; }
  Object.assign(job, patch); // keep the open Job Card's in-memory copy in sync (e.g. so "Generate Invoice" right after Save sees the just-saved Approved Amount)

  await saaJobsSaveEquipment(job.customer_id, {
    brand: document.getElementById("jbd-eq-brand").value.trim(),
    model: document.getElementById("jbd-eq-model").value.trim(),
    serialNumber: document.getElementById("jbd-eq-serial").value.trim(),
    refrigerantType: document.getElementById("jbd-eq-refrigerant").value.trim(),
    tonnage: (_jbCurrentEquipment && _jbCurrentEquipment.tonnage) || null,
    installYear: (_jbCurrentEquipment && _jbCurrentEquipment.install_year) || null,
    warrantyStatus: (_jbCurrentEquipment && _jbCurrentEquipment.warranty_status) || "unknown",
  });

  statusMsg.textContent = "Saved.";
  await jbLoadAll();
  _jbToast("Job Card saved.");
}

/* ============================== Wire up on load ============================== */

document.addEventListener("DOMContentLoaded", async () => {
  _jbTechnicians = await saaJobsFetchTechnicians();
  document.getElementById("jb-filter-type").innerHTML = `<option value="">All Job Types</option>` + _jbOptionsHtml(SAA_JOBS_TYPE_OPTIONS, "");
  document.getElementById("jb-filter-status").innerHTML = `<option value="">All Statuses</option>` + _jbOptionsHtml(SAA_JOBS_STATUS_OPTIONS, "");
  document.getElementById("jb-filter-priority").innerHTML = `<option value="">All Priorities</option>` + _jbOptionsHtml(SAA_JOBS_PRIORITY_OPTIONS, "");
  document.getElementById("jb-filter-tech").innerHTML = `<option value="">All Technicians</option>` + _jbTechnicians.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  document.getElementById("jbn-type").innerHTML = _jbOptionsHtml(SAA_JOBS_TYPE_OPTIONS, "");
  document.getElementById("jbn-tech").innerHTML = `<option value="">Unassigned</option>` + _jbTechnicians.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");

  ["jb-search", "jb-filter-type", "jb-filter-status", "jb-filter-priority", "jb-filter-tech", "jb-filter-payment"].forEach((id) => {
    document.getElementById(id).addEventListener("input", jbRenderTable);
    document.getElementById(id).addEventListener("change", jbRenderTable);
  });

  document.getElementById("jb-new-btn").addEventListener("click", jbOpenNewJobModal);
  document.getElementById("jbn-cancel-btn").addEventListener("click", () => { document.getElementById("jb-new-modal").hidden = true; });
  document.getElementById("jbn-save-btn").addEventListener("click", jbSaveNewJob);
  document.getElementById("jbn-newcust-use-btn").addEventListener("click", jbUseNewCustomer);
  document.getElementById("jbn-newcust-cancel-btn").addEventListener("click", () => {
    document.getElementById("jbn-newcust-form").hidden = true;
    document.getElementById("jbn-cust-results").hidden = false;
  });
  document.getElementById("jbn-cust-search").addEventListener("input", async (e) => {
    const q = e.target.value;
    if (!q.trim()) { document.getElementById("jbn-cust-results").hidden = true; return; }
    const results = await saaJobsSearchCustomers(q);
    jbRenderCustResults(results, q);
  });

  document.getElementById("jbd-quote-search").addEventListener("input", (e) => {
    if (_jbCurrentJob) jbSearchCustomerQuotes(_jbCurrentJob, e.target.value);
  });
  document.getElementById("jbd-save-btn").addEventListener("click", jbSaveDetail);
  document.getElementById("jbd-close-btn").addEventListener("click", () => { document.getElementById("jb-detail-modal").hidden = true; });
  document.getElementById("jb-detail-close-btn").addEventListener("click", () => { document.getElementById("jb-detail-modal").hidden = true; });

  // Deep link from the Dispatch Calendar's Job Details drawer: jobs.html?job=<id>
  await jbLoadAll();
  const params = new URLSearchParams(window.location.search);
  const openId = params.get("job");
  if (openId && _jbAllJobs.some((j) => j.id === openId)) jbOpenDetail(openId);
});
