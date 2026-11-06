/**
 * Final3 – QR-Code-Encoder (ohne externe Bibliotheken)
 * Läuft im Browser UND in Google Apps Script (ES5).
 * F3QR.matrix(text, 'M')  → boolean[][] (true = schwarz)
 * F3QR.svg(text, opts)     → SVG-String
 * F3QR.png(text, scale)    → Byte-Array (PNG, 1 Bit)
 */
var F3QR = (function () {
  var ECC = {
    L: { bits: 1, cw: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
         nb: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25] },
    M: { bits: 0, cw: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
         nb: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49] },
    Q: { bits: 3, cw: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
         nb: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68] },
    H: { bits: 2, cw: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
         nb: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81] }
  };

  function utf8(s) {
    var out = [];
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      var n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(v, e) {
    return Math.floor(rawModules(v) / 8) - ECC[e].cw[v] * ECC[e].nb[v];
  }
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 255;
  }
  function rsDivisor(deg) {
    var r = [];
    for (var i = 0; i < deg - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      for (var i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], f);
    });
    return r;
  }
  function alignPos(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2;
    var step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    var res = [6];
    for (var p = v * 4 + 17 - 7; res.length < n; p -= step) res.splice(1, 0, p);
    return res;
  }

  function matrix(text, ecl) {
    ecl = ECC[ecl] ? ecl : 'M';
    var bytes = utf8(text);
    var v, cap;
    for (v = 1; v <= 40; v++) {
      cap = dataCodewords(v, ecl) * 8;
      var need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= cap) break;
    }
    if (v > 40) throw new Error('QR: Text zu lang');
    // Bitstrom
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4);
    put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      data.push(b);
    }
    // ECC + Interleave
    var nb = ECC[ecl].nb[v], ecLen = ECC[ecl].cw[v];
    var raw = Math.floor(rawModules(v) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = rsDivisor(ecLen), blocks = [], pos = 0;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(pos, pos + shortLen - ecLen + (i < nShort ? 0 : 1));
      pos += dat.length;
      var ec = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ec));
    }
    var cw = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i !== shortLen - ecLen || j >= nShort) cw.push(blocks[j][i]);
      }
    }
    // Matrix
    var size = v * 4 + 17, M = [], F = [];
    for (i = 0; i < size; i++) {
      M.push([]); F.push([]);
      for (j = 0; j < size; j++) { M[i].push(false); F[i].push(false); }
    }
    function setF(x, y, d) { M[y][x] = d; F[y][x] = true; }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = alignPos(v), an = ap.length;
    for (i = 0; i < an; i++) for (j = 0; j < an; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === an - 1) || (i === an - 1 && j === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) {
        setF(ap[i] + dx2, ap[j] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
      }
    }
    function drawFormat(mask) {
      var d = (ECC[ecl].bits << 3) | mask, rem = d;
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((d << 10) | rem) ^ 0x5412;
      function bit(n) { return ((fb >>> n) & 1) !== 0; }
      for (q = 0; q <= 5; q++) setF(8, q, bit(q));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (q = 9; q < 15; q++) setF(14 - q, 8, bit(q));
      for (q = 0; q < 8; q++) setF(size - 1 - q, 8, bit(q));
      for (q = 8; q < 15; q++) setF(8, size - 15 + q, bit(q));
      setF(8, size - 8, true);
    }
    drawFormat(0);
    if (v >= 7) {
      var rem = v;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var vb = (v << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bt = ((vb >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3);
        setF(a, c, bt); setF(c, a, bt);
      }
    }
    // Daten platzieren
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
          if (!F[y][x] && bi < cw.length * 8) {
            M[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0;
            bi++;
          }
        }
      }
    }
    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        }
        if (!F[y][x] && inv) M[y][x] = !M[y][x];
      }
    }
    function penalty() {
      var p = 0, x, y, run, dark = 0;
      for (y = 0; y < size; y++) {
        run = 1;
        for (x = 1; x < size; x++) {
          if (M[y][x] === M[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
      }
      for (x = 0; x < size; x++) {
        run = 1;
        for (y = 1; y < size; y++) {
          if (M[y][x] === M[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
      }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
        var c0 = M[y][x];
        if (c0 === M[y][x + 1] && c0 === M[y + 1][x] && c0 === M[y + 1][x + 1]) p += 3;
      }
      var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      function match(get) {
        var cnt = 0;
        for (var a = 0; a < size; a++) for (var b = 0; b <= size - 11; b++) {
          var m1 = true, m2 = true;
          for (var k = 0; k < 11; k++) {
            var val = get(a, b + k) ? 1 : 0;
            if (val !== pat1[k]) m1 = false;
            if (val !== pat2[k]) m2 = false;
            if (!m1 && !m2) break;
          }
          if (m1) cnt++;
          if (m2) cnt++;
        }
        return cnt;
      }
      p += 40 * match(function (a, b) { return M[a][b]; });
      p += 40 * match(function (a, b) { return M[b][a]; });
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (M[y][x]) dark++;
      var total = size * size;
      p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    }
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var pp = penalty();
      if (pp < bestP) { bestP = pp; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return M;
  }

  function svg(text, opts) {
    opts = opts || {};
    var M = matrix(text, opts.ecl || 'M'), q = opts.quiet == null ? 4 : opts.quiet;
    var n = M.length + q * 2, d = '';
    for (var y = 0; y < M.length; y++) for (var x = 0; x < M.length; x++) {
      if (M[y][x]) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges"' +
      (opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : '') +
      ' role="img" aria-label="QR-Code"><rect width="100%" height="100%" fill="' + (opts.light || '#fff') + '"/>' +
      '<path d="' + d + '" fill="' + (opts.dark || '#000') + '"/></svg>';
  }

  // --- PNG (1 Bit Graustufe, unkomprimiertes Deflate) ---
  var CRC = null;
  function crc32(arr) {
    if (!CRC) {
      CRC = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC.push(c >>> 0);
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < arr.length; i++) crc = CRC[(crc ^ arr[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function chunk(type, data) {
    var t = [];
    for (var i = 0; i < 4; i++) t.push(type.charCodeAt(i));
    var td = t.concat(data);
    return u32(data.length).concat(td, u32(crc32(td)));
  }
  function png(text, scale, ecl) {
    var M = matrix(text, ecl || 'M');
    scale = scale || 6;
    var q = 4, n = (M.length + q * 2) * scale, rowBytes = Math.ceil(n / 8), raw = [];
    for (var y = 0; y < n; y++) {
      raw.push(0);
      var my = Math.floor(y / scale) - q;
      for (var bx = 0; bx < rowBytes; bx++) {
        var byte = 0;
        for (var b = 0; b < 8; b++) {
          var x = bx * 8 + b, mx = Math.floor(x / scale) - q;
          var dark = x < n && my >= 0 && my < M.length && mx >= 0 && mx < M.length && M[my][mx];
          byte = (byte << 1) | (dark ? 0 : 1);
        }
        raw.push(byte);
      }
    }
    var z = [0x78, 0x01], a1 = 1, a2 = 0;
    for (var i = 0; i < raw.length; i++) { a1 = (a1 + raw[i]) % 65521; a2 = (a2 + a1) % 65521; }
    for (var p = 0; p < raw.length; p += 65535) {
      var len = Math.min(65535, raw.length - p), fin = p + len >= raw.length ? 1 : 0;
      z.push(fin, len & 255, len >>> 8, (~len) & 255, ((~len) >>> 8) & 255);
      for (var k = 0; k < len; k++) z.push(raw[p + k]);
    }
    z = z.concat(u32(((a2 << 16) | a1) >>> 0));
    var ihdr = u32(n).concat(u32(n), [1, 0, 0, 0, 0]);
    return [137, 80, 78, 71, 13, 10, 26, 10].concat(chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', []));
  }

  return { matrix: matrix, svg: svg, png: png };
})();
if (typeof module !== 'undefined') module.exports = F3QR;
