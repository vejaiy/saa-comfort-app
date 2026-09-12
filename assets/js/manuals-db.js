/* ============================================================
   SAA Comfort Air LLC — Instruction Manual library (round 3, 2026-09-12)
   Backs employee/instruction-manual.html. The manual FILES themselves are
   deployed as ordinary static assets at assets/manuals/<filename> — same
   pipeline as every image on the site, so they ride along with the
   regular git push / Hostinger deploy instead of needing separate file-
   storage infrastructure. This table just tracks which files are current
   (filename, display title, size, last-updated) so the page can list them
   and show "last updated" without a full site rebuild every time a manual
   changes. Requires auth.js to have already created the shared _saaClient.
   ============================================================ */

async function saaManualsFetchAll() {
  const { data, error } = await _saaClient
    .from("manuals")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw error;
  return data || [];
}
