/* ============================================================
   SAA Comfort Air LLC — Job Photos data layer (round 3, 2026-09-12)
   Backs the Job Card's "Add Photos" button and the per-item camera
   button inside the Inspection checklist modal. Stores the actual
   image bytes in the "job-photos" Supabase Storage bucket (public
   bucket — read access needs no auth, matching how a plain <img>
   tag fetches it; upload/delete require a signed-in staff session,
   same "staff full access" RLS pattern as every table in this app)
   and one job_photos row per photo (job_id, storage_path, optional
   inspection_item_index linking it to one Inspection checklist item
   — see INSPECTION_ITEMS in pricing-data.js). Requires auth.js to
   have already created the shared _saaClient.
   ============================================================ */

const SAA_JOB_PHOTOS_BUCKET = "job-photos";

function _saaPhotoExt(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** Uploads one photo (a Blob from either the camera-capture canvas or a
 *  file picker — see camera-capture.js) to Storage and records it against
 *  a job, optionally tied to one Inspection checklist item by index.
 *  photoType ('general' | 'inspection' | 'receipt', Round 6) defaults from
 *  inspectionItemIndex when not given, so the two existing call sites
 *  (plain job photos, per-inspection-item photos) don't need to change —
 *  only the new Receipt upload passes 'receipt' explicitly. */
/** eventId (Round 42 Task 121, optional 5th arg) lets a caller that's
 *  editing one SPECIFIC Event's own Photos/Receipts section (the Event
 *  modal) stamp that exact event_id, rather than always re-deriving the
 *  Job's "current" Event -- the Job Card's own Photos/Receipts sections
 *  (and the per-Inspection-item camera button) keep working unchanged by
 *  simply not passing one. */
async function saaPhotosUpload(jobId, blob, inspectionItemIndex, photoType, eventId) {
  try {
    const ext = _saaPhotoExt(blob.type);
    const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await _saaClient.storage
      .from(SAA_JOB_PHOTOS_BUCKET)
      .upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (upErr) throw upErr;

    // Round 42 Task 118: auto-attaches to the Job's current Event (see
    // saaEventsGetDefaultEventId in events-db.js) -- guarded since this
    // file is also loaded on pages without events-db.js. Round 42 Task
    // 121: an explicit eventId (above) always wins over the auto-pick.
    const resolvedEventId = eventId || (typeof saaEventsGetDefaultEventId === "function" ? await saaEventsGetDefaultEventId(jobId) : null);
    const { data: row, error: insErr } = await _saaClient
      .from("job_photos")
      .insert({
        job_id: jobId,
        event_id: resolvedEventId,
        storage_path: path,
        inspection_item_index: inspectionItemIndex == null ? null : inspectionItemIndex,
        photo_type: photoType || (inspectionItemIndex == null ? "general" : "inspection"),
      })
      .select("*")
      .single();
    if (insErr) throw insErr;

    const { data: urlData } = _saaClient.storage.from(SAA_JOB_PHOTOS_BUCKET).getPublicUrl(path);
    return { ok: true, photo: Object.assign({}, row, { url: urlData.publicUrl }) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Every photo saved against a job, each hydrated with its public URL. */
async function saaPhotosFetch(jobId) {
  const { data, error } = await _saaClient
    .from("job_photos")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((p) => Object.assign({}, p, {
    url: _saaClient.storage.from(SAA_JOB_PHOTOS_BUCKET).getPublicUrl(p.storage_path).data.publicUrl,
  }));
}

/** Round 42 Task 121: every photo/receipt saved against one SPECIFIC
 *  Event (not a job's whole photo history) -- backs the Event modal's own
 *  Photos/Receipts sections. */
async function saaPhotosFetchForEvent(eventId) {
  const { data, error } = await _saaClient
    .from("job_photos")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((p) => Object.assign({}, p, {
    url: _saaClient.storage.from(SAA_JOB_PHOTOS_BUCKET).getPublicUrl(p.storage_path).data.publicUrl,
  }));
}

async function saaPhotosDelete(photo) {
  try {
    await _saaClient.storage.from(SAA_JOB_PHOTOS_BUCKET).remove([photo.storage_path]);
    const { error } = await _saaClient.from("job_photos").delete().eq("id", photo.id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
