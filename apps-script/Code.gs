// Peenwerder Jagd-Heatmap backend
// ---------------------------------
// Bound to the Google Sheet "Peenwerder Jagd". Deploy as Web App with
//   Execute as: Me      Who has access: Anyone
// Then paste the deployment URL into public/config.js as APPS_SCRIPT_URL.

// Order matters — every species dropdown in the app renders this list as it
// stands: the big game first in the order it gets called on a Drückjagd, then
// the rest, with Wolf and Sonstiges at the foot.
const SPECIES = [
  "Rotwild",
  "Damwild",
  "Schwarzwild",
  "Mufflon",
  "Rehwild",
  "Fuchs",
  "Dachs",
  "Waschbär",
  "Hase",
  "Wolf",
  "Sonstiges",
];

const SHEETS = {
  posts: "posts",
  hunters: "hunters",
  harvests: "harvests",
  nachsuchen: "nachsuchen",
  events: "events",
  event_hunters: "event_hunters",
  event_squads: "event_squads",
  address_book: "address_book",
};

const POST_HEADER = ["id", "name", "area", "lat", "lng", "type"];

// The three stand types used in Drückjagden. Stored as full words;
// the UI maps Drückjagdbock → "DJB" for compact display.
const POST_TYPES = ["Kanzel", "Drückjagdbock", "Leiter"];
const HUNTER_HEADER = ["name"];
const HARVEST_HEADER = ["timestamp", "hunter", "post_id", "species", "count", "notes", "wind_speed", "wind_dir", "gender", "age_class"];
const NACHSUCHE_HEADER = ["id", "created_at", "hunter", "stand_nr", "post_id", "summary", "status", "closed_at", "recipient"];
const EVENT_HEADER = ["id", "created_at", "name", "date", "teilgebiet", "rsvp_deadline", "treffpunkt", "treffpunkt_lat", "treffpunkt_lng", "treff_time", "start_time", "end_time", "briefing", "organizer", "status", "vet_name", "vet_phone", "coordinator_name", "coordinator_phone", "nachsuchenfuehrer", "freigaben", "art"];

// Jagdart. Bis August 2026 gab es nur Drückjagden, deshalb ist die Spalte bei
// allen Altbeständen leer — leer wird als "drueckjagd" gelesen.
const HUNT_KINDS = ["drueckjagd", "gruppenansitz"];
function huntKind_(value) {
  const v = String(value || "").trim().toLowerCase();
  return HUNT_KINDS.indexOf(v) >= 0 ? v : "drueckjagd";
}

// Canonical species / gender / AK matrix for the Freigaben section in
// the Infomail PDF. Stays in this one place so the backend filters and
// frontend checkboxes can't drift out of sync. The selected-AK list
// saved per event is a flat array of strings like
//   "rotwild.hirsche.ak0"
// An event with no freigaben column (legacy) or with an empty array is
// rendered as "everything is released" — i.e., the default before the
// organizer picks anything is identical to the previous hardcoded list.
const FREIGABEN_MATRIX = [
  { id: "rotwild", label: "Rotwild", groups: [
    { id: "hirsche",  label: "Hirsche",     aks: [
      { id: "ak0", label: "AK 0" },
      { id: "ak1", label: "AK 1" },
      { id: "ak2", label: "AK 2" },
      { id: "ak3", label: "AK 3" },
      { id: "ak4", label: "AK 4" },
    ]},
    { id: "kuehe",    label: "Rottiere",    aks: [
      { id: "ak0", label: "AK 0" },
      { id: "ak1", label: "AK 1" },
      { id: "ak2", label: "AK 2" },
    ]},
  ]},
  { id: "damwild", label: "Damwild", groups: [
    { id: "hirsche",  label: "Hirsche",     aks: [
      { id: "ak0", label: "AK 0" },
      { id: "ak1", label: "AK 1" },
      { id: "ak2", label: "AK 2" },
      { id: "ak3", label: "AK 3" },
      { id: "ak4", label: "AK 4" },
    ]},
    { id: "tiere",    label: "Damtiere",    aks: [
      { id: "ak0", label: "AK 0" },
      { id: "ak1", label: "AK 1" },
      { id: "ak2", label: "AK 2" },
    ]},
  ]},
  { id: "schwarzwild", label: "Schwarzwild", groups: [
    { id: "keiler",   label: "Keiler",      aks: [
      { id: "frischling",   label: "AK 0" },
      { id: "ueberlaeufer", label: "AK 1" },
      { id: "keiler",       label: "AK 2" },
    ]},
    { id: "bachen",   label: "Bachen",      aks: [
      { id: "frischling",   label: "AK 0" },
      { id: "ueberlaeufer", label: "AK 1" },
      { id: "bache",        label: "AK 2" },
    ]},
  ]},
  { id: "rehwild", label: "Rehwild", groups: [
    { id: "boecke",   label: "Rehböcke",    aks: [
      { id: "ak0", label: "AK 0" },
      { id: "ak1", label: "AK 1" },
      { id: "ak2", label: "AK 2" },
    ]},
    { id: "ricken",   label: "Ricken",      aks: [
      { id: "ak0", label: "AK 0" },
      { id: "ak1", label: "AK 1" },
      { id: "ak2", label: "AK 2" },
    ]},
  ]},
];

// Compact "AK 0–3" / "AK 0, 2" label for the PDF Freigaben section.
// Uses each AK's position in its group as its number — works for both
// number-coded ids (ak0, ak1, …) and stage-named ones (Frischling /
// Überläufer / Keiler), so Schwarzwild gets the same compact "AK 0–2"
// rendering as the cervids.
function formatAkSelection_(group, checkedAks) {
  if (!checkedAks.length) return "";
  const idToIdx = {};
  group.aks.forEach(function (ak, i) { idToIdx[ak.id] = i; });
  const nums = checkedAks
    .map(function (ak) { return idToIdx[ak.id]; })
    .filter(function (n) { return typeof n === "number"; })
    .sort(function (a, b) { return a - b; });
  if (!nums.length) return "";
  const ranges = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === prev + 1) { prev = nums[i]; continue; }
    ranges.push(start === prev ? String(start) : start + "–" + prev);
    start = nums[i];
    prev = nums[i];
  }
  ranges.push(start === prev ? String(start) : start + "–" + prev);
  return "AK " + ranges.join(", ");
}

// "All AKs released" — the default we use whenever an event has no
// saved freigaben yet.
function freigabenAllKeys_() {
  const out = [];
  for (const sp of FREIGABEN_MATRIX) {
    for (const g of sp.groups) {
      for (const ak of g.aks) {
        out.push(sp.id + "." + g.id + "." + ak.id);
      }
    }
  }
  return out;
}
const EVENT_HUNTER_HEADER = ["id", "event_id", "hunter", "email", "language", "token", "status", "role", "dogs", "invited_at", "responded_at", "confirmed_jagdschein", "confirmed_vsg44"];

// JGHV-anerkannte Jagdhundrassen — single source of truth, baked here so
// the backend can validate what the RSVP page submits. "Sonstige" lets a
// hunter declare a non-listed breed.
const DOG_BREEDS = [
  "Deutsch Drahthaar", "Deutsch Kurzhaar", "Pudelpointer", "Deutsch Stichelhaar",
  "Griffon Korthals", "Drahthaariger Ungarischer Vorstehhund", "Barbet", "Weimaraner",
  "English Pointer", "Kurzhaariger Ungarischer Vorstehhund",
  "Braque de l'Ariège", "Braque du Bourbonnais", "Braque d'Auvergne",
  "Braque Français", "Braque Saint-Germain", "Deutsch Langhaar",
  "Großer Münsterländer", "Kleiner Münsterländer",
  "English Setter", "Gordon Setter", "Irish Red Setter",
  "Epagneul Breton", "Epagneul Français", "Epagneul Bleu de Picardie",
  "Epagneul de Pont-Audemer", "English Cocker Spaniel", "Deutscher Wachtelhund",
  "English Springer Spaniel", "Hannoverscher Schweißhund",
  "Bayerischer Gebirgsschweißhund", "Alpenländische Dachsbracke",
  "Deutscher Jagdterrier", "Foxterrier", "Parson Russell Terrier", "Teckel",
  "Deutsche Bracke", "Westfälische Dachsbracke", "Steirische Rauhhaarbracke",
  "Brandlbracke", "Tiroler Bracke", "Beagle", "English Foxhound",
  "Français tricolore", "Français blanc et noir", "Slovensky Kopov",
  "Curly Coated Retriever", "Golden Retriever", "Flat-coated Retriever",
  "Labrador Retriever", "Chesapeake Bay Retriever",
  "Nova Scotia Duck Tolling Retriever",
  "Russisch-Europäischer Laika", "Ostsibirischer Laika", "Westsibirischer Laika",
  "Black and Tan Coonhound", "Bloodhound",
  "Grand Anglo-Français", "Harrier",
  "Irish Red and White Setter", "Welsh Springer Spaniel",
  "Sonstige",
];
// "Squad" is the legacy label — in German hunting we call these
// "Ansteller Runden" (Schützen led by an Ansteller) and "Treibergruppen"
// (Treiber led by a Hundeführer). Both share the same row schema; the
// "type" column distinguishes them ("ansteller" / "treiber"; empty = ansteller).
const EVENT_SQUAD_HEADER = ["id", "event_id", "name", "post_id", "post_name", "briefing", "members", "ansteller", "positions", "type", "start_pos"];
const ADDRESS_BOOK_HEADER = ["name", "email", "language"];

// Outgoing "From" address for all GmailApp.sendEmail calls. Must be a
// verified "Send mail as" alias on the script-owner Gmail account
// (Gmail → Settings → Accounts → Send mail as → Add another email address).
const FROM_EMAIL = "zunk.forstberatung@gmail.com";

// ---------- HTTP entrypoints ----------

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || "bootstrap";
    // Public endpoints — no token needed.
    if (action === "site-status") return json_(siteStatus_());
    if (action === "verify-access") return json_(verifyAccess_(params));
    // RSVP page authenticates via the per-hunter token in the URL.
    if (action === "rsvp-info") return json_(rsvpInfo_(params));
    // Everything else requires a valid token if the site is private.
    if (!checkToken_(params.token)) {
      return json_({ error: "private", code: "AUTH_REQUIRED" });
    }
    if (action === "bootstrap") return json_(bootstrap_());
    if (action === "aggregates") return json_(aggregates_(params));
    if (action === "sync") return json_(syncPostsFromKml());
    if (action === "history") return json_(history_(params));
    if (action === "strecke") return json_(strecke_(params));
    if (action === "nachsuche-list") return json_(nachsucheList_());
    if (action === "events-list") return json_(eventsList_());
    if (action === "event-detail") return json_(eventDetail_(params));
    if (action === "address-book") return json_(addressBookList_());
    if (action === "invite-preview") return json_(invitePreview_(params));
    if (action === "invite-template-get") return json_(inviteTemplateGetEndpoint_(params));
    return json_({ error: "unknown action" }, 400);
  } catch (err) {
    return json_({ error: String(err && err.message || err) }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || "{}");
    const action = body.action || "harvest";
    // RSVP responses authenticate via the per-hunter token in the body,
    // not the privacy gate token — so the link works without the password.
    if (action === "rsvp-respond") {
      const r = rsvpRespond_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (!checkToken_(body.token)) {
      return json_({ error: "private", code: "AUTH_REQUIRED" });
    }
    if (action === "nachsuche-create") {
      const r = nachsucheCreate_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "nachsuche-close") {
      const r = nachsucheClose_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "post-add") {
      const r = postAdd_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "posts-batch-add") {
      const r = postsBatchAdd_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-create") {
      const r = eventCreate_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-update") {
      const r = eventUpdate_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-hunter-add") {
      const r = eventHunterAdd_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-hunters-batch-add") {
      const r = eventHuntersBatchAdd_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-hunter-remove") {
      const r = eventHunterRemove_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-invites-send") {
      const r = eventInvitesSend_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-squad-save") {
      const r = eventSquadSave_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-squad-delete") {
      const r = eventSquadDelete_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-infomails-preview") {
      const r = eventInfomailsPreview_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-infomails-send") {
      const r = eventInfomailsSend_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-freigaben-save") {
      const r = eventFreigabenSave_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "event-delete") {
      const r = eventDelete_(body);
      return json_(r, r.error ? 400 : 200);
    }
    if (action === "invite-template-save") {
      const r = inviteTemplateSaveEndpoint_(body);
      return json_(r, r.error ? 400 : 200);
    }
    // default — log a harvest
    const result = logHarvest_(body);
    return json_(result, result.error ? 400 : 200);
  } catch (err) {
    return json_({ error: String(err && err.message || err) }, 500);
  }
}

// ---------- Handlers ----------

function bootstrap_() {
  return {
    posts: readPosts_(),
    hunters: readHunters_(),
    species: SPECIES.slice(),
  };
}

function strecke_(params) {
  const fromIso = params.from || null;
  const toIso = params.to || null;
  const from = fromIso ? new Date(fromIso) : null;
  const to = toIso ? new Date(toIso) : null;

  const rows = readHarvests_();
  const buckets = {}; // species → { count, by_gender: { m: {count,age{...}}, w, unknown } }
  function emptyAge() {
    return { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, unknown: 0 };
  }
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ts = new Date(r.timestamp);
    if (from && ts < from) continue;
    if (to && ts > to) continue;
    const sp = String(r.species || "").trim();
    if (!sp) continue;
    const n = Number(r.count) || 0;
    if (!n) continue;
    if (!buckets[sp]) {
      buckets[sp] = {
        count: 0,
        by_gender: {
          m: { count: 0, age: emptyAge() },
          w: { count: 0, age: emptyAge() },
          unknown: { count: 0, age: emptyAge() },
        },
      };
    }
    const b = buckets[sp];
    b.count += n;
    total += n;
    const g = safeStr_(r.gender).toLowerCase();
    const gKey = g === "m" ? "m" : g === "w" ? "w" : "unknown";
    b.by_gender[gKey].count += n;
    const a = safeStr_(r.age_class);
    const aKey = (a === "0" || a === "1" || a === "2" || a === "3" || a === "4") ? a : "unknown";
    b.by_gender[gKey].age[aKey] += n;
  }
  const by_species = Object.keys(buckets)
    .map(function (sp) {
      const b = buckets[sp];
      return { species: sp, count: b.count, by_gender: b.by_gender };
    })
    .sort(function (a, b) { return b.count - a.count; });

  // Per-day counts for the current hunting season, regardless of the
  // filter — the timeline always spans Apr 1 → Mar 31 so the user can see
  // when the season's peak weeks were.
  const seasonStart = seasonStartUtc_(new Date());
  const dailyMap = {};
  for (let j = 0; j < rows.length; j++) {
    const r2 = rows[j];
    const ts = new Date(r2.timestamp);
    if (isNaN(ts) || ts < seasonStart) continue;
    const dayKey = ts.toISOString().slice(0, 10); // YYYY-MM-DD
    const n2 = Number(r2.count) || 0;
    dailyMap[dayKey] = (dailyMap[dayKey] || 0) + n2;
  }
  const daily = Object.keys(dailyMap).sort().map(function (d) {
    return { day: d, count: dailyMap[d] };
  });
  const seasonEnd = new Date(Date.UTC(seasonStart.getUTCFullYear() + 1, 2, 31, 23, 59, 59));

  return {
    by_species: by_species,
    total: total,
    season_start: seasonStart.toISOString(),
    season_end: seasonEnd.toISOString(),
    daily: daily,
  };
}

function history_(params) {
  const post_id = String(params.post_id || "").trim();
  if (!post_id) return [];
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
  const rows = readHarvests_();
  const filtered = rows
    .filter(function (r) { return String(r.post_id).trim() === post_id; })
    .map(function (r) {
      const ts = new Date(r.timestamp);
      const ws = r.wind_speed;
      const wd = r.wind_dir;
      return {
        timestamp: isNaN(ts) ? null : ts.toISOString(),
        hunter: String(r.hunter || ""),
        species: String(r.species || ""),
        count: Number(r.count) || 0,
        notes: String(r.notes || ""),
        wind_speed: ws === "" || ws === null || ws === undefined ? null : Number(ws),
        wind_dir: wd === "" || wd === null || wd === undefined ? null : Number(wd),
        gender: safeStr_(r.gender),
        age_class: safeStr_(r.age_class),
      };
    })
    .sort(function (a, b) {
      return (b.timestamp || "").localeCompare(a.timestamp || "");
    })
    .slice(0, limit);
  return filtered;
}

function aggregates_(params) {
  const fromIso = params.from || null;     // inclusive ISO date or datetime
  const toIso = params.to || null;         // inclusive ISO date or datetime
  const species = params.species || null;  // single species or null

  const from = fromIso ? new Date(fromIso) : null;
  const to = toIso ? new Date(toIso) : null;

  const rows = readHarvests_();
  const counts = {};
  for (const r of rows) {
    const ts = new Date(r.timestamp);
    if (from && ts < from) continue;
    if (to && ts > to) continue;
    if (species && r.species !== species) continue;
    counts[r.post_id] = (counts[r.post_id] || 0) + Number(r.count || 0);
  }
  return Object.keys(counts).map(function (post_id) {
    return { post_id: post_id, total_count: counts[post_id] };
  });
}

function logHarvest_(body) {
  const hunter = String(body.hunter || "").trim();
  const speciesVal = String(body.species || "").trim();
  const count = Number(body.count);
  const notes = String(body.notes || "").trim();
  const free = body.free_location || null;
  let post_id = String(body.post_id || "").trim();

  // Optional descriptors. Empty string when unset; validated to known
  // values otherwise so the stats tab doesn't get junk data.
  let gender = String(body.gender || "").trim().toLowerCase();
  if (gender && gender !== "m" && gender !== "w") gender = "";
  let ageClass = String(body.age_class || "").trim();
  if (ageClass && !/^[0-4]$/.test(ageClass)) ageClass = "";

  if (!hunter) return { error: "hunter required" };
  if (hunter.length > 40) return { error: "hunter name too long" };
  if (!/^[\p{L}][\p{L}\s.\-']{0,39}$/u.test(hunter)) {
    return { error: "hunter name has invalid characters" };
  }
  if (!speciesVal) return { error: "species required" };
  if (!Number.isFinite(count) || count < 1 || count > 20) {
    return { error: "count must be 1–20" };
  }
  if (SPECIES.indexOf(speciesVal) === -1) {
    return { error: "invalid species" };
  }
  if (!post_id && !free) return { error: "post_id or free_location required" };

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // If a free location was provided (Klettersitz or Pirsch), materialise
  // it as a post so it shows up in aggregates/heatmap like any other.
  let createdPost = null;
  if (free && !post_id) {
    const lat = Number(free.lat);
    const lng = Number(free.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "free_location.lat out of range" };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: "free_location.lng out of range" };
    const rawLabel = String(free.label || "").trim();
    if (rawLabel.length > 40) return { error: "free_location.label too long" };
    if (rawLabel && !/^[\p{L}\p{N}][\p{L}\p{N}\s.\-_/'"]{0,39}$/u.test(rawLabel)) {
      return { error: "free_location.label has invalid characters" };
    }
    const KIND = {
      klettersitz: { area: "Klettersitz", prefix: "KS-" },
      pirsch:      { area: "Pirsch",      prefix: "P-"  },
    };
    const kindKey = String(free.kind || "klettersitz").toLowerCase();
    const cfg = KIND[kindKey];
    if (!cfg) return { error: "invalid free_location.kind" };
    const niceLabel = rawLabel || (cfg.area + " " + lat.toFixed(4) + ", " + lng.toFixed(4));
    post_id = cfg.prefix + Date.now().toString(36).toUpperCase();
    const sheet = ensureSheet_(ss, SHEETS.posts, POST_HEADER);
    sheet.appendRow([post_id, niceLabel, cfg.area, lat, lng]);
    createdPost = { id: post_id, name: niceLabel, area: cfg.area, lat: lat, lng: lng };
  }

  const posts = readPosts_();
  if (!posts.some(function (p) { return p.id === post_id; })) {
    return { error: "unknown post_id: " + post_id };
  }

  // Auto-add hunter to roster on first use (case-insensitive match).
  const hunters = readHunters_();
  const known = hunters.find(function (h) { return h.toLowerCase() === hunter.toLowerCase(); });
  if (!known) {
    ensureSheet_(ss, SHEETS.hunters, HUNTER_HEADER).appendRow([hunter]);
  }
  const canonical = known || hunter;

  // Resolve harvest time — user can backdate (logging yesterday's hunt
  // today). Falls back to now on missing/invalid input. Reject far-
  // future entries (>1h ahead) and very old (>2 years) as data hygiene.
  let harvestTime = new Date();
  const userTs = String(body.timestamp || "").trim();
  if (userTs) {
    const parsed = new Date(userTs);
    if (!isNaN(parsed)) {
      const diffMs = parsed.getTime() - Date.now();
      const TWO_YEARS_MS = 2 * 365 * 86400000;
      if (diffMs <= 3600000 && diffMs >= -TWO_YEARS_MS) {
        harvestTime = parsed;
      }
    }
  }

  // Pick the lat/lng to query weather for.
  const targetPost = createdPost || posts.find(function (p) { return p.id === post_id; });
  const weather = (targetPost && Number.isFinite(targetPost.lat) && Number.isFinite(targetPost.lng))
    ? fetchWeather_(targetPost.lat, targetPost.lng, harvestTime)
    : null;

  const sheet = ensureSheet_(ss, SHEETS.harvests, HARVEST_HEADER);
  appendByName_(sheet, {
    timestamp: harvestTime.toISOString(),
    hunter: canonical,
    post_id: post_id,
    species: speciesVal,
    count: count,
    notes: notes,
    wind_speed: weather ? weather.wind_speed : "",
    wind_dir: weather ? weather.wind_dir : "",
    gender: gender,
    age_class: ageClass,
  });

  const out = { ok: true, hunter: canonical };
  if (createdPost) out.post = createdPost;
  return out;
}

// ---------- Sheet helpers ----------

function readPosts_() {
  const rows = readSheet_(SHEETS.posts, POST_HEADER);
  return rows.map(function (r) {
    let type = String(r.type || "").trim();
    if (POST_TYPES.indexOf(type) === -1) type = "Kanzel"; // legacy rows
    return {
      id: String(r.id),
      name: String(r.name),
      area: String(r.area),
      lat: Number(r.lat),
      lng: Number(r.lng),
      type: type,
    };
  });
}

// Manual or CSV import of a single hunting post (Kanzel / Drückjagdbock /
// Leiter). Backend authority on type + area validation so the sheet doesn't
// fill with free-form junk.
const POST_AREAS = ["Hauptrevier", "Ost", "Nord", "Nordrand", "Babke", "Langenhagen", "Schwarzenhof", "Serrahn"];

function postAdd_(body) {
  const name = String(body.name || "").trim();
  if (!name) return { error: "name required" };
  if (name.length > 60) return { error: "name too long" };
  const area = String(body.area || "").trim();
  if (POST_AREAS.indexOf(area) === -1) return { error: "invalid area" };
  let type = String(body.type || "").trim();
  if (POST_TYPES.indexOf(type) === -1) type = "Kanzel";
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "lat out of range" };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: "lng out of range" };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.posts, POST_HEADER);
  // Generate an id with a short area-based prefix so existing conventions
  // (HR-01, O-02, …) extend cleanly to the new areas.
  const prefix = {
    "Hauptrevier": "HR", "Ost": "O", "Nord": "N", "Nordrand": "NR",
    "Babke": "BA", "Langenhagen": "LH", "Schwarzenhof": "SH", "Serrahn": "SE",
  }[area] || "P";
  const id = prefix + "-" + Date.now().toString(36).toUpperCase();
  appendByName_(sheet, {
    id: id, name: name, area: area, lat: lat, lng: lng, type: type,
  });
  return { ok: true, id: id };
}

function postsBatchAdd_(body) {
  const rows = Array.isArray(body.posts) ? body.posts : [];
  let added = 0;
  const errors = [];
  for (let i = 0; i < rows.length && i < 500; i++) {
    const r = postAdd_(rows[i] || {});
    if (r.error) errors.push({ row: i + 1, error: r.error, name: rows[i] && rows[i].name || "" });
    else added++;
  }
  return { ok: true, added: added, errors: errors };
}

function readHunters_() {
  return readSheet_(SHEETS.hunters, HUNTER_HEADER)
    .map(function (r) { return String(r.name).trim(); })
    .filter(Boolean);
}

function readHarvests_() {
  return readSheet_(SHEETS.harvests, HARVEST_HEADER);
}

