/* ASAP NJ Client Portal */
(function () {
  const CFG = window.ASAP_PORTAL || { useDemo: true };
  const AUTH_KEY = 'asap_portal_session_v1';

  function $(id) { return document.getElementById(id); }

  function money(n) {
    return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); }
    catch { return null; }
  }

  function setSession(s) {
    if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
    else localStorage.removeItem(AUTH_KEY);
  }

  function requireAuth() {
    const s = getSession();
    if (!s) {
      window.location.href = './index.html';
      return null;
    }
    return s;
  }

  /** Demo data — replace with Supabase rows when live */
  function demoReports(email) {
    return [
      {
        id: 'RPT-2026-0142',
        title: 'Thermal solar inspection — sample site',
        site: 'South Jersey commercial rooftop (sample)',
        date: '2026-07-12',
        type: 'Solar thermal',
        status: 'ready',
        amount_due: 0,
        amount_paid: 450,
        payment_link: CFG.stripePaymentLink || '',
        summary: 'Sample deliverable package: annotated findings, thermal overview notes, and next-step recommendations.',
        file_url: '#',
        file_label: 'Report PDF (demo)'
      },
      {
        id: 'RPT-2026-0155',
        title: 'Insurance roof documentation — sample',
        site: 'Residential claim site (sample)',
        date: '2026-07-18',
        type: 'Insurance',
        status: 'ready',
        amount_due: 275,
        amount_paid: 0,
        payment_link: CFG.stripePaymentLink || '',
        summary: 'Aerial stills + roof condition notes for the claim file. Balance due to release full package in live mode.',
        file_url: '#',
        file_label: 'Photo package (demo)'
      },
      {
        id: 'INV-2026-DEPOSIT',
        title: 'Job deposit / open balance',
        site: email,
        date: new Date().toISOString().slice(0, 10),
        type: 'Payment',
        status: 'due',
        amount_due: 500,
        amount_paid: 0,
        payment_link: CFG.stripePaymentLink || '',
        summary: 'Use this to collect deposits or remaining balances. Wire your Stripe Payment Link in config.js for real charges.',
        file_url: '',
        file_label: ''
      }
    ];
  }

  // ——— Login page ———
  function initLogin() {
    const form = $('login-form');
    if (!form) return;

    if (getSession()) {
      window.location.href = './dashboard.html';
      return;
    }

    if (CFG.useDemo) {
      const b = $('demo-banner');
      if (b) b.classList.remove('hidden');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = ($('email').value || '').trim().toLowerCase();
      const password = $('password').value || '';
      const msg = $('auth-msg');
      msg.textContent = '';
      msg.className = 'auth-msg';

      if (!email || !password) {
        msg.textContent = 'Enter email and password.';
        return;
      }

      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;

      try {
        if (CFG.useDemo || !CFG.supabaseUrl || !CFG.supabaseAnonKey) {
          // Demo gate
          if (password !== 'demo' && password !== 'Demo') {
            throw new Error('Demo password is: demo');
          }
          setSession({ email, name: email.split('@')[0], mode: 'demo', at: Date.now() });
          msg.textContent = 'Signed in…';
          msg.className = 'auth-msg ok';
          window.location.href = './dashboard.html';
          return;
        }

        // Live Supabase
        if (!window.supabase) throw new Error('Supabase library not loaded.');
        const client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setSession({
          email: data.user.email,
          uid: data.user.id,
          mode: 'live',
          at: Date.now(),
          access_token: data.session.access_token
        });
        window.location.href = './dashboard.html';
      } catch (err) {
        msg.textContent = err.message || 'Login failed.';
        btn.disabled = false;
      }
    });

    const accessForm = $('access-form');
    if (accessForm) {
      accessForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = $('access-msg');
        msg.textContent = '';
        const email = ($('access-email').value || '').trim();
        const note = ($('access-note').value || '').trim();
        if (!email) {
          msg.textContent = 'Email required.';
          return;
        }
        try {
          if (CFG.formspreeAccess) {
            const res = await fetch(CFG.formspreeAccess, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                _subject: 'Client portal access request',
                email,
                message: note || 'Please set up client portal access.',
                source: 'client-portal'
              })
            });
            if (!res.ok) throw new Error('Could not send request.');
          }
          msg.textContent = 'Request sent. We will email you login details.';
          msg.className = 'auth-msg ok';
          accessForm.reset();
        } catch (err) {
          msg.textContent = err.message || 'Could not send. Email us directly.';
          msg.className = 'auth-msg';
        }
      });
    }
  }

  // ——— Dashboard ———
  async function loadReports(session) {
    if (session.mode === 'demo' || CFG.useDemo || !CFG.supabaseUrl) {
      return demoReports(session.email);
    }

    const client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    // Restore session if needed — for production you may store full supabase session
    const { data, error } = await client
      .from('client_reports')
      .select('*')
      .order('date', { ascending: false });

    if (error) {
      console.error(error);
      return demoReports(session.email);
    }
    return (data || []).map((r) => ({
      id: r.id || r.report_id,
      title: r.title,
      site: r.site_label || r.site,
      date: r.date || r.created_at,
      type: r.service_type || r.type,
      status: r.status || 'ready',
      amount_due: Number(r.amount_due || 0),
      amount_paid: Number(r.amount_paid || 0),
      payment_link: r.payment_link || CFG.stripePaymentLink || '',
      summary: r.summary || '',
      file_url: r.file_url || '',
      file_label: r.file_label || 'Download report'
    }));
  }

  function renderDashboard(session, reports) {
    const greet = $('dash-greet');
    if (greet) greet.textContent = session.email;

    const due = reports.reduce((s, r) => s + (Number(r.amount_due) || 0), 0);
    const ready = reports.filter((r) => r.status === 'ready' || r.file_url).length;
    const open = reports.filter((r) => Number(r.amount_due) > 0).length;

    if ($('stat-reports')) $('stat-reports').textContent = String(reports.length);
    if ($('stat-ready')) $('stat-ready').textContent = String(ready);
    if ($('stat-due')) {
      $('stat-due').textContent = money(due);
      $('stat-due').className = 'v' + (due > 0 ? ' warn' : ' ok');
    }
    if ($('stat-open')) $('stat-open').textContent = String(open);

    const list = $('report-list');
    if (!list) return;

    if (!reports.length) {
      list.innerHTML = '<div class="empty">No reports yet. When your inspection is complete, packages will show up here.</div>';
      return;
    }

    list.innerHTML = reports.map((r) => {
      const dueAmt = Number(r.amount_due) || 0;
      const badge = dueAmt > 0
        ? '<span class="badge badge-due">Balance due</span>'
        : (r.status === 'draft'
          ? '<span class="badge badge-draft">Processing</span>'
          : '<span class="badge badge-paid">Paid / clear</span>');

      const payBtn = dueAmt > 0 && (r.payment_link || CFG.stripePaymentLink)
        ? `<a class="btn btn-pay btn-sm" href="${r.payment_link || CFG.stripePaymentLink}" target="_blank" rel="noopener">Pay ${money(dueAmt)}</a>`
        : (dueAmt > 0
          ? `<button type="button" class="btn btn-pay btn-sm" disabled title="Add Stripe Payment Link in config.js">Pay ${money(dueAmt)}</button>`
          : '');

      const dl = r.file_url && r.file_url !== '#'
        ? `<a class="btn btn-ghost btn-sm" href="${r.file_url}" target="_blank" rel="noopener">${r.file_label || 'Download'}</a>`
        : (r.file_label
          ? `<button type="button" class="btn btn-ghost btn-sm" disabled title="Demo — real PDFs attach when portal is live">${r.file_label}</button>`
          : '');

      return `<article class="report">
        <div>
          <div>${badge}<span class="meta">${r.type || ''} · ${r.id || ''}</span></div>
          <h3>${escapeHtml(r.title)}</h3>
          <div class="meta">${escapeHtml(r.site || '')} · ${escapeHtml(String(r.date || '').slice(0, 10))}</div>
          <p class="desc">${escapeHtml(r.summary || '')}</p>
        </div>
        <div class="report-actions">${dl}${payBtn}</div>
      </article>`;
    }).join('');

    // Pay all open
    const payAll = $('pay-all');
    const link = CFG.stripePaymentLink || reports.find((r) => r.payment_link)?.payment_link;
    if (payAll) {
      if (due > 0 && link) {
        payAll.href = link;
        payAll.classList.remove('hidden');
        payAll.textContent = 'Pay open balance (' + money(due) + ')';
      } else if (due > 0) {
        payAll.classList.remove('hidden');
        payAll.removeAttribute('href');
        payAll.setAttribute('aria-disabled', 'true');
        payAll.textContent = 'Add Stripe link to enable pay';
        payAll.classList.add('btn-ghost');
        payAll.classList.remove('btn-pay');
      }
    }

    const portal = $('stripe-portal');
    if (portal && CFG.stripeCustomerPortalLink) {
      portal.href = CFG.stripeCustomerPortalLink;
      portal.classList.remove('hidden');
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function initDashboard() {
    const session = requireAuth();
    if (!session) return;

    if (CFG.useDemo) {
      const b = $('demo-banner');
      if (b) b.classList.remove('hidden');
    }

    const logout = $('logout-btn');
    if (logout) {
      logout.addEventListener('click', async () => {
        if (!CFG.useDemo && CFG.supabaseUrl && window.supabase) {
          try {
            const client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
            await client.auth.signOut();
          } catch (_) { /* ignore */ }
        }
        setSession(null);
        window.location.href = './index.html';
      });
    }

    try {
      const reports = await loadReports(session);
      renderDashboard(session, reports);
    } catch (e) {
      console.error(e);
      renderDashboard(session, demoReports(session.email));
    }
  }

  // Boot
  const page = document.body.dataset.page;
  if (page === 'login') initLogin();
  if (page === 'dashboard') initDashboard();
})();
