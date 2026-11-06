/* Final3 Ticketing – gemeinsame Hilfsfunktionen (Shop, Admin, Scanner, Ticket) */
(function () {
  var F3 = (window.F3 = window.F3 || {});
  var CFG = null;

  F3.$ = function (s) { return document.querySelector(s); };

  F3.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* Einheitliche Formate: € 1.234,50 · 19.02.2027 · 14:30 Uhr */
  F3.eur = function (n) {
    var x = Math.round((+n || 0) * 100) / 100;
    var p = Math.abs(x).toFixed(2).split('.');
    return (x < 0 ? '− ' : '') + '€ ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1];
  };
  F3.date = function (v) {
    if (!v) return '';
    var s = String(v);
    var d = s.slice(0, 10).split('-');
    var out = d.length === 3 ? d[2] + '.' + d[1] + '.' + d[0] : s;
    if (s.length > 10) out += ', ' + s.slice(11, 16) + ' Uhr';
    return out;
  };

  F3.toast = function (t) {
    var e = document.getElementById('toast');
    if (!e) return;
    e.textContent = t;
    e.classList.add('show');
    clearTimeout(e._t);
    e._t = setTimeout(function () { e.classList.remove('show'); }, 2600);
  };

  F3.config = async function () {
    if (CFG) return CFG;
    try {
      var r = await fetch('/api/config', { cache: 'no-store' });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d.supabaseUrl) throw new Error(d.error || 'Konfiguration konnte nicht geladen werden.');
      CFG = d;
      try { localStorage.setItem('f3.cfg', JSON.stringify(d)); } catch (e) {}
      return CFG;
    } catch (e) {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem('f3.cfg') || 'null'); } catch (x) {}
      if (cached && cached.supabaseUrl) { CFG = cached; return CFG; }
      if (e instanceof TypeError) { var n = new Error('Keine Verbindung zum Server'); n.offline = true; throw n; }
      throw e;
    }
  };

  /* Aufruf der Shop-Schnittstelle (Cloudflare Function) */
  F3.shopApi = async function (path, body) {
    var r = await fetch('/api/' + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || 'Die Anfrage konnte nicht verarbeitet werden.');
    return d;
  };

  /* ---------------- Supabase (Admin, Scanner, Ticket) ---------------- */
  var SKEY = 'f3.session';
  F3.session = function () {
    try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; }
  };
  function saveSession(s) {
    try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch (e) {}
  }
  async function auth(path, body) {
    var c = await F3.config();
    var r = await fetch(c.supabaseUrl + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: c.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error_description || d.msg || d.message || 'Anmeldung fehlgeschlagen');
    var s = { access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in || 3600) * 1000, email: (d.user || {}).email };
    saveSession(s);
    return s;
  }
  F3.login = function (email, pw) {
    return auth('token?grant_type=password', { email: email, password: pw }).catch(function (e) {
      if (/invalid/i.test(e.message)) throw new Error('E-Mail oder Passwort falsch.');
      throw e;
    });
  };
  F3.logout = function () { saveSession(null); };
  async function accessToken() {
    var s = F3.session();
    if (!s) return null;
    if (Date.now() > s.exp - 60000) {
      try { s = await auth('token?grant_type=refresh_token', { refresh_token: s.refresh }); }
      catch (e) { saveSession(null); return null; }
    }
    return s.access;
  }

  /* RPC-Aufruf. opts.auth = true → mit Anmeldung */
  F3.rpc = async function (fn, args, opts) {
    opts = opts || {};
    var c = await F3.config();
    var h = { apikey: c.supabaseKey, 'Content-Type': 'application/json' };
    if (opts.auth) {
      var tok = await accessToken();
      if (!tok) { var e0 = new Error('Bitte neu anmelden.'); e0.auth = true; throw e0; }
      h.Authorization = 'Bearer ' + tok;
    }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000) : null;
    try {
      var r = await fetch(c.supabaseUrl + '/rest/v1/rpc/' + fn, {
        method: 'POST', headers: h, body: JSON.stringify(args || {}), signal: ctrl ? ctrl.signal : undefined
      });
      var txt = await r.text();
      var d; try { d = JSON.parse(txt); } catch (e) { d = txt; }
      if (!r.ok) {
        var msg = (d && d.message) || 'Serverfehler (' + r.status + ')';
        var err = new Error(msg.replace(/^AUTH:\s*/, ''));
        if (/^AUTH:|Kein Zugriff|JWT/i.test(msg) || r.status === 401) err.auth = true;
        throw err;
      }
      return d;
    } catch (e) {
      if (e.name === 'AbortError') { var t = new Error('Keine Verbindung (Zeitüberschreitung)'); t.offline = true; throw t; }
      if (e instanceof TypeError) { var n = new Error('Keine Verbindung zum Server'); n.offline = true; throw n; }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  /* QR als SVG (benötigt assets/qr.js) */
  F3.qrSvg = function (text, size) {
    return window.F3QR ? F3QR.svg(text, { size: size || 200 }) : '';
  };
})();
