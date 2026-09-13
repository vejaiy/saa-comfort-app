/* ============================================================
   SAA Comfort Air LLC — Job Warranty Files data layer
   Backs the Job Card's "Warranty Documents" section: PDF or Word
   files (manufacturer warranty cards, extended-warranty paperwork,
   signed warranty registrations) attached directly to a job. Same
   Storage-bucket-plus-row pattern as job-photos-db.js, just for
   arbitrary document files instead of images -- stores the actual
   bytes in the "job-warranty-files" Supabase Storage bucket (public
   bucket, same reasoning as job-photos: read access needs no auth so
   a plain link/download works) and one job_warranty_files row per
   file (job_id, storage_path, file_name, file_type, file_size_bytes).
   Requires auth.js to have already created the shared _saaClient.
   ============================================================ */

const SAA_JOB_WARRANTY_BUCKET = "job-warranty-files";
const SAA_WARRANTY_ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SAA_WARRANTY_MAX_BYTES = 20 * 1024 * 1024; // 20MB, generous for a scanned warranty card/PDF

function _saaWarrantyExt(fileName) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(fileName || "");
  return m ? m[1].toLowerCase() : "pdf";
}

/** Uploads one warranty document (a File from a plain file-picker input)
 *  to Storage and records it against a job. Rejects up front (no upload
 *  attempted) on a file type or size this isn't meant for, so the office
 *  gets an immediate, specific reason rather than a vague failure. */
async function saaWarrantyUpload(jobId, file) {
  try {
    const ext = _saaWarrantyExt(file.name);
    if (!["pdf", "doc", "docx"].includes(ext)) {
      throw new Error(`"${file.name}" isn't a PDF or Word file — only .pdf, .doc, and .docx are accepted.`);
    }
    if (file.size > SAA_WARRANTY_MAX_BYTES) {
      throw new Error(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — the limit is 20MB.`);
    }
    const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await _saaClient.storage
      .from(SAA_JOB_WARRANTY_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (upErr) throw upErr;

    const { data: row, error: insErr } = await _saaClient
      .from("job_warranty_files")
      .insert({
        job_id: jobId,
        storage_path: path,
        file_name: file.name,
        file_type: ext,
        file_size_bytes: file.size,
      })
      .select("*")
      .single();
    if (insErr) throw insErr;

    const { data: urlData } = _saaClient.storage.from(SAA_JOB_WARRANTY_BUCKET).getPublicUrl(path);
    return { ok: true, file: Object.assign({}, row, { url: urlData.publicUrl }) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Every warranty file saved against a job, each hydrated with its
 *  public URL, oldest first. */
async function saaWarrantyFetch(jobId) {
  const { data, error } = await _saaClient
    .from("job_warranty_files")
    .select("*")
    .eq("job_id", jobId)
    .order("uploaded_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((f) => Object.assign({}, f, {
    url: _saaClient.storage.from(SAA_JOB_WARRANTY_BUCKET).getPublicUrl(f.storage_path).data.publicUrl,
  }));
}

async function saaWarrantyDelete(file) {
  try {
    await _saaClient.storage.from(SAA_JOB_WARRANTY_BUCKET).remove([file.storage_path]);
    const { error } = await _saaClient.from("job_warranty_files").delete().eq("id", file.id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
