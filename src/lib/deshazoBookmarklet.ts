/**
 * The "Send to Job Files" bookmark. It runs on the Beloved Robot work orders page
 * (it only reads from it) and hands each work order to the Job Files tab that opened it.
 *
 * The bookmark itself is a small loader: it asks the Job Files tab for the current sync
 * code (`syncSource`) and runs it, so new sync features work without re-dragging the bookmark.
 */
const source = `(async () => {
  const O = ORIGIN;
  const note = (t) => { let d = document.getElementById('jf-note'); if (!d) { d = document.createElement('div'); d.id = 'jf-note'; d.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;background:#1c2430;color:#fff;padding:14px 18px;border-radius:10px;font:15px system-ui;box-shadow:0 4px 20px #0005;max-width:340px'; document.body.appendChild(d); } d.textContent = t; };
  if (!window.opener) { note('Start from the Sync button in Job Files, then click this bookmark on the tab it opens.'); return; }
  const scan = (o, d) => { if (!o || typeof o !== 'object' || d > 3 || o instanceof Node || o.$$typeof) return null; if (Array.isArray(o) && o.length && o[0] && o[0].salesOrderNo) return o; for (const v of Object.values(o)) { const r = scan(v, d + 1); if (r) return r; } return null; };
  const tr = document.querySelector('tbody tr');
  let list = null;
  if (tr) { const fk = Object.keys(tr).find((k) => k.startsWith('__reactFiber')); let f = tr[fk]; for (let i = 0; i < 40 && f && !list; i++, f = f.return) list = scan(f.memoizedProps, 0) || scan(f.memoizedState, 0); }
  if (!list) { note('Open the Work Orders list first, then click the bookmark again.'); return; }
  // Read a second page too, so each sync covers the newest PAGES x 25 work orders.
  const PAGES = 2;
  const readList = () => { const r = document.querySelector('tbody tr'); if (!r) return null; const k = Object.keys(r).find((x) => x.startsWith('__reactFiber')); let g = r[k], out = null; for (let i = 0; i < 40 && g && !out; i++, g = g.return) out = scan(g.memoizedProps, 0) || scan(g.memoizedState, 0); return out; };
  list = list.slice();
  for (let pg = 1; pg < PAGES; pg++) {
    const first = (readList() || [])[0];
    const btns = [...document.querySelectorAll('[aria-label="Pagination"] a, [aria-label="Pagination"] button')];
    const next = btns[btns.length - 1];
    if (!next || next.disabled || next.getAttribute('aria-disabled') === 'true') break;
    note('Reading work orders page ' + (pg + 1) + '…');
    next.click();
    let more = null;
    for (let t = 0; t < 60 && !more; t++) { await new Promise((r) => setTimeout(r, 500)); const l = readList(); if (l && l.length && first && l[0].salesOrderNo !== first.salesOrderNo) more = l; }
    if (!more) break;
    const seen = new Set(list.map((w) => w.salesOrderNo));
    list.push(...more.filter((w) => !seen.has(w.salesOrderNo)));
  }
  const have = await new Promise((res) => { const h = (e) => { if (e.origin === O && e.data && e.data.kind === 'jf-existing') { removeEventListener('message', h); res(e.data.jobs); } }; addEventListener('message', h); opener.postMessage({ kind: 'jf-ready' }, O); setTimeout(() => res(null), 8000); });
  if (!have) { note('Job Files did not answer. Start again from its Sync button.'); return; }
  const byNo = new Map(have.map((j) => [j.job_number, j]));
  const map = { 'Pending': 'Open', 'Scheduled': 'Open', 'In Progress': 'In progress', 'Waiting for parts': 'In progress', 'Completed': 'Closed', 'Ready to Invoice': 'Closed', 'Invoiced': 'Closed' };
  const fmt = (s) => s ? s.slice(5, 7) + '/' + s.slice(8, 10) + '/' + s.slice(0, 4) : '';
  const short = (a) => a.length > 3 ? a.slice(0, 3).join('; ') + ' (+' + (a.length - 3) + ' more)' : a.join('; ');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const API = 'https://deshazo-api.belovedrobot.com/api/work-orders/';
  let n = 0, added = 0, pdfs = 0, insp = 0;
  const isInsp = (w, d) => /inspect/i.test(String((d && d.jobType && (d.jobType.name || d.jobType)) || w.jobType || ''));
  for (const w of list) {
    n++;
    const no = w.salesOrderNo, j = byNo.get(no);
    const changed = !j || !j.reportAt || String(w.updatedAt || '') > j.reportAt;
    if (j && j.status === 'Closed' && j.hasReport && !changed && j.hasHours && (j.hasOverview || !isInsp(w))) continue;
    note('Sending work order ' + no + ' (' + n + ' of ' + list.length + ')…');
    try {
      const d = await (await fetch(API + w.id + '?id=' + w.id, { credentials: 'include' })).json();
      const cl = w.customerLocation || {};
      const site = [[cl.shipToAddress1, cl.shipToAddress2].filter(Boolean).join(', '), [cl.shipToCity, cl.shipToState, cl.shipToZipCode].filter(Boolean).join(', ')].filter(Boolean).join(' - ');
      const c0 = (d.customerContacts || [])[0] || {}; const cc = c0.contact || c0;
      const cranes = (d.workOrderCranes || []).map((x) => x.crane).filter(Boolean);
      const craneTxt = cranes.map((c) => [c.UDF_EQ_DESCR, c.UDF_EQ_LOC].filter(Boolean).join(' - '));
      const techs = [...new Set((d.workOrderTrips || []).flatMap((t) => (t.workOrderEmployees || []).map((e) => { const p = e.employee || e.user || {}; return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.name || ''; })).filter(Boolean))];
      const st = (d.status && d.status.name) || (w.status && w.status.name) || '';
      const po = d.customerPONo || w.customerPONo || '';
      const notes = [((w.jobType || 'Work order') + ': ' + (w.svcCommentText || w.comment || '')).trim(), 'Scheduled ' + fmt(w.startDate) + ' - ' + fmt(w.endDate), 'DeShazo status: ' + st, techs.length ? 'Techs: ' + techs.join(', ') : '', po ? 'PO: ' + po : '', craneTxt.length ? 'Cranes: ' + craneTxt.join('; ') : '', 'Imported from DeShazo work order ' + no].filter(Boolean).join('\\n');
      const row = { job_number: no, customer: w.billToName || '', site_address: site || null, status: map[st] || 'Open', contact_name: cc.contactName || cc.name || [cc.firstName, cc.lastName].filter(Boolean).join(' ') || null, contact_phone: cc.telephoneNo || cc.phone || null, contact_email: cc.emailAddress || cc.email || null, crane_make: short(craneTxt) || null, serial_number: short(cranes.map((c) => c.ContactCode).filter(Boolean)) || null, notes };
      const entries = [];
      for (const t of d.workOrderTrips || []) for (const e of t.workOrderEmployees || []) {
        const p = e.employee || {}; const tech = [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Tech';
        for (const wd of e.employeeWorkDays || []) for (const x of wd.workTimes || []) {
          if (x.startTime && x.endTime) entries.push({ tech, date: wd.date || String(x.startTime).slice(0, 10), start: String(x.startTime).slice(0, 16), end: String(x.endTime).slice(0, 16) });
        }
      }
      opener.postMessage({ kind: 'jf-job', row, entries }, O);
      if (!j) added++;
      if (!j || !j.hasReport || changed) {
        await wait(400);
        const r = await fetch(API + 'service-report/' + w.id, { credentials: 'include' });
        if (r.ok && (r.headers.get('content-type') || '').includes('pdf')) { const buf = await r.arrayBuffer(); opener.postMessage({ kind: 'jf-pdf', num: no, buf }, O, [buf]); pdfs++; }
      }
      if (entries.length) opener.postMessage({ kind: 'jf-hours', num: no, entries }, O);
      if (isInsp(w, d) && map[st] === 'Closed' && !(j && j.hasOverview)) {
        let units = 0;
        for (const wc of d.workOrderCranes || []) {
          const code = wc.crane && wc.crane.ContactCode;
          if (!code || !/^D\\d{6}$/.test(code) || !(wc.craneInspections || []).length) continue;
          note('Work order ' + no + ': inspection report for ' + code + '…');
          await wait(400);
          const r = await fetch(API + 'service-report/' + w.id + '?workOrderId=' + w.id + '&craneId=' + wc.craneId + '&browserTimeOffset=-6', { credentials: 'include' });
          if (r.ok && (r.headers.get('content-type') || '').includes('pdf')) { const buf = await r.arrayBuffer(); opener.postMessage({ kind: 'jf-unit', num: no, code, buf }, O, [buf]); units++; }
        }
        if (units) { opener.postMessage({ kind: 'jf-inspection', num: no }, O); insp++; }
      }
    } catch (e) { console.warn('Job Files sync', no, e); }
    await wait(700);
  }
  opener.postMessage({ kind: 'jf-done' }, O);
  note('Done: ' + added + ' new jobs and ' + pdfs + ' service reports sent to Job Files, ' + insp + ' inspection jobs sent for an overview. Keep the Job Files tab open until it says Done.');
})()`

