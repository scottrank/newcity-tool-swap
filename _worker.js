// New City Tool Swap backend (Cloudflare Pages advanced mode).
// Bindings: DB (D1: newcitytoolswap-db). Secrets: POLICY_AUD, TEAM_DOMAIN (Cloudflare Access).
// Everything outside /api/ is served from the static files.

const TZ = 'America/Chicago';
const COLORS = ['#e4572e', '#17bebb', '#2f6f4f', '#7b5ea7', '#d1495b', '#00798c', '#edae49', '#3d5a80', '#8f5e3c', '#c2185b'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AVATAR_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (String(e && e.message).includes('UNIQUE constraint failed: loans')) return json({ error: 'That tool is already lent out' }, 409);
      console.error(e && e.stack || e);
      return json({ error: 'Something went wrong' }, 500);
    }
  }
};

// ---------- auth (Cloudflare Access) ----------
let certCache = { at: 0, keys: [] };
const b64urlToBytes = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function accessKeys(team, force) {
  if (!force && certCache.keys.length && Date.now() - certCache.at < 3600e3) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) fail(500, 'Could not load sign-in keys');
  const body = await r.json();
  certCache = { at: Date.now(), keys: body.keys || [] };
  return certCache.keys;
}

function cookie(request, name) {
  const c = request.headers.get('cookie') || '';
  for (const part of c.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
}

async function identify(request, env) {
  if (env.DEV_BYPASS === '1') { const dev = request.headers.get('x-dev-email'); if (dev) return dev.trim().toLowerCase(); }
  const token = request.headers.get('cf-access-jwt-assertion') || cookie(request, 'CF_Authorization');
  if (!token || !env.TEAM_DOMAIN || !env.POLICY_AUD) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { return null; }
  if (header.alg !== 'RS256') return null;
  const team = String(env.TEAM_DOMAIN).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  let jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(team, true)).find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.POLICY_AUD)) return null;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
  if (payload.iss && payload.iss.replace(/\/+$/, '') !== `https://${team}`) return null;
  return typeof payload.email === 'string' && payload.email ? payload.email.toLowerCase() : null;
}

// ---------- helpers ----------
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayNum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const validDate = (d) => typeof d === 'string' && DATE_RE.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const loanDays = (l, t) => Math.max(1, dayNum(l.returned_on || t) - dayNum(l.lent_on));
function str(v, max, label, required) {
  const s = (v == null ? '' : String(v)).trim();
  if (required && !s) fail(400, `${label} is required`);
  if (s.length > max) fail(400, `${label} is too long`);
  return s;
}
function photoValue(v, maxLen, label) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !AVATAR_RE.test(v)) fail(400, `${label} must be a JPEG or PNG image`);
  if (v.length > maxLen) fail(400, `${label} is too large`);
  return v;
}
async function body(request) { try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; } }

