// New City Tool Swap front end. Vanilla JS, no build step.
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const devAs = new URLSearchParams(location.search).get('as'); // only honored by a local dev server with DEV_BYPASS=1
let S = null, tab = 'tools', q = '', availOnly = false, profile = null, helpAll = false;

async function api(path, opts = {}) {
const headers = { 'content-type': 'application/json' };
if (devAs) headers['x-dev-email'] = devAs;
const r = await fetch('/api/' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
const data = await r.json().catch(() => ({}));
if (!r.ok) throw Object.assign(new Error(data.error || ('HTTP ' + r.status)), { status: r.status });
return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }
async function act(fn, ok) { try { await fn(); if (ok) toast(ok); await load(); } catch (e) { toast(e.message); } }

const userById = (id) => S.users.find(u => u.id === id);
const initials = (n) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
function avatar(u, lg) {
if (u && typeof u.avatar === 'string' && /^data:image\/(jpeg|png);base64,/.test(u.avatar)) return `<img class="av ${lg ? 'lg' : ''}" src="${esc(u.avatar)}" alt="${esc(u.name)}">`;
const color = u ? u.color : '#8a8378';
return `<span class="av ${lg ? 'lg' : ''}" style="background:${esc(color)}">${esc(initials(u ? u.name : '?'))}</span>`;
}
function who(id, name) { const u = id != null ? userById(id) : null; return `<span class="who">${avatar(u)}${esc(u ? u.name : name || 'Unknown')}${u ? '' : ' <span class="muted small">(not on app)</span>'}</span>`; }
const fmt = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function dueTag(l) { if (!l.due_on) return ''; const late = l.due_on < S.today; return `<span class="pill ${late ? 'late' : ''}">${late ? 'Overdue' : 'Due'} ${fmt(l.due_on)}</span>`; }
const openLoanFor = (toolId) => S.loans.find(l => l.tool_id === toolId && !l.returned_on);

async function load() {
try {
if (!profile || !profile.user) { profile = await api('me'); if (!profile.user) return renderProfile(true); }
S = await api('state');
render();
if (!tourSeen() && !$('#dlg').open && !Tour.active) Tour.start();
} catch (e) {
$('#app').innerHTML = `<p class="center muted">${e.status === 401 ? 'You are not signed in. Reload the page to sign in.' : esc(e.message)}</p>`;
}
}

function render() {
document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
renderHelp();
({ tools: renderTools, shelf: renderShelf })[tab]();
Tour.refresh();
}

function renderTools() {
const term = q.toLowerCase();
const rows = S.tools.filter(t => {
const loan = openLoanFor(t.id), owner = userById(t.owner_id);
if (availOnly && loan) return false;
if (!term) return true;
const holder = loan ? (loan.borrower_id ? userById(loan.borrower_id)?.name : loan.borrower_name) : '';
return [t.name, t.notes, owner?.name, holder].some(x => (x || '').toLowerCase().includes(term));
});
$('#app').innerHTML = `
<div class="bar"><input type="search" id="q" placeholder="Search tools or people" value="${esc(q)}">
<label class="chk"><input type="checkbox" id="avail" ${availOnly ? 'checked' : ''}> Available now</label></div>
<div class="card">${rows.map(t => {
const loan = openLoanFor(t.id);
return `<div class="row click" data-tool="${t.id}"><div class="grow"><div class="title">${esc(t.name)}${t.private ? ' <span class="pill">Private</span>' : ''}</div>
<div class="muted small">${who(t.owner_id)}</div></div>
${loan ? `<div class="small">${who(loan.borrower_id, loan.borrower_name)} ${dueTag(loan)}</div>` : '<span class="pill ok">Available</span>'}</div>`;
}).join('') || '<div class="empty">No tools match.</div>'}</div>`;
const qi = $('#q'); qi.oninput = () => { q = qi.value; renderTools(); $('#q').focus(); $('#q').setSelectionRange(q.length, q.length); };
$('#avail').onchange = (e) => { availOnly = e.target.checked; renderTools(); };
document.querySelectorAll('[data-tool]').forEach(r => r.onclick = () => toolDetail(+r.dataset.tool));
}

const firstName = (n) => (n || '').trim().split(/\s+/)[0] || 'there';
function phoneOf(contact) { const m = (contact || '').match(/\+?\d[\d\s().-]{8,}\d/); if (!m) return null; let d = m[0].replace(/\D/g, ''); if (d.length === 10) d = '1' + d; return { m, d }; }
const smsHref = (d, body) => `sms:+${d}?&body=${encodeURIComponent(body)}`;

function contactHtml(o, t) {
if (!o.contact) return '<span class="muted">No contact info</span>';
const m = o.contact.match(/\+?\d[\d\s().-]{8,}\d/);
if (!m || t.owner_id === S.me.id) return esc(o.contact);
let d = m[0].replace(/\D/g, ''); if (d.length === 10) d = '1' + d;
const me = userById(S.me.id), first = (n) => (n || '').trim().split(/\s+/)[0] || 'there';
const body = `Hi ${first(o.name)}, this is ${first(me && me.name)}, I'd like to borrow your ${t.name}.`;
const href = `sms:+${d}?&body=${encodeURIComponent(body)}`;
return esc(o.contact.slice(0, m.index)) + `<a href="${href}">${esc(m[0])}</a>` + esc(o.contact.slice(m.index + m[0].length)) + '<div class="small muted">Tap the number to text a borrow request</div>';
}

function toolDetail(id) {
const t = S.tools.find(x => x.id === id), o = userById(t.owner_id), loan = openLoanFor(id);
openDlg(`<h3>${esc(t.name)}</h3>
${t.has_photo ? `<img src="/api/tools/${t.id}/photo?v=${encodeURIComponent(t.photo_v || '')}" alt="${esc(t.name)}" style="display:block;max-width:100%;max-height:320px;object-fit:contain;border-radius:10px;margin:0 auto 10px">` : ''}
${t.notes ? `<p>${esc(t.notes)}</p>` : '<p class="muted">No notes.</p>'}
<div class="field"><span>Owner</span><div>${who(t.owner_id)}<div class="small muted">${esc(o.street)}</div><div>${contactHtml(o, t)}</div></div></div>
<div class="field"><span>Status</span><div>${loan ? `With ${who(loan.borrower_id, loan.borrower_name)} since ${fmt(loan.lent_on)}<br>${loan.due_on ? 'Due ' + fmt(loan.due_on) : 'No due date'}${loan.note ? `<div class="small muted">“${esc(loan.note)}”</div>` : ''}` : '<span class="pill ok">Available</span>'}</div></div>
<div class="actions"><button value="x">Close</button></div>`);
}

function renderShelf() {
const me = S.me.id;
const mine = S.tools.filter(t => t.owner_id === me);
const lent = S.loans.filter(l => l.lender_id === me && !l.returned_on);
const borrowed = S.loans.filter(l => l.borrower_id === me && !l.returned_on);
const hist = S.loans.filter(l => l.returned_on && (l.lender_id === me || l.borrower_id === me));
$('#app').innerHTML = `
<div class="actions" style="margin-top:8px"><button class="sm" id="takeTour">Take the tour</button><button class="sm" id="editProfile">Edit my profile</button></div>
<h2>My tools <button class="sm primary" id="addTool" style="float:right">+ Add tool</button></h2>
<div class="card">${mine.map(t => { const l = openLoanFor(t.id); return `<div class="row"><div class="grow"><div class="title">${esc(t.name)} ${t.private ? '<span class="pill">Private</span>' : ''}</div><div class="small muted">${esc(t.notes)}</div></div>
${l ? `<span class="small">Out with ${who(l.borrower_id, l.borrower_name)}</span>` : '<span class="pill ok">Home</span>'}
<div class="actions">${l ? '' : `<button class="sm primary" data-lend="${t.id}">Lend</button>`}<button class="sm" data-edit="${t.id}">Edit</button>${l ? '' : `<button class="sm danger" data-rm="${t.id}">Remove</button>`}</div></div>`; }).join('') || '<div class="empty">You haven\'t added any tools yet.</div>'}</div>
<h2>Lent out</h2>
<div class="card">${lent.map(l => `<div class="row"><div class="grow"><div class="title">${esc(l.tool_name)}</div><div class="small">${who(l.borrower_id, l.borrower_name)} · since ${fmt(l.lent_on)} · ${l.days}d ${dueTag(l)}</div>${l.note ? `<div class="small muted">“${esc(l.note)}”</div>` : ''}</div>
<div class="actions"><button class="sm primary" data-ret="${l.id}">Got it back</button><button class="sm" data-hand="${l.tool_id}">Hand off</button><button class="sm" data-due="${l.id}">Due date</button></div></div>`).join('') || '<div class="empty">Nothing lent out.</div>'}</div>
<h2>Borrowed</h2>
<div class="card">${borrowed.map(l => `<div class="row"><div class="grow"><div class="title">${esc(l.tool_name)}</div><div class="small">from ${who(l.lender_id)} · since ${fmt(l.lent_on)} · ${l.days}d ${dueTag(l)}</div></div><div class="actions"><button class="sm primary" data-ret="${l.id}">I returned it</button></div></div>`).join('') || '<div class="empty">You\'re not holding anything. Nice.</div>'}</div>
<h2>History</h2>
<div class="card">${hist.map(l => `<div class="row small"><div class="grow"><b>${esc(l.tool_name)}</b> · ${l.lender_id === me ? 'lent to ' + who(l.borrower_id, l.borrower_name) : 'borrowed from ' + who(l.lender_id)}</div><span class="muted">${fmt(l.lent_on)} – ${fmt(l.returned_on)} · ${l.days}d</span></div>`).join('') || '<div class="empty">No returned loans yet.</div>'}</div>`;
$('#addTool').onclick = () => editTool(null);
document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editTool(+b.dataset.edit));
document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const t = S.tools.find(x => x.id === +b.dataset.rm); if (confirm(`Remove "${t.name}"? Its loan history is kept.`)) act(() => api('tools/' + t.id, { method: 'DELETE' }), 'Removed'); });
document.querySelectorAll('[data-lend]').forEach(b => b.onclick = () => lendDlg(+b.dataset.lend, false));
document.querySelectorAll('[data-hand]').forEach(b => b.onclick = () => lendDlg(+b.dataset.hand, true));
document.querySelectorAll('[data-ret]').forEach(b => b.onclick = () => act(() => api(`loans/${b.dataset.ret}/return`, { method: 'POST', body: {} }), 'Marked returned'));
document.querySelectorAll('[data-due]').forEach(b => b.onclick = () => dueDlg(S.loans.find(l => l.id === +b.dataset.due)));
}

