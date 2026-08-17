// Standalone Anschussprotokoll.
//
// Reached from the landing page, so it is deliberately not tied to a Revier:
// there is no stand list to pick from, no hunt, no login, and nothing is sent
// anywhere. You fill it in, you get a PDF, you forward it yourself. Everything
// happens on the device — which is also why it still works at the Anschuss
// with one bar of signal.
//
// The drawing and PDF machinery is shared with the map app's protocol modal
// (see protokoll-lib.js) so a fix lands in both.

import {
  setupProtocolFigure,
  generateProtocolPdf,
} from "./protokoll-lib.js";

const $ = (sel) => document.querySelector(sel);

const figures = [];

let toastTimer = null;
function showToast(msg, kind, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = kind === "error" ? "error" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Numeric dropdowns (Schüsse 1–10, kg 1–100, Stücke 1–15) are described by a
// data-range attribute rather than spelled out in the markup.
function fillRangeSelects() {
  document.querySelectorAll("select[data-range]").forEach((sel) => {
    const m = /^(\d+)-(\d+)$/.exec(sel.dataset.range || "");
    if (!m) return;
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    sel.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "—";
    sel.appendChild(blank);
    for (let n = lo; n <= hi; n++) {
      const o = document.createElement("option");
      o.value = String(n);
      o.textContent = String(n);
      sel.appendChild(o);
    }
  });
}

// A filename that says what it is when it lands in someone's downloads.
function pdfFilename() {
  const stand = ($("#proto-free-stand").value || "").trim();
  const name = ($('[data-proto="name"]').value || "").trim();
  const stamp = new Date().toISOString().slice(0, 10);
  const bits = ["Anschussprotokoll", stamp, stand, name]
    .filter(Boolean)
    .map((s) => s.replace(/[\\/:*?"<>|]+/g, " ").trim());
  return bits.join(" — ").slice(0, 120) + ".pdf";
}

function base64ToBlob(b64, mime) {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function downloadPdf() {
  const btn = $("#proto-pdf");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "PDF wird erstellt …";
  try {
    const b64 = await generateProtocolPdf({
      modal: $("#protocol-modal"),
      sheet: $("#protocol-sheet"),
      figures,
    });
    const blob = base64ToBlob(b64, "application/pdf");
    const file = new File([blob], pdfFilename(), { type: "application/pdf" });

    // On a phone the share sheet is the fastest way to the Nachsuchenführer;
    // a download link there just buries the file.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Anschussprotokoll" });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
        // any other failure: fall through to the plain download
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("PDF gespeichert");
  } catch (err) {
    console.error(err);
    showToast("PDF fehlgeschlagen: " + (err && err.message || err), "error", 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function resetSheet() {
  if (!confirm("Alle Eingaben verwerfen?")) return;
  const sheet = $("#protocol-sheet");
  sheet.querySelectorAll("input").forEach((inp) => {
    if (inp.type === "checkbox") inp.checked = false;
    else inp.value = "";
  });
  sheet.querySelectorAll("select").forEach((sel) => { sel.selectedIndex = 0; });
  figures.forEach((f) => f.clear());
  showToast("Zurückgesetzt");
}

function wire() {
  document.querySelectorAll(".proto-figure").forEach((fig) => setupProtocolFigure(fig, figures));
  fillRangeSelects();
  requestAnimationFrame(() => figures.forEach((f) => f.resize()));
  window.addEventListener("resize", () => figures.forEach((f) => f.resize()));

  $("#proto-pdf").addEventListener("click", downloadPdf);
  $("#proto-print").addEventListener("click", () => window.print());
  $("#proto-reset").addEventListener("click", resetSheet);

  $("#proto-loc-here").addEventListener("click", () => {
    if (!navigator.geolocation) {
      showToast("Standort nicht verfügbar", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $("#proto-loc-lat").value = pos.coords.latitude.toFixed(6);
        $("#proto-loc-lng").value = pos.coords.longitude.toFixed(6);
        showToast("Position übernommen");
      },
      (err) => showToast("Standort: " + err.message, "error", 4000),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

wire();
