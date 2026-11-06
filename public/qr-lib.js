// QR-Encoder für den Browser — wortgleich aus apps-script/Code.gs übernommen
// (Abschnitt "QR encoder"), dort gegen einen QR-Leser über 80 Codes geprüft.
// Byte-Modus, Fehlerkorrektur M, Version automatisch.
//
// Warum selbst: Ein Code aus einem kostenlosen Online-Generator ist oft ein
// "dynamischer" Code — er zeigt auf die Weiterleitung des Anbieters, und wenn
// der das Konto abschaltet oder Werbung davorhängt, ist der gedruckte Code tot.
// Diese Codes enthalten die Adresse selbst. Sie laufen nie ab, weil es nichts
// gibt, das ablaufen könnte.
//
// Bei Änderungen: beide Kopien gleich halten.

(function () {
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

  window.preyeQrEncode = qrEncode_;
})();