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
  // animals: tiny pinpoint dots. Jeder Wildbogen gehört genau einem Stück,
  // die Nummer steckt also schon in der Überschrift darüber.
  // range: larger dots that carry the placement order (1, 2, …) inside them.
  const figKind = fig.dataset.fig;
  const numbered = figKind === "range";
  const dotMinPx = numbered ? 9 : 2;
  const dotFrac = numbered ? 0.03 : 0.005;

  function resize() {
    // Read the canvas's own rect, nicht die der Figur: der Canvas kann
    // schmaler sein als sein Kasten, und ein versteckter Block misst 0.
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
  // `el` mit in die Registry: der Wildbogen-Umschalter muss zu einer Figur
  // im DOM die passenden Punkte finden können.
  registry.push({ el: fig, resize, clear: () => { circles.length = 0; redraw(); } });
}


// ---------------------------------------------------------------- Wildbögen
// Welcher Bogen zu welcher Wildart gehört. Rot-, Dam- und Rehwild teilen sich
// einen: die Trefferlage liest sich an allen dreien gleich, und drei fast
// identische Zeichnungen hätten den Jäger am Anschuss eher aufgehalten als
// geführt. Die Schlüssel müssen wörtlich den Optionen der Wildart-Selects
// entsprechen — steht dort eine Art, die hier fehlt, greift der Rückfall.
export const WILD_FIGURES = {
  Rotwild: "wild-rehwild.png",
  Damwild: "wild-rehwild.png",
  Schwarzwild: "wild-schwarzwild.png",
  Mufflon: "wild-mufflon.png",
  Rehwild: "wild-rehwild.png",
};

// Ohne gewählte Wildart steht der Rehwild-Bogen da. Irgendetwas muss antippbar
// sein, bevor die Tabelle oben ausgefüllt ist, und Rehwild ist die häufigste
// Wildart im Revier.
export const WILD_FIGURE_DEFAULT = "wild-rehwild.png";

