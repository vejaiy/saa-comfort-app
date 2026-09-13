/* ============================================================
   SAA Comfort Air LLC — employee area access gate
   Real staff login via Supabase Auth (email + password). A visitor
   needs an account created for them — there is no public sign-up
   page — and every table behind this gate is locked down with Row
   Level Security, so only a signed-in session can read or write
   anything. See database/README.md for how to add a staff account.
   ============================================================ */

const _saaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function saaLogin(email, password) {
  const { error } = await _saaClient.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

async function saaRequireAuth() {
  const { data: { session } } = await _saaClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }
  document.body.style.visibility = "visible";
}

async function saaLogout() {
  await _saaClient.auth.signOut();
  window.location.href = "login.html";
}

async function saaIsAuthed() {
  const { data: { session } } = await _saaClient.auth.getSession();
  return !!session;
}

/** Round 11 follow-up (2026-09-13): "generate and rename existing quote,
 *  job, invoice with customer first name at the end so it would be easy
 *  to identify" — appends "-FirstName" to a generated record number
 *  (Q-2026-0004 -> Q-2026-0004-Sreedhar), stripped of anything but
 *  letters/digits so a messy name never breaks the format. Left
 *  unsuffixed when there's no first name on file (e.g. a customer added
 *  with only a phone number) rather than appending a blank or
 *  placeholder. Shared by quotes-db.js, jobs-db.js, and calendar-db.js's
 *  number-generation functions — all three load auth.js first. */
function saaAppendNameSuffix(base, firstName) {
  const clean = String(firstName || "").replace(/[^a-zA-Z0-9]/g, "");
  return clean ? `${base}-${clean}` : base;
}