function quickPicks(base) { return `<div class="quick">${[['Tomorrow', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14]].map(([n, d]) => `<button type="button" class="sm" data-q="${d}">${n}</button>`).join('')}<button type="button" class="sm" data-q="0">None</button></div>`; }
function wireQuick(baseInput) { document.querySelectorAll('#dlg [data-q]').forEach(b => b.onclick = () => { const d = +b.dataset.q; $('#due').value = d ? addDays($(baseInput)?.value || S.today, d) : ''; }); }

function editTool(id) {
const t = id ? S.tools.find(x => x.id === id) : { name: '', notes: '', private: 0 };
let photo; // undefined = keep, null = remove, string = new
const curSrc = () => photo ? photo : (photo === undefined && t.has_photo ? `/api/tools/${t.id}/photo?v=${encodeURIComponent(t.photo_v || '')}` : null);
openDlg(`<h3>${id ? 'Edit tool' : 'Add a tool'}</h3>
<label class="field"><span>Tool name</span><input id="tn" required maxlength="80" value="${esc(t.name)}" placeholder="Tile saw"></label>
<label class="field"><span>Notes</span><textarea id="tnotes" rows="3" maxlength="500" placeholder="Model, quirks, extra blades…">${esc(t.notes)}</textarea></label>
<div class="field"><span>Photo (optional)</span><div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
<span id="tpvw"></span>
<label class="btn" style="cursor:pointer">Take or choose a photo<input id="tpf" type="file" accept="image/*" capture="environment" hidden></label>
<button type="button" id="tprm">Remove photo</button></div></div>
<label class="chk"><input type="checkbox" id="tp" ${t.private ? 'checked' : ''}> Private (only I can see it)</label>
<div class="actions">${id ? (openLoanFor(id) ? '<span class="small muted" style="margin-right:auto">Can\'t delete while it\'s lent out</span>' : '<button type="button" class="danger" id="delTool" style="margin-right:auto">Delete</button>') : ''}<button value="x" formnovalidate>Cancel</button><button class="primary" value="ok">Save</button></div>`,
() => act(() => api(id ? 'tools/' + id : 'tools', { method: id ? 'PATCH' : 'POST', body: { name: $('#tn').value, notes: $('#tnotes').value, private: $('#tp').checked, ...(photo !== undefined ? { photo } : {}) } }), 'Saved'));
const tpv = () => { const src = curSrc(); $('#tpvw').innerHTML = src ? `<img src="${esc(src)}" alt="" style="max-width:120px;max-height:120px;object-fit:contain;border-radius:8px">` : '<span class="small muted">No photo</span>'; $('#tprm').hidden = !src; };
tpv();
$('#tpf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { photo = await shrinkToolPhoto(f); tpv(); } catch (er) { toast(er.message); } e.target.value = ''; };
$('#tprm').onclick = () => { photo = null; tpv(); };
const del = $('#delTool');
if (del) del.onclick = () => { if (confirm(`Delete "${t.name}"? It comes off the list, but its loan history is kept.`)) { $('#dlg').close('x'); act(() => api('tools/' + id, { method: 'DELETE' }), 'Deleted'); } };
}

function lendDlg(toolId, handoff) {
const t = S.tools.find(x => x.id === toolId), cur = openLoanFor(toolId);
const others = S.users.filter(u => !u.removed && u.id !== S.me.id && (!cur || u.id !== cur.borrower_id));
openDlg(`<h3>${handoff ? 'Hand off' : 'Lend'} ${esc(t.name)}</h3>
${handoff ? `<p class="small muted">Closes the loan to ${esc(cur.borrower_id ? userById(cur.borrower_id).name : cur.borrower_name)} and opens a new one on the same date.</p>` : ''}
<div class="field"><span>To a neighbor</span><div class="card" style="max-height:200px;overflow:auto">${others.map(u => `<label class="row chk"><input type="radio" name="bw" value="${u.id}"> ${avatar(u)} ${esc(u.name)} <span class="muted small">${esc(u.street)}</span></label>`).join('') || '<div class="empty">No other neighbors yet.</div>'}</div></div>
<label class="field"><span>…or someone not on the app</span><input id="bname" maxlength="60" placeholder="Their name"></label>
<label class="field"><span>${handoff ? 'Hand-off date' : 'Date lent'}</span><input type="date" id="lon" value="${S.today}" max="${S.today}"></label>
<div class="field"><span>Due date (optional)</span><input type="date" id="due">${quickPicks()}</div>
<label class="field"><span>Note (optional)</span><input id="lnote" maxlength="300"></label>
<div class="actions"><button value="x" formnovalidate>Cancel</button><button class="primary" value="ok">${handoff ? 'Hand off' : 'Lend'}</button></div>`,
() => { const sel = $('#dlg input[name=bw]:checked'); return act(() => api(`tools/${toolId}/${handoff ? 'handoff' : 'lend'}`, { method: 'POST', body: { borrower_id: sel && !$('#bname').value.trim() ? +sel.value : null, borrower_name: $('#bname').value, lent_on: $('#lon').value, due_on: $('#due').value || null, note: $('#lnote').value } }), handoff ? 'Handed off' : 'Lent'); });
$('#bname').oninput = () => { if ($('#bname').value) document.querySelectorAll('#dlg input[name=bw]').forEach(r => r.checked = false); };
document.querySelectorAll('#dlg input[name=bw]').forEach(r => r.onchange = () => $('#bname').value = '');
wireQuick('#lon');
}

function dueDlg(l) {
openDlg(`<h3>Due date: ${esc(l.tool_name)}</h3><div class="field"><span>Due</span><input type="date" id="due" value="${l.due_on || ''}" min="${l.lent_on}">${quickPicks()}</div>
<div class="actions"><button value="x" formnovalidate>Cancel</button><button class="primary" value="ok">Save</button></div>`,
() => act(() => api('loans/' + l.id, { method: 'PATCH', body: { due_on: $('#due').value || null } }), 'Due date updated'));
document.querySelectorAll('#dlg [data-q]').forEach(b => b.onclick = () => { const d = +b.dataset.q; $('#due').value = d ? addDays(S.today, d) : ''; });
}

// ---------- project help ----------
const helpById = (id) => (S.help || []).find(h => h.id === id);
const whenText = (h) => !h.needed_on ? 'Any day' : h.needed_on === S.today ? 'Today' : h.needed_on === addDays(S.today, 1) ? 'Tomorrow' : new Date(h.needed_on + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const isNewHelp = (h) => Date.parse(String(h.created_at).replace(' ', 'T') + 'Z') > Date.now() - 2 * 864e5;
const helperCount = (h) => h.helpers.length ? `${h.helpers.length} ${h.helpers.length === 1 ? 'guy' : 'guys'} helping` : 'Nobody yet';

function renderHelp() {
$('.helpzone').hidden = false;
const list = S.help || [];
const shown = helpAll ? list : list.slice(0, 3);
$('#helpFeed').innerHTML = list.length ? `<div class="helplabel muted">Guys who need a hand</div><div class="helpfeed">${shown.map(helpCard).join('')}
${list.length > 3 ? `<button type="button" class="helpmore sm" id="helpMore">${helpAll ? 'Show fewer' : `Show all ${list.length} requests`}</button>` : ''}</div>` : '';
document.querySelectorAll('#helpFeed [data-help]').forEach(c => c.onclick = (e) => { if (!e.target.closest('button')) helpDetail(+c.dataset.help); });
document.querySelectorAll('#helpFeed [data-hoffer]').forEach(b => b.onclick = () => offerHelp(+b.dataset.hoffer));
document.querySelectorAll('#helpFeed [data-hview]').forEach(b => b.onclick = () => helpDetail(+b.dataset.hview));
document.querySelectorAll('#helpFeed [data-hedit]').forEach(b => b.onclick = () => askHelpDlg(helpById(+b.dataset.hedit)));
document.querySelectorAll('#helpFeed [data-hclose]').forEach(b => b.onclick = () => closeHelp(+b.dataset.hclose));
const more = $('#helpMore'); if (more) more.onclick = () => { helpAll = !helpAll; renderHelp(); };
}

function helpCard(h) {
const u = userById(h.user_id), mine = h.user_id === S.me.id, joined = h.helpers.includes(S.me.id);
const lead = mine ? 'You asked' : `${esc(firstName(u && u.name))} needs a hand`;
const btns = mine ? `<button class="sm" data-hview="${h.id}">See who's helping</button><button class="sm" data-hedit="${h.id}">Edit</button><button class="sm" data-hclose="${h.id}">Mark done</button>`
  : joined ? `<span class="pill ok">You're in ✓</span><button class="sm" data-hview="${h.id}">Details</button>`
  : `<button class="sm primary" data-hoffer="${h.id}">I can help</button><button class="sm" data-hview="${h.id}">Details</button>`;
return `<div class="helpcard ${mine ? 'mine' : ''}" data-help="${h.id}"><div class="helphead">${avatar(u, true)}<div class="grow">
<div class="small muted">${lead}${isNewHelp(h) ? '<span class="pill new">New</span>' : ''}</div><div class="title">${esc(h.title)}</div>
<div class="small muted">${whenText(h)} · ${helperCount(h)}</div></div></div><div class="actions">${btns}</div></div>`;
}

function textLink(u, body, label) {
const ph = phoneOf(u && u.contact);
if (!ph) return u && u.contact ? `<div class="small">Reach ${esc(firstName(u.name))}: ${esc(u.contact)}</div>` : '';
return `<a class="textbtn" href="${smsHref(ph.d, body)}">${esc(label)}</a>`;
}

function helpDetail(id) {
const h = helpById(id); if (!h) return;
const u = userById(h.user_id), me = userById(S.me.id), mine = h.user_id === S.me.id, joined = h.helpers.includes(S.me.id);
const helpersHtml = h.helpers.length ? `<div class="helperlist">${h.helpers.map(hid => { const hu = userById(hid); const ph = mine && hu ? phoneOf(hu.contact) : null;
  return `<div>${who(hid)}${ph ? ` · <a href="${smsHref(ph.d, `Hi ${firstName(hu.name)}, thanks for offering to help with "${h.title}"!`)}">text ${esc(firstName(hu.name))}</a>` : ''}</div>`; }).join('')}</div>` : '<span class="muted">Nobody yet</span>';
const acts = mine ? `<button type="button" class="danger" id="hClose" style="margin-right:auto">Mark done</button><button type="button" id="hEdit">Edit</button><button value="x">Close</button>`
  : joined ? `<button type="button" id="hOut" style="margin-right:auto">Back out</button><button value="x">Close</button>`
  : `<button value="x">Close</button><button type="button" class="primary" id="hOffer">I can help</button>`;
openDlg(`<h3>${esc(h.title)}</h3>
<div class="field"><span>Who's asking</span><div>${who(h.user_id)}${u && u.street ? `<div class="small muted">${esc(u.street)}</div>` : ''}</div></div>
<div class="field"><span>When</span><div>${whenText(h)}</div></div>
${h.details ? `<div class="field"><span>Details</span><div style="white-space:pre-wrap">${esc(h.details)}</div></div>` : ''}
<div class="field"><span>Who's helping</span>${helpersHtml}</div>
${!mine && joined ? textLink(u, `Hi ${firstName(u && u.name)}, this is ${firstName(me && me.name)}. I can help with "${h.title}".`, `Text ${firstName(u && u.name)}`) : ''}
<div class="actions">${acts}</div>`);
const o = $('#hOffer'); if (o) o.onclick = () => { $('#dlg').close('x'); offerHelp(id); };
const out = $('#hOut'); if (out) out.onclick = () => { $('#dlg').close('x'); act(() => api(`help/${id}/offer`, { method: 'DELETE' }), "You're off this one"); };
const ed = $('#hEdit'); if (ed) ed.onclick = () => askHelpDlg(h);
const cl = $('#hClose'); if (cl) cl.onclick = () => { $('#dlg').close('x'); closeHelp(id); };
}

async function offerHelp(id) {
const h = helpById(id); if (!h) return;
try { await api(`help/${id}/offer`, { method: 'POST', body: {} }); } catch (e) { toast(e.message); return load(); }
await load();
const u = userById(h.user_id), me = userById(S.me.id), name = firstName(u && u.name);
const link = textLink(u, `Hi ${name}, this is ${firstName(me && me.name)}. I saw your request on New City Tool Swap and I can help with "${h.title}".`, `Text ${name}`);
openDlg(`<h3>Thanks for pitching in!</h3>
<p>You're on the list for <b>${esc(h.title)}</b>. ${name} can see you offered.</p>
${link ? `<p class="small muted">Let ${esc(name)} know you're coming and work out the details:</p>${link}` : `<p class="small muted">${esc(name)} hasn't added contact info, so keep an eye on the request for details.</p>`}
<div class="actions"><button value="x">Done</button></div>`);
}

function closeHelp(id) {
const h = helpById(id); if (!h) return;
if (confirm(`Mark "${h.title}" as done? It comes off the list for everyone.`)) act(() => api(`help/${id}/close`, { method: 'POST', body: {} }), 'Marked done. Nice work!');
}

function nextSaturday() { const d = new Date(S.today + 'T12:00:00Z'); const add = (6 - d.getUTCDay() + 7) % 7; return addDays(S.today, add); }

function askHelpDlg(edit) {
if (!S) return;
const e = edit && edit.id ? edit : null;
openDlg(`<h3>${e ? 'Edit your request' : 'Ask for a hand'}</h3>
${e ? '<p class="small muted">Changes show up for everyone right away. Anyone who already offered stays on the list.</p>' : `<p class="small">This is where you ask the guys for help with a project: hauling gravel, moving a couch, building a fence, splitting firewood, tearing out a deck. Your request shows up at the top of the site for everyone, and anyone can offer to help with one tap.</p>`}
<label class="field"><span>What do you need help with?</span><input id="hTitle" required maxlength="100" placeholder="Haul a load of gravel to my backyard" value="${esc(e ? e.title : '')}"></label>
<label class="field"><span>Details (optional)</span><textarea id="hDetails" rows="3" maxlength="600" placeholder="Start time, how long it should take, how many guys, whether to bring a truck or tools…">${esc(e ? e.details : '')}</textarea></label>
<div class="field"><span>When (optional)</span><input type="date" id="hDate" min="${S.today}" value="${esc(e && e.needed_on || '')}">
<div class="quick"><button type="button" class="sm" data-hd="${S.today}">Today</button><button type="button" class="sm" data-hd="${addDays(S.today, 1)}">Tomorrow</button><button type="button" class="sm" data-hd="${nextSaturday()}">This Saturday</button><button type="button" class="sm" data-hd="">Any day</button></div></div>
<div class="actions"><button value="x" formnovalidate>Cancel</button><button class="primary" value="ok">${e ? 'Save changes' : 'Post request'}</button></div>`,
() => act(() => api(e ? 'help/' + e.id : 'help', { method: e ? 'PATCH' : 'POST', body: { title: $('#hTitle').value, details: $('#hDetails').value, needed_on: $('#hDate').value || null } }), e ? 'Request updated' : 'Request posted. The guys will see it up top.'));
document.querySelectorAll('#dlg [data-hd]').forEach(b => b.onclick = () => { $('#hDate').value = b.dataset.hd; });
}
$('#askHelp').onclick = () => askHelpDlg();

function shrinkPhoto(file) {
return new Promise((res, rej) => {
const url = URL.createObjectURL(file), img = new Image();
img.onload = () => {
URL.revokeObjectURL(url);
const c = document.createElement('canvas'); c.width = c.height = 160;
const s = Math.min(img.naturalWidth, img.naturalHeight);
c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 160, 160);
let q = 0.8, d = c.toDataURL('image/jpeg', q);
while (d.length > 40000 && q > 0.3) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
res(d);
};
img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
img.src = url;
});
}

function shrinkToolPhoto(file) {
return new Promise((res, rej) => {
const url = URL.createObjectURL(file), img = new Image();
img.onload = () => {
URL.revokeObjectURL(url);
const k = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
let q = 0.75, d = c.toDataURL('image/jpeg', q);
while (d.length > 200000 && q > 0.3) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
if (d.length > 250000) { rej(new Error('That photo is too large')); return; }
res(d);
};
img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
img.src = url;
});
}

function renderProfile(first) {
const u = (profile && profile.user) || {};
let newAv = u.avatar || null;
openDlg(`<h3>${first ? 'Welcome to New City Tool Swap' : 'Your profile'}</h3>
${first ? '<p class="small muted">Neighbors will see your name, street and contact line. Your email stays private.</p>' : `<p class="small muted">Signed in as ${esc(profile.email)} (only you see this)</p>`}
<label class="field"><span>Name</span><input id="pn" required maxlength="60" value="${esc(u.name || '')}"></label>
<label class="field"><span>Street or block</span><input id="ps" maxlength="80" value="${esc(u.street || '')}" placeholder="Elm St, 400 block"></label>
<label class="field"><span>How to reach you</span><input id="pc" maxlength="120" value="${esc(u.contact || '')}" placeholder="text 515-555-0142"></label>
<div class="field"><span>Photo (optional)</span><div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
<span id="pvw"></span>
<label class="btn" style="cursor:pointer">Take or choose a photo<input id="pf" type="file" accept="image/*" capture="user" hidden></label>
<button type="button" id="prm">Remove photo</button></div></div>
<div class="actions">${first ? '' : '<button value="x" formnovalidate>Cancel</button>'}<button class="primary" value="ok">Save</button></div>`,
async () => { try { profile = await api('me', { method: 'PUT', body: { name: $('#pn').value, street: $('#ps').value, contact: $('#pc').value, avatar: newAv } }); await load(); } catch (e) { toast(e.message); if (first) renderProfile(true); } }, first);
const pv = () => { $('#pvw').innerHTML = newAv ? `<img class="av lg" src="${esc(newAv)}" alt="">` : `<span class="av lg" style="background:${esc(u.color || '#8a8378')}">${esc(initials(u.name || '?'))}</span>`; $('#prm').hidden = !newAv; };
pv();
$('#pf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { newAv = await shrinkPhoto(f); pv(); } catch (er) { toast(er.message); } e.target.value = ''; };
$('#prm').onclick = () => { newAv = null; pv(); };
}

function openDlg(html, onOk, locked) {
const d = $('#dlg'); $('#dlgForm').innerHTML = html;
d.onclose = () => { if (d.returnValue === 'ok' && onOk) onOk(); };
d.oncancel = (e) => { if (locked) e.preventDefault(); };
d.returnValue = ''; d.showModal();
}

function route() { tab = (location.hash.slice(1) || 'tools'); if (!['tools', 'shelf'].includes(tab)) tab = 'tools'; if (S) render(); }
window.addEventListener('hashchange', route);
document.addEventListener('click', (e) => { if (e.target && e.target.id === 'editProfile') renderProfile(false); if (e.target && e.target.id === 'takeTour') Tour.start(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#dlg').open) load(); });
window.addEventListener('focus', () => { if (!$('#dlg').open) load(); });
setInterval(() => { if (!document.hidden && !$('#dlg').open) load(); }, 60000);

// ---------- first-visit tour ----------
const tourKey = () => 'ncts-tour-done-' + (S && S.me ? S.me.id : '');
function tourSeen() { try { return localStorage.getItem(tourKey()) === '1'; } catch { return false; } }
function markTourSeen() { try { localStorage.setItem(tourKey(), '1'); } catch {} }

const Tour = (() => {
  const steps = [
    { tab: null, title: 'Welcome to New City Tool Swap',
      body: "Borrow tools from the guys, lend out your own, and ask for a hand with projects. This quick tour shows you around. It takes about a minute." },
    { tab: null, target: '#askHelp', title: 'Need a hand?',
      body: "Tap this button to ask the guys for help with a project, like hauling gravel or moving furniture. Open requests show up right below it, and anyone can tap <b>I can help</b>." },
    { tab: 'tools', target: 'nav a[data-tab="tools"]', title: 'All tools',
      body: "Everyone's tools live here. Tap any tool to see its notes and photo, who owns it, and who has it right now." },
    { tab: 'tools', target: '.bar', title: 'Find what you need',
      body: "Search by tool or by neighbor. Tick <b>Available now</b> to hide tools that are already lent out." },
    { tab: 'tools', target: '#app .card .row.click', title: 'Ask to borrow',
      body: "Open a tool and tap the owner's phone number. A text asking to borrow it is written for you." },
    { tab: 'shelf', target: '#addTool', title: 'Add your tools',
      body: "On <b>My shelf</b>, tap <b>+ Add tool</b> to list something you're willing to lend. Add a photo and notes, or mark it private." },
    { tab: 'shelf', target: '[data-lend], #app h2:nth-of-type(2)', title: 'Lending and returns',
      body: "When a neighbor picks something up, tap <b>Lend</b> next to the tool and choose who has it. Tap <b>Got it back</b> when it comes home." },
    { tab: 'shelf', target: '#takeTour', title: "You're all set",
      body: "You can update your name, street and contact info with <b>Edit my profile</b>, and replay this tour anytime with <b>Take the tour</b>." },
  ];
  let i = 0, root = null;
  const api = { active: false };

  function el(sel) { if (!sel) return null; for (const s of sel.split(/,\s*/)) { const e = document.querySelector(s); if (e && e.getClientRects().length) return e; } return null; }

  function build() {
    root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = `<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
      <div class="tour-step small muted"></div><h3 id="tourTitle"></h3><p class="tour-body"></p>
      <div class="tour-nav"><button type="button" class="sm tour-skip">Skip tour</button><span class="grow"></span>
      <button type="button" class="sm tour-back">Back</button><button type="button" class="sm primary tour-next">Next</button></div></div>`;
    document.body.appendChild(root);
    root.querySelector('.tour-skip').onclick = end;
    root.querySelector('.tour-back').onclick = () => go(i - 1);
    root.querySelector('.tour-next').onclick = () => (i === steps.length - 1 ? end() : go(i + 1));
    root.addEventListener('click', (e) => { if (e.target === root) e.stopPropagation(); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
  }
  function onKey(e) {
    if (!api.active) return;
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight') root.querySelector('.tour-next').click();
    else if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
  }

  function go(n) {
    i = Math.max(0, Math.min(steps.length - 1, n));
    const st = steps[i];
    if (st.tab && st.tab !== tab) { location.hash = st.tab; }   // route() re-renders, which calls refresh()
    root.querySelector('.tour-step').textContent = `Step ${i + 1} of ${steps.length}`;
    root.querySelector('#tourTitle').textContent = st.title;
    root.querySelector('.tour-body').innerHTML = st.body;
    root.querySelector('.tour-back').hidden = i === 0;
    root.querySelector('.tour-next').textContent = i === 0 ? "Show me around" : (i === steps.length - 1 ? 'Done' : 'Next');
    const t = el(st.target);
    if (t) t.scrollIntoView({ block: 'center' });
    requestAnimationFrame(place);
    root.querySelector('.tour-next').focus({ preventScroll: true });
  }

  function place() {
    if (!api.active || !root) return;
    const st = steps[i], spot = root.querySelector('.tour-spot'), card = root.querySelector('.tour-card');
    const t = el(st.target), vw = window.innerWidth, vh = window.innerHeight, pad = 6, gap = 12;
    if (!t) {
      spot.style.cssText = 'left:50%;top:50%;width:0;height:0';
      card.style.left = Math.max(12, (vw - card.offsetWidth) / 2) + 'px';
      card.style.top = Math.max(12, (vh - card.offsetHeight) / 2) + 'px';
      return;
    }
    const r = t.getBoundingClientRect();
    spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let top = r.bottom + pad + gap;
    if (top + ch > vh - 12) top = r.top - pad - gap - ch;
    if (top < 12) top = Math.min(vh - ch - 12, Math.max(12, r.bottom + pad + gap));
    const left = Math.min(vw - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function end() {
    api.active = false;
    markTourSeen();
    if (root) { root.remove(); root = null; }
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
  }

  api.start = () => {
    if (!S) return;
    if ($('#dlg').open) $('#dlg').close('x');
    if (root) root.remove();
    api.active = true;
    build();
    go(0);
  };
  api.refresh = () => { if (api.active) requestAnimationFrame(place); };
  return api;
})();

route(); load();
})();
