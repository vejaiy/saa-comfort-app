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
