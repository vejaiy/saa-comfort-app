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
 *  a job, optionally tied to one Inspection checklist item by index. */
async function saaPhotosUpload(jobId, blob, inspectionItemIndex) {
  try {
    const ext = _saaPhotoExt(blob.type);
    const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await _saaClient.storage
      .from(SAA_JOB_PHOTOS_BUCKET)
      .upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (upErr) throw upErr;

    const { data: row, error: insErr } = await _saaClient
      .from("job_photos")
      .insert({
        job_id: jobId,
        storage_path: path,
        inspection_item_index: inspectionItemIndex == null ? null : inspectionItemIndex,
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