// Verbindet jeden Wildbogen mit dem Wildart-Select seines Stücks: Auswahl
// ändern heißt Bogen wechseln. `root` ist das Blatt bzw. das Modal, `figures`
// die Registry aus setupProtocolFigure — die muss vorher gefüllt sein.
//
// Gibt { refresh } zurück; nach einem Zurücksetzen des Formulars aufrufen,
// sonst bleibt der Bogen von Stück II stehen, obwohl seine Wildart weg ist.
export function wireWildFigures(root, figures) {
  const blocks = Array.from(root.querySelectorAll("[data-wild-for]")).map((block) => ({
    block,
    select: root.querySelector(`[data-proto="${block.dataset.wildFor}_wildart"]`),
    img: block.querySelector("[data-wild-img]"),
    art: block.querySelector("[data-wild-art]"),
    fig: block.querySelector(".proto-figure"),
    optional: block.hasAttribute("data-wild-optional"),
  }));

  const entryFor = (fig) => figures.find((f) => f.el === fig);

  function apply(b) {
    const art = b.select ? String(b.select.value || "").trim() : "";
    const src = WILD_FIGURES[art] || WILD_FIGURE_DEFAULT;
    // Punkte nur wegwerfen, wenn wirklich ein anderes Tier darunter liegt.
    // Rotwild → Damwild zeigt denselben Bogen; dort zu löschen wäre ein
    // Datenverlust ohne Anlass — und am Anschuss ärgerlich.
    if (b.img && b.img.getAttribute("src") !== src) {
      b.img.setAttribute("src", src);
      b.img.alt = "Wildposen " + (art || "Rehwild");
      const e = entryFor(b.fig);
      if (e) e.clear();
    }
    if (b.art) b.art.textContent = art || "noch keine Wildart";
    if (b.optional) {
      const show = Boolean(art);
      const wasHidden = b.block.hidden;
      b.block.hidden = !show;
      // Ein verstecktes Element misst 0 breit. Der Canvas muss nach dem
      // Einblenden neu vermessen werden, sonst bleibt er auf 0 stehen und
      // nimmt keine Anschusspunkte an.
      if (show && wasHidden) {
        requestAnimationFrame(() => {
          const e = entryFor(b.fig);
          if (e) e.resize();
        });
      }
    }
  }

  blocks.forEach((b) => {
    if (b.select) b.select.addEventListener("change", () => apply(b));
    // Der Kasten ist so hoch wie sein Bild. Wechselt der Bogen auf eine Datei,
    // die noch nicht im Cache liegt, hat er im Moment des Umschaltens Höhe 0
    // — und ein Canvas, der mit 0 vermessen wurde, nimmt keine Anschusspunkte
    // mehr an. Am Anschuss mit einem Balken Empfang ist das der Normalfall,
    // deshalb wird nach jedem geladenen Bild neu vermessen.
    if (b.img) {
      b.img.addEventListener("load", () => {
        const e = entryFor(b.fig);
        if (e) e.resize();
      });
    }
  });
  const refresh = () => blocks.forEach(apply);
  refresh();
  return { refresh };
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
      // Absolut positionierte Felder bleiben, wo sie sind, statt in den
      // Textfluss zu rutschen.
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
// Blöcke, die ein Seitenumbruch nicht zerschneiden darf. Der Umbruch fiel
// vorher stur alle 842pt und lief dabei mitten durch den Kasten für Stück II.
// Die Liste steht hier und nicht als Attribut im Markup, weil das Protokoll
// auf zwei Seiten liegt (Modal in der Karte, nachsuche.html) und sonst an
// beiden Stellen gepflegt werden müsste.
//
// .proto-bottom steht bewusst mit drin, obwohl es die Pirschzeichen-Kästen
// schon enthält: es ist eine Flex-Zeile mit dem Ringdiagramm daneben, ein
// Umbruch mittendrin zerschneidet also immer beide Spalten. Damit landet der
// ganze Fuß — Stück I, Stück II, Diagramm und die Meldung darunter —
// geschlossen auf der letzten Seite.
const PDF_KEEP_TOGETHER = [
  // .proto-wild ist Überschrift + Bogen; die Zeile "Stück I — Schwarzwild"
  // allein am Seitenfuß wäre schlimmer als gar keine.
  ".proto-wild",
  ".proto-figure",
  ".proto-pirsch-block",
].join(", ");

// Zusammenhängende Abschnitte, die als ein Block gelten. Die Umrisse aller
// Treffer werden zu einem Kasten vereinigt.
//
// Der Fuß des Protokolls gehört zusammen: die Pirschzeichen zu beiden Stücken,
// das Ringdiagramm daneben und die Meldung an den Nachsuchenführer darunter.
// Wer das Protokoll weitergibt, will das auf einem Blatt haben und nicht den
// Kasten für Stück II auf der einen und die Bemerkung auf der nächsten Seite.
// Passt der Fuß nicht auf eine Seite, greift die Einzelliste oben und
// verhindert wenigstens, dass mitten durch einen Kasten gebrochen wird.
const PDF_KEEP_GROUPS = [
  [".proto-bottom", ".proto-meldung"],
];

// Höhe des Streifens am Seitenfuß, in dem das Wasserzeichen steht. Der Inhalt
// hört darüber auf, damit die Zeile nichts überdeckt.
const PDF_FOOTER_H = 24;
const PDF_WATERMARK = "preye.org - the hunting OS";

// Ein Fingerbreit Inhalt, der allein auf die nächste Seite rutscht, ist beim
// Ausdrucken eine leere Seite. Genau das passierte, seit Stück II seinen
// eigenen Wildbogen hat und bei nur einem beschossenen Stück wegfällt: der
// Bogen endete 11pt hinter der Seitenkante. Passt der Überhang mit einer kaum
// sichtbaren Verkleinerung noch auf die Seite davor, wird verkleinert statt
// umgebrochen — proportional, damit die Tierzeichnungen nicht in die Länge
// oder Breite gezogen werden. Mehr als PDF_SQUEEZE_MAX geben wir nicht nach;
// darunter liest sich das Blatt schlechter als mit einer Seite mehr.
const PDF_ORPHAN_MIN = 72;   // pt — kürzere letzte Seiten gelten als Waise
const PDF_SQUEEZE_MAX = 0.08;

function drawWatermark(pdf, pageW, pageH) {
  const pages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(155);
    pdf.text(PDF_WATERMARK, pageW / 2, pageH - 9, { align: "center" });
  }
  pdf.setTextColor(0);
}

// Teilt die Gesamthöhe in Seiten auf und zieht einen Umbruch nach oben, wenn
// er sonst durch einen der Blöcke oben liefe. `keeps` sind {top, bottom} in
// derselben Einheit wie `totalH`.
function planPages(totalH, pageH, keeps) {
  const pages = [];
  let offset = 0;
  let guard = 0;
  while (offset < totalH - 1 && guard++ < 200) {
    let end = offset + pageH;
    if (end < totalH - 1) {
      let cut = end;
      for (const k of keeps) {
        // Straddelt der Block die Kante? Dann oberhalb von ihm umbrechen.
        // 2pt Luft nach oben, damit Rundungen nicht doch die Oberkante anschneiden.
        if (k.top > offset + 1 && k.top < end && k.bottom > end) cut = Math.min(cut, k.top - 2);
      }
      // Ein Block, der selbst höher als eine Seite ist, lässt sich nicht
      // retten — dann bleibt es beim normalen Umbruch, statt eine fast leere
      // Seite zu erzeugen.
      if (cut > offset + pageH * 0.2) end = cut;
    }
    pages.push({ top: offset, height: Math.min(end, totalH) - offset });
    offset = Math.min(end, totalH);
  }
  return pages;
}

