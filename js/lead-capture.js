/**
 * Dual-write website forms → company email (FormSubmit AJAX) + optional CRM inbox (Supabase).
 * RTK register: generates / accepts preferred username+password, shows them immediately,
 * stores in sessionStorage for rtk-setup.html, then Mini auto-issues the caster seat.
 *
 * Attach: data-lead-form="contact|rtk_register|insurance|portal_access|..."
 */
(function () {
  function cfg() {
    return window.ASAP_LEAD || {};
  }

  function cloudReady() {
    const c = cfg();
    return !!(c.supabaseUrl && c.supabaseAnonKey && String(c.supabaseUrl).includes('http'));
  }

  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first_name: '', last_name: '' };
    if (parts.length === 1) return { first_name: parts[0], last_name: '' };
    return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
  }

  function safeUsername(raw) {
    var s = String(raw || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (s.length > 24) s = s.slice(0, 24).replace(/-+$/g, '');
    if (!s) s = 'partner';
    if (s.length < 3) s = 'user-' + s;
    return s;
  }

  function strongPassword(n) {
    n = n || 14;
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    var out = '';
    var arr = new Uint32Array(n);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(arr);
      for (var i = 0; i < n; i++) out += alphabet[arr[i] % alphabet.length];
    } else {
      for (var j = 0; j < n; j++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  /** Ensure RTK payload has preferred_username / preferred_password (generate if blank). */
  function ensureRtkCredentials(payload) {
    var p = payload.payload || {};
    var user = String(p.preferred_username || p.username || '').trim();
    var pass = String(p.preferred_password || p.password || '').trim();
    if (!user) {
      user = safeUsername(
        (payload.name || 'partner') + (payload.company ? '-' + payload.company : '')
      );
    } else {
      user = safeUsername(user);
    }
    if (!pass || pass.length < 8) {
      pass = strongPassword(14);
    }
    p.preferred_username = user;
    p.preferred_password = pass;
    payload.payload = p;
    return { username: user, password: pass };
  }

  function formToPayload(form, source) {
    const fd = new FormData(form);
    const obj = {};
    fd.forEach((v, k) => {
      if (String(k).startsWith('_')) return;
      obj[k] = typeof v === 'string' ? v.trim() : v;
    });
    const name = obj.name || [obj.first_name, obj.last_name].filter(Boolean).join(' ') || '';
    const parts = splitName(name);
    const subjectEl = form.querySelector('input[name="_subject"]');
    return {
      source: source || obj.form_type || obj.source || 'web_contact',
      name: name,
      first_name: parts.first_name,
      last_name: parts.last_name,
      email: obj.email || '',
      phone: obj.phone || '',
      company: obj.company || '',
      service_interest: obj.service || obj.service_interest || obj.use_case || '',
      message: obj.message || obj.details || obj.note || '',
      location: obj.location || obj.work_area || obj.site || '',
      subject: (subjectEl && subjectEl.value) || 'Website lead — ASAP NJ',
      payload: obj,
    };
  }

  async function sendCloud(payload) {
    if (!cloudReady()) return { skipped: true, reason: 'no supabase keys' };
    const c = cfg();
    const table = c.inboxTable || 'web_leads_inbox';
    const url = c.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + table;
    const row = {
      source: payload.source,
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      company: payload.company,
      service_interest: payload.service_interest,
      message: payload.message,
      location: payload.location,
      payload: payload.payload,
      claimed: false,
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: c.supabaseAnonKey,
          Authorization: 'Bearer ' + c.supabaseAnonKey,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.warn('CRM cloud ingest failed', res.status, t);
        return { ok: false, status: res.status, body: t };
      }
      return { ok: true };
    } catch (err) {
      console.warn('CRM cloud ingest error', err);
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  async function sendFormsubmit(payload) {
    const c = cfg();
    const endpoint =
      c.formsubmitAjax ||
      ('https://formsubmit.co/ajax/' + (c.notifyEmail || 'gary.colyer@asap-nj.com'));
    const body = Object.assign({}, payload.payload || {}, {
      name: payload.name,
      email: payload.email,
      phone: payload.phone || '',
      company: payload.company || '',
      message: payload.message || '',
      location: payload.location || '',
      service: payload.service_interest || '',
      form_source: payload.source,
      _subject: payload.subject || 'Website lead — ASAP NJ',
      _template: 'table',
      _replyto: payload.email || undefined,
      _honey: '',
    });
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    const text = (data && (data.message || data.success || data.error)) || '';
    const ok =
      res.ok &&
      data &&
      (data.success === 'true' ||
        data.success === true ||
        /success|thank/i.test(String(text)) ||
        (!data.error && res.status === 200 && !/activate|confirm/i.test(String(text))));
    const needsActivation = /activate|confirm your email|check your email/i.test(String(text));
    return {
      ok: !!ok && !needsActivation,
      needsActivation: !!needsActivation,
      status: res.status,
      data: data,
      text: String(text || ''),
    };
  }

  function setMsg(form, text, tone) {
    let el = form.querySelector('.lead-capture-msg');
    if (!el) {
      el = document.createElement('p');
      el.className = 'lead-capture-msg';
      el.style.cssText = 'margin-top:.75rem;font-size:.9rem;line-height:1.4;';
      form.appendChild(el);
    }
    el.textContent = text;
    el.style.color =
      tone === 'ok' ? '#22c55e' : tone === 'bad' ? '#ef4444' : '#eab308';
  }

  function nextUrl(form) {
    const el = form.querySelector('input[name="_next"]');
    return el && el.value ? el.value : '';
  }

  function showRtkCreds(form, creds) {
    var existing = form.parentNode && form.parentNode.querySelector('.rtk-instant-creds');
    if (existing) existing.remove();

    var box = document.createElement('div');
    box.className = 'rtk-instant-creds';
    box.setAttribute('role', 'status');
    box.style.cssText =
      'margin-top:1rem;padding:1rem 1.1rem;border-radius:12px;border:1px solid rgba(34,197,94,.35);' +
      'background:rgba(34,197,94,.08);color:var(--text,#e8eef7);';
    box.innerHTML =
      '<p style="margin:0 0 .65rem;font-weight:700;color:#4ade80">Your login is ready — save it now</p>' +
      '<p style="margin:0 0 .75rem;font-size:.88rem;color:var(--text-muted,#a8b3c4);line-height:1.45">' +
      'Seat activates automatically (usually under 1 minute). Use these on your controller with host ' +
      '<strong style="color:inherit">rtk.asap-nj.com</strong>, port <strong style="color:inherit">2101</strong>, mount <strong style="color:inherit">ASAP-NJ</strong>.' +
      '</p>' +
      '<div style="display:grid;gap:.45rem;font-family:ui-monospace,Consolas,monospace;font-size:.92rem">' +
      '<div><span style="opacity:.7">Username</span><br><strong id="rtk-cred-user" style="user-select:all">' +
      escapeHtml(creds.username) +
      '</strong> <button type="button" data-copy="' +
      escapeAttr(creds.username) +
      '" class="rtk-copy-btn" style="margin-left:.35rem">Copy</button></div>' +
      '<div><span style="opacity:.7">Password</span><br><strong id="rtk-cred-pass" style="user-select:all">' +
      escapeHtml(creds.password) +
      '</strong> <button type="button" data-copy="' +
      escapeAttr(creds.password) +
      '" class="rtk-copy-btn" style="margin-left:.35rem">Copy</button></div>' +
      '</div>' +
      '<p style="margin:.85rem 0 0;font-size:.82rem;color:var(--text-dim,#7a8699)">Do not share this login. Screenshot or copy before you leave this page.</p>' +
      '<p style="margin:.5rem 0 0"><a href="rtk-setup.html?ok=1" style="color:#4ade80;font-weight:600">Open connection steps →</a></p>';

    form.style.display = 'none';
    form.parentNode.insertBefore(box, form.nextSibling);

    box.querySelectorAll('.rtk-copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-copy') || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(function () {
            btn.textContent = 'Copied';
            setTimeout(function () {
              btn.textContent = 'Copy';
            }, 1500);
          });
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function storeRtkCreds(creds, email) {
    try {
      sessionStorage.setItem(
        'asap_rtk_creds',
        JSON.stringify({
          username: creds.username,
          password: creds.password,
          email: email || '',
          host: 'rtk.asap-nj.com',
          port: 2101,
          mount: 'ASAP-NJ',
          at: Date.now(),
        })
      );
    } catch (_) {}
  }

  function bindForm(form) {
    if (!form || form.dataset.leadBound === '1') return;
    form.dataset.leadBound = '1';
    const source = form.getAttribute('data-lead-form') || 'web_contact';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;
      setMsg(form, 'Sending…', 'ok');

      const payload = formToPayload(form, source);
      if (source === 'rtk_register' || /rtk/i.test(String(payload.source))) {
        payload.source = 'rtk_register';
      }
      if (source === 'insurance') payload.source = 'insurance';
      if (source === 'hoa_pm' || source === 'hoa') payload.source = 'hoa_pm';
      if (source === 'portal_access') payload.source = 'portal_access';

      if (!payload.email) {
        setMsg(form, 'Email is required.', 'bad');
        if (btn) btn.disabled = false;
        return;
      }

      var rtkCreds = null;
      if (payload.source === 'rtk_register') {
        rtkCreds = ensureRtkCredentials(payload);
        // Sync generated values into form fields so FormSubmit body is complete
        var uEl = form.querySelector('[name="preferred_username"]');
        var pEl = form.querySelector('[name="preferred_password"]');
        if (uEl) uEl.value = rtkCreds.username;
        if (pEl) pEl.value = rtkCreds.password;
        storeRtkCreds(rtkCreds, payload.email);
      }

      // 1) Cloud CRM inbox — required path for Mini auto-issue of RTK seats
      let cloud = { skipped: true };
      try {
        cloud = await sendCloud(payload);
      } catch (err) {
        console.warn(err);
        cloud = { ok: false, error: String(err) };
      }

      // RTK: cloud is the activation path — fail loudly if it fails
      if (payload.source === 'rtk_register' && !(cloud && cloud.ok)) {
        setMsg(
          form,
          'Could not reach the seat system. Check your connection and try again, or email gary.colyer@asap-nj.com.',
          'bad'
        );
        if (btn) btn.disabled = false;
        return;
      }

      // 2) Company email via FormSubmit (notify Gary; RTK includes preferred user/pass)
      setMsg(form, payload.source === 'rtk_register' ? 'Activating your seat…' : 'Sending to ASAP NJ…', 'ok');
      let mail;
      try {
        mail = await sendFormsubmit(payload);
      } catch (err) {
        console.warn(err);
        mail = { ok: false, text: String(err && err.message ? err.message : err) };
      }

      // For RTK: if cloud succeeded but FormSubmit failed, still give them credentials
      if (payload.source === 'rtk_register' && rtkCreds && cloud && cloud.ok) {
        showRtkCreds(form, rtkCreds);
        setMsg(
          form,
          mail && mail.ok
            ? 'Seat request saved. Copy your login below — it activates within about a minute.'
            : 'Seat request saved (email notify delayed). Copy your login below — it activates within about a minute.',
          'ok'
        );
        if (btn) btn.disabled = false;
        return;
      }

      if (mail.needsActivation) {
        setMsg(
          form,
          'Almost there — the company inbox still needs one-time FormSubmit activation. Check gary.colyer@asap-nj.com (and spam) for “Activate FormSubmit” and click the link, then try again.',
          'bad'
        );
        if (btn) btn.disabled = false;
        return;
      }

      if (!mail.ok) {
        setMsg(
          form,
          'Could not reach ASAP NJ email (' +
            (mail.text || 'HTTP ' + (mail.status || '?') || 'network') +
            '). Check your connection and try again. If this keeps happening, email gary.colyer@asap-nj.com directly.',
          'bad'
        );
        if (btn) btn.disabled = false;
        return;
      }

      const cloudNote =
        cloud && cloud.ok
          ? ' Also saved to CRM cloud inbox.'
          : cloud && cloud.skipped
            ? ''
            : ' (CRM cloud inbox not ready yet — email still sent.)';

      setMsg(form, 'Got it — thanks! We emailed ASAP NJ and will follow up.' + cloudNote, 'ok');
      form.reset();
      if (btn) btn.disabled = false;

      const go = nextUrl(form);
      if (go) {
        setTimeout(function () {
          window.location.href = go;
        }, 900);
      }
    });
  }

  function init() {
    document.querySelectorAll('form[data-lead-form]').forEach(bindForm);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ASAP_LEAD_CAPTURE = {
    bindForm,
    cloudReady,
    formToPayload,
    sendCloud,
    sendFormsubmit,
    ensureRtkCredentials,
  };
})();
