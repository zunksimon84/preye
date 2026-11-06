// PREYE — eigene QR-Codes.
//
// Statische Codes: die Adresse steht im Code selbst. Kodiert wird mit
// qr-lib.js (dieselbe Implementierung wie im Infomail-PDF), gezeichnet als SVG
// für die Vorschau und den Druck, als PNG für Word.

(function () {
  const $ = (sel) => document.querySelector(sel);

  const PRESETS = [
    { label: "Standkarte (leer)", url: "https://preye.org/standkarte.html?blanko=1", caption: "Standkarte" },
    { label: "Anschussprotokoll", url: "https://preye.org/nachsuche.html", caption: "Anschussprotokoll" },
    { label: "Startseite", url: "https://preye.org/", caption: "PREYE" },
  ];

  const QUIET = 4; // Ruhezone in Modulen — weniger mögen manche Kameras nicht.

  let toastTimer = null;
  function showToast(msg, kind, ms = 2600) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = kind === "error" ? "error" : "";
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function current() {
    return {
      url: $("#qr-url").value.trim(),
      caption: $("#qr-caption").value.trim(),
    };
  }

  function svgFor(modules) {
    const n = modules.length;
    const dim = n + QUIET * 2;
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (modules[y][x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`
      + `<rect width="${dim}" height="${dim}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  // Ganze Pixel je Modul, sonst verschwimmen die Kanten beim Skalieren in Word.
  function canvasFor(modules, caption) {
    const n = modules.length;
    const scale = Math.max(8, Math.floor(1200 / (n + QUIET * 2)));
    const side = (n + QUIET * 2) * scale;
    const capH = caption ? Math.round(scale * 6) : 0;
    const c = document.createElement("canvas");
    c.width = side;
    c.height = side + capH;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (modules[y][x]) g.fillRect((x + QUIET) * scale, (y + QUIET) * scale, scale, scale);
      }
    }
    if (caption) {
      g.font = `600 ${Math.round(scale * 3.2)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(caption, side / 2, side + capH / 2 - scale);
    }
    return c;
  }

  function fileBase(url, caption) {
    const raw = caption || url.replace(/^https?:\/\//, "");
    return "QR " + raw.replace(/[\\/:*?"<>|?&=]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  let modules = null;

  function render() {
    const { url } = current();
    const warn = $("#qr-warn");
    warn.hidden = true;
    if (!url) {
      $("#qr-result").hidden = true;
      modules = null;
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      warn.textContent = "Bitte die volle Adresse mit https:// angeben — sonst öffnet das Handy keine Webseite.";
      warn.hidden = false;
    } else if (!/^https:\/\/(www\.)?preye\.org(\/|$)/i.test(url)) {
      warn.textContent = "Achtung: Diese Adresse liegt nicht auf preye.org. Der Code funktioniert, solange es die Seite dort gibt.";
      warn.hidden = false;
    }
    try {
      modules = window.preyeQrEncode(url);
    } catch (err) {
      $("#qr-result").hidden = true;
      warn.textContent = "Adresse zu lang für einen QR-Code.";
      warn.hidden = false;
      modules = null;
      return;
    }
    $("#qr-preview").innerHTML = svgFor(modules);
    $("#qr-contains").textContent = url;
    $("#qr-result").hidden = false;
    $$presetActive(url);
  }

  function $$presetActive(url) {
    document.querySelectorAll("#qr-presets button").forEach((b) => {
      b.classList.toggle("active", b.dataset.url === url);
    });
  }

  function wire() {
    $("#qr-presets").innerHTML = PRESETS.map((p) =>
      `<button type="button" class="qr-preset" data-url="${p.url}" data-caption="${p.caption}">${p.label}</button>`
    ).join("");
    $("#qr-presets").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-url]");
      if (!b) return;
      $("#qr-url").value = b.dataset.url;
      $("#qr-caption").value = b.dataset.caption;
      render();
    });
    $("#qr-url").addEventListener("input", render);

    $("#qr-png").addEventListener("click", () => {
      if (!modules) return;
      const { url, caption } = current();
      canvasFor(modules, caption).toBlob((blob) => {
        download(blob, fileBase(url, caption) + ".png");
        showToast("PNG gespeichert");
      }, "image/png");
    });
    $("#qr-svg").addEventListener("click", () => {
      if (!modules) return;
      const { url, caption } = current();
      download(new Blob([svgFor(modules)], { type: "image/svg+xml" }), fileBase(url, caption) + ".svg");
      showToast("SVG gespeichert");
    });
    $("#qr-copy").addEventListener("click", () => {
      if (!modules) return;
      const { caption } = current();
      if (!navigator.clipboard || !window.ClipboardItem) {
        showToast("Kopieren geht in diesem Browser nicht — PNG herunterladen", "error", 4000);
        return;
      }
      canvasFor(modules, caption).toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          showToast("Bild kopiert — in Word mit Strg+V einfügen");
        } catch {
          showToast("Kopieren nicht erlaubt — PNG herunterladen", "error", 4000);
        }
      }, "image/png");
    });

    // ?url=… füllt vor, damit man von anderen Seiten hierher verlinken kann.
    const pre = new URLSearchParams(location.search).get("url");
    if (pre) $("#qr-url").value = pre;
    render();
  }

  wire();
})();