function readSheet_(name, expectedHeader) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, name, expectedHeader);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0].map(function (c) { return String(c).trim(); });
  return values.slice(1).map(function (row) {
    const obj = {};
    header.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function ensureSheet_(ss, name, header) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Additive migration: append any header columns the sheet doesn't have
  // yet. Existing column positions are never touched, so old rows keep
  // their data and new rows get the new fields written via appendByName_.
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (s) { return String(s).trim(); })
    : [];
  for (let i = 0; i < header.length; i++) {
    if (existing.indexOf(header[i]) === -1) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(header[i]).setFontWeight("bold");
    }
  }
  return sheet;
}

// Append a row by header NAME so we don't depend on column order. The
// sheet's current header is read each call (cheap) so that additive
// migrations or manual reorderings still work.
function appendByName_(sheet, values) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const row = new Array(header.length).fill("");
  Object.keys(values).forEach(function (key) {
    const i = header.indexOf(key);
    if (i >= 0) row[i] = values[key];
  });
  sheet.appendRow(row);
}

// ---------- KML sync ----------
// Re-fetches the public Peenwerder My Map KML and upserts placemarks
// matching "Nr. X" / "DJB X" inside the four known sub-revier folders into
// the posts tab. New posts are appended; existing ones are updated in
// place if their name/area/coords changed in My Maps. Posts are never
// deleted from the sheet (they carry harvest history). Klettersitz posts
// (hunter-created free locations) are independent of KML and never
// touched by sync.

const KML_URL = "https://www.google.com/maps/d/kml?mid=1Mz4DY_G8uTFDT14YNepjb8vLbjwF6lM&forcekml=1";

const AREA_PREFIX = {
  "Peenwerder Hauptrevier": "HR",
  "Peenwerder Ost": "OST",
  "Peenwerder Nord": "N",
  "Peenwerder Nordrand": "NR",
};

// Inverse map (area name → ID prefix) for coord-based classification.
const AREA_PREFIX_BY_AREA = {
  "Hauptrevier": "HR",
  "Ost":         "OST",
  "Nord":        "N",
  "Nordrand":    "NR",
};

// Geographic bounding boxes per revier sub-area. A placemark is classified
// by whichever box it falls into (boxes are non-overlapping). Empty result
// = the marker isn't inside any known revier and gets ignored.
//
// Splits derived from the actual marker coords:
//   - HR's eastern edge at lng 12.84972; Ost's western edge at lng 12.85003
//     → boundary at 12.850 (HR strictly < 12.850, Ost ≥ 12.850).
//   - HR's northern edge ≈ 53.631; Nord's southern edge ≈ 53.646 → safe gap.
//   - Nord top ≈ 53.654; Nordrand bottom ≈ 53.655 → boundary at 53.654.
function classifyByCoords_(lat, lng) {
  if (lat >= 53.605 && lat <= 53.640 && lng >= 12.810 && lng <  12.850) return "Hauptrevier";
  if (lat >= 53.610 && lat <= 53.625 && lng >= 12.850 && lng <= 12.860) return "Ost";
  if (lat >  53.640 && lat <= 53.654 && lng >= 12.860 && lng <= 12.890) return "Nord";
  if (lat >  53.654 && lat <= 53.670 && lng >= 12.870 && lng <= 12.895) return "Nordrand";
  return null;
}

function syncPostsFromKml() {
  const res = UrlFetchApp.fetch(KML_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("KML fetch failed: HTTP " + res.getResponseCode());
  }
  const fromKml = parseKmlPosts_(res.getContentText());

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.posts, POST_HEADER);
  const lastRow = sheet.getLastRow();
  const existingValues = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, POST_HEADER.length).getValues()
    : [];

  const idToRowIdx = {};
  for (let i = 0; i < existingValues.length; i++) {
    idToRowIdx[String(existingValues[i][0])] = i;
  }

  let added = 0, updated = 0;
  const newRows = [];
  for (let i = 0; i < fromKml.length; i++) {
    const p = fromKml[i];
    const newRow = [p.id, p.name, p.area, p.lat, p.lng];
    if (idToRowIdx[p.id] !== undefined) {
      const cur = existingValues[idToRowIdx[p.id]];
      const changed =
        String(cur[1]) !== p.name ||
        String(cur[2]) !== p.area ||
        Math.abs(Number(cur[3]) - p.lat) > 1e-7 ||
        Math.abs(Number(cur[4]) - p.lng) > 1e-7;
      if (changed) {
        sheet.getRange(idToRowIdx[p.id] + 2, 1, 1, POST_HEADER.length).setValues([newRow]);
        updated++;
      }
    } else {
      newRows.push(newRow);
      added++;
    }
  }
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, POST_HEADER.length).setValues(newRows);
  }
  return { added: added, updated: updated, total: fromKml.length };
}

function parseKmlPosts_(kml) {
  // Walk every Point placemark in the whole KML — folder membership is
  // a hint we ignore. The placemark's coordinates decide which revier
  // it belongs to (classifyByCoords_), so a marker accidentally added
  // to the wrong My Maps layer still gets the right area + ID prefix.
  const placemarks = parseKmlPointPlacemarks_(kml);
  const out = [];
  for (let j = 0; j < placemarks.length; j++) {
    const pm = placemarks[j];
    if (!isHuntingPostName_(pm.name)) continue;
    const num = postNumber_(pm.name);
    if (!num) continue;
    const area = classifyByCoords_(pm.lat, pm.lng);
    if (!area) continue;
    const prefix = AREA_PREFIX_BY_AREA[area];
    if (!prefix) continue;
    const isDjb = /^DJB/i.test(pm.name);
    const idCore = (isDjb ? "DJB" : "") + num;
    out.push({
      id: prefix + "-" + idCore.toUpperCase(),
      name: pm.name,
      area: area,
      lat: pm.lat,
      lng: pm.lng,
    });
  }
  // Suffix duplicate IDs so they remain unique (matches parse-kml.mjs).
  const seen = {};
  for (let k = 0; k < out.length; k++) {
    const id = out[k].id;
    seen[id] = (seen[id] || 0) + 1;
    if (seen[id] > 1) out[k].id = id + "-" + seen[id];
  }
  return out;
}

function parseKmlFolders_(kml) {
  const folders = [];
  const re = /<Folder>([\s\S]*?)<\/Folder>/g;
  let m;
  while ((m = re.exec(kml)) !== null) {
    const body = m[1];
    const nameMatch = body.match(/<name>([^<]+)<\/name>/);
    folders.push({
      name: nameMatch ? decodeXml_(nameMatch[1].trim()) : "Unknown",
      body: body,
    });
  }
  return folders;
}

function parseKmlPointPlacemarks_(body) {
  const out = [];
  const re = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1];
    if (!/<Point>/.test(inner)) continue;
    const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/);
    const coordMatch = inner.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!nameMatch || !coordMatch) continue;
    const parts = coordMatch[1].trim().split(",").map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) continue;
    out.push({ name: decodeXml_(nameMatch[1].trim()), lat: parts[1], lng: parts[0] });
  }
  return out;
}

function decodeXml_(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function isHuntingPostName_(name) {
  return /^(Nr\.?|DJB)\s*\d+/i.test(name);
}

function postNumber_(name) {
  const m = name.match(/^(?:Nr\.?|DJB)\s*([\dA-Za-z]+)/i);
  return m ? m[1] : null;
}

function installPostsSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "syncPostsFromKml") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("syncPostsFromKml").timeBased().everyHours(1).create();
}

// ---------- Weather (Open-Meteo, no key) ----------

function fetchWeather_(lat, lng, when) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const ts = new Date(when);
  if (isNaN(ts)) return null;
  const ageDays = (Date.now() - ts.getTime()) / 86400000;

  // Forecast endpoint covers ~last 92 days plus the current day; archive
  // endpoint goes back to 1940 but lags by ~5 days. Pick whichever fits.
  let url;
  if (ageDays < 5) {
    const past = Math.max(1, Math.ceil(ageDays) + 1);
    url = "https://api.open-meteo.com/v1/forecast"
      + "?latitude=" + lat + "&longitude=" + lng
      + "&hourly=wind_speed_10m,wind_direction_10m"
      + "&past_days=" + past + "&forecast_days=1"
      + "&timezone=UTC&windspeed_unit=kmh";
  } else {
    const dayStr = ts.toISOString().slice(0, 10);
    url = "https://archive-api.open-meteo.com/v1/archive"
      + "?latitude=" + lat + "&longitude=" + lng
      + "&start_date=" + dayStr + "&end_date=" + dayStr
      + "&hourly=wind_speed_10m,wind_direction_10m"
      + "&timezone=UTC&windspeed_unit=kmh";
  }

  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const data = JSON.parse(resp.getContentText());
    if (!data.hourly || !data.hourly.time || !data.hourly.time.length) return null;
    const targetMs = ts.getTime();
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < data.hourly.time.length; i++) {
      const t = new Date(data.hourly.time[i] + "Z").getTime();
      const diff = Math.abs(t - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    if (bestIdx < 0) return null;
    const speed = data.hourly.wind_speed_10m[bestIdx];
    const dir = data.hourly.wind_direction_10m[bestIdx];
    if (!Number.isFinite(speed) || !Number.isFinite(dir)) return null;
    return {
      wind_speed: Math.round(speed * 10) / 10,
      wind_dir: Math.round(dir),
    };
  } catch (err) {
    return null;
  }
}

// One-shot helper to fill weather columns on existing harvest rows that
// were logged before the weather feature shipped. Run from the editor:
//   Function dropdown → backfillWeather → ▶
// Stops itself before hitting the per-execution time limit.
function backfillWeather() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.harvests, HARVEST_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("Keine Strecke-Einträge vorhanden.");
    return;
  }
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const tsCol = header.indexOf("timestamp") + 1;
  const postCol = header.indexOf("post_id") + 1;
  const wsCol = header.indexOf("wind_speed") + 1;
  const wdCol = header.indexOf("wind_dir") + 1;
  if (!tsCol || !postCol || !wsCol || !wdCol) {
    throw new Error("Missing required columns in harvests sheet");
  }

  const posts = readPosts_();
  const postMap = {};
  for (let i = 0; i < posts.length; i++) postMap[posts[i].id] = posts[i];

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const start = Date.now();
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < data.length; i++) {
    if (Date.now() - start > 5 * 60 * 1000) break; // 5 min safety
    const row = data[i];
    const cur = row[wsCol - 1];
    if (cur !== "" && cur !== null && cur !== undefined) { skipped++; continue; }
    const post = postMap[String(row[postCol - 1])];
    if (!post || !Number.isFinite(post.lat)) continue;
    const ts = new Date(row[tsCol - 1]);
    if (isNaN(ts)) continue;
    const w = fetchWeather_(post.lat, post.lng, ts);
    if (!w) continue;
    sheet.getRange(i + 2, wsCol).setValue(w.wind_speed);
    sheet.getRange(i + 2, wdCol).setValue(w.wind_dir);
    updated++;
    Utilities.sleep(150); // be polite to Open-Meteo
  }
  SpreadsheetApp.getUi().alert(
    "Wetter-Backfill: " + updated + " ergänzt, " + skipped + " bereits vorhanden."
  );
}

// ---------- Season rollover ----------
// A hunting season runs Apr 1 → Mar 31. archivePastSeasons() moves any
// harvest rows from earlier seasons into per-season tabs named
// "harvests_2025-26" etc., leaving only the current season in the main
// `harvests` tab. The daily trigger installed by setup() runs this every
// night, so on Apr 1 (and any day after) the rollover happens automatically.

function archivePastSeasons() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.harvests, HARVEST_HEADER);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { moved: 0 };

  const header = values[0];
  const currentStart = seasonStartUtc_(new Date());

  const keep = [header];
  const buckets = {}; // seasonLabel → [rows]

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const ts = new Date(row[0]);
    if (isNaN(ts) || ts >= currentStart) {
      keep.push(row);
      continue;
    }
    const label = seasonLabel_(ts);
    (buckets[label] = buckets[label] || []).push(row);
  }

  let moved = 0;
  for (const label in buckets) {
    const archive = ensureSheet_(ss, SHEETS.harvests + "_" + label, HARVEST_HEADER);
    const rows = buckets[label];
    archive.getRange(archive.getLastRow() + 1, 1, rows.length, HARVEST_HEADER.length).setValues(rows);
    moved += rows.length;
  }

  if (moved > 0) {
    sheet.clear();
    sheet.getRange(1, 1, keep.length, HARVEST_HEADER.length).setValues(keep);
    sheet.getRange(1, 1, 1, HARVEST_HEADER.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  return { moved: moved };
}

function seasonStartUtc_(date) {
  // April 1 of the year the season started in. Months: 0=Jan ... 3=Apr.
  const y = date.getUTCMonth() < 3 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
  return new Date(Date.UTC(y, 3, 1));
}

function seasonLabel_(date) {
  const start = seasonStartUtc_(date);
  const startYear = start.getUTCFullYear();
  return startYear + "-" + String((startYear + 1) % 100).padStart(2, "0");
}

function installArchiveTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "archivePastSeasons") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("archivePastSeasons").timeBased().atHour(1).everyDays(1).create();
}

// ---------- Auto-statistics ----------
// Reads all harvest rows and rebuilds a 'stats' tab with three summary
// tables + bar charts: by species, by gender, by age class. Wipes and
// re-creates the tab on each call so it's always fresh.

function rebuildStats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const harvests = readHarvests_();

  const bySpecies = {};
  const byGender = { m: 0, w: 0, "?": 0 };
  const byAge = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "?": 0 };
  let total = 0;
  let withGender = 0;
  let withAge = 0;

  for (let i = 0; i < harvests.length; i++) {
    const r = harvests[i];
    const count = Number(r.count) || 0;
    if (!count) continue;
    const sp = String(r.species || "?").trim() || "?";
    const g = safeStr_(r.gender);
    const a = safeStr_(r.age_class);
    bySpecies[sp] = (bySpecies[sp] || 0) + count;
    if (g === "m" || g === "w") {
      byGender[g] += count;
      withGender += count;
    } else {
      byGender["?"] += count;
    }
    if (/^[0-4]$/.test(a)) {
      byAge[a] += count;
      withAge += count;
    } else {
      byAge["?"] += count;
    }
    total += count;
  }

  // Wipe and rebuild the stats tab.
  let sheet = ss.getSheetByName("stats");
  if (sheet) {
    const charts = sheet.getCharts();
    for (let c = 0; c < charts.length; c++) sheet.removeChart(charts[c]);
    sheet.clear();
  } else {
    sheet = ss.insertSheet("stats");
  }

  sheet.getRange("A1").setValue("Statistik — aktualisiert " + new Date().toLocaleString("de-DE"))
    .setFontWeight("bold");

  let row = 3;
  row = writeStatsBlock_(sheet, row, "Strecke nach Wildart",
    Object.keys(bySpecies).sort(function (a, b) { return bySpecies[b] - bySpecies[a]; })
      .map(function (k) { return [k, bySpecies[k]]; }));

  row = writeStatsBlock_(sheet, row, "Strecke nach Geschlecht", [
    ["männlich (♂)", byGender.m],
    ["weiblich (♀)", byGender.w],
    ["unbekannt", byGender["?"]],
  ].filter(function (e) { return e[1] > 0; }));

  row = writeStatsBlock_(sheet, row, "Strecke nach Altersklasse", [
    ["AK 0", byAge["0"]],
    ["AK 1", byAge["1"]],
    ["AK 2", byAge["2"]],
    ["AK 3", byAge["3"]],
    ["AK 4", byAge["4"]],
    ["unbekannt", byAge["?"]],
  ].filter(function (e) { return e[1] > 0; }));

  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 90);

  return { total: total, species: Object.keys(bySpecies).length, withGender: withGender, withAge: withAge };
}

function writeStatsBlock_(sheet, startRow, title, rows) {
  if (!rows.length) return startRow;
  sheet.getRange(startRow, 1).setValue(title).setFontWeight("bold").setFontSize(12);
  const headerRow = startRow + 1;
  sheet.getRange(headerRow, 1, 1, 2).setValues([["Kategorie", "Anzahl"]]).setFontWeight("bold");
  const dataStart = headerRow + 1;
  sheet.getRange(dataStart, 1, rows.length, 2).setValues(rows);
  const dataEnd = dataStart + rows.length - 1;

  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(sheet.getRange(headerRow, 1, rows.length + 1, 2))
    .setPosition(dataEnd + 2, 1, 0, 0)
    .setOption("title", title)
    .setOption("legend", { position: "none" })
    .setOption("hAxis", { title: "Anzahl" })
    .setOption("colors", ["#1f3a1f"])
    .build();
  sheet.insertChart(chart);

  // Leave room for chart (~16 rows) + spacer
  return dataEnd + 18;
}

function installStatsTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "rebuildStats") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // 02:00 daily — after the season-archive trigger at 01:00.
  ScriptApp.newTrigger("rebuildStats").timeBased().atHour(2).everyDays(1).create();
}

// ---------- Nachsuche (pending wounded-game tracking) ----------
// An Anschuss-Protokoll submitted from the app creates an open Nachsuche
// record. The frontend shows a flashing skull marker at the associated
// Stand until someone marks it closed. If a recipient email + PDF were
// supplied, the PDF is mailed from the script owner's Gmail.

function nachsucheList_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.nachsuchen, NACHSUCHE_HEADER);
  const rows = readSheet_(SHEETS.nachsuchen, NACHSUCHE_HEADER);
  const posts = readPosts_();
  const postMap = {};
  for (let i = 0; i < posts.length; i++) postMap[posts[i].id] = posts[i];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r.status || "open").toLowerCase() === "closed") continue;
    const post = postMap[String(r.post_id || "")];
    if (!post || !Number.isFinite(post.lat) || !Number.isFinite(post.lng)) continue;
    const ts = new Date(r.created_at);
    out.push({
      id: String(r.id),
      created_at: isNaN(ts) ? null : ts.toISOString(),
      hunter: String(r.hunter || ""),
      stand_nr: String(r.stand_nr || ""),
      post_id: String(r.post_id || ""),
      post_name: String(post.name || ""),
      summary: String(r.summary || ""),
      lat: post.lat,
      lng: post.lng,
    });
  }
  return out;
}

// Map a "Stand-Nr." string ("13", "Nr. 13", "HR-13", "13a", "DJB 63")
// to a posts-tab row.
function resolveStandToPost_(standNr) {
  const s = String(standNr || "").trim();
  if (!s) return null;
  const posts = readPosts_();
  for (let i = 0; i < posts.length; i++) {
    if (posts[i].id.toLowerCase() === s.toLowerCase()) return posts[i];
  }
  const numMatch = s.match(/(\d+[a-z]?)/i);
  if (numMatch) {
    const num = numMatch[1].toLowerCase();
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const nameNum = String(p.name).match(/^(?:Nr\.?|DJB)\s*(\d+[a-z]?)/i);
      if (nameNum && nameNum[1].toLowerCase() === num) return p;
      const idTail = String(p.id).split("-").pop().toLowerCase();
      if (idTail === num) return p;
    }
  }
  return null;
}

function nachsucheCreate_(body) {
  const hunter = String(body.hunter || "").trim() || "?";
  const summary = String(body.summary || "").trim().slice(0, 240);
  const recipient = String(body.recipient || "").trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Resolve where the Nachsuche is. Three inputs, in priority order:
  //   1. post_id     — a Kanzel picked from the dropdown (exact id)
  //   2. free_location {lat,lng,label,kind} — Klettersitz/Pirsch; we
  //      materialise it as a posts row exactly like logHarvest_ does
  //   3. stand_nr    — legacy free-text Stand number, fuzzy-matched
  let post = null;
  let postId = String(body.post_id || "").trim();
  if (postId) {
    post = readPosts_().find(function (p) { return p.id === postId; }) || null;
  }
  if (!post && body.free_location) {
    const free = body.free_location;
    const lat = Number(free.lat);
    const lng = Number(free.lng);
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        Number.isFinite(lng) && lng >= -180 && lng <= 180) {
      const rawLabel = String(free.label || "").trim().slice(0, 40);
      const labelOk = !rawLabel || /^[\p{L}\p{N}][\p{L}\p{N}\s.\-_/'"]{0,39}$/u.test(rawLabel);
      const KIND = {
        klettersitz: { area: "Klettersitz", prefix: "KS-" },
        pirsch:      { area: "Pirsch",      prefix: "P-"  },
      };
      const cfg = KIND[String(free.kind || "klettersitz").toLowerCase()] || KIND.klettersitz;
      const niceLabel = (labelOk && rawLabel) || (cfg.area + " " + lat.toFixed(4) + ", " + lng.toFixed(4));
      postId = cfg.prefix + Date.now().toString(36).toUpperCase();
      ensureSheet_(ss, SHEETS.posts, POST_HEADER).appendRow([postId, niceLabel, cfg.area, lat, lng]);
      post = { id: postId, name: niceLabel, area: cfg.area, lat: lat, lng: lng };
    }
  }
  if (!post && body.stand_nr) {
    post = resolveStandToPost_(String(body.stand_nr));
    if (post) postId = post.id;
  }
  const standNr = post ? String(post.name) : String(body.stand_nr || "").trim();

  const sheet = ensureSheet_(ss, SHEETS.nachsuchen, NACHSUCHE_HEADER);
  const id = "NS-" + Date.now().toString(36).toUpperCase();
  appendByName_(sheet, {
    id: id,
    created_at: new Date().toISOString(),
    hunter: hunter,
    stand_nr: standNr,
    post_id: post ? post.id : "",
    summary: summary,
    status: "open",
    closed_at: "",
    recipient: recipient,
  });

  let emailed = false;
  let emailError = "";
  if (recipient && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient) && body.pdf_base64) {
    try {
      const bytes = Utilities.base64Decode(body.pdf_base64);
      const blob = Utilities.newBlob(bytes, "application/pdf", "anschuss-protokoll.pdf");
      // GmailApp (not MailApp) actually honors the `from` alias —
      // MailApp silently drops it back to the script owner.
      GmailApp.sendEmail(
        recipient,
        "Anschuss-Protokoll — Nachsuche" + (standNr ? " (Stand " + standNr + ")" : ""),
        "Hallo,\n\nanbei das Anschuss-Protokoll von " + hunter + "." +
          (summary ? "\n\n" + summary : "") +
          "\n\n— automatisch versendet aus PREYE (Peenwerder Jagd)",
        { from: FROM_EMAIL, attachments: [blob] }
      );
      emailed = true;
    } catch (err) {
      emailError = String(err && err.message || err);
    }
  }
  return { ok: true, id: id, post_id: post ? post.id : "", post_found: !!post, emailed: emailed, email_error: emailError };
}

function nachsucheClose_(body) {
  const id = String(body.id || "").trim();
  if (!id) return { error: "id required" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.nachsuchen, NACHSUCHE_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: "not found" };
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const idCol = header.indexOf("id") + 1;
  const statusCol = header.indexOf("status") + 1;
  const closedCol = header.indexOf("closed_at") + 1;
  if (!idCol || !statusCol) return { error: "schema" };
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      sheet.getRange(i + 2, statusCol).setValue("closed");
      if (closedCol) sheet.getRange(i + 2, closedCol).setValue(new Date().toISOString());
      return { ok: true };
    }
  }
  return { error: "not found" };
}

// ---------- Privacy / access control ----------
// Site mode + access password live in Script Properties (only the script
// owner can read/write). Anyone can flip the toggle from the sheet via
// the 🔒 Privacy menu added by onOpen — that menu only renders for users
// with edit access to the sheet, which is just Simon.

const PROP_SITE_MODE = "siteMode";
const PROP_ACCESS_HASH = "accessPasswordHash";

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("🔒 Privacy")
    .addItem("Privat schalten (Passwort setzen)", "menu_setPrivate")
    .addItem("Öffentlich schalten", "menu_setPublic")
    .addItem("Status anzeigen", "menu_showStatus")
    .addToUi();
  ui.createMenu("📊 Statistik")
    .addItem("Aktualisieren", "menu_rebuildStats")
    .addItem("Posten neu klassifizieren", "menu_reclassifyPosts")
    .addItem("Verlorene Klettersitz/Pirsch-Posten anzeigen", "menu_listLostFreePosts")
    .addToUi();
  ui.createMenu("📧 E-Mail")
    .addItem("Test-E-Mail an mich senden", "menu_testEmail")
    .addItem("Mapbox-Token setzen (Karten + volle Pin-Beschriftung) ⭐", "menu_setMapboxToken")
    .addItem("Geoapify-Key setzen (Karten + Pins, 2-Zeichen-Limit)", "menu_setGeoapifyKey")
    .addItem("Maps API Key setzen (Google Fallback)", "menu_setMapsApiKey")
    .addToUi();
}

