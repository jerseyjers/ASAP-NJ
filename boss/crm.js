/* ASAP NJ CRM — Week 1: companies, contacts, leads, deals, activities */
(function () {
  const CFG = window.ASAP_BOSS || {};
  if (!CFG.crmEnabled) return;

  const STORE_KEY = 'asap_crm_v1';
  const STAGES = ['new', 'contacted', 'qualified', 'quoted', 'negotiation', 'won', 'lost'];
  const LEAD_STATUSES = ['new', 'working', 'qualified', 'disqualified'];
  const SOURCES = ['manual', 'web_contact', 'rtk_register', 'insurance', 'portal_access', 'referral', 'other'];
  const CO_TYPES = ['client', 'partner', 'insurer', 'gc', 'vendor', 'other'];

  let db = emptyDb();
  let view = 'home';
  let selected = null; // { type, id }
  let filter = { leadStatus: 'all', q: '' };

  function emptyDb() {
    return {
      version: 1,
      companies: [],
      contacts: [],
      leads: [],
      deals: [],
      activities: [],
      updated_at: new Date().toISOString(),
    };
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function now() { return new Date().toISOString(); }

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function money(cents) {
    const n = (Number(cents) || 0) / 100;
    return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyDb();
      const d = JSON.parse(raw);
      return Object.assign(emptyDb(), d);
    } catch {
      return emptyDb();
    }
  }

  function saveLocal() {
    db.updated_at = now();
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  }

  async function persist() {
    saveLocal();
  }

  function sbConfigured() {
    return !!(CFG.supabaseUrl && CFG.supabaseAnonKey && String(CFG.supabaseUrl).includes('http'));
  }

  function sbHeaders(extra) {
    const h = {
      apikey: CFG.supabaseAnonKey,
      Authorization: 'Bearer ' + (window._asapCrmAccessToken || CFG.supabaseAnonKey),
      'Content-Type': 'application/json',
    };
    return Object.assign(h, extra || {});
  }

  async function sbSignIn(email, password) {
    const url = CFG.supabaseUrl.replace(/\/$/, '') + '/auth/v1/token?grant_type=password';
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign-in failed');
    window._asapCrmAccessToken = data.access_token;
    try { sessionStorage.setItem('asap_crm_sb_token', data.access_token); } catch (_) {}
    return data;
  }

  function restoreSbSession() {
    try {
      const t = sessionStorage.getItem('asap_crm_sb_token');
      if (t) window._asapCrmAccessToken = t;
    } catch (_) {}
  }

  /**
   * Pull unclaimed website form leads into local CRM.
   * Solo mode: anon key (no password). opts.quiet = auto-poll (no empty toasts / no login prompts).
   */
  async function pullWebLeads(opts) {
    opts = opts || {};
    const quiet = !!opts.quiet;
    if (!sbConfigured()) {
      if (!quiet) toast('Boss config missing Supabase keys — hard-refresh (Ctrl+Shift+R)');
      return { imported: 0 };
    }
    restoreSbSession();
    const base = CFG.supabaseUrl.replace(/\/$/, '');
    const q = base + '/rest/v1/web_leads_inbox?claimed=eq.false&order=created_at.asc&select=*';
    let res = await fetch(q, { headers: sbHeaders({ Accept: 'application/json' }) });
    // Manual pull only: offer staff login if anon blocked
    if ((res.status === 401 || res.status === 403) && !window._asapCrmAccessToken && !quiet) {
      const email = CFG.crmOwnerEmail || 'gary.colyer@asap-nj.com';
      const password = prompt(
        'Inbox is locked to staff login.\nSupabase password for ' + email +
        ' (or re-run docs/crm/RUN-THIS-IN-SUPABASE.sql for auto import).'
      );
      if (!password) return { imported: 0 };
      try {
        await sbSignIn(email, password);
        res = await fetch(q, { headers: sbHeaders({ Accept: 'application/json' }) });
      } catch (err) {
        toast(err.message || 'Sign-in failed');
        return { imported: 0 };
      }
    }
    if (res.status === 401 || res.status === 403) {
      if (!quiet) toast('Cannot read web inbox (auth). Check Supabase policies.');
      return { imported: 0 };
    }
    if (res.status === 404) {
      if (!quiet) toast('web_leads_inbox missing — run RUN-THIS-IN-SUPABASE.sql once');
      return { imported: 0 };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      if (!quiet) toast('Pull failed (' + res.status + ')');
      console.warn('pullWebLeads', res.status, t);
      return { imported: 0 };
    }
    const rows = await res.json();
    let imported = 0;
    let skipped = 0;

    function markClaimed(rowId) {
      return fetch(base + '/rest/v1/web_leads_inbox?id=eq.' + encodeURIComponent(rowId), {
        method: 'PATCH',
        headers: sbHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ claimed: true, claimed_at: now() }),
      }).catch(() => {});
    }

    function leadAlreadyExists(row) {
      const em = String(row.email || '').trim().toLowerCase();
      const nm = String(row.name || '').trim().toLowerCase();
      return db.leads.some((l) => {
        if (l.status === 'disqualified') return false;
        // Same cloud row already imported
        if (l.raw_payload && row.id && (l.raw_payload.id === row.id || l.raw_payload.inbox_id === row.id)) return true;
        // Same person email already a lead
        if (em) {
          const ct = db.contacts.find((c) => c.id === l.contact_id);
          if (ct && String(ct.email || '').toLowerCase() === em) return true;
          if (l.raw_payload && String(l.raw_payload.email || '').toLowerCase() === em) return true;
        }
        // Name + similar interest (fallback if no email)
        if (!em && nm) {
          const ct = db.contacts.find((c) => c.id === l.contact_id);
          const who = ct
            ? [ct.first_name, ct.last_name].filter(Boolean).join(' ').toLowerCase()
            : '';
          if (who && who === nm) return true;
        }
        return false;
      });
    }

    for (const row of rows) {
      // Always claim in cloud so Pull does not re-offer the same inbox row
      if (leadAlreadyExists(row)) {
        skipped++;
        await markClaimed(row.id);
        continue;
      }

      // Company
      let companyId = null;
      if (row.company) {
        let co = db.companies.find((c) => c.name.toLowerCase() === String(row.company).toLowerCase());
        if (!co) {
          co = {
            id: uid(), name: row.company,
            type: row.source === 'rtk_register' ? 'partner' : row.source === 'insurance' ? 'insurer' : 'client',
            email: row.email || '', phone: row.phone || '',
            notes: 'From web form', source: row.source || 'web',
            created_at: now(), updated_at: now(),
          };
          db.companies.push(co);
        }
        companyId = co.id;
      }
      // Contact
      let contactId = null;
      if (row.email || row.name) {
        let ct = row.email ? db.contacts.find((c) => (c.email || '').toLowerCase() === String(row.email || '').toLowerCase()) : null;
        if (!ct) {
          const parts = String(row.name || '').trim().split(/\s+/);
          ct = {
            id: uid(),
            company_id: companyId,
            first_name: parts[0] || '',
            last_name: parts.slice(1).join(' ') || '',
            email: row.email || '',
            phone: row.phone || '',
            is_primary: true,
            notes: row.location ? ('Location: ' + row.location) : '',
            tags: ['web'],
            source: row.source || 'web',
            created_at: now(), updated_at: now(),
          };
          db.contacts.push(ct);
        }
        contactId = ct.id;
      }
      const lead = {
        id: uid(),
        contact_id: contactId,
        company_id: companyId,
        source: row.source || 'web_contact',
        service_interest: row.service_interest || '',
        message: [row.message, row.location ? ('Site: ' + row.location) : ''].filter(Boolean).join('\n'),
        status: 'new',
        raw_payload: Object.assign({}, row.payload || {}, { id: row.id, inbox_id: row.id, email: row.email }),
        created_at: row.created_at || now(),
        updated_at: now(),
      };
      db.leads.push(lead);
      db.activities.push({
        id: uid(), type: 'note',
        body: 'Imported from website form inbox.',
        lead_id: lead.id, contact_id: contactId, company_id: companyId,
        created_by: CFG.crmOwnerEmail || '', created_at: now(),
      });
      imported++;
      await markClaimed(row.id);
    }
    if (imported || skipped) saveLocal();
    if (imported) {
      toast('New web lead' + (imported === 1 ? '' : 's') + ' on boss: ' + imported + (skipped ? ' (+' + skipped + ' already had)' : ''));
      render();
      paintOverviewCrm();
    } else if (!quiet) {
      if (skipped) toast('No new leads · ' + skipped + ' already in CRM');
      else toast('No new web leads');
      render();
      paintOverviewCrm();
    }
    return { imported, skipped };
  }

  let _autoPullTimer = null;
  function startAutoPullWebLeads() {
    if (!sbConfigured()) return;
    // On login / page open — no need to babysit email
    pullWebLeads({ quiet: true }).catch((e) => console.warn('auto pull', e));
    if (_autoPullTimer) clearInterval(_autoPullTimer);
    // Every 2 minutes while boss is open
    _autoPullTimer = setInterval(() => {
      pullWebLeads({ quiet: true }).catch((e) => console.warn('auto pull', e));
    }, 120000);
  }

  function companyName(id) {
    const c = db.companies.find((x) => x.id === id);
    return c ? c.name : '';
  }

  function contactLabel(id) {
    const c = db.contacts.find((x) => x.id === id);
    if (!c) return '';
    return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Contact';
  }

  function openLeads() {
    return db.leads.filter((l) => l.status === 'new' || l.status === 'working');
  }

  function openDeals() {
    return db.deals.filter((d) => !['won', 'lost'].includes(d.stage));
  }

  function pipelineValue() {
    return openDeals().reduce((s, d) => s + (Number(d.value_cents) || 0), 0);
  }

  function tasksDue() {
    const t = Date.now();
    return db.activities.filter((a) => a.type === 'task' && a.due_at && !a.done_at && new Date(a.due_at).getTime() <= t + 7 * 864e5);
  }

  /* ---------- seed from known partners ---------- */
  function seedIfEmpty() {
    if (db.companies.length || db.contacts.length || db.leads.length) return false;
    const asap = {
      id: uid(), name: 'ASAP NJ Drone Services', type: 'other',
      email: 'gary.colyer@asap-nj.com', city: 'Toms River', state: 'NJ',
      notes: 'Home company', source: 'seed', created_at: now(), updated_at: now(),
    };
    const gary = {
      id: uid(), company_id: asap.id, first_name: 'Gary', last_name: 'Colyer',
      email: 'gary.colyer@asap-nj.com', title: 'Owner', is_primary: true,
      notes: 'Owner M4T field seat', source: 'seed', tags: ['owner', 'rtk'],
      created_at: now(), updated_at: now(),
    };
    const demoCo = {
      id: uid(), name: 'Test Co', type: 'partner', email: 'demo@example.com',
      notes: 'From RTK clients.csv demo partner', source: 'seed', created_at: now(), updated_at: now(),
    };
    const demoContact = {
      id: uid(), company_id: demoCo.id, first_name: 'Demo', last_name: 'Partner',
      email: 'demo@example.com', is_primary: true, source: 'seed', tags: ['rtk'],
      created_at: now(), updated_at: now(),
    };
    db.companies.push(asap, demoCo);
    db.contacts.push(gary, demoContact);
    db.leads.push({
      id: uid(), contact_id: demoContact.id, company_id: demoCo.id,
      source: 'rtk_register', service_interest: 'RTK NTRIP stream',
      message: 'Seed example — replace with real leads from the website.',
      status: 'new', raw_payload: {}, created_at: now(), updated_at: now(),
    });
    saveLocal();
    return true;
  }

  /* ---------- CRUD helpers ---------- */
  function upsert(listName, row) {
    const list = db[listName];
    const i = list.findIndex((x) => x.id === row.id);
    row.updated_at = now();
    if (i >= 0) list[i] = Object.assign({}, list[i], row);
    else {
      row.created_at = row.created_at || now();
      list.push(row);
    }
    persist();
    return row;
  }

  function remove(listName, id) {
    db[listName] = db[listName].filter((x) => x.id !== id);
    if (listName === 'leads') db.activities = db.activities.filter((a) => a.lead_id !== id);
    if (listName === 'deals') db.activities = db.activities.filter((a) => a.deal_id !== id);
    if (listName === 'contacts') db.activities = db.activities.filter((a) => a.contact_id !== id);
    if (listName === 'companies') db.activities = db.activities.filter((a) => a.company_id !== id);
    persist();
  }

  function convertLeadToDeal(leadId) {
    const lead = db.leads.find((l) => l.id === leadId);
    if (!lead) return null;
    lead.status = 'qualified';
    lead.updated_at = now();
    const titleBits = [lead.service_interest, companyName(lead.company_id) || contactLabel(lead.contact_id)].filter(Boolean);
    const deal = {
      id: uid(),
      lead_id: lead.id,
      contact_id: lead.contact_id,
      company_id: lead.company_id,
      title: titleBits.join(' · ') || 'New deal',
      service_type: lead.service_interest || '',
      value_cents: 0,
      currency: 'USD',
      stage: 'new',
      notes: lead.message || '',
      created_at: now(),
      updated_at: now(),
    };
    db.deals.push(deal);
    db.activities.push({
      id: uid(), type: 'note', body: 'Lead converted to deal.',
      lead_id: lead.id, deal_id: deal.id, created_by: CFG.crmOwnerEmail || '', created_at: now(),
    });
    persist();
    return deal;
  }

  /* ---------- UI shells ---------- */
  function shell(title, actionsHtml, bodyHtml) {
    return `<div class="crm-shell">
      <div class="crm-toolbar">
        <h2 class="crm-title">${esc(title)}</h2>
        <div class="crm-actions">${actionsHtml || ''}</div>
      </div>
      ${bodyHtml}
    </div>`;
  }

  function modal(html) {
    let m = $('crm-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'crm-modal';
      m.className = 'crm-modal hidden';
      document.body.appendChild(m);
    }
    m.innerHTML = `<div class="crm-modal-backdrop" data-close="1"></div><div class="crm-modal-card">${html}</div>`;
    m.classList.remove('hidden');
    m.onclick = (e) => {
      if (e.target.dataset.close) closeModal();
    };
  }

  function closeModal() {
    const m = $('crm-modal');
    if (m) m.classList.add('hidden');
  }

  function toast(msg) {
    let t = $('crm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'crm-toast';
      t.className = 'crm-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- Forms ---------- */
  function formCompany(existing) {
    const c = existing || { type: 'client', state: 'NJ' };
    modal(`
      <h3>${existing ? 'Edit company' : 'New company'}</h3>
      <form id="crm-form-co" class="crm-form">
        <label>Name<input name="name" required value="${esc(c.name || '')}"></label>
        <label>Type<select name="type">${CO_TYPES.map((t) => `<option value="${t}" ${c.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Email<input name="email" type="email" value="${esc(c.email || '')}"></label>
        <label>Phone<input name="phone" value="${esc(c.phone || '')}"></label>
        <label>City<input name="city" value="${esc(c.city || '')}"></label>
        <label>State<input name="state" value="${esc(c.state || 'NJ')}"></label>
        <label>Notes<textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></label>
        <div class="crm-form-actions">
          <button type="button" class="btn btn-ghost" data-close="1">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`);
    $('crm-form-co').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const row = {
        id: c.id || uid(),
        name: fd.get('name'),
        type: fd.get('type'),
        email: fd.get('email'),
        phone: fd.get('phone'),
        city: fd.get('city'),
        state: fd.get('state'),
        notes: fd.get('notes'),
        source: c.source || 'manual',
        created_at: c.created_at,
      };
      upsert('companies', row);
      closeModal();
      toast('Company saved');
      render();
    };
  }

  function formContact(existing) {
    const c = existing || { is_primary: true };
    const cos = db.companies.map((x) => `<option value="${x.id}" ${c.company_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    modal(`
      <h3>${existing ? 'Edit contact' : 'New contact'}</h3>
      <form id="crm-form-ct" class="crm-form">
        <label>First name<input name="first_name" value="${esc(c.first_name || '')}"></label>
        <label>Last name<input name="last_name" value="${esc(c.last_name || '')}"></label>
        <label>Email<input name="email" type="email" value="${esc(c.email || '')}"></label>
        <label>Phone<input name="phone" value="${esc(c.phone || '')}"></label>
        <label>Title<input name="title" value="${esc(c.title || '')}"></label>
        <label>Company<select name="company_id"><option value="">—</option>${cos}</select></label>
        <label>Notes<textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></label>
        <div class="crm-form-actions">
          <button type="button" class="btn btn-ghost" data-close="1">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`);
    $('crm-form-ct').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const row = {
        id: c.id || uid(),
        first_name: fd.get('first_name'),
        last_name: fd.get('last_name'),
        email: fd.get('email'),
        phone: fd.get('phone'),
        title: fd.get('title'),
        company_id: fd.get('company_id') || null,
        notes: fd.get('notes'),
        is_primary: true,
        tags: c.tags || [],
        source: c.source || 'manual',
        created_at: c.created_at,
      };
      upsert('contacts', row);
      closeModal();
      toast('Contact saved');
      render();
    };
  }

  function formLead(existing) {
    const l = existing || { status: 'new', source: 'manual' };
    const cos = db.companies.map((x) => `<option value="${x.id}" ${l.company_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const cts = db.contacts.map((x) => `<option value="${x.id}" ${l.contact_id === x.id ? 'selected' : ''}>${esc(contactLabel(x.id))}</option>`).join('');
    modal(`
      <h3>${existing ? 'Edit lead' : 'New lead'}</h3>
      <form id="crm-form-ld" class="crm-form">
        <label>Source<select name="source">${SOURCES.map((s) => `<option value="${s}" ${l.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Service interest<input name="service_interest" value="${esc(l.service_interest || '')}" placeholder="e.g. Insurance roof, RTK stream"></label>
        <label>Status<select name="status">${LEAD_STATUSES.map((s) => `<option value="${s}" ${l.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Contact<select name="contact_id"><option value="">—</option>${cts}</select></label>
        <label>Company<select name="company_id"><option value="">—</option>${cos}</select></label>
        <label>Message<textarea name="message" rows="3">${esc(l.message || '')}</textarea></label>
        <div class="crm-form-actions">
          <button type="button" class="btn btn-ghost" data-close="1">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`);
    $('crm-form-ld').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const row = {
        id: l.id || uid(),
        source: fd.get('source'),
        service_interest: fd.get('service_interest'),
        status: fd.get('status'),
        contact_id: fd.get('contact_id') || null,
        company_id: fd.get('company_id') || null,
        message: fd.get('message'),
        raw_payload: l.raw_payload || {},
        created_at: l.created_at,
      };
      upsert('leads', row);
      closeModal();
      toast('Lead saved');
      render();
      paintOverviewCrm();
    };
  }

  function formDeal(existing) {
    const d = existing || { stage: 'new', value_cents: 0 };
    const cos = db.companies.map((x) => `<option value="${x.id}" ${d.company_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const cts = db.contacts.map((x) => `<option value="${x.id}" ${d.contact_id === x.id ? 'selected' : ''}>${esc(contactLabel(x.id))}</option>`).join('');
    modal(`
      <h3>${existing ? 'Edit deal' : 'New deal'}</h3>
      <form id="crm-form-dl" class="crm-form">
        <label>Title<input name="title" required value="${esc(d.title || '')}"></label>
        <label>Service type<input name="service_type" value="${esc(d.service_type || '')}"></label>
        <label>Value (USD)<input name="value_usd" type="number" min="0" step="0.01" value="${((d.value_cents || 0) / 100).toFixed(2)}"></label>
        <label>Stage<select name="stage">${STAGES.map((s) => `<option value="${s}" ${d.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Contact<select name="contact_id"><option value="">—</option>${cts}</select></label>
        <label>Company<select name="company_id"><option value="">—</option>${cos}</select></label>
        <label>Notes<textarea name="notes" rows="3">${esc(d.notes || '')}</textarea></label>
        <div class="crm-form-actions">
          <button type="button" class="btn btn-ghost" data-close="1">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`);
    $('crm-form-dl').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const usd = parseFloat(fd.get('value_usd') || '0') || 0;
      const row = {
        id: d.id || uid(),
        title: fd.get('title'),
        service_type: fd.get('service_type'),
        value_cents: Math.round(usd * 100),
        currency: 'USD',
        stage: fd.get('stage'),
        contact_id: fd.get('contact_id') || null,
        company_id: fd.get('company_id') || null,
        notes: fd.get('notes'),
        lead_id: d.lead_id || null,
        created_at: d.created_at,
      };
      upsert('deals', row);
      closeModal();
      toast('Deal saved');
      render();
      paintOverviewCrm();
    };
  }

  function formNote(parent) {
    // parent: { lead_id?, deal_id?, contact_id?, company_id? }
    modal(`
      <h3>Add note / task</h3>
      <form id="crm-form-act" class="crm-form">
        <label>Type<select name="type"><option value="note">note</option><option value="call">call</option><option value="email">email</option><option value="task">task</option><option value="meeting">meeting</option></select></label>
        <label>Body<textarea name="body" required rows="4" placeholder="What happened / what to do…"></textarea></label>
        <label>Due (tasks)<input name="due_at" type="datetime-local"></label>
        <div class="crm-form-actions">
          <button type="button" class="btn btn-ghost" data-close="1">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`);
    $('crm-form-act').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const due = fd.get('due_at');
      const row = {
        id: uid(),
        type: fd.get('type'),
        body: fd.get('body'),
        due_at: due ? new Date(due).toISOString() : null,
        done_at: null,
        lead_id: parent.lead_id || null,
        deal_id: parent.deal_id || null,
        contact_id: parent.contact_id || null,
        company_id: parent.company_id || null,
        created_by: CFG.crmOwnerEmail || '',
        created_at: now(),
      };
      db.activities.push(row);
      persist();
      closeModal();
      toast('Activity saved');
      render();
      paintOverviewCrm();
    };
  }

  /* ---------- Views ---------- */
  function renderHome() {
    const ol = openLeads().length;
    const od = openDeals().length;
    const pv = pipelineValue();
    const td = tasksDue().length;
    const mode = CFG.crmMode || 'local';
    const root = $('tab-crm-home');
    const cloud = sbConfigured();
    root.innerHTML = shell('CRM Home', `
      <button type="button" class="btn btn-primary" id="crm-add-lead">+ Lead</button>
      <button type="button" class="btn btn-primary" id="crm-pull-web" title="Import website form submissions">${cloud ? 'Pull web leads' : 'Pull web leads (need config)'}</button>
      <a class="btn btn-ghost" href="https://supabase.com/dashboard/project/ojaxoiaqbtdnglgumtrw/sql/new" target="_blank" rel="noopener">Open Supabase SQL</a>
      <button type="button" class="btn btn-ghost" id="crm-export">Export JSON</button>
      <button type="button" class="btn btn-ghost" id="crm-import">Import JSON</button>
      <input type="file" id="crm-import-file" accept="application/json" class="hidden">
    `, `
      <div class="crm-banner">
        <strong>Your job board</strong> (solo ops · grows when you hire)
        · mode <code>${esc(mode)}</code>
        · forms → cloud inbox: <code>${cloud ? 'keys OK — run SQL once (Open Supabase SQL), then Pull (no password)' : 'keys missing — hard-refresh'}</code>
        · ${db.leads.length} leads · ${db.deals.length} in pipeline · ${db.contacts.length} people
        <span class="crm-muted"> · saved ${esc((db.updated_at || '').replace('T', ' ').slice(0, 19))}</span>
      </div>
      <div class="panel" style="border-color:rgba(234,179,8,.45);background:rgba(234,179,8,.08)">
        <h2 style="margin-top:0">Why a roommate signup may not show here</h2>
        <ul class="note" style="margin-bottom:0">
          <li><strong>Boss CRM is this browser</strong> (localStorage) until you Pull web leads from Supabase.</li>
          <li><strong>Signup on another PC never writes to your Mini boss page</strong> by itself.</li>
          <li><strong>Email path:</strong> FormSubmit → <code>gary.colyer@asap-nj.com</code> (check spam + “Activate FormSubmit” mail).</li>
          <li><strong>Cloud inbox table was missing</strong> — run <code>docs/crm/RUN-THIS-IN-SUPABASE.sql</code> once, then use <strong>Pull web leads</strong>.</li>
          <li><strong>Airspace free account</strong> lives in Supabase Auth → Users (not CRM Leads) until we bridge it.</li>
        </ul>
      </div>
      <div class="viz-grid">
        <article class="viz-card tone-accent"><div class="viz-label">Open leads</div><div class="viz-row"><div class="viz-value">${ol}</div></div><div class="viz-sub">new + working</div></article>
        <article class="viz-card tone-purple"><div class="viz-label">Open deals</div><div class="viz-row"><div class="viz-value">${od}</div></div><div class="viz-sub">not won/lost</div></article>
        <article class="viz-card tone-ok"><div class="viz-label">Pipeline value</div><div class="viz-row"><div class="viz-value">${esc(money(pv))}</div></div><div class="viz-sub">open deals</div></article>
        <article class="viz-card tone-warn"><div class="viz-label">Tasks (7d window)</div><div class="viz-row"><div class="viz-value">${td}</div></div><div class="viz-sub">due / overdue tasks</div></article>
      </div>
      <div class="panel">
        <h2>Newest leads</h2>
        ${listLeadsHtml(db.leads.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 8))}
      </div>
      <div class="panel">
        <h2>Built for a one-person shop (you)</h2>
        <ul class="note">
          <li><strong>Goal:</strong> don’t lose a lead, follow up, book the job, get paid.</li>
          <li><strong>Today:</strong> every call/email/form → put it in <strong>Leads</strong> → push to <strong>Pipeline</strong> when it’s real money.</li>
          <li><strong>When you’re busy:</strong> Export JSON is your backup. Supabase later = same data on phone + Mini + server.</li>
          <li><strong>When you hire:</strong> same CRM — just add their login. No rebuild.</li>
        </ul>
      </div>
    `);
    $('crm-add-lead').onclick = () => formLead();
    $('crm-pull-web').onclick = () => { pullWebLeads(); };
    $('crm-export').onclick = () => {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `asap-crm-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      toast('Exported');
    };
    $('crm-import').onclick = () => $('crm-import-file').click();
    $('crm-import-file').onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        if (!data.companies || !data.contacts) throw new Error('Invalid CRM file');
        db = Object.assign(emptyDb(), data);
        saveLocal();
        toast('Imported');
        render();
        paintOverviewCrm();
      } catch (err) {
        toast('Import failed');
        console.error(err);
      }
    };
  }

  function listLeadsHtml(rows) {
    if (!rows.length) return '<p class="empty">No leads yet. Click + Lead or wait for website form ingest (Phase 2).</p>';
    return `<table class="crm-table"><thead><tr><th>When</th><th>Source</th><th>Service</th><th>Who</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((l) => `<tr>
        <td class="mono">${esc((l.created_at || '').replace('T', ' ').slice(0, 16))}</td>
        <td><span class="crm-pill">${esc(l.source)}</span></td>
        <td>${esc(l.service_interest || '—')}</td>
        <td>${esc(contactLabel(l.contact_id) || companyName(l.company_id) || '—')}</td>
        <td><span class="crm-pill status-${esc(l.status)}">${esc(l.status)}</span></td>
        <td class="crm-row-actions">
          <button type="button" class="btn btn-ghost btn-tiny" data-lead-open="${l.id}">Open</button>
          <button type="button" class="btn btn-ghost btn-tiny" data-lead-convert="${l.id}">→ Deal</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
  }

  function renderLeads() {
    let rows = db.leads.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (filter.leadStatus !== 'all') rows = rows.filter((l) => l.status === filter.leadStatus);
    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter((l) => JSON.stringify(l).toLowerCase().includes(q)
        || contactLabel(l.contact_id).toLowerCase().includes(q)
        || companyName(l.company_id).toLowerCase().includes(q));
    }
    const root = $('tab-crm-leads');
    root.innerHTML = shell('Leads', `
      <input class="crm-search" id="crm-lead-q" placeholder="Search…" value="${esc(filter.q)}">
      <select id="crm-lead-filter">${['all'].concat(LEAD_STATUSES).map((s) => `<option value="${s}" ${filter.leadStatus === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button type="button" class="btn btn-primary" id="crm-add-lead2">+ Lead</button>
    `, `<div class="panel">${listLeadsHtml(rows)}</div>
      <div class="panel" id="crm-lead-detail"><p class="empty">Select a lead to see detail, notes, and convert to pipeline.</p></div>`);
    $('crm-add-lead2').onclick = () => formLead();
    $('crm-lead-filter').onchange = (e) => { filter.leadStatus = e.target.value; renderLeads(); };
    $('crm-lead-q').oninput = (e) => { filter.q = e.target.value; renderLeads(); };
    root.querySelectorAll('[data-lead-open]').forEach((btn) => {
      btn.onclick = () => showLeadDetail(btn.getAttribute('data-lead-open'));
    });
    root.querySelectorAll('[data-lead-convert]').forEach((btn) => {
      btn.onclick = () => {
        const d = convertLeadToDeal(btn.getAttribute('data-lead-convert'));
        if (d) { toast('Converted to deal'); renderLeads(); paintOverviewCrm(); }
      };
    });
    if (selected && selected.type === 'lead') showLeadDetail(selected.id);
  }

  function showLeadDetail(id) {
    selected = { type: 'lead', id };
    const l = db.leads.find((x) => x.id === id);
    const box = $('crm-lead-detail');
    if (!l || !box) return;
    const acts = db.activities.filter((a) => a.lead_id === id).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    box.innerHTML = `
      <h2>${esc(l.service_interest || 'Lead')} <span class="crm-pill status-${esc(l.status)}">${esc(l.status)}</span></h2>
      <p class="note">${esc(l.message || 'No message')}</p>
      <p class="note">Source <strong>${esc(l.source)}</strong> · Contact <strong>${esc(contactLabel(l.contact_id) || '—')}</strong> · Company <strong>${esc(companyName(l.company_id) || '—')}</strong></p>
      <div class="crm-actions" style="margin:.75rem 0">
        <button type="button" class="btn btn-ghost" id="crm-lead-edit">Edit</button>
        <button type="button" class="btn btn-primary" id="crm-lead-to-deal">Convert to deal</button>
        <button type="button" class="btn btn-ghost" id="crm-lead-note">+ Note / task</button>
        <button type="button" class="btn btn-ghost" id="crm-lead-del">Delete</button>
      </div>
      <h3 class="crm-subh">Activity</h3>
      ${acts.length ? acts.map((a) => `<article class="crm-act"><div class="meta">${esc(a.type)} · ${esc((a.created_at || '').replace('T', ' ').slice(0, 16))}${a.due_at ? ' · due ' + esc(a.due_at.slice(0, 16)) : ''}</div><p>${esc(a.body)}</p></article>`).join('') : '<p class="empty">No activity yet.</p>'}
    `;
    $('crm-lead-edit').onclick = () => formLead(l);
    $('crm-lead-to-deal').onclick = () => { convertLeadToDeal(id); toast('Deal created'); renderLeads(); paintOverviewCrm(); };
    $('crm-lead-note').onclick = () => formNote({ lead_id: id, contact_id: l.contact_id, company_id: l.company_id });
    $('crm-lead-del').onclick = () => {
      if (confirm('Delete this lead?')) { remove('leads', id); selected = null; renderLeads(); paintOverviewCrm(); }
    };
  }

  function renderPipeline() {
    const root = $('tab-crm-pipeline');
    const cols = STAGES.map((stage) => {
      const deals = db.deals.filter((d) => d.stage === stage);
      const sum = deals.reduce((s, d) => s + (d.value_cents || 0), 0);
      return `<div class="kanban-col" data-stage="${stage}">
        <header><strong>${esc(stage)}</strong><span>${deals.length} · ${esc(money(sum))}</span></header>
        <div class="kanban-cards">
          ${deals.map((d) => `<article class="kanban-card" data-deal="${d.id}">
            <strong>${esc(d.title)}</strong>
            <div class="crm-muted">${esc(d.service_type || '')}</div>
            <div class="kanban-meta">${esc(money(d.value_cents))} · ${esc(companyName(d.company_id) || contactLabel(d.contact_id) || '—')}</div>
            <div class="kanban-move">
              ${STAGES.filter((s) => s !== stage).slice(0, 3).map((s) => `<button type="button" class="btn btn-ghost btn-tiny" data-move="${d.id}" data-to="${s}">${esc(s)}</button>`).join('')}
            </div>
          </article>`).join('') || '<p class="empty">—</p>'}
        </div>
      </div>`;
    }).join('');
    root.innerHTML = shell('Pipeline', `
      <button type="button" class="btn btn-primary" id="crm-add-deal">+ Deal</button>
    `, `<div class="kanban">${cols}</div>
      <div class="panel" id="crm-deal-detail"><p class="empty">Click a deal card to edit / add notes.</p></div>`);
    $('crm-add-deal').onclick = () => formDeal();
    root.querySelectorAll('[data-deal]').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('[data-move]')) return;
        showDealDetail(card.getAttribute('data-deal'));
      };
    });
    root.querySelectorAll('[data-move]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-move');
        const to = btn.getAttribute('data-to');
        const d = db.deals.find((x) => x.id === id);
        if (!d) return;
        d.stage = to;
        d.updated_at = now();
        persist();
        renderPipeline();
        paintOverviewCrm();
      };
    });
  }

  function showDealDetail(id) {
    const d = db.deals.find((x) => x.id === id);
    const box = $('crm-deal-detail');
    if (!d || !box) return;
    const acts = db.activities.filter((a) => a.deal_id === id).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    box.innerHTML = `
      <h2>${esc(d.title)} <span class="crm-pill">${esc(d.stage)}</span></h2>
      <p class="note">${esc(money(d.value_cents))} · ${esc(d.service_type || '—')} · ${esc(companyName(d.company_id) || '—')}</p>
      <p class="note">${esc(d.notes || '')}</p>
      <div class="crm-actions" style="margin:.75rem 0">
        <button type="button" class="btn btn-ghost" id="crm-deal-edit">Edit</button>
        <button type="button" class="btn btn-ghost" id="crm-deal-note">+ Note / task</button>
        <button type="button" class="btn btn-ghost" id="crm-deal-del">Delete</button>
      </div>
      <h3 class="crm-subh">Activity</h3>
      ${acts.length ? acts.map((a) => `<article class="crm-act"><div class="meta">${esc(a.type)} · ${esc((a.created_at || '').replace('T', ' ').slice(0, 16))}</div><p>${esc(a.body)}</p></article>`).join('') : '<p class="empty">No activity yet.</p>'}
    `;
    $('crm-deal-edit').onclick = () => formDeal(d);
    $('crm-deal-note').onclick = () => formNote({ deal_id: id, contact_id: d.contact_id, company_id: d.company_id });
    $('crm-deal-del').onclick = () => {
      if (confirm('Delete deal?')) { remove('deals', id); renderPipeline(); paintOverviewCrm(); }
    };
  }

  function renderContacts() {
    const root = $('tab-crm-contacts');
    const rows = db.contacts.slice().sort((a, b) => contactLabel(a.id).localeCompare(contactLabel(b.id)));
    root.innerHTML = shell('Contacts', `
      <button type="button" class="btn btn-primary" id="crm-add-ct">+ Contact</button>
    `, `<div class="panel">
      <table class="crm-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th></th></tr></thead><tbody>
      ${rows.map((c) => `<tr>
        <td>${esc(contactLabel(c.id))}</td>
        <td class="mono">${esc(c.email || '')}</td>
        <td>${esc(c.phone || '')}</td>
        <td>${esc(companyName(c.company_id))}</td>
        <td><button type="button" class="btn btn-ghost btn-tiny" data-ct="${c.id}">Edit</button>
            <button type="button" class="btn btn-ghost btn-tiny" data-ct-del="${c.id}">Del</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">No contacts</td></tr>'}
      </tbody></table></div>`);
    $('crm-add-ct').onclick = () => formContact();
    root.querySelectorAll('[data-ct]').forEach((b) => {
      b.onclick = () => formContact(db.contacts.find((c) => c.id === b.getAttribute('data-ct')));
    });
    root.querySelectorAll('[data-ct-del]').forEach((b) => {
      b.onclick = () => {
        if (confirm('Delete contact?')) { remove('contacts', b.getAttribute('data-ct-del')); renderContacts(); }
      };
    });
  }

  function renderCompanies() {
    const root = $('tab-crm-companies');
    const rows = db.companies.slice().sort((a, b) => a.name.localeCompare(b.name));
    root.innerHTML = shell('Companies', `
      <button type="button" class="btn btn-primary" id="crm-add-co">+ Company</button>
    `, `<div class="panel">
      <table class="crm-table"><thead><tr><th>Name</th><th>Type</th><th>Email</th><th>City</th><th></th></tr></thead><tbody>
      ${rows.map((c) => `<tr>
        <td>${esc(c.name)}</td>
        <td><span class="crm-pill">${esc(c.type)}</span></td>
        <td class="mono">${esc(c.email || '')}</td>
        <td>${esc([c.city, c.state].filter(Boolean).join(', '))}</td>
        <td><button type="button" class="btn btn-ghost btn-tiny" data-co="${c.id}">Edit</button>
            <button type="button" class="btn btn-ghost btn-tiny" data-co-del="${c.id}">Del</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">No companies</td></tr>'}
      </tbody></table></div>`);
    $('crm-add-co').onclick = () => formCompany();
    root.querySelectorAll('[data-co]').forEach((b) => {
      b.onclick = () => formCompany(db.companies.find((c) => c.id === b.getAttribute('data-co')));
    });
    root.querySelectorAll('[data-co-del]').forEach((b) => {
      b.onclick = () => {
        if (confirm('Delete company?')) { remove('companies', b.getAttribute('data-co-del')); renderCompanies(); }
      };
    });
  }

  function render() {
    if (view === 'home') renderHome();
    else if (view === 'leads') renderLeads();
    else if (view === 'pipeline') renderPipeline();
    else if (view === 'contacts') renderContacts();
    else if (view === 'companies') renderCompanies();
  }

  function paintOverviewCrm() {
    const el = $('overview-crm');
    if (!el) return;
    const ol = openLeads().length;
    const od = openDeals().length;
    const td = tasksDue().length;
    el.innerHTML = `
      <div class="grid">
        <div class="stat"><div class="k">Open leads</div><div class="v ${ol ? 'warn' : 'ok'}">${ol}</div><div class="s">CRM</div></div>
        <div class="stat"><div class="k">Open deals</div><div class="v">${od}</div><div class="s">${money(pipelineValue())}</div></div>
        <div class="stat"><div class="k">Tasks due</div><div class="v ${td ? 'warn' : ''}">${td}</div><div class="s">next 7 days</div></div>
        <div class="stat"><div class="k">CRM mode</div><div class="v" style="font-size:1rem">${esc(CFG.crmMode || 'local')}</div><div class="s">${db.contacts.length} contacts</div></div>
      </div>
      <p class="note" style="margin-top:.5rem">Website forms <strong>auto-import</strong> into CRM while this desk is open (and on login). Still open <strong>CRM / Leads</strong> to work them. Export JSON as backup.</p>`;
  }

  function onTab(tab) {
    if (tab === 'crm-home') { view = 'home'; render(); startAutoPullWebLeads(); }
    if (tab === 'crm-leads') { view = 'leads'; render(); startAutoPullWebLeads(); }
    if (tab === 'crm-pipeline') { view = 'pipeline'; render(); }
    if (tab === 'crm-contacts') { view = 'contacts'; render(); }
    if (tab === 'crm-companies') { view = 'companies'; render(); }
    if (tab === 'overview') {
      paintOverviewCrm();
      startAutoPullWebLeads();
    }
  }

  function hookTabs() {
    document.querySelectorAll('.nav-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => onTab(btn.dataset.tab));
    });
  }

  function init() {
    db = loadLocal();
    if (seedIfEmpty()) toast('CRM seeded with starter records');
    hookTabs();
    paintOverviewCrm();
    window.ASAP_CRM = {
      getDb: () => db,
      reload: () => { db = loadLocal(); render(); paintOverviewCrm(); },
      openLeadsCount: () => openLeads().length,
      pullWebLeads,
      startAutoPullWebLeads,
    };
    restoreSbSession();
    // Auto-import web forms whenever boss desk is open (no email babysitting)
    startAutoPullWebLeads();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') startAutoPullWebLeads();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