const USER_COLS = 'id, name, street, contact, color, avatar, removed_at IS NOT NULL AS removed';
const getUser = (db, email) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`).bind(email).first();
const getTool = (db, id) => db.prepare('SELECT id, owner_id, name, notes, private, removed_at, photo IS NOT NULL AS has_photo FROM tools WHERE id = ?').bind(id).first();
const openLoan = (db, toolId) => db.prepare('SELECT * FROM loans WHERE tool_id = ? AND returned_on IS NULL AND removed_at IS NULL').bind(toolId).first();

// ---------- routes ----------
async function handleApi(request, env, url) {
  const db = env.DB;
  const email = await identify(request, env);
  if (!email) fail(401, 'Not signed in');
  const method = request.method.toUpperCase();
  const path = url.pathname.slice(5).replace(/\/+$/, '').split('/'); // after "/api/"
  const [a, b, c] = path;

  if (a === 'me' && !b) {
    const existing = await getUser(db, email);
    if (existing && existing.removed) fail(403, 'Your access to New City Tool Swap has been removed');
    if (method === 'GET') return json({ email, user: existing });
    if (method === 'PUT') {
      const x = await body(request);
      const name = str(x.name, 60, 'Name', true), street = str(x.street, 80, 'Street'), contact = str(x.contact, 120, 'Contact');
      const avatar = photoValue(x.avatar, 60000, 'Photo');
      const cur = existing;
      if (cur) await db.prepare('UPDATE users SET name = ?, street = ?, contact = ?, avatar = ? WHERE id = ?').bind(name, street, contact, avatar, cur.id).run();
      else await db.prepare('INSERT INTO users (email, name, street, contact, color, avatar) VALUES (?, ?, ?, ?, ?, ?)').bind(email, name, street, contact, COLORS[Math.floor(Math.random() * COLORS.length)], avatar).run();
      return json({ email, user: await getUser(db, email) });
    }
    fail(405, 'Method not allowed');
  }

  const me = await getUser(db, email);
  if (!me) fail(403, 'Set up your profile first');
  if (me.removed) fail(403, 'Your access to New City Tool Swap has been removed');
  const t = today();

  if (a === 'state' && !b && method === 'GET') return json(await state(db, me, t));

  if (a === 'tools') {
    if (!b) {
      if (method !== 'POST') fail(404, 'No such tool');
      const x = await body(request);
      const r = await db.prepare('INSERT INTO tools (owner_id, name, notes, private, photo) VALUES (?, ?, ?, ?, ?)')
        .bind(me.id, str(x.name, 80, 'Tool name', true), str(x.notes, 500, 'Notes'), x.private ? 1 : 0, photoValue(x.photo, 260000, 'Photo')).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    const id = /^\d+$/.test(b) ? +b : 0;
    const tool = id ? await getTool(db, id) : null;
    const visible = tool && !tool.removed_at && (!tool.private || tool.owner_id === me.id);
    if (!visible) fail(404, 'No such tool');
    const mine = tool.owner_id === me.id;

    if (c === 'photo' && method === 'GET') {
      const row = await db.prepare('SELECT photo FROM tools WHERE id = ?').bind(id).first();
      const m = row && row.photo && row.photo.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
      if (!m) fail(404, 'No photo');
      return new Response(b64urlToBytes(m[2].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), { headers: { 'content-type': m[1], 'cache-control': 'private, max-age=31536000' } });
    }
    if (!c && method === 'PATCH') {
      if (!mine) fail(403, 'Only the owner can edit this tool');
      const x = await body(request);
      const sets = ['name = ?', 'notes = ?', 'private = ?'];
      const vals = [str(x.name, 80, 'Tool name', true), str(x.notes, 500, 'Notes'), x.private ? 1 : 0];
      if ('photo' in x) { sets.push('photo = ?'); vals.push(photoValue(x.photo, 260000, 'Photo')); }
      await db.prepare(`UPDATE tools SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
      return json({ ok: true });
    }
    if (!c && method === 'DELETE') {
      if (!mine) fail(403, 'Only the owner can remove this tool');
      if (await openLoan(db, id)) fail(409, "Can't delete while it's lent out");
      await db.prepare("UPDATE tools SET removed_at = datetime('now') WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    if ((c === 'lend' || c === 'handoff') && method === 'POST') {
      if (!mine) fail(403, 'Only the owner can lend this tool');
      const x = await body(request);
      const cur = await openLoan(db, id);
      if (c === 'lend' && cur) fail(409, 'That tool is already lent out');
      if (c === 'handoff' && !cur) fail(409, "That tool isn't lent out");
      const borrowerName = str(x.borrower_name, 60, 'Name');
      let borrowerId = null;
      if (!borrowerName) {
        borrowerId = Number.isInteger(x.borrower_id) ? x.borrower_id : null;
        if (!borrowerId) fail(400, 'Pick who is borrowing it');
        if (borrowerId === me.id) fail(400, "You can't lend to yourself");
        if (!(await db.prepare('SELECT id FROM users WHERE id = ? AND removed_at IS NULL').bind(borrowerId).first())) fail(400, 'That neighbor is not on the app');
        if (cur && cur.borrower_id === borrowerId) fail(400, 'They already have it');
      }
      const lentOn = x.lent_on || t;
      if (!validDate(lentOn)) fail(400, 'Pick a valid date');
      if (lentOn > t) fail(400, "The date can't be in the future");
      if (cur && lentOn < cur.lent_on) fail(400, 'Hand-off date is before the current loan started');
      const due = x.due_on || null;
      if (due !== null && (!validDate(due) || due < lentOn)) fail(400, 'Due date must be on or after the lend date');
      const note = str(x.note, 300, 'Note');
      const insert = db.prepare('INSERT INTO loans (tool_id, lender_id, borrower_id, borrower_name, lent_on, due_on, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, me.id, borrowerId, borrowerName, lentOn, due, note);
      if (cur) await db.batch([db.prepare('UPDATE loans SET returned_on = ? WHERE id = ? AND returned_on IS NULL').bind(lentOn, cur.id), insert]);
      else await insert.run();
      return json({ ok: true });
    }
    fail(404, 'Not found');
  }

  if (a === 'loans' && /^\d+$/.test(b || '')) {
    const loan = await db.prepare('SELECT * FROM loans WHERE id = ? AND removed_at IS NULL').bind(+b).first();
    if (!loan || (loan.lender_id !== me.id && loan.borrower_id !== me.id)) fail(404, 'No such loan');
    if (c === 'return' && method === 'POST') {
      if (loan.returned_on) fail(409, 'Already returned');
      const ret = t < loan.lent_on ? loan.lent_on : t;
      await db.prepare('UPDATE loans SET returned_on = ? WHERE id = ? AND returned_on IS NULL').bind(ret, loan.id).run();
      return json({ ok: true });
    }
    if (!c && method === 'PATCH') {
      if (loan.lender_id !== me.id) fail(403, 'Only the lender can change the due date');
      const x = await body(request);
      const due = x.due_on || null;
      if (due !== null && (!validDate(due) || due < loan.lent_on)) fail(400, 'Due date must be on or after the lend date');
      await db.prepare('UPDATE loans SET due_on = ? WHERE id = ?').bind(due, loan.id).run();
      return json({ ok: true });
    }
    fail(404, 'Not found');
  }

  if (a === 'help') {
    if (!b) {
      if (method !== 'POST') fail(404, 'Not found');
      const x = await body(request);
      const neededOn = x.needed_on || null;
      if (neededOn !== null && (!validDate(neededOn) || neededOn < t)) fail(400, "Pick a date that isn't in the past");
      const r = await db.prepare('INSERT INTO help_requests (user_id, title, details, needed_on) VALUES (?, ?, ?, ?)')
        .bind(me.id, str(x.title, 100, 'What you need help with', true), str(x.details, 600, 'Details'), neededOn).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    const req = /^\d+$/.test(b) ? await db.prepare('SELECT * FROM help_requests WHERE id = ? AND closed_at IS NULL').bind(+b).first() : null;
    if (!req) fail(404, 'That request is closed or gone');
    const mine = req.user_id === me.id;
    if (c === 'offer' && method === 'POST') {
      if (mine) fail(400, "That's your own request");
      await db.prepare('INSERT OR IGNORE INTO help_offers (request_id, user_id) VALUES (?, ?)').bind(req.id, me.id).run();
      return json({ ok: true });
    }
    if (c === 'offer' && method === 'DELETE') {
      await db.prepare('DELETE FROM help_offers WHERE request_id = ? AND user_id = ?').bind(req.id, me.id).run();
      return json({ ok: true });
    }
    if (!c && method === 'PATCH') {
      if (!mine) fail(403, 'Only the person who asked can edit this');
      const x = await body(request);
      const neededOn = x.needed_on || null;
      if (neededOn !== null && (!validDate(neededOn) || (neededOn < t && neededOn !== req.needed_on))) fail(400, "Pick a date that isn't in the past");
      await db.prepare('UPDATE help_requests SET title = ?, details = ?, needed_on = ? WHERE id = ?')
        .bind(str(x.title, 100, 'What you need help with', true), str(x.details, 600, 'Details'), neededOn, req.id).run();
      return json({ ok: true });
    }
    if (c === 'close' && method === 'POST') {
      if (!mine) fail(403, 'Only the person who asked can close this');
      await db.prepare("UPDATE help_requests SET closed_at = datetime('now') WHERE id = ?").bind(req.id).run();
      return json({ ok: true });
    }
    fail(404, 'Not found');
  }

  fail(404, 'Not found');
}

async function state(db, me, t) {
  // Open help requests: those with a date stay up through that day; undated ones for 30 days.
  const [usersR, toolsR, loansR, helpR, offersR] = await db.batch([
    db.prepare(`SELECT ${USER_COLS} FROM users ORDER BY name COLLATE NOCASE`),
    db.prepare("SELECT id, owner_id, name, notes, private, removed_at, photo IS NOT NULL AS has_photo, CASE WHEN photo IS NULL THEN '' ELSE length(photo) || '-' || substr(photo, -10) END AS photo_v FROM tools ORDER BY name COLLATE NOCASE"),
    db.prepare('SELECT * FROM loans WHERE removed_at IS NULL ORDER BY lent_on DESC, id DESC'),
    db.prepare("SELECT id, user_id, title, details, needed_on, created_at FROM help_requests WHERE closed_at IS NULL AND (needed_on >= ? OR (needed_on IS NULL AND created_at >= datetime('now', '-30 days'))) ORDER BY id DESC").bind(t),
    db.prepare('SELECT o.request_id, o.user_id FROM help_offers o JOIN help_requests r ON r.id = o.request_id WHERE r.closed_at IS NULL ORDER BY o.created_at')
  ]);
  const users = usersR.results.map(u => ({ ...u, removed: !!u.removed })), allTools = toolsR.results, allLoans = loansR.results;
  const removedIds = new Set(users.filter(u => u.removed).map(u => u.id));
  const toolById = new Map(allTools.map(x => [x.id, x]));

  const tools = allTools
    .filter(x => !x.removed_at && !removedIds.has(x.owner_id) && (!x.private || x.owner_id === me.id))
    .map(({ removed_at, ...x }) => ({ ...x, private: x.private ? 1 : 0, has_photo: !!x.has_photo }));

  const loans = [];
  for (const l of allLoans) {
    const tool = toolById.get(l.tool_id);
    const days = loanDays(l, t);
    const canSee = tool && (!tool.private || tool.owner_id === me.id || l.borrower_id === me.id || l.lender_id === me.id);
    if (canSee) loans.push({ ...l, tool_name: tool.name, days });
  }


  const helpers = new Map();
  for (const o of offersR.results) { if (removedIds.has(o.user_id)) continue; if (!helpers.has(o.request_id)) helpers.set(o.request_id, []); helpers.get(o.request_id).push(o.user_id); }
  const help = helpR.results.filter(h => !removedIds.has(h.user_id)).map(h => ({ ...h, helpers: helpers.get(h.id) || [] }));

  return { me: { id: me.id }, today: t, users, tools, loans, help };
}