// One-time check that the "send email as you" permission is granted and
// delivery works. Run this from the menu (or the Run ▶ button) — it will
// trigger the OAuth consent screen on first use, which is exactly the grant
// the Anschuss-Protokoll's PDF mailer needs.
// Diagnostic — logs the list of "Send mail as" aliases the script can use.
// Run from the editor: Run ▶ → menu_listAliases, then open "Executions"
// (Ausführungen) in the left sidebar and read the log output.
// One-time setter for the Static-Maps API key. Stored in Script Properties
// so the build can fetch satellite maps for the per-Schütze info mails.
// Manually trigger the documents/Drive OAuth consent so the deployed web
// app can call DocumentApp.create() / DriveApp.getFileById() when building
// the Infomail PDF. Web-app POSTs never show the consent screen, so the
// only way to grant the scope is to run a function from the editor once.
// After this runs successfully, the existing deployment picks up the
// new scopes — no re-deploy needed.
//
// Reports via console.log + return value (visible in the editor's
// execution log). Avoids ui.alert because that dialog appears in the
// bound spreadsheet tab — if you're in the editor it just blocks
// invisibly until you go switch tabs.
function menu_authorizeInfomailPdf() {
  let doc;
  try {
    doc = DocumentApp.create("_authorize_test_" + Date.now());
    DriveApp.getFileById(doc.getId()).setTrashed(true);
    console.log("Docs- & Drive-Zugriff freigeschaltet ✓");
    return { ok: true, message: "Docs- & Drive-Zugriff freigeschaltet." };
  } catch (err) {
    const msg = (err && err.message || err);
    console.log("Fehler: " + msg + " — Falls ein Berechtigungsdialog erscheint, einmal genehmigen und die Funktion erneut starten.");
    if (doc) {
      try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e) {}
    }
    return { ok: false, error: String(msg) };
  }
}

function menu_setMapsApiKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("Maps API Key", "Bitte gib den Google-Maps-API-Key ein (wird in den Script-Properties gespeichert):", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = (r.getResponseText() || "").trim();
  if (!k) { ui.alert("Kein Key eingegeben."); return; }
  PropertiesService.getScriptProperties().setProperty("MAPS_API_KEY", k);
  ui.alert("Gespeichert. Info-Mails können jetzt eine Karte einbetten.");
}

// Stores the Mapbox access token. Once set, the Infomail PDF builder
// uses Mapbox's Static Images API (outdoors style with our own
// preye.org/markers/ pin PNGs rendered natively on the map) as the
// primary provider. The full post number — suffix and all — fits on
// every pin head because Mapbox accepts arbitrary HTTPS icon URLs.
// Free tier: 50 000 requests/month. Sign up at https://account.mapbox.com/
// (no card required). The "Default public token" on the account page
// (starts with `pk.`) is what to paste here.
function menu_setMapboxToken() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt(
    "Mapbox Access Token",
    "Default public token von account.mapbox.com (beginnt mit pk.).\n\n" +
    "Damit werden die Infomail-Karten gerendert und die Stand-Pins zeigen " +
    "die volle Nummer inkl. a/b-Suffix.",
    ui.ButtonSet.OK_CANCEL
  );
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = (r.getResponseText() || "").trim();
  if (!k) { ui.alert("Kein Token eingegeben."); return; }
  PropertiesService.getScriptProperties().setProperty("MAPBOX_TOKEN", k);
  ui.alert("Mapbox-Token gespeichert. Beim nächsten Infomail-Versand wird Mapbox verwendet.");
}

// Stores the Geoapify API key. Once set, the Infomail PDF builder
// uses Geoapify's Static Maps API (OSM base + native teardrop pins
// with up to 2-char text labels). Free tier: 3 000 requests/day.
// Sign up at https://www.geoapify.com/ (no card required).
function menu_setGeoapifyKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt(
    "Geoapify Key",
    "API-Key von geoapify.com (Free-Tier reicht für unsere Mengen).\n\n" +
    "Damit werden die Infomail-Karten über OSM gerendert und die Pins mit " +
    "der Standnummer direkt auf der Karte gezeichnet.",
    ui.ButtonSet.OK_CANCEL
  );
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = (r.getResponseText() || "").trim();
  if (!k) { ui.alert("Kein Key eingegeben."); return; }
  PropertiesService.getScriptProperties().setProperty("GEOAPIFY_KEY", k);
  ui.alert("Geoapify-Key gespeichert. Beim nächsten Infomail-Versand werden die Pins direkt auf der Karte gerendert.");
}

function menu_listAliases() {
  const me = Session.getActiveUser().getEmail();
  let aliases = [];
  let err = "";
  try { aliases = GmailApp.getAliases(); }
  catch (e) { err = String(e && e.message || e); }

  console.log("Script-Besitzer: " + me);
  console.log("Gewünschter Absender (FROM_EMAIL): " + FROM_EMAIL);
  console.log("getAliases-Fehler: " + (err || "(keiner)"));
  console.log("Anzahl Aliasse: " + aliases.length);
  console.log("Aliasse: " + JSON.stringify(aliases));
  const has = aliases.indexOf(FROM_EMAIL) >= 0;
  console.log(has
    ? "RESULT: ✓ " + FROM_EMAIL + " ist als Alias verfügbar."
    : "RESULT: ✗ " + FROM_EMAIL + " fehlt in der Aliasliste.");

  // Also return so it shows in the editor's debug pane.
  return { owner: me, wanted: FROM_EMAIL, aliases: aliases, available: has, error: err };
}

function menu_testEmail() {
  const ui = SpreadsheetApp.getUi();
  const me = Session.getActiveUser().getEmail();
  try {
    GmailApp.sendEmail(
      me,
      "PREYE — Test",
      "E-Mail-Versand funktioniert. Absender: " + FROM_EMAIL +
        "\nVerbleibendes Tageskontingent: " + MailApp.getRemainingDailyQuota(),
      { from: FROM_EMAIL }
    );
    ui.alert("Gesendet von " + FROM_EMAIL + " an " + me +
      ".\nVerbleibendes Kontingent heute: " + MailApp.getRemainingDailyQuota());
  } catch (err) {
    ui.alert("Fehlgeschlagen: " + (err && err.message || err));
  }
}

// Walk every row in the posts sheet and rename any whose ID prefix /
// area no longer match where the marker physically sits. Runs once
// after the bounding-box classifier was tightened so existing wrong
// entries get fixed in place — IDs and area are updated, harvest rows
// referring to the old ID get rewritten to the new ID, and ID
// collisions (where the correct row already exists) trigger a row
// deletion of the orphan instead of a rename.
function menu_reclassifyPosts() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postsSheet = ensureSheet_(ss, SHEETS.posts, POST_HEADER);
  const harvestsSheet = ensureSheet_(ss, SHEETS.harvests, HARVEST_HEADER);
  const lastRow = postsSheet.getLastRow();
  if (lastRow < 2) {
    ui.alert("Keine Posten zum Reklassifizieren.");
    return;
  }
  const data = postsSheet.getRange(2, 1, lastRow - 1, POST_HEADER.length).getValues();

  // Build a set of all existing post IDs so we can detect collisions.
  const existingIds = {};
  for (let i = 0; i < data.length; i++) existingIds[String(data[i][0]).trim()] = i;

  const renames = []; // {rowIdx, oldId, newId, newArea}
  const drops = [];   // rowIdx (1-based) — orphans where the correct row already exists
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0]).trim();
    const lat = Number(row[3]);
    const lng = Number(row[4]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // User-created free posts (Klettersitz / Pirsch) shouldn't be re-prefixed.
    if (id.indexOf("KS-") === 0 || id.indexOf("P-") === 0 || id.indexOf("FREE-") === 0) continue;
    const correctArea = classifyByCoords_(lat, lng);
    if (!correctArea) continue;
    const correctPrefix = AREA_PREFIX_BY_AREA[correctArea];
    const dashIdx = id.indexOf("-");
    if (dashIdx <= 0) continue;
    const currentPrefix = id.substring(0, dashIdx);
    if (currentPrefix === correctPrefix) continue;
    const idCore = id.substring(dashIdx + 1);
    const newId = correctPrefix + "-" + idCore;
    if (existingIds[newId] !== undefined && existingIds[newId] !== i) {
      // Correct row already exists → orphan, drop this one.
      drops.push(i + 2);
    } else {
      renames.push({ rowIdx: i + 2, oldId: id, newId: newId, newArea: correctArea });
      existingIds[newId] = i;
      delete existingIds[id];
    }
  }

  // Apply renames: update id (col 1) and area (col 3) in-place; rewrite
  // any harvest row referring to oldId.
  const harvestHeader = harvestsSheet.getLastColumn() > 0
    ? harvestsSheet.getRange(1, 1, 1, harvestsSheet.getLastColumn()).getValues()[0]
    : [];
  const postIdCol = harvestHeader.indexOf("post_id") + 1; // 1-based, 0 if not found
  const harvestLastRow = harvestsSheet.getLastRow();
  let harvestVals = null;
  if (postIdCol > 0 && harvestLastRow > 1) {
    harvestVals = harvestsSheet.getRange(2, postIdCol, harvestLastRow - 1, 1).getValues();
  }
  let harvestRefsRewritten = 0;
  for (let r = 0; r < renames.length; r++) {
    const u = renames[r];
    postsSheet.getRange(u.rowIdx, 1).setValue(u.newId);
    postsSheet.getRange(u.rowIdx, 3).setValue(u.newArea);
    if (harvestVals) {
      for (let j = 0; j < harvestVals.length; j++) {
        if (String(harvestVals[j][0]).trim() === u.oldId) {
          harvestVals[j][0] = u.newId;
          harvestRefsRewritten++;
        }
      }
    }
  }
  if (harvestVals && harvestRefsRewritten > 0) {
    harvestsSheet.getRange(2, postIdCol, harvestVals.length, 1).setValues(harvestVals);
  }

  // Apply drops: delete rows from bottom up so the indices stay valid.
  drops.sort(function (a, b) { return b - a; });
  for (let d = 0; d < drops.length; d++) {
    postsSheet.deleteRow(drops[d]);
  }

  ui.alert(
    "Posten reklassifiziert.\n\n" +
    "Umbenannt: " + renames.length + "\n" +
    "Verworfene Duplikate: " + drops.length + "\n" +
    "Harvest-Zeilen aktualisiert: " + harvestRefsRewritten
  );
}

// Lists Klettersitz/Pirsch/FREE post IDs that are referenced by harvest
// rows but no longer have a matching row in the posts tab — i.e. lost.
// Coords aren't recoverable (harvests don't store them), but knowing
// which IDs and how many harvests each had helps Simon manually re-add
// them with the same ID so the orphan history relinks automatically.
function menu_listLostFreePosts() {
  const harvests = readHarvests_();
  const posts = readPosts_();
  const known = {};
  for (let i = 0; i < posts.length; i++) known[posts[i].id] = true;

  const orphans = {};
  for (let i = 0; i < harvests.length; i++) {
    const h = harvests[i];
    const pid = String(h.post_id || "").trim();
    if (!pid || known[pid]) continue;
    if (pid.indexOf("KS-") !== 0 && pid.indexOf("P-") !== 0 && pid.indexOf("FREE-") !== 0) continue;
    if (!orphans[pid]) orphans[pid] = { count: 0, latest: "", entries: 0 };
    orphans[pid].count += Number(h.count) || 0;
    orphans[pid].entries++;
    const ts = String(h.timestamp || "");
    if (ts > orphans[pid].latest) orphans[pid].latest = ts;
  }

  const ids = Object.keys(orphans);
  if (ids.length === 0) {
    SpreadsheetApp.getUi().alert("Keine verlorenen Klettersitz- oder Pirsch-Posten.");
    return;
  }
  let msg = "Diese Klettersitz/Pirsch-Posten fehlen im 'posts' Tab, " +
    "obwohl noch Strecken-Einträge auf sie zeigen:\n\n";
  ids.sort();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const o = orphans[id];
    msg += "• " + id + " — " + o.count + " Stück (" + o.entries + " Einträge), zuletzt " +
      (o.latest ? o.latest.slice(0, 10) : "—") + "\n";
  }
  msg += "\nWiederherstellen: im 'posts' Tab eine neue Zeile mit dieser ID, " +
    "Bereich = 'Klettersitz' oder 'Pirsch', und den Koordinaten anlegen.";
  SpreadsheetApp.getUi().alert(msg);
}

function menu_rebuildStats() {
  const r = rebuildStats();
  SpreadsheetApp.getUi().alert(
    "Statistik aktualisiert.\n\n" +
    "Gesamt-Strecke: " + r.total + " Stück\n" +
    "Wildarten: " + r.species + " · Geschlecht erfasst: " + r.withGender + " · Altersklasse erfasst: " + r.withAge
  );
}

function menu_setPrivate() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Privat schalten",
    "Neues Zugangs-Passwort eingeben (min 4 Zeichen):",
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const password = String(response.getResponseText() || "").trim();
  if (password.length < 4) {
    ui.alert("Passwort zu kurz (min 4 Zeichen).");
    return;
  }
  const hash = sha256_(password);
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_SITE_MODE, "private");
  props.setProperty(PROP_ACCESS_HASH, hash);
  ui.alert(
    "Site ist jetzt PRIVAT.\n\nZugangs-Passwort:  " + password +
    "\n\nNur an Vertraute weitergeben."
  );
}

function menu_setPublic() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_SITE_MODE, "public");
  props.deleteProperty(PROP_ACCESS_HASH);
  SpreadsheetApp.getUi().alert("Site ist jetzt ÖFFENTLICH (kein Passwort nötig).");
}

function menu_showStatus() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const mode = props[PROP_SITE_MODE] || "public";
  let msg = "Status: " + mode.toUpperCase();
  if (mode === "private") {
    msg += "\nPasswort gesetzt: " + (props[PROP_ACCESS_HASH] ? "✓ ja" : "✗ NEIN (bitte erneut setzen)");
  }
  SpreadsheetApp.getUi().alert(msg);
}

function isPublic_() {
  const mode = PropertiesService.getScriptProperties().getProperty(PROP_SITE_MODE);
  return mode !== "private";
}

function getAccessHash_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_ACCESS_HASH) || "";
}

function checkToken_(token) {
  if (isPublic_()) return true;
  const stored = getAccessHash_();
  if (!stored) return false; // private but no password set — fail closed
  return String(token || "") === stored;
}

function siteStatus_() {
  return { is_public: isPublic_() };
}

function verifyAccess_(params) {
  if (isPublic_()) return { ok: true, token: "" };
  const stored = getAccessHash_();
  if (!stored) return { ok: false, error: "no password set" };
  const token = String(params.token || "");
  if (token && token === stored) return { ok: true, token: stored };
  const password = String(params.password || "");
  if (password && sha256_(password) === stored) return { ok: true, token: stored };
  return { ok: false };
}

function sha256_(input) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    input,
    Utilities.Charset.UTF_8
  );
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

// ---------- Response helpers ----------

function json_(obj /*, statusCode (advisory only) */) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Convert a sheet cell value to a trimmed string without the falsy-trap
// of `value || ""` — which would turn the number 0 (e.g. age_class for
// AK 0) into the empty string and silently drop it from stats.
function safeStr_(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// ---------- Drückjagd / event organisation ----------
// One driven-hunt day = one row in `events`. The roster lives in
// `event_hunters` (one row per invited hunter, with a per-row token used
// as the magic-link auth for the RSVP page). Optional squads live in
// `event_squads`. `address_book` stores reusable name+email contacts so
// you don't retype them across events.

function eventsList_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.events, EVENT_HEADER);
  ensureSheet_(ss, SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  const events = readSheet_(SHEETS.events, EVENT_HEADER);
  const hunters = readSheet_(SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  return events.map(function (ev) {
    const stats = { invited: 0, accepted: 0, declined: 0, pending: 0 };
    for (let i = 0; i < hunters.length; i++) {
      if (String(hunters[i].event_id) !== String(ev.id)) continue;
      stats.invited++;
      const s = String(hunters[i].status || "").toLowerCase();
      if (s === "accepted") stats.accepted++;
      else if (s === "declined") stats.declined++;
      else stats.pending++;
    }
    return {
      id: String(ev.id),
      name: String(ev.name || ""),
      date: toDateString_(ev.date),
      teilgebiet: String(ev.teilgebiet || ""),
      art: huntKind_(ev.art),
      rsvp_deadline: toDateString_(ev.rsvp_deadline),
      treffpunkt: String(ev.treffpunkt || ""),
      treffpunkt_lat: numOrEmpty_(ev.treffpunkt_lat),
      treffpunkt_lng: numOrEmpty_(ev.treffpunkt_lng),
      treff_time: toTimeString_(ev.treff_time),
      start_time: toTimeString_(ev.start_time),
      end_time: toTimeString_(ev.end_time),
      organizer: String(ev.organizer || ""),
      status: String(ev.status || ""),
      stats: stats,
    };
  }).sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
}

function numOrEmpty_(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function eventDetail_(params) {
  const id = String((params && params.id) || "").trim();
  if (!id) return { error: "id required" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.events, EVENT_HEADER);
  ensureSheet_(ss, SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  ensureSheet_(ss, SHEETS.event_squads, EVENT_SQUAD_HEADER);
  const ev = readSheet_(SHEETS.events, EVENT_HEADER)
    .find(function (e) { return String(e.id) === id; });
  if (!ev) return { error: "not found" };
  const hunters = readSheet_(SHEETS.event_hunters, EVENT_HUNTER_HEADER)
    .filter(function (h) { return String(h.event_id) === id; })
    .map(function (h) {
      let dogs = [];
      try { dogs = JSON.parse(String(h.dogs || "[]")); } catch (e) {}
      let lang = String(h.language || "").trim().toLowerCase();
      if (lang !== "de" && lang !== "en") lang = "de";
      return {
        id: String(h.id),
        hunter: String(h.hunter || ""),
        email: String(h.email || ""),
        language: lang,
        status: String(h.status || "pending"),
        role: String(h.role || ""),
        dogs: Array.isArray(dogs) ? dogs : [],
        invited_at: String(h.invited_at || ""),
        responded_at: String(h.responded_at || ""),
      };
    });
  const squads = readSheet_(SHEETS.event_squads, EVENT_SQUAD_HEADER)
    .filter(function (s) { return String(s.event_id) === id; })
    .map(function (s) {
      let positions = [];
      try { positions = JSON.parse(String(s.positions || "[]")); } catch (e) {}
      let startPos = null;
      try {
        const raw = String(s.start_pos || "").trim();
        startPos = raw ? JSON.parse(raw) : null;
      } catch (e) {}
      const groupType = String(s.type || "").trim().toLowerCase() || "ansteller";
      return {
        id: String(s.id),
        name: String(s.name || ""),
        type: (groupType === "treiber") ? "treiber" : "ansteller",
        ansteller: String(s.ansteller || ""),
        positions: Array.isArray(positions) ? positions : [],
        briefing: String(s.briefing || ""),
        start_pos: (startPos && typeof startPos === "object") ? startPos : null,
      };
    });
  let nsfList = [];
  try { nsfList = JSON.parse(String(ev.nachsuchenfuehrer || "[]")); } catch (e) {}
  // freigaben: empty string in the sheet = "not yet configured", we
  // return null in that case so the frontend can fall back to "all on";
  // a JSON array (even empty) means the organizer made a choice.
  let freigabenList = null;
  const rawFreigaben = String(ev.freigaben || "").trim();
  if (rawFreigaben) {
    try {
      const parsed = JSON.parse(rawFreigaben);
      if (Array.isArray(parsed)) freigabenList = parsed.map(String);
    } catch (e) { /* leave as null on parse error */ }
  }
  return {
    event: {
      id: String(ev.id),
      name: String(ev.name || ""),
      date: toDateString_(ev.date),
      teilgebiet: String(ev.teilgebiet || ""),
      art: huntKind_(ev.art),
      rsvp_deadline: toDateString_(ev.rsvp_deadline),
      treffpunkt: String(ev.treffpunkt || ""),
      treffpunkt_lat: numOrEmpty_(ev.treffpunkt_lat),
      treffpunkt_lng: numOrEmpty_(ev.treffpunkt_lng),
      treff_time: toTimeString_(ev.treff_time),
      start_time: toTimeString_(ev.start_time),
      end_time: toTimeString_(ev.end_time),
      briefing: String(ev.briefing || ""),
      organizer: String(ev.organizer || ""),
      status: String(ev.status || ""),
      vet_name: String(ev.vet_name || ""),
      vet_phone: String(ev.vet_phone || ""),
      coordinator_name: String(ev.coordinator_name || ""),
      coordinator_phone: String(ev.coordinator_phone || ""),
      nachsuchenfuehrer: Array.isArray(nsfList) ? nsfList : [],
      freigaben: freigabenList,
    },
    hunters: hunters,
    squads: squads,
    freigaben_matrix: FREIGABEN_MATRIX,
  };
}

function eventCreate_(body) {
  const name = String(body.name || "").trim();
  if (!name) return { error: "name required" };
  const date = String(body.date || "").trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "valid date (YYYY-MM-DD) required" };
  const id = "EVT-" + Date.now().toString(36).toUpperCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.events, EVENT_HEADER);
  // Nachsuchenführer is a list of {name, phone} — store as JSON so the row
  // stays one cell wide even when the organizer adds many.
  let nsfList = [];
  if (Array.isArray(body.nachsuchenfuehrer)) {
    nsfList = body.nachsuchenfuehrer
      .map(function (p) {
        return { name: String(p && p.name || "").trim(), phone: String(p && p.phone || "").trim() };
      })
      .filter(function (p) { return p.name || p.phone; })
      .slice(0, 20);
  }
  appendByName_(sheet, {
    id: id,
    created_at: new Date().toISOString(),
    name: name,
    date: date,
    teilgebiet: String(body.teilgebiet || "").trim(),
    art: huntKind_(body.art),
    rsvp_deadline: String(body.rsvp_deadline || "").trim(),
    treffpunkt: String(body.treffpunkt || "").trim(),
    treffpunkt_lat: numOrEmpty_(body.treffpunkt_lat),
    treffpunkt_lng: numOrEmpty_(body.treffpunkt_lng),
    treff_time: String(body.treff_time || "").trim(),
    start_time: String(body.start_time || "").trim(),
    end_time: String(body.end_time || "").trim(),
    briefing: String(body.briefing || "").trim(),
    organizer: String(body.organizer || "").trim(),
    status: "draft",
    vet_name: String(body.vet_name || "").trim(),
    vet_phone: String(body.vet_phone || "").trim(),
    coordinator_name: String(body.coordinator_name || "").trim(),
    coordinator_phone: String(body.coordinator_phone || "").trim(),
    nachsuchenfuehrer: JSON.stringify(nsfList),
  });
  return { ok: true, id: id };
}

// Update an existing event in place. Writes only the columns we care
// about so unrelated fields (created_at, status, id) stay untouched.
function eventUpdate_(body) {
  const id = String(body.id || "").trim();
  if (!id) return { error: "id required" };
  const name = String(body.name || "").trim();
  if (!name) return { error: "name required" };
  const date = String(body.date || "").trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "valid date (YYYY-MM-DD) required" };

  let nsfList = [];
  if (Array.isArray(body.nachsuchenfuehrer)) {
    nsfList = body.nachsuchenfuehrer
      .map(function (p) {
        return { name: String(p && p.name || "").trim(), phone: String(p && p.phone || "").trim() };
      })
      .filter(function (p) { return p.name || p.phone; })
      .slice(0, 20);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.events, EVENT_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: "not found" };
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const idCol = headers.indexOf("id");
  if (idCol < 0) return { error: "schema: id column missing" };
  const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  let rowIdx = -1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) { rowIdx = i + 2; break; }
  }
  if (rowIdx < 0) return { error: "not found" };

  const update = {
    name: name,
    date: date,
    teilgebiet: String(body.teilgebiet || "").trim(),
    art: huntKind_(body.art),
    rsvp_deadline: String(body.rsvp_deadline || "").trim(),
    treffpunkt: String(body.treffpunkt || "").trim(),
    treffpunkt_lat: numOrEmpty_(body.treffpunkt_lat),
    treffpunkt_lng: numOrEmpty_(body.treffpunkt_lng),
    treff_time: String(body.treff_time || "").trim(),
    start_time: String(body.start_time || "").trim(),
    end_time: String(body.end_time || "").trim(),
    briefing: String(body.briefing || "").trim(),
    organizer: String(body.organizer || "").trim(),
    vet_name: String(body.vet_name || "").trim(),
    vet_phone: String(body.vet_phone || "").trim(),
    coordinator_name: String(body.coordinator_name || "").trim(),
    coordinator_phone: String(body.coordinator_phone || "").trim(),
    nachsuchenfuehrer: JSON.stringify(nsfList),
  };
  Object.keys(update).forEach(function (k) {
    const c = headers.indexOf(k);
    if (c >= 0) sheet.getRange(rowIdx, c + 1).setValue(update[k]);
  });
  return { ok: true, id: id };
}

