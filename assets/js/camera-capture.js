/* ============================================================
   SAA Comfort Air LLC — reusable "take a photo" modal (round 3, 2026-09-12)
   Opens the device camera via getUserMedia when the browser/device grants
   it (a phone, or a desktop with a webcam) so a technician can snap one
   or more photos without leaving the page; falls back to a plain file
   picker when no camera is available or permission is declined, so it
   still works on every desktop. Used by the Job Card's "Add Photos"
   button and by each Inspection checklist item's camera button — the
   caller passes an onDone(blobs) callback and gets back every photo
   taken/picked in that one sitting, saving them wherever it needs to
   (see jobs.js's jbAddPhotos / jbShootInspectionPhoto).
   ============================================================ */

let _saaCamStream = null;
let _saaCamBlobs = []; // [{ blob, url }] — url is a local object URL, just for the on-screen strip
let _saaCamOnDone = null;

function _saaCamStopStream() {
  if (_saaCamStream) {
    _saaCamStream.getTracks().forEach((t) => t.stop());
    _saaCamStream = null;
  }
}

function _saaCamRenderStrip() {
  const strip = document.getElementById("cam-strip");
  strip.innerHTML = _saaCamBlobs.map((b, i) =>
    `<div class="cam-thumb"><img src="${b.url}"><button type="button" class="cam-thumb-x" data-i="${i}">&times;</button></div>`
  ).join("");
  document.getElementById("cam-count").textContent = `${_saaCamBlobs.length} photo${_saaCamBlobs.length === 1 ? "" : "s"}`;
  strip.querySelectorAll(".cam-thumb-x").forEach((btn) => {
    btn.addEventListener("click", () => {
      _saaCamBlobs.splice(parseInt(btn.dataset.i, 10), 1);
      _saaCamRenderStrip();
    });
  });
}

/** Opens the modal and starts the live camera if available. onDone(blobs)
 *  is called with every photo taken/picked once "Save Photos" is clicked
 *  (never called if the office cancels or saves zero photos). */
async function saaCamOpen(onDone) {
  _saaCamBlobs = [];
  _saaCamOnDone = onDone;
  document.getElementById("cam-modal").hidden = false;
  _saaCamRenderStrip();
  document.getElementById("cam-live-wrap").hidden = false;
  document.getElementById("cam-nolive-note").hidden = true;

  const video = document.getElementById("cam-video");
  try {
    _saaCamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = _saaCamStream;
  } catch (e) {
    // No camera, or permission declined — the file-picker fallback below still works.
    document.getElementById("cam-live-wrap").hidden = true;
    document.getElementById("cam-nolive-note").hidden = false;
  }
}

function saaCamClose() {
  _saaCamStopStream();
  document.getElementById("cam-modal").hidden = true;
  _saaCamBlobs = [];
}

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("cam-modal");
  if (!modal) return; // this page doesn't include the camera modal

  document.getElementById("cam-shoot-btn").addEventListener("click", () => {
    const video = document.getElementById("cam-video");
    const canvas = document.getElementById("cam-canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      _saaCamBlobs.push({ blob, url: URL.createObjectURL(blob) });
      _saaCamRenderStrip();
    }, "image/jpeg", 0.88);
  });

  document.getElementById("cam-file-input").addEventListener("change", (e) => {
    Array.from(e.target.files || []).forEach((file) => {
      _saaCamBlobs.push({ blob: file, url: URL.createObjectURL(file) });
    });
    e.target.value = "";
    _saaCamRenderStrip();
  });

  document.getElementById("cam-cancel-btn").addEventListener("click", saaCamClose);
  document.getElementById("cam-done-btn").addEventListener("click", async () => {
    const blobs = _saaCamBlobs.map((b) => b.blob);
    const cb = _saaCamOnDone;
    saaCamClose();
    if (cb && blobs.length) await cb(blobs);
  });
});
