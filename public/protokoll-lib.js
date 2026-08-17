// Anschuss-Protokoll — the pieces that are pure DOM and have no idea which
// page they are on.
//
// Two pages need them: the protocol modal inside the map app, and the
// standalone Nachsuche page reachable from the landing page, which is not tied
// to a Revier at all. One copy here means a fix to the PDF export cannot land
// in one place and be forgotten in the other.
//
// Anything an app would normally reach for globally is passed in instead: the
// figure registry, the sheet element, the modal element.

export function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Skript konnte nicht geladen werden: " + src));
    document.head.appendChild(s);
  });
}

export function romanNumeral(n) {
  return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][n - 1] || String(n);
}

export function setupProtocolFigure(fig, registry) {
  const canvas = fig.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const circles = []; // fractional coords {xr, yr} so they survive resizing
  let dpr = 1;
  // animals: tiny pinpoint dots (the row dropdowns say which Stück a row is).
  // range: larger dots that carry the placement order (1, 2, …) inside them.
  const figKind = fig.dataset.fig;
  const numbered = figKind === "range";
  const dotMinPx = numbered ? 9 : 2;
  const dotFrac = numbered ? 0.03 : 0.005;

  function resize() {
    // Read the canvas's own rect — on the animals figure the canvas is
    // shifted right of the row selectors, so it's narrower than the figure.
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    redraw();
  }
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const radius = Math.max(dotMinPx * dpr, canvas.width * dotFrac);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold " + Math.round(radius * 1.25) + "px -apple-system, system-ui, sans-serif";
    circles.forEach((c, i) => {
      const x = c.xr * canvas.width;
      const y = c.yr * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#e00000";
      ctx.fill();
      ctx.lineWidth = Math.max(0.75 * dpr, radius * 0.22);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.stroke();
      if (numbered) {
        ctx.fillStyle = "#fff";
        ctx.fillText(romanNumeral(i + 1), x, y);
      }
    });
  }
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const xr = (e.clientX - rect.left) / rect.width;
    const yr = (e.clientY - rect.top) / rect.height;
    const hitIdx = circles.findIndex(
      (c) => Math.hypot((c.xr - xr) * rect.width, (c.yr - yr) * rect.height) < 18
    );
    if (hitIdx >= 0) circles.splice(hitIdx, 1);
    // Range diagram: cap at two dots (Stück I + Stück II). Tap an existing
    // dot to remove it before placing a third.
    else if (!numbered || circles.length < 2) circles.push({ xr, yr });
    redraw();
  });
  registry.push({ resize, clear: () => { circles.length = 0; redraw(); } });
}

// html2canvas mis-positions the text inside form controls (it sat low and
// got clipped in the PDF). So in the cloned document we swap every input /
// select / time field for a plain <div> carrying the same text — divs render
// reliably. Border / padding / font are copied from the live element so the
// layout doesn't shift. Checkboxes are left alone (they render fine).
export function flattenFormControlsForPdf(clonedDoc, sheetEl) {
  const liveRoot = sheetEl;
  const clonedRoot = clonedDoc.getElementById(sheetEl.id);
  if (!liveRoot || !clonedRoot) return;
  const liveCtrls = liveRoot.querySelectorAll("input, select, textarea");
  const clonedCtrls = clonedRoot.querySelectorAll("input, select, textarea");
  // Read computed styles from the *clone*, which html2canvas renders at the
  // windowWidth we pass (800px) — so even when the live phone viewport is
  // showing the mobile card layout, the PDF lays out as the desktop table.
  const cloneView = clonedDoc.defaultView || window;
  liveCtrls.forEach((live, i) => {
    const clone = clonedCtrls[i];
    if (!clone) return;
    if (live.tagName === "INPUT" && live.type === "checkbox") return; // renders ok
    let text;
    if (live.tagName === "SELECT") {
      const opt = live.options[live.selectedIndex];
      text = opt ? opt.textContent.trim() : "";
      if (text === "—" || text === "–") text = ""; // the "—" placeholder
    } else {
      text = live.value || "";
    }
    const cs = cloneView.getComputedStyle(clone);
    const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const borV = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const fontPx = parseFloat(cs.fontSize) || 13;
    const abs = cs.position === "absolute" || cs.position === "fixed";
    const div = clonedDoc.createElement("div");
    div.textContent = text;
    div.style.boxSizing = "border-box";
    if (abs) {
      // e.g. the per-row Stück selectors overlaid on the animal chart — keep
      // them where they are instead of letting them flow into the layout.
      div.style.position = cs.position;
      div.style.top = cs.top; div.style.left = cs.left;
      div.style.right = cs.right; div.style.bottom = cs.bottom;
      div.style.zIndex = cs.zIndex;
      div.style.width = cs.width;
    } else {
      div.style.width = "100%";
      div.style.flex = "1 1 0%";
      div.style.minWidth = "0";
    }
    // border-box min-height = one text line + the input's own padding + border,
    // so empty fields don't collapse and filled ones match the live height.
    div.style.minHeight = Math.round(fontPx * 1.4 + padV + borV) + "px";
    div.style.padding = cs.paddingTop + " " + cs.paddingRight + " " + cs.paddingBottom + " " + cs.paddingLeft;
    div.style.borderWidth = cs.borderTopWidth;
    div.style.borderStyle = (parseFloat(cs.borderTopWidth) || 0) === 0 ? "none" : "solid";
    div.style.borderColor = cs.borderTopColor;
    div.style.borderRadius = cs.borderTopLeftRadius;
    const bg = cs.backgroundColor;
    div.style.background = (bg === "rgba(0, 0, 0, 0)" || bg === "transparent" || !bg) ? "#fff" : bg;
    div.style.fontFamily = cs.fontFamily;
    div.style.fontSize = cs.fontSize;
    div.style.fontWeight = cs.fontWeight;
    div.style.lineHeight = "1.4";
    div.style.color = cs.color || "#1f1f1f";
    div.style.textAlign = (cs.textAlign === "start" || cs.textAlign === "") ? (abs ? "center" : "left") : cs.textAlign;
    div.style.whiteSpace = "nowrap";
    div.style.overflow = "hidden";
    div.style.textOverflow = "ellipsis";
    clone.replaceWith(div);
  });
}

// Snapshot the filled-in protocol sheet to a multi-page A4 PDF (same layout
// as printing) and return just the base64 payload (no data: prefix).
// Libraries are lazy-loaded. The `.exporting` class temporarily un-clips the
// modal and lays it out at a fixed document width so html2canvas captures the
// whole form, not just the part scrolled into view.
export async function generateProtocolPdf({ modal, sheet, figures }) {
  await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  const el = sheet;
  let canvas;
  modal.classList.add("exporting");
  try {
    void modal.offsetHeight;             // force the reflow before measuring
    figures.forEach((f) => f.resize()); // re-render dot overlays at the new width
    canvas = await window.html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      windowWidth: 800,
      onclone: (doc) => flattenFormControlsForPdf(doc, sheet),
    });
  } finally {
    modal.classList.remove("exporting");
    void modal.offsetHeight;
    figures.forEach((f) => f.resize());
  }

  const imgData = canvas.toDataURL("image/jpeg", 0.92);
  const JsPDF = window.jspdf.jsPDF;
  const pdf = new JsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgH = pageW * (canvas.height / canvas.width);
  pdf.addImage(imgData, "JPEG", 0, 0, pageW, imgH);
  let offset = pageH;
  while (offset < imgH - 1) {
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, -offset, pageW, imgH);
    offset += pageH;
  }
  return pdf.output("datauristring").split(",")[1];
}