function eventHunterAdd_(body) {
  const eventId = String(body.event_id || "").trim();
  const hunter = String(body.hunter || "").trim();
  const email = String(body.email || "").trim();
  let language = String(body.language || "").trim().toLowerCase();
  if (language !== "de" && language !== "en") language = "de";
  if (!eventId) return { error: "event_id required" };
  if (!hunter) return { error: "hunter required" };
  if (!email) return { error: "E-Mail erforderlich" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Ungültige E-Mail-Adresse" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  // Reject duplicate (same event, same hunter name).
  const existing = readSheet_(SHEETS.event_hunters, EVENT_HUNTER_HEADER)
    .find(function (h) {
      return String(h.event_id) === eventId &&
             String(h.hunter).toLowerCase() === hunter.toLowerCase();
    });
  if (existing) return { error: hunter + " ist bereits auf der Liste" };
  const id = "EH-" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
  appendByName_(sheet, {
    id: id,
    event_id: eventId,
    hunter: hunter,
    email: email,
    language: language,
    token: randomToken_(),
    status: "pending",
    invited_at: "",
    responded_at: "",
  });
  // Upsert into the address book so future events can pick it from a list.
  addressBookUpsert_(hunter, email, language);
  return { ok: true, id: id };
}

// Batch-add several hunters (from a CSV import or address-book selection)
// in one call. Returns counts + per-row errors so the UI can summarise.
function eventHuntersBatchAdd_(body) {
  const eventId = String(body.event_id || "").trim();
  if (!eventId) return { error: "event_id required" };
  const rows = Array.isArray(body.hunters) ? body.hunters : [];
  let added = 0;
  const errors = [];
  const skipped = [];
  for (let i = 0; i < rows.length && i < 200; i++) {
    const r = rows[i] || {};
    const result = eventHunterAdd_({
      event_id: eventId,
      hunter: r.name || r.hunter || "",
      email: r.email || "",
      language: r.language || "de",
    });
    if (result.error) {
      // Duplicates are a quiet skip rather than a loud error.
      if (/bereits auf der Liste/.test(result.error)) skipped.push(r.name || r.email || "");
      else errors.push({ name: r.name || r.email || "(unbekannt)", error: result.error });
    } else {
      added++;
    }
  }
  return { ok: true, added: added, skipped: skipped, errors: errors };
}

function eventHunterRemove_(body) {
  const id = String(body.id || "").trim();
  if (!id) return { error: "id required" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: "not found" };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      sheet.deleteRow(i + 2);
      return { ok: true };
    }
  }
  return { error: "not found" };
}

function eventInvitesSend_(body) {
  const eventId = String(body.event_id || "").trim();
  if (!eventId) return { error: "event_id required" };
  const onlyUnsent = body.only_unsent !== false; // default true
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const eventsSheet = ensureSheet_(ss, SHEETS.events, EVENT_HEADER);
  const huntersSheet = ensureSheet_(ss, SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  const rawEv = readSheet_(SHEETS.events, EVENT_HEADER)
    .find(function (e) { return String(e.id) === eventId; });
  if (!rawEv) return { error: "event not found" };
  const ev = normalizeEventDates_(rawEv);
  const baseUrl = String(body.base_url || "").trim();
  if (!baseUrl) return { error: "base_url required (the site origin so the magic-link works)" };

  // Per-language overrides from the preview-and-edit modal. Each must
  // contain the literal token {link} where the magic URL is substituted;
  // we append it automatically if the organizer accidentally stripped it.
  function prepBody(raw, fallback) {
    let t = String(raw || "").trim();
    if (!t) t = fallback;
    if (t.indexOf("{link}") < 0) t += "\n\n{link}";
    return t;
  }
  const subjectDe = String(body.subject_de || body.subject || "").trim() || inviteSubject_(ev);
  const subjectEn = String(body.subject_en || "").trim() || inviteSubjectEn_(ev);
  const bodyTemplateDe = prepBody(body.body_text_de || body.body_text || "", inviteEmailBodyTemplate_(ev));
  const bodyTemplateEn = prepBody(body.body_text_en || "", inviteEmailBodyTemplateEn_(ev));

  const rows = huntersSheet.getRange(2, 1, Math.max(huntersSheet.getLastRow() - 1, 0), EVENT_HUNTER_HEADER.length).getValues();
  const headers = huntersSheet.getRange(1, 1, 1, EVENT_HUNTER_HEADER.length).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const colEventId = headers.indexOf("event_id");
  const colEmail = headers.indexOf("email");
  const colHunter = headers.indexOf("hunter");
  const colToken = headers.indexOf("token");
  const colStatus = headers.indexOf("status");
  const colLanguage = headers.indexOf("language");
  const colInvitedAt = headers.indexOf("invited_at");

  let sent = 0, skipped = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][colEventId]) !== eventId) continue;
    const email = String(rows[i][colEmail] || "").trim();
    if (!email) { skipped++; continue; }
    const invitedAt = String(rows[i][colInvitedAt] || "").trim();
    if (onlyUnsent && invitedAt) { skipped++; continue; }
    const hunter = String(rows[i][colHunter] || "");
    const hunterLang = colLanguage >= 0
      ? String(rows[i][colLanguage] || "").trim().toLowerCase()
      : "de";
    const useEn = hunterLang === "en";
    const subject = useEn ? subjectEn : subjectDe;
    const bodyTemplate = useEn ? bodyTemplateEn : bodyTemplateDe;
    const token = String(rows[i][colToken] || "") || randomToken_();
    if (!String(rows[i][colToken] || "").trim()) {
      huntersSheet.getRange(i + 2, colToken + 1).setValue(token);
    }
    const link = baseUrl.replace(/\/+$/, "") + "/rsvp.html?t=" + encodeURIComponent(token);
    const forename = forenameFor_(hunter);
    const personalized = bodyTemplate.split("{forename}").join(forename);
    const plainBody = inviteBodyToPlain_(personalized, link);
    const htmlBody = inviteBodyToHtml_(personalized, link);
    try {
      // GmailApp honors the alias `from`; MailApp would silently fall
       // back to the script owner.
      GmailApp.sendEmail(email, subject, plainBody, { from: FROM_EMAIL, htmlBody: htmlBody });
      huntersSheet.getRange(i + 2, colInvitedAt + 1).setValue(new Date().toISOString());
      if (String(rows[i][colStatus] || "").toLowerCase() !== "accepted" &&
          String(rows[i][colStatus] || "").toLowerCase() !== "declined") {
        huntersSheet.getRange(i + 2, colStatus + 1).setValue("invited");
      }
      sent++;
    } catch (err) {
      errors.push({ hunter: hunter, error: String(err && err.message || err) });
    }
  }
  // Flip the event status to "open" once at least one invitation has gone out.
  if (sent > 0 && String(ev.status || "") === "draft") {
    const evRows = eventsSheet.getRange(2, 1, eventsSheet.getLastRow() - 1, EVENT_HEADER.length).getValues();
    const evHeaders = eventsSheet.getRange(1, 1, 1, EVENT_HEADER.length).getValues()[0]
      .map(function (s) { return String(s).trim(); });
    const idCol = evHeaders.indexOf("id");
    const statusCol = evHeaders.indexOf("status");
    for (let i = 0; i < evRows.length; i++) {
      if (String(evRows[i][idCol]) === eventId) {
        eventsSheet.getRange(i + 2, statusCol + 1).setValue("open");
        break;
      }
    }
  }
  return { ok: true, sent: sent, skipped: skipped, errors: errors };
}

// Built-in default invitation templates. Saved overrides live in Script
// Properties ("invite_tpl_de_subject", "invite_tpl_de_body", same for _en);
// when present they replace the defaults below for every event.
//
// Placeholders the template may use:
//   {forename} {link}                — per recipient, filled at send time
//   {event_name} {date} {revier}     — event-level, filled when previewing
//   {teilgebiet} {teilgebiete_satz}    or sending
//   {rsvp_deadline} {written_invite_date} {organizer}
const DEFAULT_INVITE_DE = {
  subject: "Einladung Drückjagd: {event_name}",
  body: [
    "Hallo **{forename}**,",
    "",
    "ich möchte Dich recht herzlich zur nächsten Drückjagd in **{revier}** am **{date}** einladen.{teilgebiete_satz}",
    "",
    "Ich bitte Dich, mir bis zum **{rsvp_deadline}** eine verbindliche Zusage zu machen, wenn und in welcher Funktion Du teilnehmen möchtest (Schütze/Treiber/Hundeführer). Nutze dafür bitte ausschließlich diesen Anmeldelink:",
    "",
    "{link}",
    "",
    "Treiber kannst Du gerne mitbringen, bitte vorher mit Namen anmelden.",
    "",
    "Im Laufe des **{written_invite_date}** (zwei Wochen vorher) bekommst Du von mir eine schriftliche Einladung, der Du alle Details zur Anreise und zum Ablauf entnehmen kannst.",
    "",
    "Ich freue mich, wenn Du dabei bist und wir waidgerecht und mit Freude gemeinsam Beute machen. Horrido!",
    "",
    "Dein **{organizer}**",
  ].join("\n"),
};

const DEFAULT_INVITE_EN = {
  subject: "Invitation — driven hunt: {event_name}",
  body: [
    "Hi **{forename}**,",
    "",
    "I would like to cordially invite you to the next driven hunt (Drückjagd) in **{revier}** on **{date}**.{teilgebiete_satz}",
    "",
    "Please confirm your participation by **{rsvp_deadline}** and let me know in what capacity you would like to take part (Schütze / Treiber / Hundeführer — shooter / beater / dog handler). Please use only this link:",
    "",
    "{link}",
    "",
    "Beaters may be brought along, please register them by name beforehand.",
    "",
    "On or around **{written_invite_date}** (two weeks before) I will send you a written invitation with the details of arrival and schedule.",
    "",
    "Looking forward to having you join us — may we hunt fairly and with joy. Horrido!",
    "",
    "Yours, **{organizer}**",
  ].join("\n"),
};

function inviteTemplatePropKeys_(lang) {
  const l = (lang === "en") ? "en" : "de";
  return { subject: "invite_tpl_" + l + "_subject", body: "invite_tpl_" + l + "_body" };
}

// Returns the raw template (with placeholders intact). Falls back to the
// built-in default for any field the organizer hasn't customised.
function getInviteTemplate_(lang) {
  const fallback = (lang === "en") ? DEFAULT_INVITE_EN : DEFAULT_INVITE_DE;
  const keys = inviteTemplatePropKeys_(lang);
  const props = PropertiesService.getScriptProperties();
  const subject = props.getProperty(keys.subject);
  const body = props.getProperty(keys.body);
  return {
    subject: (subject && subject.trim()) ? subject : fallback.subject,
    body: (body && body.trim()) ? body : fallback.body,
    using_default_subject: !subject || !subject.trim(),
    using_default_body: !body || !body.trim(),
  };
}

function setInviteTemplate_(lang, subject, body) {
  const keys = inviteTemplatePropKeys_(lang);
  const props = PropertiesService.getScriptProperties();
  // Empty string → restore the built-in default.
  if (subject && String(subject).trim()) props.setProperty(keys.subject, String(subject));
  else props.deleteProperty(keys.subject);
  if (body && String(body).trim()) props.setProperty(keys.body, String(body));
  else props.deleteProperty(keys.body);
}

// Substitute event-level placeholders. {forename} and {link} stay in the
// output for per-recipient substitution at send time.
function fillEventPlaceholders_(template, ev, lang) {
  const isEn = (lang === "en");
  const eventDate = isEn ? formatLongEnglishDate_(ev.date) : formatGermanDate_(ev.date);
  const twoWeeksBefore = addDays_(ev.date, -14);
  const rsvpDeadline = isEn
    ? formatLongEnglishDate_(ev.rsvp_deadline || twoWeeksBefore)
    : formatGermanDate_(ev.rsvp_deadline || twoWeeksBefore);
  const writtenInvite = isEn ? formatLongEnglishDate_(twoWeeksBefore) : formatGermanDate_(twoWeeksBefore);
  const teilgebiet = String(ev.teilgebiet || "").trim();
  const revier = revierFromTeilgebiete_(teilgebiet);
  const teilgebieteSatz = teilgebiet
    ? " " + (isEn ? teilgebietSentenceEn_(teilgebiet) : teilgebietSentence_(teilgebiet))
    : "";
  const organizer = String(ev.organizer || "").trim() || "Jakob";
  const fallbackOpen = isEn ? "[to be confirmed]" : "[noch offen]";
  const treffpunkt = String(ev.treffpunkt || "").trim();
  const tpLat = numOrEmpty_(ev.treffpunkt_lat);
  const tpLng = numOrEmpty_(ev.treffpunkt_lng);
  const treffpunktMap = (tpLat !== "" && tpLng !== "")
    ? "https://www.google.com/maps?q=" + tpLat + "," + tpLng
    : "";
  return String(template || "")
    .split("{event_name}").join(String(ev.name || ""))
    .split("{date}").join(eventDate || fallbackOpen)
    .split("{revier}").join(revier || "Peenwerder")
    .split("{teilgebiet}").join(teilgebiet)
    .split("{teilgebiete_satz}").join(teilgebieteSatz)
    .split("{treffpunkt}").join(treffpunkt)
    .split("{treffpunkt_map}").join(treffpunktMap)
    .split("{rsvp_deadline}").join(rsvpDeadline || fallbackOpen)
    .split("{written_invite_date}").join(writtenInvite || fallbackOpen)
    .split("{organizer}").join(organizer);
}

function inviteEmailBodyTemplate_(ev) {
  return fillEventPlaceholders_(getInviteTemplate_("de").body, ev, "de");
}

// Render the editable plain-text body into HTML for the actual email so the
// **bold** markers turn into real <b> emphasis. Plain-text fallback strips
// the markers so subscribers without HTML still see clean text. The light
// sans-serif inline style mirrors how the preview textarea looks in the UI.
function inviteBodyToHtml_(text, linkUrl) {
  let html = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const safeUrl = String(linkUrl || "").replace(/"/g, "&quot;");
  const anchor = '<a href="' + safeUrl + '" style="color:#1a5f1a;">' + safeUrl + '</a>';
  html = html.split("{link}").join(anchor);
  html = html.split("\n").join("<br>\n");
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Helvetica Neue\',\'Segoe UI\',sans-serif;' +
         'font-weight:400;line-height:1.55;color:#232323;font-size:15px;max-width:640px;">' +
         html + '</div>';
}

// First whitespace-separated word of the hunter's name. "Klaus Müller"
// → "Klaus"; "Klaus-Peter Müller" → "Klaus-Peter" (hyphen stays in the
// first token). Used to personalize the email greeting.
function forenameFor_(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function inviteBodyToPlain_(text, linkUrl) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .split("{link}").join(String(linkUrl || ""));
}

function inviteSubject_(ev) {
  return fillEventPlaceholders_(getInviteTemplate_("de").subject, ev, "de");
}

function inviteEmailBodyTemplateEn_(ev) {
  return fillEventPlaceholders_(getInviteTemplate_("en").body, ev, "en");
}

function inviteSubjectEn_(ev) {
  return fillEventPlaceholders_(getInviteTemplate_("en").subject, ev, "en");
}

function teilgebietSentenceEn_(raw) {
  const parts = String(raw || "").split(/\s*,\s*/).filter(function (p) { return p; });
  if (parts.length === 0) return "";
  if (parts.length === 1) return "We will hunt the area **" + parts[0] + "**.";
  const bold = parts.map(function (p) { return "**" + p + "**"; });
  const last = bold[bold.length - 1];
  const head = bold.slice(0, -1).join(", ");
  return "We will hunt the areas " + head + " and " + last + ".";
}

function formatLongEnglishDate_(isoDate) {
  const s = String(isoDate || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  const day = parseInt(m[3], 10);
  const suffix = (day >= 11 && day <= 13) ? "th"
              : (day % 10 === 1) ? "st"
              : (day % 10 === 2) ? "nd"
              : (day % 10 === 3) ? "rd" : "th";
  return MONTHS[parseInt(m[2], 10) - 1] + " " + day + suffix + ", " + m[1];
}

// Returns the editable default invitation template (with placeholders
// intact) for a given language. Frontend uses this for the Einladungsentwurf
// modal on the events overview.
function inviteTemplateGetEndpoint_(params) {
  const lang = String((params && params.language) || "de").toLowerCase();
  if (lang !== "de" && lang !== "en") return { error: "language must be de or en" };
  const tpl = getInviteTemplate_(lang);
  return {
    language: lang,
    subject: tpl.subject,
    body: tpl.body,
    using_default_subject: tpl.using_default_subject,
    using_default_body: tpl.using_default_body,
    // Also expose the placeholder reference so the UI doesn't have to
    // hard-code it; keeps the help text in one place.
    placeholders: [
      { name: "{forename}",            doc: "Vorname des Empfängers (pro Person)" },
      { name: "{link}",                doc: "persönlicher Anmeldelink (pro Person)" },
      { name: "{event_name}",          doc: "Name der Jagd" },
      { name: "{date}",                doc: "Datum der Jagd" },
      { name: "{revier}",              doc: "Revier (z.B. Peenwerder)" },
      { name: "{teilgebiet}",          doc: "Liste der Teilgebiete" },
      { name: "{teilgebiete_satz}",    doc: 'kompletter Satz „Wir bejagen das Teilgebiet …"' },
      { name: "{treffpunkt}",          doc: "Name des Treffpunkts (z.B. Forsthalle Rützenfelde)" },
      { name: "{treffpunkt_map}",      doc: "Google-Maps-Link zum Treffpunkt (leer wenn keine Koordinaten gesetzt)" },
      { name: "{rsvp_deadline}",       doc: "Anmeldeschluss" },
      { name: "{written_invite_date}", doc: "Datum der schriftlichen Einladung (2 Wochen vorher)" },
      { name: "{organizer}",           doc: "Name des Organisators" },
    ],
  };
}

function inviteTemplateSaveEndpoint_(body) {
  const lang = String((body && body.language) || "de").toLowerCase();
  if (lang !== "de" && lang !== "en") return { error: "language must be de or en" };
  // Empty string explicitly restores the built-in default.
  const subject = body.subject == null ? "" : String(body.subject);
  const text = body.body == null ? "" : String(body.body);
  setInviteTemplate_(lang, subject, text);
  return { ok: true, language: lang };
}

// Public preview endpoint — frontend uses this to show the editable email
// before sending so the organizer can amend wording. The language param
// switches between the German default and the English variant for guests.
function invitePreview_(params) {
  const id = String((params && params.event_id) || "").trim();
  if (!id) return { error: "event_id required" };
  const lang = String((params && params.language) || "de").toLowerCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.events, EVENT_HEADER);
  const raw = readSheet_(SHEETS.events, EVENT_HEADER)
    .find(function (e) { return String(e.id) === id; });
  if (!raw) return { error: "event not found" };
  const ev = normalizeEventDates_(raw);
  if (lang === "en") {
    return { subject: inviteSubjectEn_(ev), body: inviteEmailBodyTemplateEn_(ev) };
  }
  return { subject: inviteSubject_(ev), body: inviteEmailBodyTemplate_(ev) };
}

// Strip Google Sheets' Date typing on the four date/time columns so anything
// that consumes `ev` (the email template, formatters) sees ISO strings.
// Endpoint: save just the Freigaben selection for an event without
// touching anything else on the row. Used by the per-event Freigaben
// editor that lives on the event detail page.
function eventFreigabenSave_(body) {
  const eventId = String(body.event_id || "").trim();
  if (!eventId) return { error: "event_id required" };
  const selected = Array.isArray(body.freigaben)
    ? body.freigaben.map(function (k) { return String(k); })
    : [];
  saveEventFreigaben_(eventId, selected);
  return { ok: true };
}

// Saves the Freigaben selection (array of "species.group.ak" tokens) to
// the event row. Tolerates the column not existing yet by relying on
// ensureSheet_'s additive migration.
function saveEventFreigaben_(eventId, selected) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.events, EVENT_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const headerWidth = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, headerWidth).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const colId = headers.indexOf("id");
  const colFreigaben = headers.indexOf("freigaben");
  if (colId < 0 || colFreigaben < 0) return;
  const ids = sheet.getRange(2, colId + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === eventId) {
      sheet.getRange(i + 2, colFreigaben + 1).setValue(JSON.stringify(selected));
      return;
    }
  }
}

function normalizeEventDates_(ev) {
  if (!ev) return ev;
  return {
    id: ev.id,
    name: ev.name,
    date: toDateString_(ev.date),
    teilgebiet: ev.teilgebiet,
    rsvp_deadline: toDateString_(ev.rsvp_deadline),
    treffpunkt: ev.treffpunkt,
    treffpunkt_lat: numOrEmpty_(ev.treffpunkt_lat),
    treffpunkt_lng: numOrEmpty_(ev.treffpunkt_lng),
    treff_time: toTimeString_(ev.treff_time),
    start_time: toTimeString_(ev.start_time),
    end_time: toTimeString_(ev.end_time),
    briefing: ev.briefing,
    organizer: ev.organizer,
    status: ev.status,
    vet_name: ev.vet_name,
    vet_phone: ev.vet_phone,
    coordinator_name: ev.coordinator_name,
    coordinator_phone: ev.coordinator_phone,
    nachsuchenfuehrer: ev.nachsuchenfuehrer,
    freigaben: ev.freigaben,
  };
}

// Each Teilgebiet belongs to one Revier; the invitation needs to mention
// which Revier the hunt is on (e.g. "Drückjagd in Peenwerder" vs
// "Drückjagd in NPA-Müritz"). Anything unknown falls back to Peenwerder
// for backward-compat with existing event rows.
const REVIER_FOR_AREA = {
  "Hauptrevier": "Peenwerder",
  "Ost": "Peenwerder",
  "Nord": "Peenwerder",
  "Nordrand": "Peenwerder",
  "Babke": "NPA-Müritz",
  "Langenhagen": "NPA-Müritz",
  "Schwarzenhof": "NPA-Müritz",
  "Serrahn": "NPA-Müritz",
};

function revierFromTeilgebiete_(raw) {
  const parts = String(raw || "").split(/\s*,\s*/).filter(function (p) { return p; });
  const reviere = [];
  for (let i = 0; i < parts.length; i++) {
    const r = REVIER_FOR_AREA[parts[i]] || "Peenwerder";
    if (reviere.indexOf(r) === -1) reviere.push(r);
  }
  if (reviere.length === 0) return "Peenwerder";
  if (reviere.length === 1) return reviere[0];
  // "Peenwerder und NPA-Müritz"
  return reviere.slice(0, -1).join(", ") + " und " + reviere[reviere.length - 1];
}

// "Hauptrevier" → "Wir bejagen das Teilgebiet **Hauptrevier**."
// "Hauptrevier, Ost" → "Wir bejagen die Teilgebiete **Hauptrevier** und **Ost**."
// **markers are rendered as <b>…</b> in the HTML email and stripped for the
// plain-text fallback. See inviteBodyToHtml_ / inviteBodyToPlain_.
function teilgebietSentence_(raw) {
  const parts = String(raw || "").split(/\s*,\s*/).filter(function (p) { return p; });
  if (parts.length === 0) return "";
  if (parts.length === 1) return "Wir bejagen das Teilgebiet **" + parts[0] + "**.";
  const bold = parts.map(function (p) { return "**" + p + "**"; });
  const last = bold[bold.length - 1];
  const head = bold.slice(0, -1).join(", ");
  return "Wir bejagen die Teilgebiete " + head + " und " + last + ".";
}

function formatGermanDate_(isoDate) {
  const s = String(isoDate || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni",
                  "Juli", "August", "September", "Oktober", "November", "Dezember"];
  return parseInt(m[3], 10) + ". " + MONTHS[parseInt(m[2], 10) - 1] + " " + m[1];
}

// Google Sheets auto-types date and time cells as JS Date objects, so a
// "2026-12-12" cell comes back as `Sat Dec 12 2026 00:00:00 GMT+0100 …` when
// stringified. These helpers re-format dates back to ISO YYYY-MM-DD and
// times to HH:mm, using the spreadsheet's own timezone so a 07:30 cell
// doesn't drift to 06:30 in UTC.
function toDateString_(v) {
  if (!v && v !== 0) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || "Europe/Berlin", "yyyy-MM-dd");
  }
  return String(v).trim();
}