export async function generateProtocolPdf({ modal, sheet, figures }) {
  await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  const el = sheet;
  let canvas;
  let keepsCss = [];
  let sheetCssH = 0;
  modal.classList.add("exporting");
  try {
    void modal.offsetHeight;             // force the reflow before measuring
    figures.forEach((f) => f.resize()); // re-render dot overlays at the new width
    canvas = await window.html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      windowWidth: 800,
      onclone: (doc) => {
        flattenFormControlsForPdf(doc, sheet);
        // Erst hier messen, nicht am lebenden Bogen. flattenFormControlsForPdf
        // ersetzt jedes Eingabefeld durch ein div, und die sind ein paar Pixel
        // anders hoch — der gerenderte Bogen war dadurch 15px kürzer als der
        // gemessene, und der Umbruch landete knapp innerhalb des Blocks statt
        // davor. Im Klon stimmen die Positionen mit dem überein, was gleich
        // gezeichnet wird.
        const root = doc.getElementById(sheet.id);
        if (!root) return;
        const sheetRect = root.getBoundingClientRect();
        if (!sheetRect.height) return;
        sheetCssH = sheetRect.height;
        const rel = (n) => {
          const r = n.getBoundingClientRect();
          return { top: r.top - sheetRect.top, bottom: r.bottom - sheetRect.top };
        };
        // Versteckte Blöcke — etwa der Wildbogen von Stück II, solange dort
        // keine Wildart steht — messen 0 hoch und haben in der Umbruchplanung
        // nichts zu suchen.
        const solid = (b) => b.bottom - b.top > 1;
        keepsCss = [...root.querySelectorAll(PDF_KEEP_TOGETHER)].map(rel).filter(solid);
        PDF_KEEP_GROUPS.forEach((selectors) => {
          const boxes = selectors
            .flatMap((sel) => [...root.querySelectorAll(sel)])
            .map(rel)
            .filter(solid);
          if (!boxes.length) return;
          keepsCss.push({
            top: Math.min(...boxes.map((b) => b.top)),
            bottom: Math.max(...boxes.map((b) => b.bottom)),
          });
        });
      },
    });
  } finally {
    modal.classList.remove("exporting");
    void modal.offsetHeight;
    figures.forEach((f) => f.resize());
  }

  const JsPDF = window.jspdf.jsPDF;
  const pdf = new JsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const usableH = pageH - PDF_FOOTER_H;
  const imgH = pageW * (canvas.height / canvas.width);

  // CSS-Pixel → PDF-Punkte
  const scale = sheetCssH ? imgH / sheetCssH : 1;
  const keeps = keepsCss.map((k) => ({ top: k.top * scale, bottom: k.bottom * scale }));

  let pages = planPages(imgH, usableH, keeps);
  // Waisenseite einsammeln, falls sie sich mit wenig Nachgeben vermeiden lässt.
  let squeeze = 1;
  let renderH = imgH;
  const lastPage = pages[pages.length - 1];
  if (pages.length > 1 && lastPage && lastPage.height < PDF_ORPHAN_MIN) {
    const fit = (usableH * (pages.length - 1)) / imgH;
    if (fit >= 1 - PDF_SQUEEZE_MAX && fit < 1) {
      squeeze = fit;
      renderH = imgH * squeeze;
      const squeezed = keeps.map((k) => ({ top: k.top * squeeze, bottom: k.bottom * squeeze }));
      const retry = planPages(renderH, usableH, squeezed);
      // Nur übernehmen, wenn es wirklich eine Seite spart — sonst hätten wir
      // umsonst verkleinert.
      if (retry.length < pages.length) pages = retry;
      else { squeeze = 1; renderH = imgH; }
    }
  }
  const drawW = pageW * squeeze;
  const offX = (pageW - drawW) / 2;
  const pxPerPt = canvas.height / renderH;
  const slice = document.createElement("canvas");
  const sctx = slice.getContext("2d");

  pages.forEach((page, i) => {
    if (i > 0) pdf.addPage();
    // Jede Seite als eigener Ausschnitt statt eines langen Bildes mit
    // negativem Versatz — nur so lässt sich eine Seite früher enden lassen.
    slice.width = canvas.width;
    slice.height = Math.max(1, Math.round(page.height * pxPerPt));
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, slice.width, slice.height);
    sctx.drawImage(canvas, 0, -Math.round(page.top * pxPerPt));
    pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", offX, 0, drawW, page.height);
  });

  drawWatermark(pdf, pageW, pageH);
  return pdf.output("datauristring").split(",")[1];
}
