/**
 * ASAP NJ — shared US address autocomplete (Esri World Geocoder).
 * Usage:
 *   <input data-address-autocomplete>
 *   or AddressAutocomplete.attach('#my-input')
 *   or AddressAutocomplete.attachAll()
 */
(function (global) {
  "use strict";

  const GEO = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected || document.getElementById("asap-addr-ac-css")) return;
    stylesInjected = true;
    const css = document.createElement("style");
    css.id = "asap-addr-ac-css";
    css.textContent = `
      .asap-addr-wrap { position: relative; }
      .asap-addr-suggest {
        position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 80;
        background: #1a1f2b; border: 1px solid rgba(255,255,255,0.16); border-radius: 12px;
        max-height: 260px; overflow: auto; box-shadow: 0 16px 48px rgba(0,0,0,0.5);
      }
      .asap-addr-item {
        display: block; width: 100%; text-align: left; padding: 0.75rem 0.9rem;
        border: none; border-bottom: 1px solid rgba(255,255,255,0.08);
        background: transparent; color: #f3f5f7; font: inherit; cursor: pointer; font-size: 0.92rem;
      }
      .asap-addr-item:last-child { border-bottom: none; }
      .asap-addr-item:hover, .asap-addr-item.is-active {
        background: rgba(62,196,232,0.14); color: #3ec4e8;
      }
      /* Light pages (insurance etc.) */
      .asap-addr-suggest.is-light {
        background: #fff; border-color: #d0d5dd; box-shadow: 0 10px 30px rgba(16,24,40,0.12);
      }
      .asap-addr-suggest.is-light .asap-addr-item { color: #101828; border-bottom-color: #eef0f3; }
      .asap-addr-suggest.is-light .asap-addr-item:hover,
      .asap-addr-suggest.is-light .asap-addr-item.is-active { background: #eef9fc; color: #0b6e8a; }
    `;
    document.head.appendChild(css);
  }

  async function fetchJson(url) {
    const res = await fetch(url, { mode: "cors", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("geocode " + res.status);
    return res.json();
  }

  async function suggest(text) {
    const url =
      GEO +
      "/suggest?" +
      new URLSearchParams({
        f: "json",
        text: text,
        maxSuggestions: "7",
        countryCode: "USA",
      });
    const data = await fetchJson(url);
    return data.suggestions || [];
  }

  async function find(singleLine, magicKey) {
    const params = {
      f: "json",
      outFields: "Match_addr,City,Region,Postal",
      maxLocations: "3",
      countryCode: "USA",
    };
    if (magicKey) {
      params.magicKey = magicKey;
      params.SingleLine = singleLine || "";
    } else {
      params.SingleLine = singleLine;
    }
    const url = GEO + "/findAddressCandidates?" + new URLSearchParams(params);
    const data = await fetchJson(url);
    const cands = data.candidates || [];
    if (!cands.length) return null;
    cands.sort((a, b) => (b.score || 0) - (a.score || 0));
    const c = cands[0];
    return {
      label: c.address || singleLine,
      lat: c.location && c.location.y,
      lon: c.location && c.location.x,
      score: c.score,
    };
  }

  function isLightPage(input) {
    // insurance.html is light; main site is dark
    const bg = getComputedStyle(document.body).backgroundColor || "";
    // crude: if body is light-ish
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return document.body.classList.contains("light") || /insurance/i.test(location.pathname);
    const r = +m[1], g = +m[2], b = +m[3];
    return (r + g + b) / 3 > 180;
  }

  function attach(input, options) {
    if (!input || input.dataset.asapAddrBound === "1") return;
    injectStyles();
    input.dataset.asapAddrBound = "1";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "words");
    input.setAttribute("spellcheck", "false");

    // wrap if needed
    let wrap = input.parentElement;
    if (!wrap || !wrap.classList.contains("asap-addr-wrap")) {
      wrap = document.createElement("div");
      wrap.className = "asap-addr-wrap";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }

    const box = document.createElement("div");
    box.className = "asap-addr-suggest" + (isLightPage(input) ? " is-light" : "");
    box.hidden = true;
    box.setAttribute("role", "listbox");
    wrap.appendChild(box);

    let timer = null;
    let items = [];
    let active = -1;
    let selected = null;

    function hide() {
      box.hidden = true;
      box.innerHTML = "";
      items = [];
      active = -1;
    }

    function show(list) {
      items = list || [];
      if (!items.length) {
        hide();
        return;
      }
      box.innerHTML = "";
      items.forEach((s, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "asap-addr-item";
        btn.setAttribute("role", "option");
        btn.textContent = s.text;
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(i);
        });
        box.appendChild(btn);
      });
      box.hidden = false;
    }

    function highlight() {
      [...box.querySelectorAll(".asap-addr-item")].forEach((n, i) => {
        n.classList.toggle("is-active", i === active);
      });
    }

    async function pick(i) {
      const s = items[i];
      if (!s) return;
      hide();
      input.value = s.text;
      try {
        const place = await find(s.text, s.magicKey);
        if (place && place.label) {
          input.value = place.label;
          selected = place;
          input.dispatchEvent(new CustomEvent("asap:address", { detail: place, bubbles: true }));
        }
      } catch (e) {
        /* keep text */
      }
    }

    function schedule() {
      clearTimeout(timer);
      selected = null;
      const q = (input.value || "").trim();
      if (q.length < 3) {
        hide();
        return;
      }
      timer = setTimeout(async () => {
        try {
          const list = await suggest(q);
          show(list);
        } catch (e) {
          hide();
        }
      }, 250);
    }

    input.addEventListener("input", schedule);
    input.addEventListener("keydown", (e) => {
      if (box.hidden || !items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(active + 1, items.length - 1);
        highlight();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(active - 1, 0);
        highlight();
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        pick(active);
      } else if (e.key === "Escape") {
        hide();
      }
    });
    input.addEventListener("blur", () => setTimeout(hide, 180));

    if (options && options.placeholder) input.placeholder = options.placeholder;
  }

  function attachAll(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-address-autocomplete]").forEach((el) => attach(el));
  }

  // Auto-bind common ASAP form fields + data attributes
  function autoBind() {
    injectStyles();
    attachAll(document);

    const defaults = [
      "#location",           // main contact project location
      "#rtk-area",           // RTK work area
      "#ins-location",       // insurance site address
      'input[name="location"]',
      'input[name="work_area"]',
      'input[name="site_address"]',
      'input[name="address"]',
    ];
    defaults.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        // skip pure name fields mistaken
        if (el.type === "email" || el.type === "tel" || el.type === "hidden") return;
        attach(el);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoBind);
  } else {
    autoBind();
  }

  global.AddressAutocomplete = { attach, attachAll, suggest, find };
})(typeof window !== "undefined" ? window : this);