function toTimeString_(v) {
  if (!v && v !== 0) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || "Europe/Berlin", "HH:mm");
  }
  return String(v).trim();
}

function addDays_(isoDate, days) {
  const s = String(isoDate || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return yyyy + "-" + mm + "-" + dd;
}

function rsvpInfo_(params) {
  const token = String((params && params.token) || "").trim();
  if (!token) return { error: "token required" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  const eh = readSheet_(SHEETS.event_hunters, EVENT_HUNTER_HEADER)
    .find(function (h) { return String(h.token) === token; });
  if (!eh) return { error: "invalid token" };
  const ev = readSheet_(SHEETS.events, EVENT_HEADER)
    .find(function (e) { return String(e.id) === String(eh.event_id); });
  if (!ev) return { error: "event not found" };
  let dogs = [];
  try { dogs = JSON.parse(String(eh.dogs || "[]")); } catch (e) {}
  let lang = String(eh.language || "").trim().toLowerCase();
  if (lang !== "de" && lang !== "en") lang = "de";
  return {
    hunter: String(eh.hunter || ""),
    status: String(eh.status || ""),
    role: String(eh.role || ""),
    language: lang,
    dogs: Array.isArray(dogs) ? dogs : [],
    breeds: DOG_BREEDS,
    event: {
      name: String(ev.name || ""),
      date: toDateString_(ev.date),
      art: huntKind_(ev.art),
      teilgebiet: String(ev.teilgebiet || ""),
      rsvp_deadline: toDateString_(ev.rsvp_deadline),
      treffpunkt: String(ev.treffpunkt || ""),
      treff_time: toTimeString_(ev.treff_time),
      start_time: toTimeString_(ev.start_time),
      end_time: toTimeString_(ev.end_time),
      briefing: String(ev.briefing || ""),
      organizer: String(ev.organizer || ""),
    },
  };
}

function rsvpRespond_(body) {
  const token = String(body.token || "").trim();
  const choiceRaw = String(body.choice || "").toLowerCase();
  if (!token) return { error: "token required" };
  const choice = (choiceRaw === "accept" || choiceRaw === "accepted") ? "accepted"
              : (choiceRaw === "decline" || choiceRaw === "declined") ? "declined"
              : "";
  if (!choice) return { error: "choice must be accept or decline" };
  // Role is only meaningful on accept; allowlisted so the sheet doesn't
  // fill with free-form junk. Older spellings ("Schütze", "Schütze/
  // Standschneller") are still accepted and normalised so any existing
  // RSVPs aren't invalidated.
  const VALID_ROLES = {
    "Schütze/Standschnaller": 1,
    "Schütze/Standschneller": 1,
    "Schütze": 1,
    "Treiber": 1,
    "Hundeführer": 1,
  };
  let role = String(body.role || "").trim();
  if (role && !VALID_ROLES[role]) role = "";
  if (role === "Schütze" || role === "Schütze/Standschneller") role = "Schütze/Standschnaller";
  if (choice === "declined") role = "";

  // Dogs are optional and only valid for the two roles that can bring them.
  let dogs = [];
  if (choice === "accepted" && (role === "Schütze/Standschnaller" || role === "Hundeführer") &&
      Array.isArray(body.dogs)) {
    const allowed = {};
    for (let k = 0; k < DOG_BREEDS.length; k++) allowed[DOG_BREEDS[k]] = 1;
    for (let k = 0; k < body.dogs.length && dogs.length < 8; k++) {
      const d = body.dogs[k] || {};
      const breed = String(d.breed || "").trim();
      const count = Math.max(1, Math.min(10, parseInt(d.count, 10) || 1));
      if (breed && allowed[breed]) dogs.push({ breed: breed, count: count });
    }
  }

  // Liability paper trail: on accept we expect both confirmations
  // (valid Jagdschein + VSG 4.4 acknowledged). Each is written as the
  // ISO timestamp of the response, or left blank if missing. Declines
  // clear any previously-recorded confirmations because they no longer
  // apply.
  const now = new Date().toISOString();
  const confirmedJs = (choice === "accepted" && truthy_(body.confirmed_jagdschein)) ? now : "";
  const confirmedVsg = (choice === "accepted" && truthy_(body.confirmed_vsg44)) ? now : "";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: "not found" };
  const headerWidth = sheet.getLastColumn();
  const rows = sheet.getRange(2, 1, lastRow - 1, headerWidth).getValues();
  const headers = sheet.getRange(1, 1, 1, headerWidth).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const colToken = headers.indexOf("token");
  const colStatus = headers.indexOf("status");
  const colRole = headers.indexOf("role");
  const colDogs = headers.indexOf("dogs");
  const colResponded = headers.indexOf("responded_at");
  const colConfirmedJs = headers.indexOf("confirmed_jagdschein");
  const colConfirmedVsg = headers.indexOf("confirmed_vsg44");
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][colToken]) === token) {
      sheet.getRange(i + 2, colStatus + 1).setValue(choice);
      if (colRole >= 0) sheet.getRange(i + 2, colRole + 1).setValue(role);
      if (colDogs >= 0) sheet.getRange(i + 2, colDogs + 1).setValue(choice === "accepted" ? JSON.stringify(dogs) : "");
      sheet.getRange(i + 2, colResponded + 1).setValue(now);
      if (colConfirmedJs >= 0) sheet.getRange(i + 2, colConfirmedJs + 1).setValue(confirmedJs);
      if (colConfirmedVsg >= 0) sheet.getRange(i + 2, colConfirmedVsg + 1).setValue(confirmedVsg);
      return {
        ok: true,
        status: choice,
        role: role,
        dogs: dogs,
        confirmed_jagdschein: !!confirmedJs,
        confirmed_vsg44: !!confirmedVsg,
      };
    }
  }
  return { error: "not found" };
}

function truthy_(v) {
  if (v === true) return true;
  const s = String(v || "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "ja" || s === "on";
}

function eventSquadSave_(body) {
  const eventId = String(body.event_id || "").trim();
  if (!eventId) return { error: "event_id required" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.event_squads, EVENT_SQUAD_HEADER);
  const name = String(body.name || "").trim();
  const ansteller = String(body.ansteller || "").trim();
  const briefing = String(body.briefing || "").trim();
  const groupType = (body.type === "treiber") ? "treiber" : "ansteller";

  // Treibergruppen carry an optional single starting position (where the
  // group meets before pushing into the area). Ansteller Runden ignore it.
  let startPosJson = "";
  if (groupType === "treiber" && body.start_pos && typeof body.start_pos === "object") {
    const lat = Number(body.start_pos.lat);
    const lng = Number(body.start_pos.lng);
    const label = String(body.start_pos.label || "").trim().slice(0, 60);
    if ((Number.isFinite(lat) && Number.isFinite(lng)) || label) {
      startPosJson = JSON.stringify({
        lat: Number.isFinite(lat) ? lat : "",
        lng: Number.isFinite(lng) ? lng : "",
        label: label,
      });
    }
  }

  // Ansteller-Runden positions carry Kanzel/Klettersitz; Treibergruppen
  // positions are just hunter names. We normalise both shapes here.
  const positions = Array.isArray(body.positions)
    ? body.positions
        .filter(function (p) { return p && String(p.hunter || "").trim(); })
        .map(function (p) {
          if (groupType === "treiber") {
            return { hunter: String(p.hunter || "").trim() };
          }
          const lat = Number(p.lat);
          const lng = Number(p.lng);
          return {
            hunter: String(p.hunter || "").trim(),
            type: p.type === "klettersitz" ? "klettersitz" : "kanzel",
            post_id: String(p.post_id || "").trim(),
            post_name: String(p.post_name || "").trim(),
            lat: Number.isFinite(lat) ? lat : "",
            lng: Number.isFinite(lng) ? lng : "",
            label: String(p.label || "").trim().slice(0, 60),
          };
        })
    : [];
  const positionsJson = JSON.stringify(positions);

  function writeRow(rowIdx /* 1-based sheet row */) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (s) { return String(s).trim(); });
    const update = {
      event_id: eventId,
      name: name,
      ansteller: ansteller,
      positions: positionsJson,
      briefing: briefing,
      type: groupType,
      start_pos: startPosJson,
    };
    Object.keys(update).forEach(function (k) {
      const c = headers.indexOf(k);
      if (c >= 0) sheet.getRange(rowIdx, c + 1).setValue(update[k]);
    });
  }

  const id = String(body.id || "").trim();
  if (id) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { error: "not found" };
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === id) {
        writeRow(i + 2);
        return { ok: true, id: id };
      }
    }
    return { error: "not found" };
  }
  const newId = "ES-" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
  appendByName_(sheet, {
    id: newId,
    event_id: eventId,
    name: name,
    ansteller: ansteller,
    positions: positionsJson,
    briefing: briefing,
    type: groupType,
    start_pos: startPosJson,
  });
  return { ok: true, id: newId };
}

// ---------- Per-Schütze info mails (2 weeks before the hunt) ----------
// One e-mail per accepted Schütze in every Ansteller Runde. The mail
// lists the runde's roster (recipient bolded) and embeds a satellite map
// with the runde's stands — recipient's stand red, the others yellow —
// fetched from the Google Static-Maps API.

function eventInfomailsPreview_(body) {
  const eventId = String(body.event_id || "").trim();
  if (!eventId) return { error: "event_id required" };
  const detail = eventDetail_({ id: eventId });
  if (detail.error) return detail;
  const ev = normalizeEventDates_(detail.event);
  const ansteller = (detail.squads || []).filter(function (s) { return (s.type || "ansteller") === "ansteller"; });
  const hunters = detail.hunters || [];
  const huntersByName = {};
  hunters.forEach(function (h) { huntersByName[(h.hunter || "").toLowerCase()] = h; });
  const posts = readPosts_();
  const postsById = {};
  posts.forEach(function (p) { postsById[p.id] = p; });

  let recipients = 0;
  let anstellerRecipients = 0; // count if Schützen are excluded from the send
  const noEmail = [];
  const notAccepted = [];
  let sample = null; // first eligible recipient — used for the preview render
  for (const squad of ansteller) {
    const positions = (squad.positions || []).filter(function (p) { return p && p.hunter; });
    for (let pi = 0; pi < positions.length; pi++) {
      const pos = positions[pi];
      const isAnsteller = pi === 0;
      const h = huntersByName[pos.hunter.toLowerCase()];
      if (!h) { noEmail.push(pos.hunter + " (kein Roster-Eintrag)"); continue; }
      if (!h.email) { noEmail.push(pos.hunter + " (keine E-Mail)"); continue; }
      if (h.status !== "accepted") { notAccepted.push(pos.hunter + " (Status: " + (h.status || "offen") + ")"); continue; }
      recipients++;
      if (isAnsteller) anstellerRecipients++;
      if (!sample) sample = { squad: squad, positions: positions, pos: pos, hunter: h };
    }
  }
  const props = PropertiesService.getScriptProperties();
  const hasGoogleKey = !!(props.getProperty("MAPS_API_KEY") || "").trim();
  const hasGeoapifyKey = !!(props.getProperty("GEOAPIFY_KEY") || "").trim();
  const hasMapboxToken = !!(props.getProperty("MAPBOX_TOKEN") || "").trim();
  // We can render a map if ANY provider is configured. Priority order:
  // Mapbox (full pin labels) → Geoapify (2-char pin labels) → Google composite.
  const hasMapKey = hasMapboxToken || hasGeoapifyKey || hasGoogleKey;

  // Render the first eligible recipient's actual email body + the PDF that
  // would be attached. The PDF is shipped to the client as base64 so it can
  // be embedded in an <iframe> data: URL preview.
  let sampleHtml = "";
  let sampleRecipient = "";
  let sampleSubject = "";
  let samplePdfBase64 = "";
  let samplePdfName = "";
  if (sample) {
    sampleHtml = buildInfoMailBodyHtml_(ev, sample.squad, sample.pos);
    sampleRecipient = sample.hunter.hunter + " <" + sample.hunter.email + ">";
    sampleSubject = "Info zur Drückjagd: " + ev.name + " — " + displayRundeNameServer_(sample.squad.name);
    if (hasMapKey) {
      try {
        // Match the send path: one PDF per Runde, no recipient-specific
        // red marker. The recipient's stand is identified via the
        // email body + the table row in the PDF.
        const pdfBlob = buildInfoMailPdf_(ev, sample.squad, sample.positions, null, postsById);
        if (pdfBlob) {
          samplePdfBase64 = Utilities.base64Encode(pdfBlob.getBytes());
          samplePdfName = pdfBlob.getName();
        }
      } catch (err) {
        // Surface PDF generation failures as a warning rather than blocking
        // the preview — admin can still see the email body.
        notAccepted.push("PDF-Vorschau fehlgeschlagen: " + (err && err.message || err));
      }
    }
  }
  // Freigaben: send the canonical AK matrix to the client so the
  // checkboxes can render, plus the saved selection from the event row
  // (or null → frontend defaults to "all on").
  return {
    ok: true,
    runden: ansteller.length,
    recipients: recipients,
    ansteller_recipients: anstellerRecipients,
    no_email: noEmail,
    not_accepted: notAccepted,
    has_maps_key: hasMapKey,
    map_provider: hasMapboxToken ? "mapbox" :
                   hasGeoapifyKey ? "geoapify" :
                   hasGoogleKey ? "google" : "none",
    sample_recipient: sampleRecipient,
    sample_subject: sampleSubject,
    sample_html: sampleHtml,
    sample_pdf_base64: samplePdfBase64,
    sample_pdf_name: samplePdfName,
    freigaben_matrix: FREIGABEN_MATRIX,
    freigaben_selected: Array.isArray(ev.freigaben) ? ev.freigaben : null,
  };
}

function eventInfomailsSend_(body) {
  const eventId = String(body.event_id || "").trim();
  if (!eventId) return { error: "event_id required" };
  const detail = eventDetail_({ id: eventId });
  if (detail.error) return detail;

  const ev = normalizeEventDates_(detail.event);
  const allHunters = detail.hunters || [];
  const ansteller = (detail.squads || []).filter(function (s) { return (s.type || "ansteller") === "ansteller"; });
  const posts = readPosts_();
  const postsById = {};
  posts.forEach(function (p) { postsById[p.id] = p; });
  const huntersByName = {};
  allHunters.forEach(function (h) { huntersByName[(h.hunter || "").toLowerCase()] = h; });

  // When ansteller_only is set, the Schützen (positions[1..n-1]) are
  // skipped; only the Ansteller (positions[0]) of each Runde receives
  // the mail. The PDF is still built once per Runde regardless.
  const anstellerOnly = truthy_(body.ansteller_only);

  // Freigaben checked in the modal: a flat array like
  // ["rotwild.hirsche.ak0", "rotwild.kuehe.ak0", …]. Persisted to the
  // event so re-opening the modal remembers the choice. Null/missing →
  // PDF builder renders the full matrix (legacy default).
  const freigabenSelected = Array.isArray(body.freigaben)
    ? body.freigaben.map(function (k) { return String(k); })
    : null;
  if (freigabenSelected) {
    saveEventFreigaben_(eventId, freigabenSelected);
    ev.freigaben = freigabenSelected;
  }

  let sent = 0;
  const errors = [];
  for (const squad of ansteller) {
    const positions = (squad.positions || []).filter(function (p) { return p && p.hunter; });
    if (!positions.length) continue;

    // Build the PDF ONCE per Runde and reuse it for every recipient in
    // that Runde. Drops the dominant DocumentApp cost from O(recipients)
    // to O(runden) — a 20-recipient hunt with 4 Runden now does 4 PDF
    // builds instead of 20.
    let pdfBlob = null;
    let pdfError = "";
    try {
      pdfBlob = buildInfoMailPdf_(ev, squad, positions, null, postsById);
    } catch (err) {
      pdfError = String(err && err.message || err);
    }
    const subject = "Info zur Drückjagd: " + ev.name + " — " + displayRundeNameServer_(squad.name);

    for (let i = 0; i < positions.length; i++) {
      if (anstellerOnly && i > 0) break; // Only the Ansteller (index 0)
      const pos = positions[i];
      const h = huntersByName[pos.hunter.toLowerCase()];
      if (!h || !h.email || h.status !== "accepted") continue;

      try {
        const html = buildInfoMailBodyHtml_(ev, squad, pos);
        const opts = { from: FROM_EMAIL, htmlBody: html };
        if (pdfBlob) opts.attachments = [pdfBlob];
        GmailApp.sendEmail(h.email, subject, htmlToPlain_(html), opts);
        sent++;
      } catch (err) {
        errors.push({ hunter: pos.hunter, error: String(err && err.message || err) });
      }
    }
    if (pdfError) {
      errors.push({ hunter: displayRundeNameServer_(squad.name), error: "PDF build: " + pdfError });
    }
  }
  return { ok: true, sent: sent, errors: errors };
}

function positionCoords_(pos, postsById) {
  if (pos.type === "kanzel" && pos.post_id && postsById[pos.post_id]) {
    const p = postsById[pos.post_id];
    return { lat: p.lat, lng: p.lng };
  }
  if (pos.type === "klettersitz" && pos.lat !== "" && pos.lng !== "") {
    return { lat: Number(pos.lat), lng: Number(pos.lng) };
  }
  return null;
}

function positionLabel_(pos, postsById) {
  if (pos.type === "kanzel" && pos.post_id && postsById[pos.post_id]) {
    const p = postsById[pos.post_id];
    const suffix = (p.type && p.type !== "Kanzel") ? " · " + (p.type === "Drückjagdbock" ? "DJB" : p.type) : "";
    return p.name + " (" + p.area + ")" + suffix;
  }
  if (pos.type === "klettersitz") {
    const label = pos.label || "Klettersitz";
    const coord = (pos.lat !== "" && pos.lng !== "") ? " — " + pos.lat.toFixed(5) + ", " + pos.lng.toFixed(5) : "";
    return label + coord;
  }
  return "(Position offen)";
}

// Extracts the post's numeric ID + optional sub-position suffix from
// its name. Examples: "Nr. 13" → "13", "Nr. 5a" → "5a", "DJB 7" → "7",
// "Klettersitz Süd" → "". The lowercase a/b suffix is preserved so
// pin lookup still finds the right asset (markers/5a.png).
function postNumberString_(pos, postsById) {
  let nm = "";
  if (pos.type === "kanzel" && pos.post_id && postsById[pos.post_id]) {
    nm = String(postsById[pos.post_id].name || "");
  } else if (pos.type === "klettersitz" && pos.label) {
    nm = String(pos.label);
  }
  const m = /(\d+)([ab])?/i.exec(nm);
  if (!m) return "";
  return m[1] + (m[2] ? m[2].toLowerCase() : "");
}

// Label shown both on the map pin and in the PDF roster's "Nr." column.
// The full post number when we have one (e.g., "13"), else A/B/C as a
// fallback so something distinguishable still appears.
function squadRosterLabel_(pos, postsById, fallbackIndex) {
  const num = postNumberString_(pos, postsById);
  if (num) return num;
  return String.fromCharCode(65 + fallbackIndex);
}

// Pre-rendered teardrop PNGs (1..80 + 1a..80b + A..H letter fallbacks)
// live in public/markers/ on the static site. Google's Static Maps
// API has disabled the `icon:` parameter on this GCP project, so we
// can't have Static Maps render them directly. Instead we fetch a
// plain base map and overlay these PNGs ourselves as positioned images
// inside the PDF. The generator is tools/generate-pins.py.
const SITE_BASE_URL = "https://preye.org";
const MARKER_BASE_URL = "https://preye.org/markers/";

// Base map geometry — these constants drive both the Static Maps fetch
// and the lat/lng → PDF-point projection used to position the pins.
const MAP_SIZE_PX = 640;     // unscaled width/height requested from Static Maps
const MAP_SCALE = 2;          // Static Maps scale=2 → 1280×1280 rendered image
const MAP_TARGET_WIDTH_PT = 515;  // width when placed in the PDF (full text body width)
const PIN_WIDTH_PT = 26;      // pin PNG display width in the PDF
const PIN_HEIGHT_PT = 36;     // height: 88/64 aspect rounded to fit

function markerIconUrl_(text) {
  return MARKER_BASE_URL + encodeURIComponent(String(text)) + ".png";
}

// Fetches a single PNG of the squad's stands rendered on a Mapbox
// outdoors map with our pre-rendered pin PNGs as native markers.
// Mapbox's Static Images API accepts arbitrary HTTPS icon URLs (unlike
// Google Static Maps and Geoapify), so the full post number — including
// 3+ char labels like "100" or "23a" — renders directly on the pin head.
// Free tier: 50k req/mo.
function fetchMapboxMap_(positions, postsById) {
  const props = PropertiesService.getScriptProperties();
  const token = (props.getProperty("MAPBOX_TOKEN") || "").trim();
  if (!token) return { blob: null, error: "Kein MAPBOX_TOKEN hinterlegt." };

  const coords = [];
  const overlays = [];
  for (let i = 0; i < positions.length; i++) {
    const c = positionCoords_(positions[i], postsById);
    if (!c) continue;
    coords.push(c);
    const label = squadRosterLabel_(positions[i], postsById, i);
    // Mapbox overlay syntax: url-{encoded_url}({lon},{lat}). The URL
    // must be URL-encoded; the (lon,lat) stays literal.
    const iconUrl = "https://preye.org/markers/" + encodeURIComponent(label) + ".png";
    overlays.push("url-" + encodeURIComponent(iconUrl) + "(" + c.lng + "," + c.lat + ")");
  }
  if (!coords.length) return { blob: null, error: "Keine Koordinaten für die Karte." };

  // satellite-streets-v12 is Mapbox's "hybrid" — real aerial imagery
  // (forests, fields, dirt tracks visible) overlaid with road/water/
  // place labels. Best detail for hunting orientation. Overridable via
  // the MAPBOX_STYLE script property: try "outdoors-v12" for a
  // hiking-style topo, "satellite-v9" for satellite without labels,
  // or "streets-v12" for the plain street view.
  const style = (props.getProperty("MAPBOX_STYLE") || "").trim() || "satellite-streets-v12";
  const size = "640x640@2x";
  const overlay = overlays.join(",");
  let url;
  if (coords.length === 1) {
    // Single marker: explicit centre+zoom so auto-fit doesn't pick
    // a degenerate bounding box.
    url = "https://api.mapbox.com/styles/v1/mapbox/" + style + "/static/" +
      overlay + "/" + coords[0].lng + "," + coords[0].lat + ",15/" + size +
      "?access_token=" + encodeURIComponent(token);
  } else {
    url = "https://api.mapbox.com/styles/v1/mapbox/" + style + "/static/" +
      overlay + "/auto/" + size +
      "?access_token=" + encodeURIComponent(token) +
      "&padding=80";
  }
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      return { blob: null, error: "Mapbox HTTP " + code + ": " +
        String(res.getContentText() || "").slice(0, 200) };
    }
    const blob = res.getBlob();
    const ct = blob.getContentType() || "";
    if (ct.indexOf("image/") !== 0) {
      return { blob: null, error: "Mapbox lieferte " + ct + " statt eines Bildes." };
    }
    return { blob: blob.setName("squadmap.png"), error: "" };
  } catch (err) {
    return { blob: null, error: "Mapbox UrlFetchApp: " + (err && err.message || err) };
  }
}