/** The sync code the bookmark runs, for the Job Files tab at `origin`. */
export function syncSource(origin: string) {
  return source.replace('ORIGIN', JSON.stringify(origin))
}

const loader = `(() => {
  const O = ORIGIN;
  const say = (t) => { let d = document.getElementById('jf-note'); if (!d) { d = document.createElement('div'); d.id = 'jf-note'; d.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;background:#1c2430;color:#fff;padding:14px 18px;border-radius:10px;font:15px system-ui;box-shadow:0 4px 20px #0005;max-width:340px'; document.body.appendChild(d); } d.textContent = t; };
  if (!window.opener) { say('Start from the Sync button in Job Files, then click this bookmark on the tab it opens.'); return; }
  let got = false;
  const h = (e) => { if (e.origin === O && e.data && e.data.kind === 'jf-code' && typeof e.data.source === 'string') { got = true; removeEventListener('message', h); new Function(e.data.source)(); } };
  addEventListener('message', h);
  opener.postMessage({ kind: 'jf-hello' }, O);
  setTimeout(() => { if (!got) say('Job Files did not answer. Start again from its Sync button.'); }, 8000);
})()`

export function bookmarkletHref(origin: string) {
  return 'javascript:' + encodeURIComponent(loader.replace('ORIGIN', JSON.stringify(origin)))
}
