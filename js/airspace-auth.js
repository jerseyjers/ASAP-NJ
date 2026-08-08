/**
 * ASAP NJ airspace gate — Google + email
 * Email always works. Google works when Supabase provider is enabled.
 */
(function () {
  "use strict";

  const CFG = window.ASAP_AIRSPACE_AUTH || {};
  const SESSION_KEY = CFG.sessionKey || "asap_airspace_user_v1";
  const ACCOUNTS_KEY = CFG.accountsKey || "asap_airspace_accounts_v1";

  let supabase = null;
  let ready = false;
  /** Live flags from Supabase /auth/v1/settings */
  let liveProviders = { google: false, apple: false, azure: false, email: true };

  function $(id) {
    return document.getElementById(id);
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setSession(user) {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  }

  function loadAccounts() {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveAccount(email, profile) {
    const map = loadAccounts();
    const key = email.toLowerCase();
    map[key] = Object.assign({}, map[key] || {}, profile, {
      email: key,
      updatedAt: Date.now(),
    });
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(map));
  }

  function setGateMsg(text, kind) {
    const el = $("as-auth-msg");
    if (!el) return;
    el.hidden = !text;
    if (text) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
    el.textContent = text || "";
    el.dataset.kind = kind || "info";
  }

  function isValidUser(user) {
    return !!(
      user &&
      typeof user.email === "string" &&
      user.email.indexOf("@") > 0 &&
      user.email.length > 4
    );
  }

  async function fetchProviderFlags() {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return liveProviders;
    try {
      const res = await fetch(CFG.supabaseUrl + "/auth/v1/settings", {
        headers: {
          apikey: CFG.supabaseAnonKey,
          Authorization: "Bearer " + CFG.supabaseAnonKey,
        },
      });
      if (!res.ok) return liveProviders;
      const data = await res.json();
      const ext = data.external || {};
      liveProviders = {
        google: !!ext.google,
        apple: !!ext.apple,
        azure: !!ext.azure,
        email: data.external ? data.external.email !== false : true,
      };
    } catch (e) {
      console.warn("provider flags", e);
    }
    return liveProviders;
  }

  function hasSupabaseClient() {
    return !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient);
  }

  async function initSupabase() {
    if (!hasSupabaseClient()) return null;
    try {
      supabase = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
      const { data } = await supabase.auth.getSession();
      if (data && data.session && data.session.user) {
        applySupabaseUser(data.session.user);
      }
      supabase.auth.onAuthStateChange(function (_event, session) {
        if (session && session.user) {
          applySupabaseUser(session.user);
          unlockTool(getSession());
        }
      });
    } catch (e) {
      console.warn("supabase init", e);
      supabase = null;
    }
    return supabase;
  }

  function applySupabaseUser(u) {
    const email = (u.email || "").toLowerCase();
    if (!email) return;
    const profile = {
      email: email,
      name: u.user_metadata?.full_name || u.user_metadata?.name || email.split("@")[0],
      company: u.user_metadata?.company || "",
      role: u.user_metadata?.role || "",
      provider: u.app_metadata?.provider || "supabase",
      at: Date.now(),
      id: u.id,
      picture: u.user_metadata?.avatar_url || u.user_metadata?.picture || "",
    };
    setSession(profile);
    saveAccount(email, profile);
  }

  async function notifyLead(payload) {
    const endpoint = CFG.formsubmitAjax;
    if (!endpoint) return { ok: false, reason: "no endpoint" };
    const body = Object.assign(
      {
        _subject: payload._subject || "Airspace tool signup — ASAP NJ",
        _template: "table",
        source: "airspace_signup",
        form_source: "airspace_signup",
      },
      payload
    );
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      let data = null;
      try { data = await res.json(); } catch (_) {}
      const msg = (data && (data.message || data.error || data.success)) || "";
      if (!res.ok || /activate|confirm your email/i.test(String(msg))) {
        console.warn("airspace lead notify failed", res.status, msg, data);
        return { ok: false, status: res.status, data: data };
      }
      // Also best-effort CRM cloud inbox when lead-config is present
      try {
        if (window.ASAP_LEAD_CAPTURE && window.ASAP_LEAD_CAPTURE.sendCloud) {
          await window.ASAP_LEAD_CAPTURE.sendCloud({
            source: "airspace_signup",
            name: payload.name || "",
            email: payload.email || "",
            company: payload.company || "",
            phone: payload.phone || "",
            service_interest: "Airspace tool account",
            message: payload.role ? ("Role: " + payload.role) : "Airspace free signup",
            location: "",
            payload: payload,
          });
        }
      } catch (e2) {
        console.warn("airspace cloud inbox", e2);
      }
      return { ok: true, data: data };
    } catch (e) {
      console.warn("lead notify", e);
      return { ok: false, error: String(e) };
    }
  }

  async function logAirspaceCheck(place, summary) {
    const user = getSession();
    if (!isValidUser(user)) return;
    const endpoint = CFG.formsubmitAjax;
    if (!endpoint) return;
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          _subject: "Airspace check used — " + (place && place.label ? place.label : "site"),
          _template: "table",
          source: "airspace_check",
          name: user.name || "",
          email: user.email,
          company: user.company || "",
          role: user.role || "",
          provider: user.provider || "email",
          site_label: (place && place.label) || "",
          lat: place && place.lat,
          lon: place && place.lon,
          summary: summary || "",
          checked_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.warn("check log", e);
    }
  }

  function unlockTool(user) {
    if (!isValidUser(user)) {
      setSession(null);
      lockTool();
      return;
    }
    const gate = $("as-gate");
    const app = $("as-app");
    const bar = $("as-user-bar");
    if (gate) {
      gate.setAttribute("hidden", "");
      gate.hidden = true;
    }
    if (app) {
      app.removeAttribute("hidden");
      app.hidden = false;
    }
    if (bar) {
      bar.removeAttribute("hidden");
      bar.hidden = false;
      const label = $("as-user-label");
      if (label) {
        const nm = (user.name || "").trim();
        label.textContent = nm ? nm + " · " + user.email : user.email;
      }
    }
    const readyEl = $("as-ready");
    if (readyEl) {
      readyEl.hidden = false;
      readyEl.removeAttribute("hidden");
      readyEl.textContent = "Signed in — type an address, use location, or click the map.";
    }
    const bootMap = function () {
      if (!window.AsapAirspaceMap) return;
      try {
        window.AsapAirspaceMap.ensure();
        window.AsapAirspaceMap.showIdle();
        window.AsapAirspaceMap.invalidate();
      } catch (e) {
        console.warn("map unlock", e);
      }
    };
    bootMap();
    setTimeout(bootMap, 50);
    setTimeout(bootMap, 250);
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (_) {}
  }

  function lockTool() {
    const gate = $("as-gate");
    const app = $("as-app");
    const bar = $("as-user-bar");
    if (gate) {
      gate.removeAttribute("hidden");
      gate.hidden = false;
    }
    if (app) {
      app.setAttribute("hidden", "");
      app.hidden = true;
    }
    if (bar) {
      bar.setAttribute("hidden", "");
      bar.hidden = true;
      const label = $("as-user-label");
      if (label) label.textContent = "—";
    }
    const res = $("as-results");
    if (res) {
      res.setAttribute("hidden", "");
      res.hidden = true;
    }
  }

  function showTab(which) {
    const signup = $("as-tab-signup");
    const signin = $("as-tab-signin");
    const panelSignup = $("as-panel-signup");
    const panelSignin = $("as-panel-signin");
    if (!signup || !signin) return;
    const isSignup = which === "signup";
    signup.classList.toggle("is-active", isSignup);
    signin.classList.toggle("is-active", !isSignup);
    if (panelSignup) {
      panelSignup.hidden = !isSignup;
      if (isSignup) panelSignup.removeAttribute("hidden");
      else panelSignup.setAttribute("hidden", "");
    }
    if (panelSignin) {
      panelSignin.hidden = isSignup;
      if (!isSignup) panelSignin.removeAttribute("hidden");
      else panelSignin.setAttribute("hidden", "");
    }
    setGateMsg("", "info");
  }

  function updateSocialButtons() {
    const row = $("as-oauth-row");
    const g = $("as-btn-google");
    const a = $("as-btn-apple");
    const m = $("as-btn-microsoft");
    const note = $("as-oauth-note");
    const divider = $("as-auth-divider");
    const status = $("as-google-status");

    if (row) {
      row.removeAttribute("hidden");
      row.hidden = false;
    }
    if (divider) {
      divider.removeAttribute("hidden");
      divider.hidden = false;
    }

    if (g) {
      g.disabled = false;
      g.innerHTML = '<span class="oauth-ico">G</span> Continue with Google';
      g.title = "Sign in with Google";
    }
    if (a) {
      a.hidden = !liveProviders.apple;
      a.disabled = !liveProviders.apple;
    }
    if (m) {
      m.hidden = !liveProviders.azure;
      m.disabled = !liveProviders.azure;
    }
    // Never show the scary yellow "almost ready" box to visitors
    if (status) {
      status.setAttribute("hidden", "");
      status.hidden = true;
      status.textContent = "";
    }
    if (note) {
      note.hidden = false;
      note.removeAttribute("hidden");
      note.textContent = liveProviders.google
        ? "Google one-click or email — both open the map."
        : "Use Google or create a free email account below.";
    }
  }

  async function startGoogle() {
    setGateMsg("Opening Google…", "info");
    await fetchProviderFlags();

    if (!liveProviders.google) {
      // Don't redirect to Supabase JSON error page
      setGateMsg(
        "Google isn’t connected in Supabase yet. Open Supabase → Authentication → Providers → Google → turn Enable ON → paste Client ID + Secret → Save. Until then use name + email below (same map).",
        "err"
      );
      const name = $("as-auth-name");
      if (name) name.focus();
      return;
    }
    if (!supabase) {
      await initSupabase();
    }
    if (!supabase) {
      setGateMsg("Sign-in service unavailable. Use email below.", "err");
      return;
    }
    setGateMsg("Redirecting to Google…", "info");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: (CFG.siteUrl || window.location.origin) + "/airspace.html",
        queryParams: { access_type: "online", prompt: "select_account" },
      },
    });
    if (error) {
      setGateMsg(
        (error.message || "Google sign-in failed") + " — use email below for now.",
        "err"
      );
    }
  }

  async function completeEmailSignup(e) {
    e.preventDefault();
    const name = ($("as-auth-name").value || "").trim();
    const email = ($("as-auth-email").value || "").trim().toLowerCase();
    const company = ($("as-auth-company").value || "").trim();
    const role = ($("as-auth-role").value || "").trim();
    const phone = ($("as-auth-phone").value || "").trim();
    const marketing = $("as-auth-ok") && $("as-auth-ok").checked;

    if (!name || name.length < 2) {
      setGateMsg("Type your name in the first box (browser was blocking empty fields).", "err");
      const el = $("as-auth-name");
      if (el) el.focus();
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setGateMsg("Type a real email like you@gmail.com (not the placeholder).", "err");
      const el = $("as-auth-email");
      if (el) el.focus();
      return;
    }
    if (!marketing) {
      setGateMsg("Check the box under the form to create your free account.", "err");
      return;
    }

    const btn = e.target.querySelector('[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Opening map…";
    }

    const profile = {
      name: name,
      email: email,
      company: company,
      role: role,
      phone: phone,
      provider: "email",
      at: Date.now(),
    };

    try {
      saveAccount(email, profile);
      setSession(profile);
      setGateMsg("You're in — loading map…", "ok");
      unlockTool(profile);
    } catch (err) {
      console.error(err);
      setGateMsg("Could not open the tool. Refresh and try again.", "err");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Create free account & open map";
      }
      return;
    }

    notifyLead({
      _subject: "Airspace free account — " + name,
      name: name,
      email: email,
      company: company || "(none)",
      role: role || "(none)",
      phone: phone || "(none)",
      provider: "email",
      tool: "airspace_check",
      message: "New free airspace tool account",
    });

    if (btn) {
      btn.disabled = false;
      btn.textContent = "Create free account & open map";
    }
  }

  async function completeEmailSignin(e) {
    e.preventDefault();
    const email = ($("as-signin-email").value || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setGateMsg("Enter the email you used to sign up.", "err");
      return;
    }
    const btn = e.target.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    setGateMsg("Signing in…", "info");

    try {
      const accounts = loadAccounts();
      const existing = accounts[email];
      if (existing && isValidUser(existing)) {
        const profile = Object.assign({}, existing, { at: Date.now() });
        setSession(profile);
        unlockTool(profile);
        setGateMsg("Welcome back.", "ok");
        return;
      }
      const profile = {
        email: email,
        name: email.split("@")[0],
        company: "",
        role: "",
        provider: "email-return",
        at: Date.now(),
      };
      setSession(profile);
      saveAccount(email, profile);
      notifyLead({
        _subject: "Airspace tool sign-in — " + email,
        email: email,
        name: profile.name,
        provider: "email-return",
        tool: "airspace_check",
        message: "Returned via email",
      });
      unlockTool(profile);
      setGateMsg("Signed in.", "ok");
    } catch (err) {
      setGateMsg(err.message || "Sign-in failed.", "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function signOut() {
    try {
      if (supabase) await supabase.auth.signOut();
    } catch (_) {}
    setSession(null);
    lockTool();
    showTab("signup");
    setGateMsg("Signed out.", "info");
  }

  function wireUi() {
    const tabSignup = $("as-tab-signup");
    const tabSignin = $("as-tab-signin");
    if (tabSignup) tabSignup.addEventListener("click", function () { showTab("signup"); });
    if (tabSignin) tabSignin.addEventListener("click", function () { showTab("signin"); });

    const formSignup = $("as-signup-form");
    const formSignin = $("as-signin-form");
    if (formSignup) formSignup.addEventListener("submit", completeEmailSignup);
    if (formSignin) formSignin.addEventListener("submit", completeEmailSignin);

    const g = $("as-btn-google");
    if (g) g.addEventListener("click", function (e) {
      e.preventDefault();
      startGoogle();
    });
    const a = $("as-btn-apple");
    if (a) a.addEventListener("click", function (e) {
      e.preventDefault();
      setGateMsg("Apple sign-in not enabled yet. Use Google or email.", "err");
    });
    const m = $("as-btn-microsoft");
    if (m) m.addEventListener("click", function (e) {
      e.preventDefault();
      setGateMsg("Microsoft sign-in not enabled yet. Use Google or email.", "err");
    });

    const out = $("as-signout");
    if (out) out.addEventListener("click", signOut);

    updateSocialButtons();
  }

  async function boot() {
    if (ready) return;
    ready = true;
    wireUi();

    // Handle return from Google OAuth (?code= in URL handled by supabase getSession)
    try {
      await Promise.race([
        initSupabase(),
        new Promise(function (r) { setTimeout(r, 3000); }),
      ]);
    } catch (e) {
      console.warn("supabase boot", e);
    }

    try {
      await Promise.race([
        fetchProviderFlags(),
        new Promise(function (r) { setTimeout(r, 2000); }),
      ]);
    } catch (_) {}

    updateSocialButtons();

    const existing = getSession();
    if (isValidUser(existing)) {
      unlockTool(existing);
    } else {
      if (existing) setSession(null);
      lockTool();
      showTab("signup");
    }
  }

  window.AsapAirspaceAuth = {
    getUser: getSession,
    requireUser: function () {
      const u = getSession();
      if (!isValidUser(u)) {
        lockTool();
        setGateMsg("Create a free account to use the airspace tool.", "err");
        return null;
      }
      return u;
    },
    logCheck: logAirspaceCheck,
    ready: function () { return ready; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