// Fetches a single PNG of the squad's stands rendered on an OSM-based
// map. Geoapify natively supports teardrop pin markers with arbitrary
// text labels — no client-side compositing needed, unlike Google
// Static Maps which blocks custom icon URLs on this GCP project.
// Free tier is 3 000 req/day, more than enough for our use.
function fetchGeoapifyMap_(positions, postsById) {
  const props = PropertiesService.getScriptProperties();
  const key = (props.getProperty("GEOAPIFY_KEY") || "").trim();
  if (!key) return { blob: null, error: "Kein GEOAPIFY_KEY hinterlegt (Menü 📧 E-Mail → Geoapify-Key setzen)." };

  const coords = [];
  const markers = [];
  for (let i = 0; i < positions.length; i++) {
    const c = positionCoords_(positions[i], postsById);
    if (!c) continue;
    coords.push(c);
    const label = squadRosterLabel_(positions[i], postsById, i);
    // Geoapify marker syntax: `lonlat:LNG,LAT;key:value;…`. The `text`
    // field is capped at 2 characters server-side, so labels like "80b"
    // get truncated to "80" (the full label still appears in the PDF's
    // Nr. column — the pin just shows the number). Field order matches
    // Geoapify's documented example to avoid validator quirks.
    const pinText = String(label).slice(0, 2);
    markers.push("lonlat:" + c.lng + "," + c.lat +
      ";color:%23ffe100" +
      ";size:large" +
      ";type:material" +
      ";text:" + encodeURIComponent(pinText));
  }
  if (!coords.length) return { blob: null, error: "Keine Koordinaten für die Karte." };

  const params = [
    "style=osm-bright",
    "width=640",
    "height=640",
    "scaleFactor=2",
    "format=png",
  ];
  if (coords.length === 1) {
    params.push("center=lonlat:" + coords[0].lng + "," + coords[0].lat);
    params.push("zoom=15");
  } else {
    // Auto-fit via a rect area covering all positions with a small
    // forest-sized padding so pins don't hug the image edge.
    const lats = coords.map(function (c) { return c.lat; });
    const lngs = coords.map(function (c) { return c.lng; });
    const pad = 0.002; // ~200 m
    params.push("area=rect:" +
      (Math.min.apply(null, lngs) - pad) + "," +
      (Math.min.apply(null, lats) - pad) + "," +
      (Math.max.apply(null, lngs) + pad) + "," +
      (Math.max.apply(null, lats) + pad));
  }
  markers.forEach(function (m) { params.push("marker=" + m); });
  params.push("apiKey=" + encodeURIComponent(key));

  const url = "https://maps.geoapify.com/v1/staticmap?" + params.join("&");
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      return { blob: null, error: "Geoapify HTTP " + code + ": " +
        String(res.getContentText() || "").slice(0, 200) };
    }
    const blob = res.getBlob();
    const ct = blob.getContentType() || "";
    if (ct.indexOf("image/") !== 0) {
      return { blob: null, error: "Geoapify lieferte " + ct + " statt eines Bildes." };
    }
    return { blob: blob.setName("squadmap.png"), error: "" };
  } catch (err) {
    return { blob: null, error: "Geoapify UrlFetchApp: " + (err && err.message || err) };
  }
}

// Fetches a pre-rendered pin PNG from the static site. Per-execution
// memo cache so the same label (e.g., when two Runden share a stand
// number) only costs one round-trip.
const __MARKER_BLOB_CACHE = {};
function fetchMarkerBlob_(label) {
  const key = String(label || "");
  if (!key) return null;
  if (__MARKER_BLOB_CACHE[key]) return __MARKER_BLOB_CACHE[key];
  try {
    const res = UrlFetchApp.fetch(markerIconUrl_(key), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const blob = res.getBlob().setName("pin-" + key + ".png");
    __MARKER_BLOB_CACHE[key] = blob;
    return blob;
  } catch (err) {
    return null;
  }
}

// Mercator world coordinate at zoom 0 (tile-size = 256 px). Multiplying
// by 2^zoom gives the global pixel offset; subtracting the map-centre's
// world coord gives the pin's pixel position relative to the centre of
// the rendered map.
function mercatorWorld_(lat, lng) {
  const tile = 256;
  const x = (lng + 180) / 360 * tile;
  const siny = Math.sin(lat * Math.PI / 180);
  const sinyC = Math.min(Math.max(siny, -0.9999), 0.9999);
  const y = tile * (0.5 - Math.log((1 + sinyC) / (1 - sinyC)) / (4 * Math.PI));
  return { x: x, y: y };
}

// Picks the highest zoom (most detail) at which every position still
// fits inside the rendered map with some padding. Caps at 17 because
// at 18+ terrain tiles lose the forest shading that hunters rely on.
function pickZoom_(coords, paddingPx) {
  if (coords.length === 1) return 15;
  const lats = coords.map(function (c) { return c.lat; });
  const lngs = coords.map(function (c) { return c.lng; });
  const minLat = Math.min.apply(null, lats);
  const maxLat = Math.max.apply(null, lats);
  const minLng = Math.min.apply(null, lngs);
  const maxLng = Math.max.apply(null, lngs);
  const wA = mercatorWorld_(maxLat, minLng);
  const wB = mercatorWorld_(minLat, maxLng);
  const dx = Math.abs(wB.x - wA.x);
  const dy = Math.abs(wB.y - wA.y);
  if (dx === 0 && dy === 0) return 15;
  const usable = MAP_SIZE_PX - 2 * paddingPx;
  // 256 * 2^z must be >= world_span * usable / 256, simplified:
  const zx = Math.log2(usable / dx);
  const zy = Math.log2(usable / dy);
  return Math.min(17, Math.max(10, Math.floor(Math.min(zx, zy))));
}

// Fetches a plain base map (no markers) at a centre+zoom chosen to fit
// all positions, and computes each pin's pixel position inside the
// rendered image. Returns the blob plus the projected pixel positions
// + the rendered image dimensions. The PDF builder uses these to drop
// pin PNGs onto the map at the right spots.
function fetchBaseMapAndPositions_(positions, postsById) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = (props.getProperty("MAPS_API_KEY") || "").trim();
  if (!apiKey) return { error: "Kein MAPS_API_KEY in den Script-Properties hinterlegt." };
  const coords = [];
  const labels = [];
  for (let i = 0; i < positions.length; i++) {
    const c = positionCoords_(positions[i], postsById);
    if (!c) continue;
    coords.push(c);
    labels.push(squadRosterLabel_(positions[i], postsById, i));
  }
  if (!coords.length) return { error: "Keine Koordinaten für die Karte." };
  const centerLat = (Math.min.apply(null, coords.map(function (c) { return c.lat; })) +
                     Math.max.apply(null, coords.map(function (c) { return c.lat; }))) / 2;
  const centerLng = (Math.min.apply(null, coords.map(function (c) { return c.lng; })) +
                     Math.max.apply(null, coords.map(function (c) { return c.lng; }))) / 2;
  // Padding leaves room for the pin's "tail" pointing down at the coord;
  // PIN_HEIGHT_PT is the pixel-equivalent buffer at the chosen scale.
  const paddingPx = Math.ceil(PIN_HEIGHT_PT * (MAP_SIZE_PX * MAP_SCALE) / MAP_TARGET_WIDTH_PT);
  const zoom = pickZoom_(coords, paddingPx);

  const url = "https://maps.googleapis.com/maps/api/staticmap?" + [
    "center=" + centerLat + "," + centerLng,
    "zoom=" + zoom,
    "size=" + MAP_SIZE_PX + "x" + MAP_SIZE_PX,
    "maptype=terrain",
    "scale=" + MAP_SCALE,
    "key=" + encodeURIComponent(apiKey),
  ].join("&");
  let res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (err) {
    return { error: "UrlFetchApp: " + (err && err.message || err) };
  }
  if (res.getResponseCode() !== 200) {
    return { error: "Static-Maps HTTP " + res.getResponseCode() + ": " +
                    String(res.getContentText() || "").slice(0, 200) };
  }
  const ct = res.getBlob().getContentType() || "";
  if (ct.indexOf("image/") !== 0) {
    return { error: "Static-Maps lieferte " + ct + " statt eines Bildes." };
  }
  const mapBlob = res.getBlob().setName("squadmap.png");

  // Project each pin's coord into rendered-image pixels (taking scale
  // into account), so the caller knows where to drop the pin PNGs.
  const scale = Math.pow(2, zoom);
  const centerWorld = mercatorWorld_(centerLat, centerLng);
  const renderedSize = MAP_SIZE_PX * MAP_SCALE;
  const pins = coords.map(function (c, i) {
    const w = mercatorWorld_(c.lat, c.lng);
    const dx = (w.x - centerWorld.x) * scale;
    const dy = (w.y - centerWorld.y) * scale;
    return {
      label: labels[i],
      pxX: (MAP_SIZE_PX / 2 + dx) * MAP_SCALE,
      pxY: (MAP_SIZE_PX / 2 + dy) * MAP_SCALE,
    };
  });
  return { blob: mapBlob, pins: pins, renderedSize: renderedSize, zoom: zoom, error: "" };
}

// Kept for backwards compatibility with menu_testInfomailMap. The real
// rendering path now goes through fetchBaseMapAndPositions_ above.
function squadBaseMarkers_(positions, postsById) {
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    const c = positionCoords_(positions[i], postsById);
    if (!c) continue;
    out.push("color:yellow|label:" + (squadRosterLabel_(positions[i], postsById, i)[0] || "A") +
             "|" + c.lat + "," + c.lng);
  }
  return out;
}

// Returns { blob, error } so callers can surface WHY the map is missing
// instead of silently dropping it.
function fetchSquadMap_(baseMarkerSpecs, recipientCoord) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = (props.getProperty("MAPS_API_KEY") || "").trim();
  if (!apiKey) return { blob: null, error: "Kein MAPS_API_KEY in den Script-Properties hinterlegt (menu_setMapsApiKey ausführen)." };
  if (!baseMarkerSpecs.length && !recipientCoord) return { blob: null, error: "Keine Koordinaten für die Karte (Stände ohne lat/lng?)." };
  // EEA accounts can't request satellite/hybrid tiles via the Static Maps
  // API (Google restriction since 2024). Terrain still works and gives us
  // forest shading + roads, which is what hunters need to orient.
  const params = [
    "size=640x480",
    "maptype=terrain",
    "scale=2",
  ];
  for (const m of baseMarkerSpecs) {
    params.push("markers=" + encodeURIComponent(m));
  }
  if (recipientCoord) {
    params.push("markers=" + encodeURIComponent("color:red|size:mid|" + recipientCoord.lat + "," + recipientCoord.lng));
  }
  params.push("key=" + encodeURIComponent(apiKey));
  const url = "https://maps.googleapis.com/maps/api/staticmap?" + params.join("&");
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      const snippet = String(res.getContentText() || "").slice(0, 200);
      return { blob: null, error: "Static-Maps-Aufruf HTTP " + code + ": " + snippet };
    }
    const blob = res.getBlob();
    const ct = blob.getContentType() || "";
    if (ct.indexOf("image/") !== 0) {
      const snippet = String(res.getContentText() || "").slice(0, 200);
      return { blob: null, error: "Static-Maps lieferte " + ct + " statt eines Bildes: " + snippet };
    }
    return { blob: blob.setName("squadmap.png"), error: "" };
  } catch (err) {
    return { blob: null, error: "UrlFetchApp-Fehler: " + (err && err.message || err) };
  }
}

// Run this from the Apps Script editor to diagnose the map rendering.
// Logs the API-key status, builds a sample Static Maps URL using the
// CURRENT icon URLs (so we can verify the deployed code is using the
// new preye.org/markers/* pins), and reports whether the fetch itself
// returned a valid image. Logs go to the editor's execution log; we
// avoid ui.alert because it would block invisibly when invoked from
// the editor.
function menu_testInfomailMap() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = (props.getProperty("MAPS_API_KEY") || "").trim();
  const geoKey = (props.getProperty("GEOAPIFY_KEY") || "").trim();
  const mboxToken = (props.getProperty("MAPBOX_TOKEN") || "").trim();
  console.log("MAPBOX_TOKEN gesetzt? " + (mboxToken ? "ja (" + mboxToken.length + " Zeichen)" : "NEIN"));
  console.log("GEOAPIFY_KEY gesetzt? " + (geoKey ? "ja (" + geoKey.length + " Zeichen)" : "NEIN"));
  console.log("MAPS_API_KEY gesetzt? " + (apiKey ? "ja (" + apiKey.length + " Zeichen)" : "NEIN"));

  // Probe each configured provider end-to-end with a sample marker so
  // the editor log shows exactly which one(s) work and what fails.
  const fakePositions = [{ type: "kanzel", post_id: "demo" }];
  const fakePostsById = { demo: { name: "Nr. 13", area: "Hauptrevier", type: "Kanzel", lat: 53.63065, lng: 12.83461 } };
  if (mboxToken) {
    const r = fetchMapboxMap_(fakePositions, fakePostsById);
    console.log("Mapbox   " + (r.blob ? "OK: " + r.blob.getBytes().length + " bytes" : "FEHLER: " + r.error));
  }
  if (geoKey) {
    const r = fetchGeoapifyMap_(fakePositions, fakePostsById);
    console.log("Geoapify " + (r.blob ? "OK: " + r.blob.getBytes().length + " bytes" : "FEHLER: " + r.error));
  }


  // Build a sample marker spec the way the live code does so we can
  // see exactly what icon URL is being passed to Static Maps.
  const samplePos = { type: "kanzel", post_id: "demo" };
  const samplePostsById = { demo: { name: "Nr. 13", area: "Hauptrevier", type: "Kanzel" } };
  const sampleLabel = squadRosterLabel_(samplePos, samplePostsById, 0);
  const sampleIcon = markerIconUrl_(sampleLabel);
  console.log("Sample marker label: " + sampleLabel);
  console.log("Sample icon URL: " + sampleIcon);

  const markerSpec = "icon:" + sampleIcon + "|53.63065,12.83461";
  const staticUrl = "https://maps.googleapis.com/maps/api/staticmap?size=640x480&maptype=terrain&scale=2&markers=" +
    encodeURIComponent(markerSpec) + "&key=" + encodeURIComponent(apiKey);
  console.log("Static Maps URL (paste in browser to verify visually):\n" + staticUrl);

  const result = fetchSquadMap_(
    [markerSpec],
    null
  );
  if (result.blob) {
    const out = {
      ok: true,
      bytes: result.blob.getBytes().length,
      content_type: result.blob.getContentType(),
    };
    console.log("Map-Fetch OK: " + JSON.stringify(out));
    return out;
  } else {
    const out = { ok: false, error: result.error || "(kein Fehler-Text)" };
    console.log("Map-Fetch fehlgeschlagen: " + out.error);
    return out;
  }
}

function displayRundeNameServer_(name) {
  const s = String(name || "").trim();
  const m = /^(Ansteller Runde)\s+(\d+)\s*$/i.exec(s);
  if (!m) return s || "Ansteller Runde";
  // Reuse the same Roman-numeral table the frontend uses.
  const R = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX"];
  const n = parseInt(m[2], 10);
  return m[1] + " " + (R[n - 1] || String(n));
}

