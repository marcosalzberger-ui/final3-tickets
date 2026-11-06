/**
 * Final3 Ticketing – Cloudflare Pages Function  (/api/*)
 * Benötigte Variablen in Cloudflare (Settings › Variables and Secrets):
 *   SUPABASE_URL, SUPABASE_KEY, ORDER_SECRET
 * Optional (Bot-Schutz): TURNSTILE_SITEKEY, TURNSTILE_SECRET
 */
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });

export async function onRequest({ request, env, params }) {
  const path = (params.path || []).join('/');
  const url = new URL(request.url);
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY || '';

  if (!base || !key) {
    return json({ error: 'Konfiguration fehlt: SUPABASE_URL und SUPABASE_KEY in Cloudflare eintragen.' }, 500);
  }

  const rpc = async (fn, args) => {
    const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify(args)
    });
    const t = await r.text();
    let d;
    try { d = JSON.parse(t); } catch { d = t; }
    if (!r.ok) throw new Error((d && d.message) || 'Serverfehler');
    return d;
  };

  try {
    if (request.method === 'GET') {
      if (path === 'config') {
        return json({ supabaseUrl: base, supabaseKey: key, turnstileSiteKey: env.TURNSTILE_SITEKEY || '' });
      }
      if (path === 'shop') return json(await rpc('f3_shop_data', {}));
      return json({ error: 'Nicht gefunden' }, 404);
    }

    if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405);

    // Nur Anfragen von der eigenen Seite
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'Ungültige Herkunft' }, 403);
    if (Number(request.headers.get('content-length') || 0) > 20000) return json({ error: 'Anfrage zu groß' }, 413);

    const body = await request.json().catch(() => ({}));
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (!env.ORDER_SECRET) return json({ error: 'Konfiguration fehlt: ORDER_SECRET in Cloudflare eintragen.' }, 500);

    if (path === 'discount') {
      return json(await rpc('f3_shop_discount', { p_secret: env.ORDER_SECRET, p_ip: ip, p_code: body.code || '', p_items: body.items || [] }));
    }

    if (path === 'order') {
      if (env.TURNSTILE_SECRET) {
        const form = new FormData();
        form.append('secret', env.TURNSTILE_SECRET);
        form.append('response', body.turnstile || '');
        form.append('remoteip', ip);
        const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
          .then((r) => r.json())
          .catch(() => ({ success: false }));
        if (!v.success) return json({ error: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.' }, 400);
      }
      return json(await rpc('f3_shop_order', { p_secret: env.ORDER_SECRET, p_ip: ip, p_origin: url.origin, p_order: body.order || {} }));
    }

    return json({ error: 'Nicht gefunden' }, 404);
  } catch (e) {
    return json({ error: e.message || 'Fehler' }, 400);
  }
}
