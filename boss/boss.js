/* ASAP-NJ Boss desk — email login + first-time password setup */
(function () {
  const CFG = window.ASAP_BOSS || {};
  const SESSION_KEY = 'asap_boss_session_v2';
  const LOCAL_AUTH_KEY = 'asap_boss_auth_v2';

  function $(id) { return document.getElementById(id); }

  function allowedEmails() {
    return (CFG.allowedEmails || []).map((e) => String(e).trim().toLowerCase());
  }

  function isAllowedEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return allowedEmails().includes(e);
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.exp || !s.email || Date.now() > s.exp) return null;
      if (!isAllowedEmail(s.email)) return null;
      return s;
    } catch { return null; }
  }

  function setSession(email) {
    if (!email) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const hrs = Number(CFG.sessionHours) || 12;
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      email: String(email).trim().toLowerCase(),
      exp: Date.now() + hrs * 3600 * 1000,
    }));
  }

  function getLocalAuth() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_AUTH_KEY) || 'null');
    } catch { return null; }
  }

  function setLocalAuth(email, passwordHash) {
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify({
      email: String(email).trim().toLowerCase(),
      passwordHash,
      setAt: new Date().toISOString(),
    }));
  }

  let remoteAuth = null; // { email?, passwordHash } from data/auth.json

  async function loadRemoteAuth() {
    try {
      const url = (CFG.authUrl || 'data/auth.json') + '?t=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.passwordHash) {
        remoteAuth = data;
        return data;
      }
    } catch { /* no remote auth yet */ }
    return null;
  }

  function hasPasswordConfigured(email) {
    const e = String(email || '').trim().toLowerCase();
    if (remoteAuth && remoteAuth.passwordHash) {
      if (!remoteAuth.email || String(remoteAuth.email).toLowerCase() === e) return true;
    }
    if (CFG.passwordHash) return true;
    const loc = getLocalAuth();
    if (loc && loc.passwordHash && loc.email === e) return true;
    return false;
  }

  async function verifyPassword(email, password) {
    const e = String(email || '').trim().toLowerCase();
    const hash = await sha256Hex(password + '|' + e);
    const candidates = [];
    if (remoteAuth && remoteAuth.passwordHash) {
      if (!remoteAuth.email || String(remoteAuth.email).toLowerCase() === e) {
        candidates.push(String(remoteAuth.passwordHash).toLowerCase());
      }
    }
    if (CFG.passwordHash) candidates.push(String(CFG.passwordHash).toLowerCase());
    const loc = getLocalAuth();
    if (loc && loc.email === e && loc.passwordHash) {
      candidates.push(String(loc.passwordHash).toLowerCase());
    }
    return candidates.some((h) => h === hash);
  }

  function showDash(on, email) {
    $('view-login').classList.toggle('hidden', on);
    $('view-dash').classList.toggle('hidden', !on);
    $('btn-logout').classList.toggle('hidden', !on);
    if (on && email) $('dash-email').textContent = email;
    // Auto-import website forms into CRM whenever you open the desk
    if (on && window.ASAP_CRM && typeof window.ASAP_CRM.startAutoPullWebLeads === 'function') {
      try { window.ASAP_CRM.startAutoPullWebLeads(); } catch (_) { /* optional */ }
    }
  }

  function showAuthStep(step) {
    // step: email | login | setup
    $('email-form').classList.toggle('hidden', step !== 'email');
    $('login-form').classList.toggle('hidden', step !== 'login');
    $('setup-form').classList.toggle('hidden', step !== 'setup');
    if (step === 'email') {
      $('auth-title').textContent = 'Boss login';
      $('auth-lead').textContent = 'Sign in with your company email.';
    } else if (step === 'login') {
      $('auth-title').textContent = 'Welcome back';
      $('auth-lead').textContent = 'Enter your boss desk password.';
    } else {
      $('auth-title').textContent = 'Create password';
      $('auth-lead').textContent = 'First time — set a password for your company email.';
    }
  }

  function money(n) {
    return Number(n || 0).toLocaleString();
  }

  function fmtMin(m) {
    m = Number(m) || 0;
    if (m < 60) return m.toFixed(1) + ' min';
    return (m / 60).toFixed(1) + ' h';
  }

  function badge(level, text) {
    const cls = level === 'bad' ? 'badge-bad' : level === 'warn' ? 'badge-warn' : level === 'ok' ? 'badge-ok' : 'badge-info';
    return `<span class="badge ${cls}">${text}</span>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Fix mojibake / smart punctuation so boss notes never show â€ garbage */
  function cleanText(s) {
    return String(s == null ? '' : s)
      .replace(/\u2014|\u2013/g, '-')
      .replace(/â€”|â€“|â€"|â€"|â€-/g, '-')
      .replace(/â€™|â€˜/g, "'")
      .replace(/â€œ|â€/g, '"')
      .replace(/â€./g, '-')
      .replace(/â€/g, '-');
  }

  function emptyPanel(msg) {
    return `<p class="empty">${escapeHtml(cleanText(msg))}</p>`;
  }

  function card(k, v, cls, sub) {
    return `<div class="stat"><div class="k">${escapeHtml(cleanText(k))}</div><div class="v ${cls || ''}">${escapeHtml(cleanText(v))}</div><div class="s">${escapeHtml(cleanText(sub || ''))}</div></div>`;
  }

  function notifHtml(n) {
    const lvl = n.level || 'info';
    return `<article class="${lvl === 'warn' || lvl === 'bad' ? lvl : ''}">
      <div class="meta">${escapeHtml(n.ts || '')} · ${badge(lvl, (lvl || 'info').toUpperCase())}</div>
      <div>${escapeHtml(n.text || '')}</div>
    </article>`;
  }

  let pendingEmail = '';

  async function initAuth() {
    await loadRemoteAuth();

    const sess = getSession();
    if (sess) {
      showDash(true, sess.email);
      loadStats();
      return;
    }
    showDash(false);
    showAuthStep('email');

    $('email-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = ($('email').value || '').trim().toLowerCase();
      $('email-msg').textContent = '';
      if (!isAllowedEmail(email)) {
        $('email-msg').textContent = 'That email is not authorized for the boss desk.';
        return;
      }
      pendingEmail = email;
      $('login-email-label').textContent = email;
      $('setup-email-label').textContent = email;
      if (hasPasswordConfigured(email)) {
        showAuthStep('login');
        $('password').focus();
      } else {
        showAuthStep('setup');
        $('new-pass').focus();
      }
    });

    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('password').value || '';
      $('login-msg').textContent = '';
      const ok = await verifyPassword(pendingEmail, pw);
      if (!ok) {
        $('login-msg').innerHTML =
          'Wrong password. <button type="button" id="btn-reset-boss-pw" class="btn btn-ghost" style="margin-top:.5rem;width:100%">Forgot? Reset on this device</button>';
        const br = $('btn-reset-boss-pw');
        if (br) {
          br.onclick = () => {
            try { localStorage.removeItem(LOCAL_AUTH_KEY); } catch (_) {}
            remoteAuth = null;
            $('login-msg').textContent = '';
            $('password').value = '';
            showAuthStep('setup');
            $('setup-msg').textContent =
              'Create a new boss password for this browser. To use the same password on every device, run Set-BossPassword.ps1 on Mini and deploy auth.json.';
            $('new-pass').focus();
          };
        }
        return;
      }
      setSession(pendingEmail);
      showDash(true, pendingEmail);
      loadStats();
    });

    $('setup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = $('new-pass').value || '';
      const p2 = $('new-pass2').value || '';
      $('setup-msg').textContent = '';
      if (p1.length < 8) {
        $('setup-msg').textContent = 'Use at least 8 characters.';
        return;
      }
      if (p1 !== p2) {
        $('setup-msg').textContent = 'Passwords do not match.';
        return;
      }
      const hash = await sha256Hex(p1 + '|' + pendingEmail);
      setLocalAuth(pendingEmail, hash);
      // Help multi-device: download auth.json for Mini deploy
      try {
        const blob = new Blob([JSON.stringify({
          email: pendingEmail,
          passwordHash: hash,
          setAt: new Date().toISOString(),
          note: 'Place as website/boss/data/auth.json and deploy so all devices share this password.',
        }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'auth.json';
        a.click();
        URL.revokeObjectURL(a.href);
      } catch { /* ignore */ }

      setSession(pendingEmail);
      showDash(true, pendingEmail);
      loadStats();
      alert('Password saved on this device.\n\nOptional: an auth.json file downloaded — put it in website/boss/data/ and redeploy so the same password works on every computer.\n\nOr on Mini run:\n  Publish-BossStats after saving the hash with Set-BossPassword.ps1');
    });

    $('btn-back-login').addEventListener('click', () => showAuthStep('email'));
    $('btn-back-setup').addEventListener('click', () => showAuthStep('email'));
  }

  function initTabs() {
    document.querySelectorAll('.nav-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-tabs button').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
        btn.classList.add('active');
        const el = document.getElementById('tab-' + btn.dataset.tab);
        if (el) el.classList.add('active');
      });
    });
    $('btn-logout').addEventListener('click', () => {
      setSession(null);
      showDash(false);
      showAuthStep('email');
    });
    const btnRef = $('btn-refresh');
    if (btnRef) {
      btnRef.addEventListener('click', async () => {
        const prev = btnRef.textContent;
        btnRef.disabled = true;
        btnRef.textContent = 'Refreshing…';
        try {
          await loadStats({ force: true });
        } finally {
          btnRef.disabled = false;
          btnRef.textContent = prev || 'Refresh';
        }
      });
    }
    if (CFG.cloudflareAnalyticsUrl) {
      const a = $('link-cf');
      if (a) a.href = CFG.cloudflareAnalyticsUrl;
      const a2 = $('link-cf-site');
      if (a2) a2.href = CFG.cloudflareAnalyticsUrl;
    }
  }

  function fmtBytes(n) {
    const x = Number(n) || 0;
    if (x >= 1073741824) return (x / 1073741824).toFixed(2) + ' GB';
    if (x >= 1048576) return (x / 1048576).toFixed(1) + ' MB';
    if (x >= 1024) return (x / 1024).toFixed(0) + ' KB';
    return String(Math.round(x)) + ' B';
  }

  function sparklineSvg(values, color) {
    const nums = (values || []).map((v) => Number(v) || 0);
    if (!nums.length) {
      return `<svg class="viz-spark" viewBox="0 0 88 40" aria-hidden="true"><path d="M2 30 H86" stroke="${color}" stroke-width="1.5" opacity=".25" fill="none"/></svg>`;
    }
    const w = 88, h = 40, pad = 3;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const pts = nums.map((v, i) => {
      const x = pad + (i * (w - pad * 2)) / Math.max(nums.length - 1, 1);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return [x, y];
    });
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L${pts[0][0].toFixed(1)} ${h - pad} Z`;
    const gid = 'sg' + Math.random().toString(36).slice(2, 9);
    return `<svg class="viz-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".35"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.6" fill="${color}"/>
    </svg>`;
  }

  function ringSvg(pct, color) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const r = 22, c = 2 * Math.PI * r;
    const dash = (p / 100) * c;
    return `<svg class="viz-ring" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="5"/>
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="5"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"
        transform="rotate(-90 28 28)"/>
      <text x="28" y="31" text-anchor="middle" fill="${color}" font-size="11" font-weight="700">${Math.round(p)}%</text>
    </svg>`;
  }

  function iconSvg(name) {
    const common = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
    const icons = {
      eye: `<path ${common} d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle ${common} cx="12" cy="12" r="3"/>`,
      bolt: `<path ${common} d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>`,
      users: `<path ${common} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle ${common} cx="9" cy="7" r="3"/><path ${common} d="M22 21v-2a4 4 0 0 0-3-3.87"/><path ${common} d="M16 3.13a3 3 0 0 1 0 5.94"/>`,
      shield: `<path ${common} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
      disk: `<ellipse ${common} cx="12" cy="5" rx="9" ry="3"/><path ${common} d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path ${common} d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/>`,
      gauge: `<path ${common} d="M12 15l3.5-3.5"/><path ${common} d="M4.9 19A9 9 0 1 1 19 19"/><circle ${common} cx="12" cy="15" r="1.2" fill="currentColor"/>`,
      clock: `<circle ${common} cx="12" cy="12" r="9"/><path ${common} d="M12 7v5l3 2"/>`,
    };
    const body = icons[name] || icons.bolt;
    return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${body}</svg>`;
  }

  function vizCard({ label, value, sub, tone, spark, ring, icon, valueClass }) {
    const toneCls = tone ? ` tone-${tone}` : ' tone-accent';
    let right = '';
    if (ring != null) right = ringSvg(ring, tone === 'warn' ? '#eab308' : tone === 'bad' ? '#ef4444' : tone === 'ok' ? '#22c55e' : '#3ec4e8');
    else if (spark && spark.length) right = sparklineSvg(spark, tone === 'purple' ? '#a78bfa' : tone === 'ok' ? '#22c55e' : tone === 'warn' ? '#eab308' : '#3ec4e8');
    else if (icon) right = `<div class="viz-icon">${iconSvg(icon)}</div>`;
    return `<article class="viz-card${toneCls}">
      <div class="viz-label">${escapeHtml(label)}</div>
      <div class="viz-row">
        <div class="viz-value ${valueClass || ''}">${escapeHtml(String(value))}</div>
        ${right}
      </div>
      <div class="viz-sub">${escapeHtml(sub || '')}</div>
    </article>`;
  }

  function dailyBarsHtml(daily) {
    const rows = daily || [];
    if (!rows.length) return '';
    const maxReq = Math.max(...rows.map((d) => Number(d.requests) || 0), 1);
    const maxViews = Math.max(...rows.map((d) => Number(d.pageViews) || 0), 1);
    const max = Math.max(maxReq, maxViews);
    const cols = rows.map((d) => {
      const req = Number(d.requests) || 0;
      const views = Number(d.pageViews) || 0;
      const hReq = Math.max(4, Math.round((req / max) * 100));
      const hViews = Math.max(3, Math.round((views / max) * 100));
      const day = String(d.date || '').slice(5); // MM-DD
      const title = `${d.date}: ${req} req, ${views} views`;
      return `<div class="bar-col" title="${escapeHtml(title)}">
        <div class="bar-stack">
          <div class="bar-seg requests" style="height:${hReq}%"></div>
          <div class="bar-seg views" style="height:${hViews}%"></div>
        </div>
        <div class="bar-day">${escapeHtml(day)}</div>
      </div>`;
    }).join('');
    return `<div class="bars-wrap">${cols}</div>
      <div class="bars-legend">
        <span><i class="lg-views"></i>Page views</span>
        <span><i class="lg-req"></i>Requests</span>
      </div>
      <details style="margin-top:.85rem">
        <summary class="note" style="cursor:pointer;color:var(--muted)">Show daily numbers table</summary>
        <table style="margin-top:.6rem"><thead><tr><th>Date</th><th>Requests</th><th>Page views</th><th>Uniques</th><th>Threats</th></tr></thead><tbody>
        ${rows.map((d) => `<tr>
          <td class="mono">${escapeHtml(d.date || '')}</td>
          <td>${money(d.requests)}</td>
          <td>${money(d.pageViews)}</td>
          <td>${money(d.uniques)}</td>
          <td>${money(d.threats)}</td>
        </tr>`).join('')}
        </tbody></table>
      </details>`;
  }

  function pathBarsHtml(paths) {
    const list = paths || [];
    if (!list.length) return '';
    const max = Math.max(...list.map((p) => Number(p.count) || 0), 1);
    return `<div class="path-bars">${list.slice(0, 10).map((p) => {
      const n = Number(p.count) || 0;
      const pct = Math.max(2, Math.round((n / max) * 100));
      return `<div class="path-row">
        <div class="path-name" title="${escapeHtml(p.path || '')}">${escapeHtml(p.path || '')}</div>
        <div class="path-count">${money(n)}</div>
        <div class="path-track"><div class="path-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('')}</div>`;
  }

  async function loadStats(opts) {
    const force = !!(opts && opts.force);
    const base = CFG.statsUrl || 'data/stats.json';
    // Bust CDN + browser cache hard (Cloudflare/GitHub Pages often sticky)
    const url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now() + '&r=' + Math.random().toString(36).slice(2);
    try {
      if ($('gen-stamp') && force) {
        $('gen-stamp').textContent = 'Refreshing stats…';
      }
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      render(data);
      if (force && $('gen-stamp')) {
        const stamp = 'Stats: ' + (data.generated_at_iso || '—') + (data.host ? ' · ' + data.host : '');
        $('gen-stamp').textContent = stamp + ' · refreshed';
      }
    } catch (e) {
      $('gen-stamp').textContent = 'Stats not published yet — server Publish-AndDeploy may be delayed';
      $('overview-stats').innerHTML = emptyPanel('No stats.json yet.');
      $('overview-alerts').innerHTML = emptyPanel(String(e.message || e));
    }
  }

  /** Collapse many sessions into one row per NTRIP username (login count). */
  function groupRtkByUser(recent, topUsers, liveList) {
    const map = {};
    function bump(u, row) {
      const key = String(u || '(unknown)').toLowerCase();
      if (!map[key]) {
        map[key] = {
          user: u || '(unknown)',
          who: row.who || '',
          name: row.name || '',
          email: row.email || '',
          company: row.company || '',
          phone: row.phone || '',
          logins: 0,
          minutes: 0,
          kb: 0,
          last_at: '',
          via: row.via || '',
          live: false,
        };
      }
      const m = map[key];
      m.logins += 1;
      if (row.who) m.who = row.who;
      if (row.name) m.name = row.name;
      if (row.email) m.email = row.email;
      if (row.company) m.company = row.company;
      if (row.phone) m.phone = row.phone;
      if (row.via) m.via = row.via;
      const min = Number(row.minutes);
      if (!isNaN(min) && min > 0) m.minutes += min;
      else if (row.duration_sec != null) m.minutes += (Number(row.duration_sec) || 0) / 60;
      if (row.kb != null) m.kb += Number(row.kb) || 0;
      else if (row.bytes_sent != null) m.kb += (Number(row.bytes_sent) || 0) / 1024;
      const when = row.connected_at_iso || row.last_at || '';
      if (when && (!m.last_at || when > m.last_at)) m.last_at = when;
    }
    (recent || []).forEach((r) => bump(r.user, r));
    // Ensure top_users who appear in ledger aggregate get profile even if not in recent slice
    (topUsers || []).forEach((u) => {
      const key = String(u.user || '').toLowerCase();
      if (!key) return;
      if (!map[key]) {
        bump(u.user, {
          who: u.who, minutes: u.minutes, kb: u.kb,
          // count sessions as logins if we have no recent rows
          duration_sec: 0,
        });
        if (map[key] && u.sessions) map[key].logins = Number(u.sessions) || map[key].logins;
      } else if (u.sessions && u.sessions > map[key].logins) {
        map[key].logins = Number(u.sessions);
        if (u.who) map[key].who = u.who;
        if (u.minutes != null) map[key].minutes = Number(u.minutes) || map[key].minutes;
        if (u.kb != null) map[key].kb = Number(u.kb) || map[key].kb;
      }
    });
    (liveList || []).forEach((r) => {
      const key = String(r.user || '').toLowerCase();
      if (!map[key]) bump(r.user, r);
      if (map[key]) {
        map[key].live = true;
        if (r.who) map[key].who = r.who;
        if (r.name) map[key].name = r.name;
        if (r.email) map[key].email = r.email;
        if (r.company) map[key].company = r.company;
      }
    });
    return Object.values(map).sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      return (b.logins || 0) - (a.logins || 0);
    });
  }

  function render(d) {
    const rtk = d.rtk || {};
    const site = d.site || {};
    const notifs = d.notifications || [];
    const ideas = d.ideas || [];

    $('gen-stamp').textContent = 'Stats: ' + (d.generated_at_iso || '—') + (d.host ? ' · ' + d.host : '');

    const baseUp = !!rtk.base_up;
    const live = Number(rtk.live_clients || 0);
    const cf = (site && site.cloudflare) || {};
    const overviewCards = [
      card('RTK base', baseUp ? 'UP' : 'DOWN', baseUp ? 'ok' : 'bad', rtk.base_detail || ''),
      card('Live clients', String(live), live ? 'ok' : '', 'right now'),
      card('Sessions 7d', String(rtk.sessions_7d || 0), '', fmtMin(rtk.minutes_7d || 0)),
      card('Data 7d', money(rtk.kb_7d || 0) + ' KB', '', 'RTCM delivered'),
      card('Auth fails 24h', String(rtk.auth_fails_24h || 0), (rtk.auth_fails_24h || 0) > 0 ? 'warn' : 'ok', 'bad logins'),
      card('Partner seats', String(rtk.users_enabled || 0), '', (rtk.users_total || 0) + ' total'),
    ];
    if (cf.ok) {
      overviewCards.push(
        card('Site views 7d', money(cf.page_views_7d || 0), 'ok', 'Cloudflare page views'),
        card('Site requests 7d', money(cf.requests_7d || 0), '', cf.visits_7d != null ? (money(cf.visits_7d) + ' RUM visits') : 'edge hits')
      );
    }
    $('overview-stats').innerHTML = overviewCards.join('');
    if (window.ASAP_CRM && typeof window.ASAP_CRM.reload === 'function') {
      try { window.ASAP_CRM.reload(); } catch (_) { /* crm optional */ }
    } else if ($('overview-crm') && (!window.ASAP_BOSS || window.ASAP_BOSS.crmEnabled !== false)) {
      // crm.js paints this after load; leave placeholder if not yet
    }

    const alerts = (notifs.length ? notifs : [{ level: 'info', ts: '', text: 'No alerts.' }]).slice(0, 8);
    $('overview-alerts').innerHTML = alerts.map(n => notifHtml(n)).join('');

    $('rtk-stats').innerHTML = [
      card('Public host', CFG.rtkPublicHost || 'rtk.asap-nj.com', '', 'port ' + (CFG.rtkPort || 2101)),
      card('Mount', CFG.rtkMount || 'ASAP-NJ', '', CFG.rtkPublicIp || ''),
      card('Top user', (rtk.top_users && rtk.top_users[0] && rtk.top_users[0].user) || '—', '',
        rtk.top_users && rtk.top_users[0] ? fmtMin(rtk.top_users[0].minutes) : ''),
    ].join('');

    const top = rtk.top_users || [];
    $('rtk-top').innerHTML = top.length
      ? `<table><thead><tr><th>Seat</th><th>Contact</th><th>Logins</th><th>Time</th><th>Data</th></tr></thead><tbody>` +
        top.map(u => `<tr>
          <td class="mono">${escapeHtml(u.user)}</td>
          <td>${escapeHtml(u.who || '—')}</td>
          <td><strong>${money(u.sessions)}</strong></td>
          <td>${fmtMin(u.minutes)}</td>
          <td>${money(u.kb)} KB</td>
        </tr>`).join('') + `</tbody></table>`
      : emptyPanel('No sessions in ledger yet.');

    // One row per NTRIP seat — login count instead of a wall of duplicate lines
    const byUser = groupRtkByUser(rtk.recent || [], rtk.top_users || [], rtk.live || []);
    $('rtk-recent').innerHTML = byUser.length
      ? `<p class="note" style="margin-bottom:.6rem">Grouped by partner seat (same user reconnecting = one line, higher login count).</p>
        <table><thead><tr><th>Partner</th><th>Logins</th><th>Time on stream</th><th>Data</th><th>Last seen</th><th>Status</th></tr></thead><tbody>` +
        byUser.map((u) => {
          const who = u.who || [u.name, u.company].filter(Boolean).join(' / ');
          const contact = [
            who ? escapeHtml(who) : '',
            u.email ? `<span class="note" style="margin:0">${escapeHtml(u.email)}</span>` : '',
            u.phone ? `<span class="note" style="margin:0">${escapeHtml(u.phone)}</span>` : '',
          ].filter(Boolean).join('<br>');
          const seat = `<div class="mono">${escapeHtml(u.user)}</div>${contact || '<span class="note" style="margin:0">No contact on file</span>'}`;
          return `<tr>
          <td>${seat}</td>
          <td><strong>${money(u.logins)}</strong></td>
          <td>${fmtMin(u.minutes || 0)}</td>
          <td>${money(Math.round(u.kb || 0))} KB</td>
          <td class="mono">${escapeHtml((u.last_at || '').replace('T', ' '))}</td>
          <td>${u.live ? '<span class="badge badge-ok">LIVE</span>' : '<span class="badge badge-info">idle</span>'}</td>
        </tr>`;
        }).join('') + `</tbody></table>`
      : emptyPanel('No partner sessions in this period yet.');

    const liveList = rtk.live || [];
    $('rtk-live').innerHTML = liveList.length
      ? `<table><thead><tr><th>Seat / contact</th><th>IP</th><th>Via</th><th>For</th><th>Data</th></tr></thead><tbody>` +
        liveList.map(s => {
          const who = s.who || [s.name, s.company].filter(Boolean).join(' / ');
          const em = s.email ? `<div class="note" style="margin:0">${escapeHtml(s.email)}</div>` : '';
          const seat = who
            ? `<div class="mono">${escapeHtml(s.user)}</div><div>${escapeHtml(who)}</div>${em}`
            : `<div class="mono">${escapeHtml(s.user)}</div><div class="note" style="margin:0">No contact on file — issue seat with name/email</div>`;
          return `<tr>
          <td>${seat}</td>
          <td class="mono">${escapeHtml(s.ip)}</td>
          <td>${escapeHtml(s.via)}</td>
          <td>${fmtMin((s.connected_for_sec || 0) / 60)}</td>
          <td>${money((s.bytes_sent || 0) / 1024)} KB</td>
        </tr>`;
        }).join('') + `</tbody></table>`
      : emptyPanel('No live rover clients right now.');

    const cfOk = !!cf.ok;
    const daily = cf.daily || [];
    const sparkViews = daily.map((d) => d.pageViews);
    const sparkReq = daily.map((d) => d.requests);
    const sparkUniques = daily.map((d) => d.uniques);
    const sparkThreats = daily.map((d) => d.threats);

    if ($('site-stats')) {
      if (cfOk) {
        const threatTone = (cf.threats_7d || 0) > 50 ? 'warn' : (cf.threats_7d || 0) > 0 ? 'accent' : 'ok';
        const cacheTone = (cf.cached_pct || 0) < 5 ? 'warn' : 'ok';
        $('site-stats').innerHTML = [
          vizCard({
            label: 'Page views',
            value: money(cf.page_views_7d || 0),
            sub: '7 days · edge HTML/doc hits',
            tone: 'ok',
            valueClass: 'ok',
            spark: sparkViews,
            icon: sparkViews.length ? null : 'eye',
          }),
          vizCard({
            label: 'Requests',
            value: money(cf.requests_7d || 0),
            sub: 'All assets + pages through CF',
            tone: 'purple',
            spark: sparkReq,
            icon: sparkReq.length ? null : 'bolt',
          }),
          vizCard({
            label: 'Uniques (sum)',
            value: money(cf.uniques_7d || 0),
            sub: 'Daily uniques summed · 7d',
            tone: 'accent',
            spark: sparkUniques,
            icon: sparkUniques.length ? null : 'users',
          }),
          vizCard({
            label: 'RUM visits',
            value: cf.visits_7d != null ? money(cf.visits_7d) : '—',
            sub: 'Web Analytics beacon (when available)',
            tone: 'accent',
            icon: 'eye',
          }),
          vizCard({
            label: 'Cache hit',
            value: cf.cached_pct != null ? (Number(cf.cached_pct).toFixed(1) + '%') : '—',
            sub: 'Served from Cloudflare edge',
            tone: cacheTone,
            ring: cf.cached_pct,
            valueClass: cacheTone === 'ok' ? 'ok' : 'warn',
          }),
          vizCard({
            label: 'Threats blocked',
            value: money(cf.threats_7d || 0),
            sub: 'WAF / security events · 7d',
            tone: threatTone,
            spark: sparkThreats,
            valueClass: threatTone === 'warn' ? 'warn' : '',
            icon: sparkThreats.length ? null : 'shield',
          }),
          vizCard({
            label: 'Bandwidth',
            value: fmtBytes(cf.bytes_7d || 0),
            sub: 'Bytes delivered · 7 days',
            tone: 'purple',
            icon: 'disk',
          }),
          vizCard({
            label: 'Last fetch',
            value: (cf.fetched_at_iso || '—').replace('T', ' ').slice(5, 16),
            sub: cf.source || 'Cloudflare GraphQL',
            tone: 'accent',
            icon: 'clock',
          }),
        ].join('');
      } else {
        const hint = cleanText(
          cf.setup_hint ||
          site.note ||
          'Optional: add Cloudflare analytics token for traffic charts. RTK stats still work.'
        );
        // missing_token is optional polish - not a site outage
        const isOptional = cf.error === 'missing_token' || !cf.error;
        $('site-stats').innerHTML = vizCard({
          label: 'Visitor charts',
          value: isOptional ? 'Off (optional)' : 'Offline',
          sub: hint,
          tone: isOptional ? 'accent' : 'warn',
          valueClass: isOptional ? '' : 'warn',
          icon: 'gauge',
        });
      }
    }

    const rawNote = site.note || 'Traffic from Cloudflare when token is configured (server or Mini).';
    $('site-metrics-note').textContent = cleanText(rawNote);
    if ($('site-daily')) {
      $('site-daily').innerHTML = daily.length
        ? dailyBarsHtml(daily)
        : emptyPanel(cfOk ? 'No daily rows returned.' : cleanText(cf.setup_hint || 'Visitor charts not connected yet (optional).'));
    }
    if ($('site-top-paths')) {
      const paths = cf.top_paths || [];
      $('site-top-paths').innerHTML = paths.length
        ? pathBarsHtml(paths)
        : emptyPanel(cfOk
          ? 'Top paths unavailable (plan/API limit) - use full Cloudflare link for path breakdown.'
          : 'Paths load after Cloudflare analytics is connected.');
    }
    if (CFG.cloudflareAnalyticsUrl) {
      const a2 = $('link-cf-site');
      if (a2) a2.href = CFG.cloudflareAnalyticsUrl;
    }

    const sm = site.metrics || [];
    $('site-metrics-list').innerHTML = sm.length
      ? sm.map(m => `<li><strong>${escapeHtml(cleanText(m.label))}:</strong> ${escapeHtml(cleanText(m.value))}</li>`).join('')
      : '<li>No extra notes</li>';
    $('forms-note').innerHTML = cleanText(site.forms_note || 'Formsubmit email for leads for now.');

    $('notifications').innerHTML = (notifs.length ? notifs : [{ level: 'info', ts: '', text: 'All quiet.' }])
      .map(n => notifHtml(n)).join('');

    const growth = d.growth || {};
    const weekLabel = growth.label || isoWeekLabelClient();
    const theme = growth.theme || 'Grow the business';
    if ($('growth-week-label')) {
      $('growth-week-label').textContent = weekLabel;
    }
    if ($('growth-meta')) {
      const refreshed = growth.refreshed_at_iso
        ? growth.refreshed_at_iso.replace('T', ' ')
        : (d.generated_at_iso || '—');
      $('growth-meta').innerHTML =
        `<div class="growth-banner">
          <span><strong>This week’s focus:</strong> <span class="theme">${escapeHtml(theme)}</span></span>
          <span>${escapeHtml(weekLabel)}</span>
          <span>Updated with stats · ${escapeHtml(String(refreshed))}</span>
        </div>
        <span class="note">Ideas rebuild on each stats publish (server, or Mini during failover) from live RTK + Cloudflare when the token is available. Two “weekly” tips rotate each Monday.</span>`;
    }

    const defaultIdeas = weeklyFallbackIdeas();
    const list = ideas.length ? ideas : defaultIdeas;
    $('growth-ideas').innerHTML = list.map((i) => {
      const tag = String(i.tag || 'tip').toLowerCase();
      const prio = String(i.priority || 'normal').toLowerCase();
      const tags = [
        `<span class="idea-tag tag-${escapeHtml(tag)}">${escapeHtml(tag)}</span>`,
      ];
      if (prio === 'high') tags.push('<span class="idea-tag tag-high">priority</span>');
      return `<article class="${prio === 'high' ? 'prio-high' : ''}">
        <div class="idea-tags">${tags.join('')}</div>
        <h3>${escapeHtml(i.title)}</h3>
        <p>${escapeHtml(i.body)}</p>
      </article>`;
    }).join('');
  }

  function isoWeekLabelClient() {
    const now = new Date();
    const day = now.getDay(); // 0 Sun
    const monOffset = day === 0 ? -6 : 1 - day;
    const mon = new Date(now);
    mon.setDate(now.getDate() + monOffset);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `Week of ${fmt(mon)} – ${fmt(sun)}`;
  }

  function weeklyFallbackIdeas() {
    // Used only if stats.json has no ideas yet — still rotates by week
    const pool = [
      { title: 'Insurance vertical', body: 'Push roof / storm inspection content to insurance adjusters.', tag: 'weekly' },
      { title: 'Solar + thermal package', body: 'Bundle solar farm + thermal as one higher-ticket quote.', tag: 'weekly' },
      { title: 'Google Business posts', body: 'One Google Business jobsite photo this week.', tag: 'weekly' },
      { title: 'Partner one-pager', body: 'One-page RTK PDF with every approval email.', tag: 'weekly' },
      { title: 'Before/after reels', body: 'Ship one 15s inspection reel; link to contact form.', tag: 'weekly' },
      { title: 'Coverage honesty', body: 'Best near Toms River — far drops kill referrals.', tag: 'weekly' },
      { title: 'Seat hygiene', body: 'Disable unused RTK seats; keep VIP roster clean.', tag: 'weekly' },
      { title: 'Form follow-up SLA', body: 'Answer Formsubmit leads within 4 business hours.', tag: 'weekly' },
      { title: 'Airspace tool CTA', body: 'Story swipe-up to /airspace demo.', tag: 'weekly' },
      { title: 'Referral ask', body: 'After every happy flight, ask for one GC/surveyor intro.', tag: 'weekly' },
      { title: 'Public RTK path', body: 'Confirm rtk.asap-nj.com + port 2101 still reachable from the field.', tag: 'ops', priority: 'high' },
      { title: 'Site CTA check', body: 'Strongest offer (free RTK or inspection) above the fold.', tag: 'web' },
    ];
    const now = new Date();
    const oneJan = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil((((now - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
    const i = (week * 2) % pool.length;
    return [pool[i], pool[(i + 1) % pool.length], pool[(i + 3) % pool.length], pool[(i + 5) % pool.length]];
  }

  function initFieldTools() {
    const hours = $('qs-hours');
    const rate = $('qs-rate');
    const travel = $('qs-travel');
    const report = $('qs-report');
    const totalEl = $('qs-total');
    if (!hours || !totalEl) return;

    function calc() {
      const h = Number(hours.value) || 0;
      const r = Number(rate.value) || 0;
      const t = Number(travel.value) || 0;
      const p = Number(report.value) || 0;
      const total = h * r + t + p;
      totalEl.textContent = total.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      return { h, r, t, p, total };
    }
    ['qs-hours', 'qs-rate', 'qs-travel', 'qs-report'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('input', calc);
    });
    calc();

    const copyBtn = $('qs-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const name = ($('qs-name') && $('qs-name').value) || 'Job';
        const { h, r, t, p, total } = calc();
        const text = [
          'ASAP NJ Drone Services — quote sketch',
          'Job: ' + name,
          'Flight: ' + h + ' hr × $' + r + '/hr = $' + (h * r).toFixed(2),
          'Travel/mob: $' + t.toFixed(2),
          'Report/processing: $' + p.toFixed(2),
          'Estimated total: $' + total.toFixed(2),
          '(Estimate only — confirm scope before booking.)',
        ].join('\n');
        try {
          await navigator.clipboard.writeText(text);
          if ($('qs-msg')) $('qs-msg').textContent = 'Copied — paste into email or text.';
        } catch {
          if ($('qs-msg')) $('qs-msg').textContent = text;
        }
      });
    }
    const toCrm = $('qs-to-crm');
    if (toCrm) {
      toCrm.addEventListener('click', () => {
        const name = ($('qs-name') && $('qs-name').value) || 'Quoted job';
        const { total } = calc();
        if (window.ASAP_CRM && window.ASAP_CRM.getDb) {
          try {
            const db = window.ASAP_CRM.getDb();
            const id = (crypto.randomUUID && crypto.randomUUID()) || ('d-' + Date.now());
            db.deals.push({
              id,
              title: name,
              service_type: 'Inspection / flight',
              value_cents: Math.round(total * 100),
              currency: 'USD',
              stage: 'quoted',
              notes: 'From Field tools quote sketch',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            localStorage.setItem('asap_crm_v1', JSON.stringify(db));
            if ($('qs-msg')) $('qs-msg').textContent = 'Saved to CRM Pipeline as “quoted”. Open Pipeline tab.';
            if (window.ASAP_CRM.reload) window.ASAP_CRM.reload();
          } catch (e) {
            if ($('qs-msg')) $('qs-msg').textContent = 'Could not save to CRM.';
          }
        } else if ($('qs-msg')) {
          $('qs-msg').textContent = 'CRM not loaded — copy quote text instead.';
        }
      });
    }

    const KEY = 'asap_job_checklist_v1';
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
      document.querySelectorAll('[data-jc]').forEach((cb, i) => {
        cb.checked = !!saved[i];
        cb.addEventListener('change', () => {
          const arr = Array.from(document.querySelectorAll('[data-jc]')).map((x) => !!x.checked);
          localStorage.setItem(KEY, JSON.stringify(arr));
        });
      });
    } catch (_) {}
    const reset = $('jc-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        document.querySelectorAll('[data-jc]').forEach((cb) => { cb.checked = false; });
        localStorage.setItem(KEY, '[]');
      });
    }
  }

  initTabs();
  initAuth();
  initFieldTools();
})();