function htmlEscape_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function htmlToPlain_(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================================
// QR codes
// ----------------------------------------------------------------------------
// The Infomail PDF carries a QR code to the recipient's own Standkarte, so a
// Schütze can pull it up on his phone from the printed sheet. Encoder and PNG
// writer are implemented here rather than fetched from a QR web service: the
// mail must not depend on a third party being up, and the hunter's name should
// not travel to one either.
//
// Byte mode, error-correction level M, versions picked automatically. The
// implementation was verified against a QR reader over 80 generated codes
// (every Standkarte-URL shape plus a length sweep across versions 2–8).
// ============================================================================

// ---------------------------------------------------------------- QR encoder

// Error-correction codewords per block, level M, versions 1..40.
var QR_ECC_PER_BLOCK_M = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
// Number of error-correction blocks, level M, versions 1..40.
var QR_BLOCKS_M = [
  1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
  17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

function qrNumRawDataModules_(ver) {
  var result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    var numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function qrNumDataCodewords_(ver) {
  return Math.floor(qrNumRawDataModules_(ver) / 8)
    - QR_ECC_PER_BLOCK_M[ver - 1] * QR_BLOCKS_M[ver - 1];
}

function qrAlignPositions_(ver) {
  if (ver === 1) return [];
  var size = ver * 4 + 17;
  var numAlign = Math.floor(ver / 7) + 2;
  var step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  var result = [6];
  for (var pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// --- GF(256) arithmetic for Reed-Solomon -----------------------------------

var QR_GF_EXP = null;
var QR_GF_LOG = null;

function qrInitGf_() {
  if (QR_GF_EXP) return;
  QR_GF_EXP = new Array(512);
  QR_GF_LOG = new Array(256);
  var x = 1;
  for (var i = 0; i < 255; i++) {
    QR_GF_EXP[i] = x;
    QR_GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (var j = 255; j < 512; j++) QR_GF_EXP[j] = QR_GF_EXP[j - 255];
}

function qrGfMul_(a, b) {
  if (a === 0 || b === 0) return 0;
  return QR_GF_EXP[QR_GF_LOG[a] + QR_GF_LOG[b]];
}

function qrRsGenerator_(degree) {
  qrInitGf_();
  var result = [1];
  for (var i = 0; i < degree; i++) {
    var next = new Array(result.length + 1);
    for (var k = 0; k < next.length; k++) next[k] = 0;
    for (var j = 0; j < result.length; j++) {
      next[j] ^= result[j];
      next[j + 1] ^= qrGfMul_(result[j], QR_GF_EXP[i]);
    }
    result = next;
  }
  return result;
}

function qrRsRemainder_(data, generator) {
  var degree = generator.length - 1;
  var result = new Array(degree);
  for (var i = 0; i < degree; i++) result[i] = 0;
  for (var d = 0; d < data.length; d++) {
    var factor = data[d] ^ result[0];
    result.shift();
    result.push(0);
    for (var g = 0; g < degree; g++) {
      result[g] ^= qrGfMul_(generator[g + 1], factor);
    }
  }
  return result;
}

// --- Bit stream -------------------------------------------------------------

function qrTextToBytes_(text) {
  // UTF-8 encode without relying on TextEncoder (not in Apps Script).
  var out = [];
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      var c2 = text.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
               0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

function qrBuildCodewords_(bytes, ver) {
  var bits = [];
  function push(value, len) {
    for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }
  push(4, 4); // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

  var capacityBits = qrNumDataCodewords_(ver) * 8;
  var terminator = Math.min(4, capacityBits - bits.length);
  push(0, terminator);
  push(0, (8 - bits.length % 8) % 8);

  var padBytes = [0xec, 0x11];
  for (var p = 0; bits.length < capacityBits; p++) push(padBytes[p % 2], 8);

  var codewords = [];
  for (var b = 0; b < bits.length; b += 8) {
    var v = 0;
    for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
    codewords.push(v);
  }
  return codewords;
}

// Split into blocks, append RS parity, interleave — as the spec requires.
function qrAddEcc_(data, ver) {
  var numBlocks = QR_BLOCKS_M[ver - 1];
  var eccLen = QR_ECC_PER_BLOCK_M[ver - 1];
  var rawCodewords = Math.floor(qrNumRawDataModules_(ver) / 8);
  var numShort = numBlocks - rawCodewords % numBlocks;
  var shortLen = Math.floor(rawCodewords / numBlocks);

  var generator = qrRsGenerator_(eccLen);
  var blocks = [];
  var offset = 0;
  for (var i = 0; i < numBlocks; i++) {
    var dataLen = shortLen - eccLen + (i < numShort ? 0 : 1);
    var dat = data.slice(offset, offset + dataLen);
    offset += dataLen;
    blocks.push({ data: dat, ecc: qrRsRemainder_(dat, generator) });
  }

  var result = [];
  for (var c = 0; c < shortLen - eccLen + 1; c++) {
    for (var b = 0; b < blocks.length; b++) {
      if (c < blocks[b].data.length) result.push(blocks[b].data[c]);
    }
  }
  for (var e = 0; e < eccLen; e++) {
    for (var b2 = 0; b2 < blocks.length; b2++) result.push(blocks[b2].ecc[e]);
  }
  return result;
}

// --- Module placement -------------------------------------------------------

function qrNewGrid_(size, value) {
  var g = new Array(size);
  for (var y = 0; y < size; y++) {
    g[y] = new Array(size);
    for (var x = 0; x < size; x++) g[y][x] = value;
  }
  return g;
}

function qrDrawFunctionPatterns_(modules, isFunction, ver) {
  var size = modules.length;

  function setFn(x, y, dark) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  }

  // Timing patterns.
  for (var i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Finder patterns + separators.
  var corners = [[0, 0], [size - 7, 0], [0, size - 7]];
  for (var c = 0; c < corners.length; c++) {
    var cx = corners[c][0], cy = corners[c][1];
    for (var dy = -1; dy <= 7; dy++) {
      for (var dx = -1; dx <= 7; dx++) {
        var xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        var d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
  }

  // Alignment patterns (skipping the three finder corners).
  var pos = qrAlignPositions_(ver);
  for (var a = 0; a < pos.length; a++) {
    for (var b = 0; b < pos.length; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === pos.length - 1)
          || (a === pos.length - 1 && b === 0)) continue;
      for (var ay = -2; ay <= 2; ay++) {
        for (var ax = -2; ax <= 2; ax++) {
          setFn(pos[b] + ax, pos[a] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
        }
      }
    }
  }

  // Version information (version 7 and up).
  if (ver >= 7) {
    var rem = ver;
    for (var r = 0; r < 12; r++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var vbits = (ver << 12) | rem;
    for (var k = 0; k < 18; k++) {
      var bit = ((vbits >>> k) & 1) === 1;
      var vx = Math.floor(k / 3);
      var vy = size - 11 + (k % 3);
      setFn(vx, vy, bit);
      setFn(vy, vx, bit);
    }
  }

  // Reserve the format-information area; the real bits go in later. Index 6
  // is skipped in both loops — that cell belongs to the timing pattern, which
  // crosses the format band and must survive.
  for (var f = 0; f < 9; f++) {
    if (f === 6) continue;
    setFn(f, 8, false);
    setFn(8, f, false);
  }
  for (var f2 = 0; f2 < 8; f2++) {
    setFn(size - 1 - f2, 8, false);
    setFn(8, size - 1 - f2, false);
  }
  setFn(8, size - 8, true); // always-dark module
}

function qrDrawFormatBits_(modules, ver, mask) {
  var size = modules.length;
  var data = (0 /* level M */ << 3) | mask;
  var rem = data;
  for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  var bits = ((data << 10) | rem) ^ 0x5412;

  function bit(k) { return ((bits >>> k) & 1) === 1; }

  // First copy, around the top-left finder.
  for (var i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (var j = 9; j < 15; j++) modules[8][14 - j] = bit(j);

  // Second copy, split between the other two finders.
  for (var k = 0; k < 8; k++) modules[8][size - 1 - k] = bit(k);
  for (var m = 8; m < 15; m++) modules[size - 15 + m][8] = bit(m);
  modules[size - 8][8] = true; // always-dark module
}

function qrDrawCodewords_(modules, isFunction, codewords) {
  var size = modules.length;
  var i = 0; // bit index
  for (var right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped
    for (var vert = 0; vert < size; vert++) {
      for (var j = 0; j < 2; j++) {
        var x = right - j;
        var upward = ((right + 1) & 2) === 0;
        var y = upward ? size - 1 - vert : vert;
        if (isFunction[y][x] || i >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        i++;
      }
    }
  }
  return i;
}

function qrApplyMask_(modules, isFunction, mask) {
  var size = modules.length;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      if (isFunction[y][x]) continue;
      var invert;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
        case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = false;
      }
      if (invert) modules[y][x] = !modules[y][x];
    }
  }
}

function qrPenalty_(modules) {
  var size = modules.length;
  var result = 0;
  var N1 = 3, N2 = 3, N3 = 40, N4 = 10;

  // Rules 1 and 3, scanned once per row and once per column.
  for (var pass = 0; pass < 2; pass++) {
    for (var a = 0; a < size; a++) {
      var runColor = false;
      var runLen = 0;
      var history = [0, 0, 0, 0, 0, 0, 0];
      for (var b = 0; b < size; b++) {
        var v = pass === 0 ? modules[a][b] : modules[b][a];
        if (v === runColor) {
          runLen++;
          if (runLen === 5) result += N1;
          else if (runLen > 5) result++;
        } else {
          qrFinderAddHistory_(runLen, history, size);
          if (!runColor) result += qrFinderCount_(history) * N3;
          runColor = v;
          runLen = 1;
        }
      }
      result += qrFinderTerminate_(runColor, runLen, history, size) * N3;
    }
  }

  // Rule 2: 2x2 blocks of a single colour.
  for (var y = 0; y < size - 1; y++) {
    for (var x = 0; x < size - 1; x++) {
      var c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        result += N2;
      }
    }
  }

  // Rule 4: how far the dark ratio strays from 50%.
  var dark = 0;
  for (var yy = 0; yy < size; yy++) {
    for (var xx = 0; xx < size; xx++) if (modules[yy][xx]) dark++;
  }
  var total = size * size;
  var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * N4;
  return result;
}

function qrFinderAddHistory_(runLen, history, size) {
  if (history[0] === 0) runLen += size; // the run touching the border counts as bordered
  history.pop();
  history.unshift(runLen);
}

function qrFinderTerminate_(runColor, runLen, history, size) {
  if (runColor) {
    qrFinderAddHistory_(runLen, history, size);
    runLen = 0;
  }
  runLen += size;
  qrFinderAddHistory_(runLen, history, size);
  return qrFinderCount_(history);
}

// Counts the 1:1:3:1:1 finder-lookalikes that confuse scanners.
function qrFinderCount_(history) {
  var n = history[1];
  var core = n > 0 && history[2] === n && history[3] === n * 3
    && history[4] === n && history[5] === n;
  return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0)
    + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
}

// Returns a size×size array of booleans (true = dark module), level M.
function qrEncode_(text) {
  var bytes = qrTextToBytes_(text);
  var ver = 0;
  for (var v = 1; v <= 40; v++) {
    var capacity = qrNumDataCodewords_(v);
    var headerBits = 4 + (v <= 9 ? 8 : 16);
    if (Math.ceil(headerBits / 8) + bytes.length <= capacity
        && headerBits + bytes.length * 8 <= capacity * 8) {
      ver = v;
      break;
    }
  }
  if (!ver) throw new Error("QR: Text zu lang");

  var codewords = qrAddEcc_(qrBuildCodewords_(bytes, ver), ver);
  var size = ver * 4 + 17;

  var best = null;
  for (var mask = 0; mask < 8; mask++) {
    var modules = qrNewGrid_(size, false);
    var isFunction = qrNewGrid_(size, false);
    qrDrawFunctionPatterns_(modules, isFunction, ver);
    qrDrawCodewords_(modules, isFunction, codewords);
    qrDrawFormatBits_(modules, ver, mask);
    qrApplyMask_(modules, isFunction, mask);
    var penalty = qrPenalty_(modules);
    if (!best || penalty < best.penalty) best = { penalty: penalty, modules: modules };
  }
  return best.modules;
}

// ---------------------------------------------------------------- PNG writer
//
// 1-bit greyscale, and the zlib stream uses stored (uncompressed) blocks so we
// only need Adler-32 and CRC-32 — no deflate implementation. A QR at this size
// is a few kilobytes either way.

var QR_CRC_TABLE = null;
function qrCrcTable_() {
  if (QR_CRC_TABLE) return QR_CRC_TABLE;
  QR_CRC_TABLE = new Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    QR_CRC_TABLE[n] = c >>> 0;
  }
  return QR_CRC_TABLE;
}

function qrCrc32_(bytes) {
  var table = qrCrcTable_();
  var c = 0xffffffff;
  for (var i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function qrAdler32_(bytes) {
  var a = 1, b = 0;
  for (var i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function qrPush32_(out, value) {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function qrChunk_(out, type, data) {
  qrPush32_(out, data.length);
  var body = [];
  for (var i = 0; i < type.length; i++) body.push(type.charCodeAt(i));
  for (var j = 0; j < data.length; j++) body.push(data[j]);
  for (var k = 0; k < body.length; k++) out.push(body[k]);
  qrPush32_(out, qrCrc32_(body));
}

// modules → PNG bytes. `scale` pixels per module, `quiet` modules of margin.
function qrToPngBytes_(modules, scale, quiet) {
  var n = modules.length;
  var sizePx = (n + quiet * 2) * scale;
  var bytesPerRow = Math.ceil(sizePx / 8);

  // Raw scanlines: filter byte 0, then 1 bit per pixel (1 = white, 0 = black).
  var raw = [];
  for (var y = 0; y < sizePx; y++) {
    raw.push(0);
    var moduleY = Math.floor(y / scale) - quiet;
    var row = new Array(bytesPerRow);
    for (var i = 0; i < bytesPerRow; i++) row[i] = 0xff;
    if (moduleY >= 0 && moduleY < n) {
      for (var x = 0; x < sizePx; x++) {
        var moduleX = Math.floor(x / scale) - quiet;
        if (moduleX < 0 || moduleX >= n) continue;
        if (modules[moduleY][moduleX]) row[x >> 3] &= ~(0x80 >> (x & 7));
      }
    }
    for (var r = 0; r < bytesPerRow; r++) raw.push(row[r]);
  }

  // zlib stream with stored deflate blocks.
  var z = [0x78, 0x01];
  var MAX = 65535;
  for (var off = 0; off < raw.length; off += MAX) {
    var len = Math.min(MAX, raw.length - off);
    var last = (off + len >= raw.length) ? 1 : 0;
    z.push(last, len & 0xff, (len >>> 8) & 0xff, ~len & 0xff, (~len >>> 8) & 0xff);
    for (var d = 0; d < len; d++) z.push(raw[off + d]);
  }
  qrPush32_(z, qrAdler32_(raw));

  var png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  var ihdr = [];
  qrPush32_(ihdr, sizePx);
  qrPush32_(ihdr, sizePx);
  ihdr.push(1, 0, 0, 0, 0); // bit depth 1, greyscale, no interlace
  qrChunk_(png, "IHDR", ihdr);
  qrChunk_(png, "IDAT", z);
  qrChunk_(png, "IEND", []);
  return png;
}

// Apps Script blobs take signed Java bytes, so 0..255 has to be folded into
// -128..127 on the way out.
function qrPngBlob_(text, scale, quiet, name) {
  var bytes = qrToPngBytes_(qrEncode_(text), scale || 8, quiet == null ? 4 : quiet);
  var signed = new Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) {
    signed[i] = bytes[i] > 127 ? bytes[i] - 256 : bytes[i];
  }
  return Utilities.newBlob(signed, "image/png", (name || "qr") + ".png");
}

// The Standkarte link for one hunter at one hunt. Matches the query string
// standkarte.js reads: ?event=<id>&h=<name>.
function standkarteUrl_(ev, hunterName) {
  var url = SITE_BASE_URL.replace(/\/+$/, "") + "/standkarte.html?event=" + encodeURIComponent(ev.id);
  if (hunterName) url += "&h=" + encodeURIComponent(hunterName);
  return url;
}

// Single-page Infomail PDF. Layout: title strip on top, a 2-column
// header band (info + Freigaben on the left, map on the right), the
// runde roster table full-width below, then a compact Kontakte
// block, and a signature line at the foot.
//
// Design tokens — kept at the top so a future tweak (different accent,
// tighter spacing, larger fonts) is a one-spot change.
function buildInfoMailPdf_(ev, squad, positions, recipientPos, postsById) {
  const rundeLabel = displayRundeNameServer_(squad.name);
  const cleanName = function (s) { return String(s || "").replace(/[\\\/?%*:|"<>]/g, " "); };
  const filename = recipientPos
    ? "Infomail " + cleanName(ev.name) + " — " + cleanName(rundeLabel) + " — " + cleanName(recipientPos.hunter || "")
    : "Infomail " + cleanName(ev.name) + " — " + cleanName(rundeLabel);
  const doc = DocumentApp.create(filename);
  const docId = doc.getId();

  const FONT       = "Helvetica";
  const INK        = "#1a1a1a"; // primary text
  const SOFT       = "#6b7280"; // labels & meta
  const ACCENT     = "#2d5a3d"; // single muted-forest-green accent
  const BORDER     = "#e5e7eb"; // hairline borders
  const SOFT_BG    = "#fafafa"; // subtle table-header background
  // Page math: letter (612×792 pt) − margins → 548 × 736 usable.
  const MARGIN_X   = 32;
  const MARGIN_Y   = 28;
  const MAP_W_PT   = 295;        // square Mapbox image → ~295 pt tall (about a quarter of the page)
  const LEFT_COL   = 245;        // info+Freigaben column (548 usable − map width)

  function styleParagraph(p, opts) {
    opts = opts || {};
    const t = p.editAsText().setFontFamily(FONT).setFontSize(opts.size || 10);
    t.setForegroundColor(opts.color || INK);
    t.setBold(!!opts.bold);
    t.setItalic(!!opts.italic);
    p.setSpacingBefore(opts.before == null ? 0 : opts.before);
    p.setSpacingAfter(opts.after == null ? 0 : opts.after);
    p.setLineSpacing(opts.line || 1.2);
    if (opts.align) p.setAlignment(opts.align);
    return p;
  }

  // Appender that reuses the cell's auto-created empty first paragraph
  // for the first call and appends new paragraphs after that. We track
  // "first call" with a WeakMap rather than a property on the cell —
  // Apps Script wraps cells in fresh proxies, so custom JS properties
  // don't survive across calls.
  const cellState = new Map();
  function appendInCell(cell, text, opts) {
    let para;
    if (!cellState.get(cell)) {
      para = cell.getChild(0).asParagraph();
      para.setText(text);
      cellState.set(cell, true);
    } else {
      para = cell.appendParagraph(text);
    }
    return styleParagraph(para, opts);
  }

  // ALL-CAPS hairline label above each meta value (DATUM, TREFFPUNKT…).
  function appendCellLabel(cell, text) {
    return appendInCell(cell, text, {
      size: 7.5, bold: true, color: SOFT, before: 8, after: 1, line: 1.0,
    });
  }
  function appendCellValue(cell, text) {
    return appendInCell(cell, text, { size: 10, color: INK, line: 1.25 });
  }

  try {
    const body = doc.getBody();
    body.setMarginTop(MARGIN_Y).setMarginBottom(MARGIN_Y)
        .setMarginLeft(MARGIN_X).setMarginRight(MARGIN_X);

    // === Title strip ===========================================
    // Reuse the body's auto-first-paragraph for the title.
    const title = body.getChild(0).asParagraph();
    title.setText(ev.name);
    styleParagraph(title, { size: 18, bold: true, color: INK, before: 0, after: 2, line: 1.1 });

    const subText = recipientPos
      ? rundeLabel + " · " + (recipientPos.hunter || "")
      : rundeLabel + " · " + formatGermanDate_(ev.date);
    const sub = body.appendParagraph(subText);
    styleParagraph(sub, { size: 10.5, color: ACCENT, before: 0, after: 10, line: 1.1 });

    // === Two-column header band ================================
    const headerTable = body.appendTable();
    headerTable.setBorderColor("#ffffff").setBorderWidth(0);
    const headerRow = headerTable.appendTableRow();
    const leftCell = headerRow.appendTableCell();
    const rightCell = headerRow.appendTableCell();
    headerTable.setColumnWidth(0, LEFT_COL);
    headerTable.setColumnWidth(1, MAP_W_PT);
    [leftCell, rightCell].forEach(function (c) {
      c.setPaddingTop(0).setPaddingBottom(0);
    });
    leftCell.setPaddingLeft(0).setPaddingRight(14);
    rightCell.setPaddingLeft(0).setPaddingRight(0);

    // --- Left column: DATUM, TREFFPUNKT, ZEITEN, ANSTELLER, (DEIN STAND), FREIGABEN ---
    appendCellLabel(leftCell, "DATUM");
    appendCellValue(leftCell, formatGermanDate_(ev.date));

    if (ev.treffpunkt) {
      appendCellLabel(leftCell, "TREFFPUNKT");
      appendCellValue(leftCell, ev.treffpunkt);
    }

    const timeBits = [];
    if (ev.treff_time)  timeBits.push("Treff "  + ev.treff_time);
    if (ev.start_time)  timeBits.push("Beginn " + ev.start_time);
    if (ev.end_time)    timeBits.push("Ende "   + ev.end_time);
    if (timeBits.length) {
      appendCellLabel(leftCell, "ZEITEN");
      appendCellValue(leftCell, timeBits.join("  ·  "));
    }

    const anstellerName = (positions[0] && positions[0].hunter) || squad.ansteller || "";
    if (anstellerName) {
      appendCellLabel(leftCell, "ANSTELLER");
      appendCellValue(leftCell, anstellerName);
    }
    if (recipientPos) {
      appendCellLabel(leftCell, "DEIN STAND");
      appendCellValue(leftCell, positionLabel_(recipientPos, postsById));
    }

    // Freigaben (compact: one line per species, gender ranges inline).
    appendCellLabel(leftCell, "FREIGABEN");
    const freigabenSet = {};
    const freigabenRaw = (ev.freigaben && Array.isArray(ev.freigaben)) ? ev.freigaben : freigabenAllKeys_();
    freigabenRaw.forEach(function (k) { freigabenSet[k] = true; });

    let anyFreigaben = false;
    FREIGABEN_MATRIX.forEach(function (sp) {
      const groupBits = sp.groups.map(function (g) {
        const checked = g.aks.filter(function (ak) { return freigabenSet[sp.id + "." + g.id + "." + ak.id]; });
        if (!checked.length) return null;
        return g.label + " " + formatAkSelection_(g, checked);
      }).filter(Boolean);
      if (!groupBits.length) return;
      anyFreigaben = true;
      const line = sp.label + " — " + groupBits.join(", ");
      appendInCell(leftCell, line, { size: 9.5, color: INK, line: 1.25, before: 1 });
    });
    if (!anyFreigaben) {
      appendInCell(leftCell, "Keine Freigaben.", {
        size: 9.5, italic: true, color: SOFT, line: 1.25,
      });
    }
    appendInCell(leftCell, "Kein Raubwild · Leitbachen verschonen.", {
      size: 8, italic: true, color: SOFT, before: 4, line: 1.2,
    });

    // --- Right column: map ---
    // We resolve the blob FIRST, then build the cell content based on the
    // outcome. Styling an empty paragraph upfront triggers "Leeres
    // Textelement kann nicht eingefügt werden" in some Apps Script
    // versions, so we only call styleParagraph after content lands.
    let mapBlob = null;
    let mapError = "";
    const mbox = fetchMapboxMap_(positions, postsById);
    if (mbox.blob) {
      mapBlob = mbox.blob;
    } else if (/Kein MAPBOX_TOKEN/.test(mbox.error)) {
      const geo = fetchGeoapifyMap_(positions, postsById);
      if (geo.blob) mapBlob = geo.blob;
      else mapError = geo.error;
    } else {
      mapError = mbox.error;
    }

    const mapPara = rightCell.getChild(0).asParagraph();
    if (mapBlob) {
      const img = mapPara.appendInlineImage(mapBlob);
      const ratio = img.getHeight() / img.getWidth();
      img.setWidth(MAP_W_PT);
      img.setHeight(MAP_W_PT * ratio);
      // Centre the image inside the cell; no text styles to apply since
      // the paragraph contains only the image.
      mapPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      const cap = rightCell.appendParagraph("Pinzahl = Standnummer");
      styleParagraph(cap, {
        size: 7.5, italic: true, color: SOFT, before: 4, line: 1.0,
        align: DocumentApp.HorizontalAlignment.CENTER,
      });
    } else {
      // Now that we know we're inserting real text, set it BEFORE styling.
      mapPara.setText("⚠ Karte: " + (mapError || "unbekannter Fehler"));
      styleParagraph(mapPara, { size: 9, italic: true, color: "#a85a00", line: 1.2 });
    }

    // === Roster table (full width) =============================
    const rosterLabel = body.appendParagraph("RUNDE");
    styleParagraph(rosterLabel, {
      size: 7.5, bold: true, color: SOFT, before: 14, after: 4, line: 1.0,
    });

    const table = body.appendTable();
    table.setBorderColor(BORDER).setBorderWidth(0.5);
    const head = table.appendTableRow();
    ["Nr.", "Schütze", "Stand"].forEach(function (h) {
      const c = head.appendTableCell(h);
      const p = c.getChild(0).asParagraph();
      styleParagraph(p, { size: 8, bold: true, color: SOFT, line: 1.0 });
      c.setBackgroundColor(SOFT_BG);
      c.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(8).setPaddingRight(8);
    });
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const isMe = recipientPos && p.hunter === recipientPos.hunter;
      const row = table.appendTableRow();
      const numCell = row.appendTableCell(squadRosterLabel_(p, postsById, i));
      styleParagraph(numCell.getChild(0).asParagraph(), {
        size: 10, bold: true, color: ACCENT, line: 1.0,
      });
      const hunterCell = row.appendTableCell(p.hunter + (i === 0 ? " (Ansteller)" : ""));
      styleParagraph(hunterCell.getChild(0).asParagraph(), {
        size: 10, bold: !!isMe, color: INK, line: 1.0,
      });
      const standCell = row.appendTableCell(positionLabel_(p, postsById));
      styleParagraph(standCell.getChild(0).asParagraph(), {
        size: 10, color: SOFT, line: 1.0,
      });
      [numCell, hunterCell, standCell].forEach(function (c) {
        c.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(8).setPaddingRight(8);
      });
    }

    // === Kontakte ==============================================
    const kLabel = body.appendParagraph("KONTAKTE AM JAGDTAG");
    styleParagraph(kLabel, {
      size: 7.5, bold: true, color: SOFT, before: 14, after: 4, line: 1.0,
    });
    function appendContact(role, name, phone) {
      const parts = [name, phone].filter(Boolean).join(" · ");
      if (!parts) return;
      const p = body.appendParagraph(role + "   " + parts);
      styleParagraph(p, { size: 10, color: INK, line: 1.35 });
    }
    if (ev.vet_name || ev.vet_phone) appendContact("Tierarzt", ev.vet_name, ev.vet_phone);
    if (ev.coordinator_name || ev.coordinator_phone)
      appendContact("Nachsuchen-Koordinator", ev.coordinator_name, ev.coordinator_phone);
    const nsf = Array.isArray(ev.nachsuchenfuehrer) ? ev.nachsuchenfuehrer : [];
    nsf.forEach(function (p) {
      if (!p.name && !p.phone) return;
      appendContact("Nachsuchenführer", p.name, p.phone);
    });

    // === Standkarte QR =========================================
    // Two columns: the code on the left, what it is on the right. The plain
    // URL goes underneath so the sheet still works if the camera won't play
    // along or someone reads this on paper only.
    //
    // The link is the hunt, not the person: this PDF is built once per Runde
    // and the same file goes to everyone in it, so a personal link would be
    // wrong for all but one recipient. The Standkarte asks for the name on
    // first open anyway. The per-hunter link does go out — in the mail body,
    // which is rendered per recipient.
    const stkUrl = standkarteUrl_(ev, "");
    let stkBlob = null;
    try {
      stkBlob = qrPngBlob_(stkUrl, 8, 2, "standkarte");
    } catch (qrErr) {
      stkBlob = null;
    }

    const qLabel = body.appendParagraph("DEINE STANDKARTE AUFS HANDY");
    styleParagraph(qLabel, {
      size: 7.5, bold: true, color: SOFT, before: 14, after: 4, line: 1.0,
    });

    const qTable = body.appendTable();
    qTable.setBorderColor("#ffffff").setBorderWidth(0);
    const qRow = qTable.appendTableRow();
    const qLeft = qRow.appendTableCell();
    const qRight = qRow.appendTableCell();
    qTable.setColumnWidth(0, 142);
    qTable.setColumnWidth(1, 406);
    [qLeft, qRight].forEach(function (c) {
      c.setPaddingTop(0).setPaddingBottom(0);
    });
    qLeft.setPaddingLeft(0).setPaddingRight(12);
    qRight.setPaddingLeft(0).setPaddingRight(0);

    const qPara = qLeft.getChild(0).asParagraph();
    if (stkBlob) {
      // Docs renders inline images at 96 dpi against the PDF's 72 pt, so what
      // you ask for comes out at three quarters the size. 128 pt here lands at
      // ~96 pt on the page — about 34 mm printed, which keeps the modules
      // coarse enough for a phone to read at arm's length.
      const qImg = qPara.appendInlineImage(stkBlob);
      qImg.setWidth(128).setHeight(128);
    } else {
      qPara.setText("QR nicht verfügbar");
      styleParagraph(qPara, { size: 8, italic: true, color: SOFT, line: 1.2 });
    }

    appendInCell(qRight, "Mit der Handykamera abfotografieren, dann Deinen Namen antippen.", {
      size: 10, bold: true, color: INK, line: 1.3,
    });
    appendInCell(qRight,
      "Du bekommst Deine Standkarte für diesen Tag: Zeiten, Freigaben, Kontakte, "
      + "Dein Stand und eine Liste zum Eintragen, was Du gesehen und beschossen hast.", {
      size: 9.5, color: INK, line: 1.3, before: 2,
    });
    appendInCell(qRight,
      "Einmal zu Hause mit Empfang öffnen — danach lässt sie sich auf dem Stand "
      + "auch ohne Netz ausfüllen.", {
      size: 9, italic: true, color: SOFT, line: 1.3, before: 3,
    });
    appendInCell(qRight, stkUrl, { size: 7.5, color: SOFT, line: 1.2, before: 3 });

    // === Signature =============================================
    const sig = body.appendParagraph("Waidmannsheil! — " + (ev.organizer || "Dein Organisator"));
    styleParagraph(sig, {
      size: 9, italic: true, color: SOFT, before: 14, line: 1.0,
      align: DocumentApp.HorizontalAlignment.CENTER,
    });

    doc.saveAndClose();
    const pdfBlob = DriveApp.getFileById(docId).getAs("application/pdf").setName(filename + ".pdf");
    return pdfBlob;
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (err) { /* swallow */ }
  }
}

// Tight HTML body — the real content lives in the PDF attachment.
function buildInfoMailBodyHtml_(ev, squad, recipientPos) {
  const forename = forenameFor_(recipientPos.hunter || "");
  const rundeLabel = displayRundeNameServer_(squad.name);
  const dateLabel = formatGermanDate_(ev.date);
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Helvetica Neue\',\'Segoe UI\',sans-serif;font-weight:400;line-height:1.55;color:#232323;font-size:15px;max-width:640px;">',
    '<p>Hallo <strong>' + htmlEscape_(forename) + '</strong>,</p>',
    '<p>am <strong>' + htmlEscape_(dateLabel) + '</strong> findet die Drückjagd <strong>' + htmlEscape_(ev.name) + '</strong> statt.</p>',
    '<p>Du bist in der <strong>' + htmlEscape_(rundeLabel) + '</strong> eingeteilt. Im angehängten PDF findest Du:</p>',
    '<ul style="margin:4px 0 12px 22px;">',
    '<li>Deine Standnummer und die der anderen Schützen Deiner Runde,</li>',
    '<li>eine Karte des Reviers mit allen Ständen Deiner Runde markiert,</li>',
    '<li>Treffpunkt, Zeiten und die Kontakte am Jagdtag,</li>',
    '<li>einen QR-Code zu Deiner Standkarte fürs Handy.</li>',
    '</ul>',
    '<p>Bitte schau Dir das Dokument vor der Anfahrt einmal in Ruhe an. Die '
      + '<a href="' + htmlEscape_(standkarteUrl_(ev, recipientPos.hunter || "")) + '">Standkarte</a> '
      + 'öffnest Du am besten schon zu Hause — dann funktioniert sie auf dem Stand auch ohne Empfang.</p>',
    '<p>Waidmannsheil!<br>— ' + htmlEscape_(ev.organizer || "Dein Organisator") + '</p>',
    '</div>',
  ].join("");
}

// (Legacy — kept so the existing HTML preview path still compiles. The
// production send path uses the PDF builder above.)
function buildInfoMailHtml_(ev, squad, positions, recipientPos, postsById) {
  const recipient = recipientPos.hunter || "";
  const forename = forenameFor_(recipient);
  const eventDate = formatGermanDate_(ev.date);
  const rundeName = displayRundeNameServer_(squad.name);
  const ansteller = (positions[0] && positions[0].hunter) || squad.ansteller || "";
  const myLabel = positionLabel_(recipientPos, postsById);
  const myCoords = positionCoords_(recipientPos, postsById);
  const myMapLink = myCoords
    ? '<a href="https://www.google.com/maps?q=' + myCoords.lat + ',' + myCoords.lng + '" style="color:#1a5f1a;">In Google Maps öffnen</a>'
    : "";

  const rosterRows = positions.map(function (p, i) {
    const isMe = p.hunter === recipient;
    const label = String.fromCharCode(65 + i);
    const stand = positionLabel_(p, postsById);
    const role = i === 0 ? " — Ansteller" : "";
    const cells =
      '<td style="padding:6px 10px;border:1px solid #ddd;font-weight:700;color:#7a5a00;">' + label + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd;' + (isMe ? "font-weight:700;background:#fff2c0;" : "") + '">' + htmlEscape_(p.hunter) + htmlEscape_(role) + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd;color:#3a3a3a;">' + htmlEscape_(stand) + '</td>';
    return '<tr>' + cells + '</tr>';
  }).join("");

  const treffpunktLine = ev.treffpunkt
    ? '<p style="margin:4px 0;"><strong>Treffpunkt:</strong> ' + htmlEscape_(ev.treffpunkt) +
      (ev.treffpunkt_lat !== "" && ev.treffpunkt_lng !== ""
        ? ' (<a href="https://www.google.com/maps?q=' + ev.treffpunkt_lat + ',' + ev.treffpunkt_lng + '" style="color:#1a5f1a;">Karte</a>)'
        : "") + "</p>"
    : "";

  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Helvetica Neue\',\'Segoe UI\',sans-serif;font-weight:400;line-height:1.55;color:#232323;font-size:15px;max-width:680px;">',
    '<p>Hallo <strong>' + htmlEscape_(forename) + '</strong>,</p>',
    '<p>am <strong>' + htmlEscape_(eventDate) + '</strong> findet die Drückjagd <strong>' + htmlEscape_(ev.name) + '</strong> statt. Hier Deine Position und Deine Ansteller-Runde:</p>',
    '<h3 style="margin:18px 0 4px;">' + htmlEscape_(rundeName) + ' (Ansteller: ' + htmlEscape_(ansteller) + ')</h3>',
    '<p style="margin:4px 0;"><strong>Dein Stand:</strong> ' + htmlEscape_(myLabel) + '</p>',
    myMapLink ? '<p style="margin:2px 0 12px;">' + myMapLink + '</p>' : "",
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #ddd;font-size:14px;margin:8px 0 14px;">',
    '<thead><tr style="background:#f3f8df;color:#1a5f1a;">',
    '<th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">#</th>',
    '<th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Schütze</th>',
    '<th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Stand</th>',
    '</tr></thead><tbody>' + rosterRows + '</tbody></table>',
    '<p style="margin:6px 0 2px;color:#5a5a5a;font-size:13px;">Karte: Dein Stand ist rot markiert, die anderen Stände Deiner Runde gelb.</p>',
    '<img src="cid:squadmap" alt="Karte der Ansteller-Runde" style="max-width:100%;border:1px solid #ddd;border-radius:6px;display:block;margin:8px 0 14px;">',
    treffpunktLine,
    ev.treff_time ? '<p style="margin:4px 0;"><strong>Treffzeit:</strong> ' + htmlEscape_(ev.treff_time) + ' Uhr</p>' : "",
    ev.start_time ? '<p style="margin:4px 0;"><strong>Beginn:</strong> ' + htmlEscape_(ev.start_time) + ' Uhr</p>' : "",
    ev.end_time ? '<p style="margin:4px 0;"><strong>Ende:</strong> ' + htmlEscape_(ev.end_time) + ' Uhr</p>' : "",
    contactsBlockHtml_(ev),
    '<p style="margin:16px 0 6px;">Waidmannsheil!<br>— ' + htmlEscape_(ev.organizer || "Dein Organisator") + '</p>',
    '</div>',
  ].join("");
}

function contactsBlockHtml_(ev) {
  const lines = [];
  if (ev.vet_name || ev.vet_phone) {
    lines.push('<li><strong>Tierarzt:</strong> ' + htmlEscape_([ev.vet_name, ev.vet_phone].filter(Boolean).join(" — ")) + '</li>');
  }
  if (ev.coordinator_name || ev.coordinator_phone) {
    lines.push('<li><strong>Nachsuchen-Koordinator:</strong> ' + htmlEscape_([ev.coordinator_name, ev.coordinator_phone].filter(Boolean).join(" — ")) + '</li>');
  }
  const nsf = Array.isArray(ev.nachsuchenfuehrer) ? ev.nachsuchenfuehrer.filter(function (p) { return p.name || p.phone; }) : [];
  if (nsf.length) {
    const items = nsf.map(function (p) {
      return '<li>' + htmlEscape_([p.name, p.phone].filter(Boolean).join(" — ")) + '</li>';
    }).join("");
    lines.push('<li><strong>Nachsuchenführer:</strong><ul style="margin:2px 0 0 0;padding-left:20px;">' + items + '</ul></li>');
  }
  if (!lines.length) return "";
  return '<h4 style="margin:14px 0 4px;color:#5a5a5a;">Kontakte am Jagdtag</h4><ul style="margin:0;padding-left:20px;font-size:14px;">' + lines.join("") + '</ul>';
}

// Deletes an event row plus every row in event_hunters / event_squads that
// belongs to it. Iterates bottom-up so deletion indexes stay valid.
function eventDelete_(body) {
  const id = String(body.id || "").trim();
  if (!id) return { error: "id required" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const events = ensureSheet_(ss, SHEETS.events, EVENT_HEADER);
  const hunters = ensureSheet_(ss, SHEETS.event_hunters, EVENT_HUNTER_HEADER);
  const squads = ensureSheet_(ss, SHEETS.event_squads, EVENT_SQUAD_HEADER);

  function deleteWhere(sheet, column, value) {
    const last = sheet.getLastRow();
    if (last < 2) return 0;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (s) { return String(s).trim(); });
    const col = headers.indexOf(column);
    if (col < 0) return 0;
    const vals = sheet.getRange(2, col + 1, last - 1, 1).getValues();
    let removed = 0;
    for (let i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0]).trim() === value) {
        sheet.deleteRow(i + 2);
        removed++;
      }
    }
    return removed;
  }

  const huntersRemoved = deleteWhere(hunters, "event_id", id);
  const squadsRemoved = deleteWhere(squads, "event_id", id);
  const eventRemoved = deleteWhere(events, "id", id);
  if (!eventRemoved) return { error: "not found" };
  return { ok: true, hunters_removed: huntersRemoved, squads_removed: squadsRemoved };
}

function eventSquadDelete_(body) {
  const id = String(body.id || "").trim();
  if (!id) return { error: "id required" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.event_squads, EVENT_SQUAD_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: "not found" };
  const headerWidth = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, headerWidth).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const colId = headers.indexOf("id");
  const colEvent = headers.indexOf("event_id");
  const colName = headers.indexOf("name");
  const colType = headers.indexOf("type");
  const rows = sheet.getRange(2, 1, lastRow - 1, headerWidth).getValues();

  let deletedRow = -1;
  let deletedEventId = "";
  let deletedType = "";
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][colId]).trim() === id) {
      deletedRow = i + 2;
      deletedEventId = String(rows[i][colEvent] || "").trim();
      deletedType = String(rows[i][colType] || "ansteller").trim().toLowerCase();
      break;
    }
  }
  if (deletedRow < 0) return { error: "not found" };
  sheet.deleteRow(deletedRow);

  // Renumber the remaining squads of the same type for this event so the
  // sequence stays I, II, III, … with no gaps. (Deleting "Treibergruppe I"
  // promotes "Treibergruppe II" to "Treibergruppe I", and so on.)
  const renamed = renumberSquadsForEvent_(sheet, deletedEventId, deletedType);
  return { ok: true, renumbered: renamed };
}

// Given the event_squads sheet, an event id, and a squad type
// ("ansteller" or "treiber"), renames every squad of that type/event so
// the Roman-numeral suffix runs I, II, III, … 1..N. The relative order
// (by current numeric value, then by id as a tiebreaker for any name
// that didn't parse) is preserved.
function renumberSquadsForEvent_(sheet, eventId, type) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const headerWidth = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, headerWidth).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const colId = headers.indexOf("id");
  const colEvent = headers.indexOf("event_id");
  const colName = headers.indexOf("name");
  const colType = headers.indexOf("type");
  if (colName < 0) return 0;

  const prefix = (type === "treiber") ? "Treibergruppe" : "Ansteller Runde";
  const rowParser = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+([IVXLCDM]+|\\d+)\\s*$", "i");
  const rows = sheet.getRange(2, 1, lastRow - 1, headerWidth).getValues();
  const same = [];
  for (let i = 0; i < rows.length; i++) {
    const ev = String(rows[i][colEvent] || "").trim();
    const tp = String(rows[i][colType] || "ansteller").trim().toLowerCase();
    if (ev !== eventId || tp !== type) continue;
    const nm = String(rows[i][colName] || "").trim();
    const m = rowParser.exec(nm);
    const num = m
      ? (/^\d+$/.test(m[1]) ? parseInt(m[1], 10) : fromRoman_(m[1]))
      : 99999; // unparseable names sink to the bottom
    same.push({
      row: i + 2,
      currentName: nm,
      currentNum: num,
      id: String(rows[i][colId] || "").trim(),
    });
  }
  // Stable order: numeric, then id.
  same.sort(function (a, b) {
    if (a.currentNum !== b.currentNum) return a.currentNum - b.currentNum;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let changes = 0;
  for (let i = 0; i < same.length; i++) {
    const wanted = prefix + " " + toRoman_(i + 1);
    if (same[i].currentName !== wanted) {
      sheet.getRange(same[i].row, colName + 1).setValue(wanted);
      changes++;
    }
  }
  return changes;
}

// Roman-numeral helpers shared by the renumbering logic. Mirror the
// frontend implementations so the produced names match what the UI
// generates for fresh squads.
function toRoman_(n) {
  const R = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let v = Math.max(1, parseInt(n, 10) || 0);
  for (let i = 0; i < R.length; i++) {
    while (v >= R[i][0]) { out += R[i][1]; v -= R[i][0]; }
  }
  return out;
}

function fromRoman_(s) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const str = String(s || "").toUpperCase();
  let result = 0;
  for (let i = 0; i < str.length; i++) {
    const cur = map[str[i]] || 0;
    const next = map[str[i + 1]] || 0;
    if (next && cur < next) result -= cur;
    else result += cur;
  }
  return result;
}

