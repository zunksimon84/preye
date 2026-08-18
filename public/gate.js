// Zugangssperre für preye — eine Implementierung für alle Seiten.
//
// Vorher stand dieselbe Sperre zweimal im Code (app.js und events.js) und lag
// nur auf der Karte und der Drückjagdplanung. Seit im Control Room, in den
// Revieren und auf der Standkarte echte Revierdaten stehen, gehört sie an den
// Anfang der App. Damit sie nicht ein drittes Mal kopiert wird, liegt sie hier.
//
// Bewusst offen bleiben zwei Seiten:
//   rsvp.html       — der eingeladene Jäger weist sich über seinen eigenen
//                     Token im Link aus, das Backend lässt ihn ohne Passwort
//                     durch (siehe rsvp-info / rsvp-respond in Code.gs).
//   nachsuche.html  — leeres Anschussprotokoll, kein Backend, keine
//                     Revierdaten. Das Ding muss im Wald aufgehen, auch wenn
//                     sonst nichts geht.
//   standkarte.html — der QR-Code in der Infomail führt direkt dorthin. Die
//                     Jäger scannen ihn am Jagdtag auf dem Parkplatz; die
//                     Karte hinter ein Passwort zu legen, das sie nicht haben,
//                     würde den QR-Code wertlos machen. Der Link trägt die
//                     Jagd-ID, ist also nicht zu erraten.
//
// Solange die Seite öffentlich geschaltet ist (Script Property site_mode ≠
// "private"), tut das Modul nichts — die Maske erscheint erst, wenn im Sheet
// ein Passwort gesetzt wurde.

(function () {
  "use strict";

  const TOKEN_KEY = "preye.token";
  const OK_KEY = "preye.gate.verified_at";
  // Nur der Abstand, in dem der gespeicherte Token erneut beim Server
  // gegengeprüft wird. Es ist KEIN Ablauf der Anmeldung: der Token selbst
  // bleibt liegen, es wird also nicht alle 15 Minuten neu gefragt.
  const RECHECK_MS = 15 * 60 * 1000;

  // Ob in diesem Seitenaufruf wirklich die Maske stand. Wenn ja, sind die
  // Panels schon ohne Token losgelaufen und hätten leere Kacheln — dann lohnt
  // sich ein Neuladen.
  let didPrompt = false;

  function config() {
    // Heißt aus historischen Gründen so — config.js wird beim Deploy erzeugt.
    return (typeof window !== "undefined" && window.PEENWERDER_CONFIG) || {};
  }

  function backendUrl() {
    const url = config().APPS_SCRIPT_URL;
    if (!url || String(url).startsWith("PASTE")) return "";
    return url;
  }

  async function getJson(url) {
    const res = await fetch(url, { redirect: "follow" });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error("Antwort vom Server konnte nicht gelesen werden");
    }
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function forget() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(OK_KEY);
  }

  // Baut die Maske selbst, damit nicht auf jeder Seite dasselbe Markup steht.
  // Seiten, die das <div id="gate"> schon im HTML haben (Karte, Events),
  // behalten ihres.
  function ensureMarkup() {
    let gate = document.getElementById("gate");
    if (gate) return gate;
    gate = document.createElement("div");
    gate.id = "gate";
    gate.hidden = true;
    gate.innerHTML =
      '<div class="gate-card">' +
        '<div class="gate-brand">' +
          '<img class="brand-eye" src="preye-mark.png" alt="" />' +
          '<span class="brand-pray">PREYE</span>' +
        '</div>' +
        '<p class="gate-sub">Privater Zugang</p>' +
        '<form id="gate-form" autocomplete="on">' +
          '<input id="gate-pw" type="password" autocomplete="current-password" ' +
                 'placeholder="Passwort" required />' +
          '<button type="submit">Öffnen</button>' +
        '</form>' +
        '<p id="gate-error" class="gate-error" hidden></p>' +
      '</div>';
    document.body.appendChild(gate);
    return gate;
  }

  function prompt() {
    return new Promise((resolve) => {
      didPrompt = true;
      const gate = ensureMarkup();
      const form = gate.querySelector("#gate-form");
      const input = gate.querySelector("#gate-pw");
      const errorEl = gate.querySelector("#gate-error");
      const submitBtn = form.querySelector("button");
      gate.hidden = false;
      setTimeout(() => input.focus(), 50);

      let inflight = false;

      async function attempt() {
        if (inflight) return;
        const password = input.value;
        if (!password) return;
        inflight = true;
        errorEl.hidden = true;
        const oldText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "…";
        try {
          const data = await getJson(
            backendUrl() + "?action=verify-access&password=" + encodeURIComponent(password)
          );
          if (data && data.ok && data.token) {
            localStorage.setItem(TOKEN_KEY, data.token);
            localStorage.setItem(OK_KEY, String(Date.now()));
            gate.hidden = true;
            resolve(true);
            return;
          }
          errorEl.textContent = data && data.error ? "Fehler: " + data.error : "Falsches Passwort.";
          errorEl.hidden = false;
          input.select();
        } catch (err) {
          console.error("gate verify failed", err);
          errorEl.textContent = "Fehler: " + (err.message || err);
          errorEl.hidden = false;
        } finally {
          inflight = false;
          submitBtn.disabled = false;
          submitBtn.textContent = oldText;
        }
      }

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        attempt();
      });
    });
  }

  // true = weitermachen. Kommt der Server nicht ans Telefon, lassen wir durch:
  // die Sperre ist ein Zugangsschutz für die Oberfläche, die eigentliche
  // Prüfung sitzt im Backend, das jede Anfrage ohne gültigen Token abweist.
  async function pass() {
    const url = backendUrl();
    if (!url) return true;

    const checkedAt = parseInt(localStorage.getItem(OK_KEY) || "0", 10);
    if (checkedAt && Date.now() - checkedAt < RECHECK_MS) return true;

    let isPublic = true;
    try {
      const data = await getJson(url + "?action=site-status");
      isPublic = !!data.is_public;
    } catch (err) {
      console.warn("site-status nicht erreichbar, lasse durch:", err);
      return true;
    }

    if (isPublic) {
      localStorage.setItem(OK_KEY, String(Date.now()));
      return true;
    }

    const cached = token();
    if (cached) {
      try {
        const vr = await getJson(url + "?action=verify-access&token=" + encodeURIComponent(cached));
        if (vr && vr.ok) {
          localStorage.setItem(OK_KEY, String(Date.now()));
          return true;
        }
      } catch (err) {
        // durchfallen zur Eingabe
      }
      forget();
    }

    return prompt();
  }

  window.PreyeGate = { pass, token, forget };

  // Seiten ohne eigenes Startskript (Control Room, Reviere, Standkarte) hängen
  // <script src="gate.js" data-autogate></script> ein. Die Sperre legt sich
  // dann über die Seite, sobald das DOM steht; der Inhalt darunter lädt normal
  // weiter, weil das Backend ihn ohnehin ohne Token nicht herausgibt.
  const self = document.currentScript;
  if (self && self.hasAttribute("data-autogate")) {
    const start = () => {
      pass().then((ok) => {
        if (ok && didPrompt) location.reload();
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }
})();
