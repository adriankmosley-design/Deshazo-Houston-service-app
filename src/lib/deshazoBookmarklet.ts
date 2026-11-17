/**
 * The "Send to Job Files" bookmark. It runs on the Beloved Robot work orders page
 * (it only reads from it) and hands each work order to the Job Files tab that opened it.
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
  const have = await new Promise((res) => { const h = (e) => { if (e.origin === O && e.data && e.data.kind === 'jf-existing') { removeEventListener('message', h); res(e.data.jobs); } }; addEventListener('message', h); opener.postMessage({ kind: 'jf-ready' }, O); setTimeout(() => res(null), 8000); });
  if (!have) { note('Job Files did not answer. Start again from its Sync button.'); return; }
  const byNo = new Map(have.map((j) => [j.job_number, j]));
  const map = { 'Pending': 'Open', 'Scheduled': 'Open', 'In Progress': 'In progress', 'Waiting for parts': 'In progress', 'Completed': 'Closed', 'Ready to Invoice': 'Closed', 'Invoiced': 'Closed' };
  const fmt = (s) => s ? s.slice(5, 7) + '/' + s.slice(8, 10) + '/' + s.slice(0, 4) : '';
  const short = (a) => a.length > 3 ? a.slice(0, 3).join('; ') + ' (+' + (a.length - 3) + ' more)' : a.join('; ');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const API = 'https://deshazo-api.belovedrobot.com/api/work-orders/';
  let n = 0, added = 0, pdfs = 0;
  for (const w of list) {
    n++;
    const no = w.salesOrderNo, j = byNo.get(no);
    if (j && j.status === 'Closed' && j.hasReport) continue;
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
      opener.postMessage({ kind: 'jf-job', row }, O);
      if (!j) added++;
      if (!j || !j.hasReport) {
        await wait(400);
        const r = await fetch(API + 'service-report/' + w.id, { credentials: 'include' });
        if (r.ok && (r.headers.get('content-type') || '').includes('pdf')) { const buf = await r.arrayBuffer(); opener.postMessage({ kind: 'jf-pdf', num: no, buf }, O, [buf]); pdfs++; }
      }
    } catch (e) { console.warn('Job Files sync', no, e); }
    await wait(700);
  }
  opener.postMessage({ kind: 'jf-done' }, O);
  note('Done: ' + added + ' new jobs and ' + pdfs + ' service reports sent to Job Files. You can close this tab.');
})()`

export function bookmarkletHref(origin: string) {
  return 'javascript:' + encodeURIComponent(source.replace('ORIGIN', JSON.stringify(origin)))
}