function addressBookList_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.address_book, ADDRESS_BOOK_HEADER);
  return readSheet_(SHEETS.address_book, ADDRESS_BOOK_HEADER).map(function (r) {
    let lang = String(r.language || "").trim().toLowerCase();
    if (lang !== "de" && lang !== "en") lang = "de";
    return {
      name: String(r.name || ""),
      email: String(r.email || ""),
      language: lang,
    };
  });
}

function addressBookUpsert_(name, email, language) {
  if (!name || !email) return;
  const lang = (language === "en") ? "en" : "de";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEETS.address_book, ADDRESS_BOOK_HEADER);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (s) { return String(s).trim(); });
  const colName = headers.indexOf("name");
  const colEmail = headers.indexOf("email");
  const colLang = headers.indexOf("language");
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, ADDRESS_BOOK_HEADER.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][colName]).trim().toLowerCase() === name.toLowerCase()) {
        sheet.getRange(i + 2, colEmail + 1).setValue(email);
        if (colLang >= 0) sheet.getRange(i + 2, colLang + 1).setValue(lang);
        return;
      }
    }
  }
  appendByName_(sheet, { name: name, email: email, language: lang });
}

function randomToken_() {
  // 16 url-safe hex chars from Apps Script's UUID — enough to be
  // unguessable for an invitation link in a small hunting group.
  return Utilities.getUuid().replace(/-/g, "").slice(0, 16);
}

// Inlined post data — generated by tools/bake-posts.
// To regenerate: node tools/parse-kml.mjs && node -e ... (see README).
const INLINED_POSTS = [
  {
    "id": "HR-1",
    "name": "Nr. 1 Ackerkante",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.63065,
    "lng": 12.83461
  },
  {
    "id": "HR-2",
    "name": "Nr.2",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62943,
    "lng": 12.83042
  },
  {
    "id": "HR-2A",
    "name": "Nr. 2a",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6293676,
    "lng": 12.8266951
  },
  {
    "id": "HR-3",
    "name": "Nr. 3",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62806,
    "lng": 12.82424
  },
  {
    "id": "HR-3A",
    "name": "Nr. 3a",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62766,
    "lng": 12.82126
  },
  {
    "id": "HR-4",
    "name": "Nr. 4 - Schilfloch",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6273,
    "lng": 12.82624
  },
  {
    "id": "HR-5",
    "name": "Nr. 5",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62716,
    "lng": 12.83145
  },
  {
    "id": "HR-6",
    "name": "Nr. 6",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62691,
    "lng": 12.83396
  },
  {
    "id": "HR-7A",
    "name": "Nr. 7a",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62658,
    "lng": 12.81967
  },
  {
    "id": "HR-8",
    "name": "Nr. 8",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62573,
    "lng": 12.8328
  },
  {
    "id": "HR-9",
    "name": "Nr. 9",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62364,
    "lng": 12.83096
  },
  {
    "id": "HR-10",
    "name": "Nr. 10 - Märchenwald",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.624367,
    "lng": 12.8267271
  },
  {
    "id": "HR-10A",
    "name": "Nr. 10a",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6249,
    "lng": 12.82425
  },
  {
    "id": "HR-12",
    "name": "Nr. 12 - an den Buchen",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62254,
    "lng": 12.82915
  },
  {
    "id": "HR-13",
    "name": "Nr. 13 - Kanzel",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62155,
    "lng": 12.82405
  },
  {
    "id": "HR-13A",
    "name": "Nr. 13a - Wiese",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62057,
    "lng": 12.82695
  },
  {
    "id": "HR-14",
    "name": "Nr. 14 - Kanzel Klein Ivenack",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62075,
    "lng": 12.82244
  },
  {
    "id": "HR-16",
    "name": "Nr. 16",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61949,
    "lng": 12.82477
  },
  {
    "id": "HR-17",
    "name": "Nr. 17",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6208167,
    "lng": 12.8195108
  },
  {
    "id": "HR-18",
    "name": "Nr. 18",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61954,
    "lng": 12.81915
  },
  {
    "id": "HR-19",
    "name": "Nr. 19 - Kanzel Eichwerder Ost",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6176899,
    "lng": 12.8190928
  },
  {
    "id": "HR-20",
    "name": "Nr. 20",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61924,
    "lng": 12.82846
  },
  {
    "id": "HR-21",
    "name": "Nr. 21",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61834,
    "lng": 12.83149
  },
  {
    "id": "HR-22",
    "name": "Nr. 22",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6234511,
    "lng": 12.8222788
  },
  {
    "id": "HR-23",
    "name": "Nr. 23 - Scheidegraben",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61593,
    "lng": 12.82536
  },
  {
    "id": "HR-24",
    "name": "Nr. 24 - Graben",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61585,
    "lng": 12.82332
  },
  {
    "id": "HR-25",
    "name": "Nr. 25",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61323,
    "lng": 12.82363
  },
  {
    "id": "HR-26",
    "name": "Nr. 26",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61151,
    "lng": 12.82398
  },
  {
    "id": "HR-27",
    "name": "Nr. 27 - Lehmweg",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6103,
    "lng": 12.82117
  },
  {
    "id": "HR-28",
    "name": "Nr. 28 - Suhle",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61147,
    "lng": 12.81898
  },
  {
    "id": "HR-29",
    "name": "Nr. 29",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.60993,
    "lng": 12.81588
  },
  {
    "id": "HR-30",
    "name": "Nr. 30 - Lehmweg Ende",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61213,
    "lng": 12.81519
  },
  {
    "id": "HR-32",
    "name": "Nr. 32",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61487,
    "lng": 12.81954
  },
  {
    "id": "HR-33",
    "name": "Nr. 33 - Eichwerderbruch",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6162127,
    "lng": 12.81807
  },
  {
    "id": "HR-34",
    "name": "Nr. 34 - Ahornbock",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61599,
    "lng": 12.81583
  },
  {
    "id": "HR-35",
    "name": "Nr. 35",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61644,
    "lng": 12.8138
  },
  {
    "id": "HR-36",
    "name": "Nr. 36",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61759,
    "lng": 12.813
  },
  {
    "id": "HR-37",
    "name": "Nr. 37 - Kanzel Eichwerder Nord",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6191977,
    "lng": 12.8154821
  },
  {
    "id": "HR-38",
    "name": "Nr. 38 - Kanzel Eierkuhle Süd",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61037,
    "lng": 12.82736
  },
  {
    "id": "HR-39",
    "name": "Nr. 39 - Kanzel Eierkuhle",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61146,
    "lng": 12.8283
  },
  {
    "id": "HR-40",
    "name": "Nr. 40",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61084,
    "lng": 12.83003
  },
  {
    "id": "HR-41",
    "name": "Nr. 41 - Teiche",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61138,
    "lng": 12.8315
  },
  {
    "id": "HR-42",
    "name": "Nr. 42 - Bruch",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61453,
    "lng": 12.82918
  },
  {
    "id": "HR-43",
    "name": "Nr. 43 - Eichenzaum",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61408,
    "lng": 12.83164
  },
  {
    "id": "HR-44",
    "name": "Nr. 44 -Eichenallee",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61668,
    "lng": 12.83097
  },
  {
    "id": "HR-45",
    "name": "Nr. 45 - Eschentot",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61726,
    "lng": 12.83398
  },
  {
    "id": "HR-46",
    "name": "Nr 46 - Kanzel am Graben",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61798,
    "lng": 12.8359
  },
  {
    "id": "HR-47",
    "name": "Nr. 47",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61885,
    "lng": 12.83382
  },
  {
    "id": "HR-48",
    "name": "Nr. 48 - Kanzel Neue Wiese",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61956,
    "lng": 12.83408
  },
  {
    "id": "HR-49",
    "name": "Nr. 49",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62027,
    "lng": 12.83724
  },
  {
    "id": "HR-49A",
    "name": "Nr. 49a - Eichenhügel",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61516,
    "lng": 12.84635
  },
  {
    "id": "HR-50",
    "name": "Nr. 50 Erlenspitze",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62119,
    "lng": 12.83409
  },
  {
    "id": "HR-51",
    "name": "Nr. 51 Erlenbruch",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62161,
    "lng": 12.83827
  },
  {
    "id": "HR-52",
    "name": "Nr. 52 Erlenbruch",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62301,
    "lng": 12.83948
  },
  {
    "id": "HR-53",
    "name": "Nr. 53 Schilfinsel",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.62423,
    "lng": 12.83569
  },
  {
    "id": "HR-54",
    "name": "Nr. 54",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6098,
    "lng": 12.83417
  },
  {
    "id": "HR-55",
    "name": "Nr. 55",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61245,
    "lng": 12.8340772
  },
  {
    "id": "HR-56",
    "name": "Nr. 56 - Holzlager",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61394,
    "lng": 12.83465
  },
  {
    "id": "HR-57",
    "name": "Nr. 57 - Eichenkanzel/ Fichtenriegel",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61508,
    "lng": 12.83382
  },
  {
    "id": "HR-58",
    "name": "Nr. 58 - Kanzel",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61537,
    "lng": 12.83532
  },
  {
    "id": "HR-59",
    "name": "Nr. 59",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6153236,
    "lng": 12.8386548
  },
  {
    "id": "HR-61",
    "name": "Nr. 61",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6182,
    "lng": 12.84565
  },
  {
    "id": "HR-63",
    "name": "Nr. 63 - Eichenrand",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61641,
    "lng": 12.84416
  },
  {
    "id": "HR-66",
    "name": "Nr. 66 - Neue Wiese",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61366,
    "lng": 12.84972
  },
  {
    "id": "HR-68",
    "name": "Nr. 68 - Bruchkante Kiefernhügel",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61321,
    "lng": 12.84419
  },
  {
    "id": "HR-68A",
    "name": "Nr. 68a - Alter Damm",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61385,
    "lng": 12.84599
  },
  {
    "id": "HR-69",
    "name": "Nr. 69 - Sauenkanzel",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61385,
    "lng": 12.84152
  },
  {
    "id": "HR-69A",
    "name": "Nr. 69a - Torfstich",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6151,
    "lng": 12.84203
  },
  {
    "id": "HR-70",
    "name": "Nr. 70 - Kieskuhle",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.6108,
    "lng": 12.84163
  },
  {
    "id": "HR-71",
    "name": "Nr. 71",
    "area": "Hauptrevier",
    "kind": "Nr",
    "lat": 53.61175,
    "lng": 12.83866
  },
  {
    "id": "N-1",
    "name": "Nr. 1",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.64646,
    "lng": 12.87283
  },
  {
    "id": "N-2",
    "name": "Nr. 2 - Sukzession Wiese",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.64707,
    "lng": 12.87115
  },
  {
    "id": "N-3",
    "name": "Nr. 3 - Schweinsrücken",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.64753,
    "lng": 12.87351
  },
  {
    "id": "N-4",
    "name": "Nr. 4",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.64699,
    "lng": 12.87715
  },
  {
    "id": "N-5",
    "name": "Nr. 5 - Käferloch Nord",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.64856,
    "lng": 12.87527
  },
  {
    "id": "N-6",
    "name": "Nr. 6 - Wachturm",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.64922,
    "lng": 12.87402
  },
  {
    "id": "N-6A",
    "name": "Nr. 6a - Erlensuhle",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.64886,
    "lng": 12.87178
  },
  {
    "id": "N-7",
    "name": "Nr. 7",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.6492692,
    "lng": 12.8776542
  },
  {
    "id": "N-8",
    "name": "Nr. 8",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.65129,
    "lng": 12.87746
  },
  {
    "id": "N-9",
    "name": "Nr. 9 - Douglasie",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.65207,
    "lng": 12.88136
  },
  {
    "id": "N-10",
    "name": "Nr. 10 - Mirabelle",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.65309,
    "lng": 12.87829
  },
  {
    "id": "N-11",
    "name": "Nr. 11 -",
    "area": "Nord",
    "kind": "Nr",
    "lat": 53.6528245,
    "lng": 12.8751236
  },
  {
    "id": "NR-4",
    "name": "Nr. 4 - Grenzhügel",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.66305,
    "lng": 12.88705
  },
  {
    "id": "NR-11",
    "name": "Nr. 11 - Birne",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.65547,
    "lng": 12.8818
  },
  {
    "id": "NR-12",
    "name": "Nr. 12",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.65536,
    "lng": 12.87868
  },
  {
    "id": "NR-13",
    "name": "Nr. 13",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.6582167,
    "lng": 12.8781336
  },
  {
    "id": "NR-14",
    "name": "Nr. 14 - Waldhaus Wiese",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.659421,
    "lng": 12.8845359
  },
  {
    "id": "NR-15",
    "name": "Nr. 15 Grenzwiesen",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.6601015,
    "lng": 12.8819424
  },
  {
    "id": "NR-16",
    "name": "Nr. 16",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.66213,
    "lng": 12.8856
  },
  {
    "id": "NR-17",
    "name": "Nr. 17 - Fichte",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.65787,
    "lng": 12.88579
  },
  {
    "id": "NR-18",
    "name": "Nr. 18",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.65694,
    "lng": 12.88424
  },
  {
    "id": "NR-19",
    "name": "Nr. 19",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.6571994,
    "lng": 12.8783697
  },
  {
    "id": "NR-60",
    "name": "Nr. 60",
    "area": "Nordrand",
    "kind": "Nr",
    "lat": 53.6172334,
    "lng": 12.8411497
  },
  {
    "id": "OST-65",
    "name": "Nr.65 - Nordkanzel Neue Wiese",
    "area": "Ost",
    "kind": "Nr",
    "lat": 53.61524,
    "lng": 12.85003
  },
  {
    "id": "OST-DJB63",
    "name": "DJB 63 - Kiefer",
    "area": "Ost",
    "kind": "DJB",
    "lat": 53.61832,
    "lng": 12.85564
  }
];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postsSheet = ensureSheet_(ss, SHEETS.posts, POST_HEADER);

  // Upsert INLINED_POSTS — update by ID if the row exists, append if not.
  // Critically, this *preserves* user-created KS- / P- / FREE- prefixed
  // rows (Klettersitz / Pirsch). Earlier setup() wiped the whole posts
  // sheet and silently nuked those entries.
  const lastRow = postsSheet.getLastRow();
  const idToRow = {};
  if (lastRow > 1) {
    const existing = postsSheet.getRange(2, 1, lastRow - 1, POST_HEADER.length).getValues();
    for (let i = 0; i < existing.length; i++) {
      idToRow[String(existing[i][0]).trim()] = i + 2;
    }
  }
  const appended = [];
  for (let i = 0; i < INLINED_POSTS.length; i++) {
    const p = INLINED_POSTS[i];
    const row = [p.id, p.name, p.area, p.lat, p.lng];
    const rowIdx = idToRow[p.id];
    if (rowIdx) {
      postsSheet.getRange(rowIdx, 1, 1, POST_HEADER.length).setValues([row]);
    } else {
      appended.push(row);
    }
  }
  if (appended.length > 0) {
    postsSheet.getRange(postsSheet.getLastRow() + 1, 1, appended.length, POST_HEADER.length).setValues(appended);
  }
  const rows = INLINED_POSTS;
  ensureSheet_(ss, SHEETS.hunters, HUNTER_HEADER);
  ensureSheet_(ss, SHEETS.harvests, HARVEST_HEADER);

  // Catch up on any Kanzeln added in My Maps since the last bake.
  let syncMsg = "";
  try {
    const r = syncPostsFromKml();
    syncMsg = "\nKML-Sync: " + r.added + " neu, " + r.updated + " aktualisiert.";
  } catch (err) {
    syncMsg = "\nKML-Sync hat nicht funktioniert (" + err.message + "), wird stündlich erneut versucht.";
  }

  installArchiveTrigger();
  installPostsSyncTrigger();
  installStatsTrigger();

  SpreadsheetApp.getUi().alert(
    "Importiert: " + rows.length + " Hochsitze." + syncMsg + "\n" +
    "Trigger installiert: Saison-Rollover (01:00 täglich), KML-Sync (stündlich).\n\n" +
    "Trage jetzt im hunters-Tab Namen ein, dann Bereitstellen → Neue Bereitstellung → Web App."
  );
}
