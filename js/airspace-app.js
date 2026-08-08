/**
 * ASAP NJ airspace check — Esri geocode (primary) + FAA ArcGIS layers.
 * Features: autocomplete, Use my location, street addresses.
 */
(function () {
  "use strict";

  const FAA = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
  const GEO = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
  const RADIUS_M = 20000;

  const $ = (id) => document.getElementById(id);

  let suggestTimer = null;
  let suggestions = []; // {text, magicKey}
  let activeSuggest = -1;
  let selectedPlace = null; // {lat, lon, label}

  function setStatus(msg, kind) {
    const el = $("as-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.dataset.kind = kind || "info";
  }

  function showResults(show) {
    const el = $("as-results");
    if (el) el.hidden = !show;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { mode: "cors", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Network error (" + res.status + ")");
    return res.json();
  }

  // ——— Geocoding (Esri World Geocoder — free, CORS, good US streets) ———

  async function suggestAddress(text) {
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

  async function findAddress(singleLine, magicKey) {
    const params = {
      f: "json",
      outFields: "Match_addr,PlaceName,Type,City,Region,Postal",
      maxLocations: "5",
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
    if (!cands.length) throw new Error("No match for that address. Try city + state, or Use my location.");
    // prefer highest score
    cands.sort((a, b) => (b.score || 0) - (a.score || 0));
    const c = cands[0];
    const loc = c.location || {};
    if (loc.y == null || loc.x == null) throw new Error("Address found but missing coordinates.");
    return {
      lat: Number(loc.y),
      lon: Number(loc.x),
      label: c.address || singleLine,
      score: c.score,
    };
  }

  async function reverseGeocode(lat, lon) {
    const url =
      GEO +
      "/reverseGeocode?" +
      new URLSearchParams({
        f: "json",
        location: lon + "," + lat,
        outSR: "4326",
      });
    const data = await fetchJson(url);
    const addr = (data.address && (data.address.LongLabel || data.address.Match_addr || data.address.Address)) ||
      lat.toFixed(5) + ", " + lon.toFixed(5);
    return { lat, lon, label: addr, raw: data.address };
  }

  // ——— Suggest UI ———

  function hideSuggest() {
    const box = $("as-suggest");
    if (!box) return;
    box.hidden = true;
    box.innerHTML = "";
    suggestions = [];
    activeSuggest = -1;
    const input = $("as-address");
    if (input) input.setAttribute("aria-expanded", "false");
  }

  function showSuggest(list) {
    const box = $("as-suggest");
    if (!box) return;
    suggestions = list || [];
    if (!suggestions.length) {
      hideSuggest();
      return;
    }
    box.innerHTML = "";
    suggestions.forEach((s, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "as-suggest-item";
      btn.setAttribute("role", "option");
      btn.textContent = s.text;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickSuggest(i);
      });
      box.appendChild(btn);
    });
    box.hidden = false;
    const input = $("as-address");
    if (input) input.setAttribute("aria-expanded", "true");
  }

  async function pickSuggest(i) {
    const s = suggestions[i];
    if (!s) return;
    hideSuggest();
    $("as-address").value = s.text;
    setStatus("Looking up “" + s.text + "”…", "info");
    try {
      const place = await findAddress(s.text, s.magicKey);
      selectedPlace = place;
      $("as-address").value = place.label;
      await runCheckWithPlace(place);
    } catch (err) {
      setStatus(err.message || "Could not resolve that suggestion.", "err");
    }
  }

  function scheduleSuggest(q) {
    clearTimeout(suggestTimer);
    selectedPlace = null;
    if (!q || q.trim().length < 3) {
      hideSuggest();
      return;
    }
    suggestTimer = setTimeout(async () => {
      try {
        const list = await suggestAddress(q.trim());
        showSuggest(list);
      } catch (e) {
        console.warn("suggest", e);
        hideSuggest();
      }
    }, 250);
  }

  function highlightSuggest() {
    const box = $("as-suggest");
    if (!box) return;
    [...box.querySelectorAll(".as-suggest-item")].forEach((node, i) => {
      node.classList.toggle("is-active", i === activeSuggest);
    });
  }

  // ——— FAA queries ———

  function arcgisQuery(service, lat, lon, distanceM, withGeom) {
    const params = new URLSearchParams({
      geometry: lon + "," + lat,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(distanceM),
      units: "esriSRUnit_Meter",
      outFields: "*",
      returnGeometry: withGeom ? "true" : "false",
      outSR: "4326",
      f: "json",
      resultRecordCount: withGeom ? "60" : "50",
    });
    return fetchJson(FAA + "/" + service + "/FeatureServer/0/query?" + params).then((j) => {
      if (j.error) throw new Error(j.error.message || "FAA data error");
      return j.features || [];
    });
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(lat2 - lat1);
    const dLon = toR(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function nmFromKm(km) {
    return km * 0.539957;
  }
  function parseDms(str) {
    if (str == null || typeof str !== "string") return null;
    const m = str.trim().match(/^(\d+)-(\d+)-([\d.]+)([NSEW])$/i);
    if (!m) return null;
    let val = +m[1] + +m[2] / 60 + +m[3] / 3600;
    if (m[4] === "S" || m[4] === "W") val = -val;
    return val;
  }
  function formatAlt(val, uom, code) {
    if (val == null || val === "" || Number(val) === -9998) {
      if (code === "SFC") return "Surface";
      if (code === "AA" || code === "UNLTD") return "Unlimited / above";
      return "—";
    }
    return val + " " + (uom || "FT") + (code ? " " + code : "");
  }

  function summarizeClass(features) {
    const items = [];
    for (const f of features) {
      const a = f.attributes || {};
      const name = a.NAME || "Class airspace";
      if (/CONTIGUOUS UNITED STATES CLASS A/i.test(name)) continue;
      if (a.LOWER_CODE === "MSL" && Number(a.LOWER_VAL) >= 10000) continue;
      const needsAuth =
        a.CLASS === "B" || a.CLASS === "C" || a.CLASS === "D" ||
        ["CLASS_B", "CLASS_C", "CLASS_D", "CLASS_E2", "CLASS_E3", "CLASS_E4"].includes(a.LOCAL_TYPE);
      items.push({
        name,
        class: a.CLASS || (a.LOCAL_TYPE || "").replace("CLASS_", "") || "—",
        localType: a.LOCAL_TYPE || "",
        lower: formatAlt(a.LOWER_VAL, a.LOWER_UOM, a.LOWER_CODE),
        upper: formatAlt(a.UPPER_VAL, a.UPPER_UOM, a.UPPER_CODE),
        needsAuth: !!needsAuth,
      });
    }
    const order = { B: 1, C: 2, D: 3, E: 4, G: 5, A: 9 };
    items.sort((a, b) => (order[a.class] || 8) - (order[b.class] || 8));
    return items;
  }

  function summarizeSua(features) {
    return (features || []).map((f) => {
      const a = f.attributes || {};
      const typeMap = { R: "Restricted", P: "Prohibited", A: "Alert", W: "Warning", MOA: "MOA" };
      return {
        name: a.NAME || "Special-use",
        type: typeMap[a.TYPE_CODE] || a.TYPE_CODE || "Special use",
        lower: formatAlt(a.LOWER_VAL, a.LOWER_UOM, a.LOWER_CODE),
        upper: formatAlt(a.UPPER_VAL, a.UPPER_UOM, a.UPPER_CODE),
        times: a.TIMESOFUSE || "",
        highImpact: a.TYPE_CODE === "R" || a.TYPE_CODE === "P",
      };
    });
  }

  function summarizeAirports(features, lat, lon) {
    const list = [];
    for (const f of features || []) {
      const a = f.attributes || {};
      const alat = parseDms(a.LATITUDE) ?? a.LATITUDE;
      const alon = parseDms(a.LONGITUDE) ?? a.LONGITUDE;
      let distNm = null;
      if (typeof alat === "number" && typeof alon === "number") {
        distNm = nmFromKm(haversineKm(lat, lon, alat, alon));
      }
      const typeMap = { AIRPORT: "Airport", HP: "Heliport", HELIPORT: "Heliport", SP: "Seaplane base" };
      list.push({
        name: a.NAME || "Facility",
        ident: a.IDENT || a.ICAO_ID || "",
        type: typeMap[a.TYPE_CODE] || a.TYPE_CODE || "Aviation facility",
        city: a.SERVCITY || "",
        private: a.PRIVATEUSE === 1 || a.PRIVATEUSE === "1",
        distNm,
      });
    }
    list.sort((a, b) => (a.distNm ?? 99) - (b.distNm ?? 99));
    return list.slice(0, 12);
  }

  function closestUasfm(features, lat, lon) {
    if (!features || !features.length) return null;
    let best = null, bestD = Infinity;
    for (const f of features) {
      const a = f.attributes || {};
      const glat = Number(a.LATITUDE), glon = Number(a.LONGITUDE);
      if (!Number.isFinite(glat) || !Number.isFinite(glon)) continue;
      const d = haversineKm(lat, lon, glat, glon);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (!best) return null;
    return {
      ceiling: best.CEILING,
      unit: best.UNIT || "Feet",
      airspace: [best.AIRSPACE_1, best.AIRSPACE_2, best.AIRSPACE_3].filter((x) => x && String(x).trim()).join(", "),
      airports: [
        best.APT1_NAME && { name: best.APT1_NAME, faa: best.APT1_FAAID, laanc: best.APT1_LAANC },
        best.APT2_NAME && { name: best.APT2_NAME, faa: best.APT2_FAAID, laanc: best.APT2_LAANC },
      ].filter(Boolean),
      mapEff: best.MAP_EFF,
    };
  }

  function buildFlags({ classItems, sua, uasfm }) {
    const flags = [];
    const authClass = classItems.filter((c) => c.needsAuth);
    if (authClass.length) {
      flags.push({
        level: "warn",
        title: "Controlled airspace may require authorization",
        detail:
          "Class B/C/D (and some surface Class E) under Part 107 typically need LAANC or DroneZone before flight. Nearby: " +
          authClass.slice(0, 3).map((c) => c.name).join("; ") + ".",
      });
    } else {
      flags.push({
        level: "ok",
        title: "No Class B/C/D volume flagged at this point",
        detail: "Still verify TFRs, NOTAMs, and official sources before flight.",
      });
    }
    const highSua = sua.filter((s) => s.highImpact);
    if (highSua.length) {
      flags.push({
        level: "alert",
        title: "Restricted / prohibited special-use airspace nearby",
        detail: highSua.map((s) => s.name + (s.times ? " (" + s.times + ")" : "")).join("; ") + ".",
      });
    } else if (sua.length) {
      flags.push({
        level: "warn",
        title: "Special-use airspace in the awareness radius",
        detail: sua.map((s) => s.name + " · " + s.type).join("; ") + ".",
      });
    }
    if (uasfm) {
      const ceil = uasfm.ceiling;
      if (ceil === 0) {
        flags.push({ level: "alert", title: "UAS Facility Map grid ceiling is 0 ft AGL", detail: "Automated LAANC at altitude is unlikely here—confirm on official maps." });
      } else if (ceil != null && ceil < 400) {
        flags.push({ level: "warn", title: "UAS Facility Map max " + ceil + " " + (uasfm.unit || "ft") + " AGL", detail: "Do not exceed authorized altitude. Map effective: " + (uasfm.mapEff || "see FAA") + "." });
      } else if (ceil != null) {
        flags.push({ level: "ok", title: "UAS Facility Map grid ceiling " + ceil + " " + (uasfm.unit || "ft") + " AGL", detail: "Confirm on official UAS Facility Maps before flight." });
      }
      const laanc = (uasfm.airports || []).filter((a) => Number(a.laanc) === 1);
      if (laanc.length) {
        flags.push({
          level: "info",
          title: "LAANC-enabled facility association on grid",
          detail: laanc.map((a) => a.name + (a.faa ? " (" + a.faa + ")" : "")).join("; ") + ". Request via AirData / other LAANC USS when eligible.",
        });
      }
    } else {
      flags.push({ level: "info", title: "No UAS Facility Map grid nearby", detail: "Common outside airport grids. Part 107 and NOTAMs still apply." });
    }
    flags.push({
      level: "info",
      title: "Waivers are separate from airspace authorization",
      detail: "Night, BVLOS, over people, etc. use Part 107 waivers—not LAANC. ASAP NJ can advise when hired.",
    });
    return flags;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(place, data) {
    $("as-place").textContent = place.label;
    $("as-coords").textContent = place.lat.toFixed(5) + "°, " + place.lon.toFixed(5) + "°";
    $("as-map-link").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(place.lat + "," + place.lon);
    $("as-faa-map-link").href = "https://faa.maps.arcgis.com/apps/webappviewer/index.html?id=9c2e4406710048e19806ebf6a06754ad";

    const flagsHost = $("as-flags");
    flagsHost.innerHTML = "";
    data.flags.forEach((f) => {
      const card = el("article", "as-flag as-flag--" + f.level);
      card.appendChild(el("strong", null, f.title));
      card.appendChild(el("p", null, f.detail));
      flagsHost.appendChild(card);
    });

    const uHost = $("as-uasfm");
    uHost.innerHTML = "";
    if (data.uasfm) {
      const u = data.uasfm;
      uHost.appendChild(el("p", null,
        "Nearest UAS Facility Map grid: ceiling " +
        (u.ceiling != null ? u.ceiling + " " + (u.unit || "ft") + " AGL" : "n/a") +
        (u.airspace ? " · class tags: " + u.airspace : "") +
        (u.mapEff ? " · map effective " + u.mapEff : "") + "."
      ));
      if (u.airports && u.airports.length) {
        const ul = el("ul");
        u.airports.forEach((a) => {
          ul.appendChild(el("li", null, a.name + (a.faa ? " (" + a.faa + ")" : "") + (Number(a.laanc) === 1 ? " · LAANC: yes" : " · LAANC: no/unknown")));
        });
        uHost.appendChild(ul);
      }
    } else {
      uHost.appendChild(el("p", "muted", "No UASFM grid cell found in search radius."));
    }

    const cHost = $("as-class");
    cHost.innerHTML = "";
    if (!data.classItems.length) {
      cHost.appendChild(el("p", "muted", "No class airspace polygons in radius—verify manually."));
    } else {
      const table = el("table", "as-table");
      const thead = el("thead");
      const hr = el("tr");
      ["Name", "Class", "Lower", "Upper", "Auth likely?"].forEach((h) => hr.appendChild(el("th", null, h)));
      thead.appendChild(hr);
      table.appendChild(thead);
      const tb = el("tbody");
      data.classItems.forEach((c) => {
        const tr = el("tr");
        tr.appendChild(el("td", null, c.name));
        tr.appendChild(el("td", null, c.class + (c.localType ? " (" + c.localType + ")" : "")));
        tr.appendChild(el("td", null, c.lower));
        tr.appendChild(el("td", null, c.upper));
        tr.appendChild(el("td", null, c.needsAuth ? "Often yes (LAANC / DroneZone)" : "Usually no for B/C/D"));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      cHost.appendChild(table);
    }

    const sHost = $("as-sua");
    sHost.innerHTML = "";
    if (!data.sua.length) {
      sHost.appendChild(el("p", "muted", "No special-use airspace in radius."));
    } else {
      const ul = el("ul");
      data.sua.forEach((s) => {
        ul.appendChild(el("li", null, s.name + " · " + s.type + " · " + s.lower + "–" + s.upper + (s.times ? " · " + s.times : "")));
      });
      sHost.appendChild(ul);
    }

    const aHost = $("as-airports");
    aHost.innerHTML = "";
    if (!data.airports.length) {
      aHost.appendChild(el("p", "muted", "No airports/heliports in radius."));
    } else {
      const ul = el("ul");
      data.airports.forEach((a) => {
        ul.appendChild(el("li", null,
          (a.distNm != null ? a.distNm.toFixed(1) + " nm · " : "") +
          a.name + (a.ident ? " (" + a.ident + ")" : "") + " · " + a.type +
          (a.private ? " · private" : " · public") + (a.city ? " · " + a.city : "")
        ));
      });
      aHost.appendChild(ul);
    }

    const q = $("as-quote-link");
    if (q) q.href = "index.html#contact?job_site=" + encodeURIComponent(place.label);

    showResults(true);

    // Interactive map with FAA polygons / airports
    if (window.AsapAirspaceMap) {
      window.AsapAirspaceMap.showResult(
        place,
        {
          classFeatures: data.classFeatures || [],
          suaFeatures: data.suaFeatures || [],
          airportFeatures: data.airportFeatures || [],
          uasfmFeatures: data.uasfmFeatures || [],
          nsufrFeatures: data.nsufrFeatures || [],
        },
        RADIUS_M
      );
    }
  }

  function setBusy(busy) {
    ["as-run", "as-locate", "as-demo"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = !!busy;
    });
  }

  function requireSignedIn() {
    if (window.AsapAirspaceAuth && typeof window.AsapAirspaceAuth.requireUser === "function") {
      return !!window.AsapAirspaceAuth.requireUser();
    }
    return true;
  }

  async function runCheckWithPlace(place) {
    if (!requireSignedIn()) {
      setStatus("Create a free account or sign in first.", "err");
      return;
    }
    setStatus("Querying FAA airspace layers + drawing map…", "info");
    showResults(false);
    setBusy(true);
    try {
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) {
        throw new Error("Invalid coordinates.");
      }
      // Geometry on = interactive map polygons (same features used for tables)
      const settled = await Promise.allSettled([
        arcgisQuery("Class_Airspace", place.lat, place.lon, RADIUS_M, true),
        arcgisQuery("Special_Use_Airspace", place.lat, place.lon, RADIUS_M, true),
        arcgisQuery("US_Airport", place.lat, place.lon, RADIUS_M, true),
        arcgisQuery("FAA_UAS_FacilityMap_Data", place.lat, place.lon, 8000, true),
        arcgisQuery("Part_Time_National_Security_UAS_Flight_Restrictions", place.lat, place.lon, RADIUS_M, true),
      ]);
      const take = (i) => (settled[i].status === "fulfilled" ? settled[i].value : []);
      if (settled[0].status === "rejected" && settled[1].status === "rejected" && settled[2].status === "rejected") {
        throw new Error("Could not reach FAA map data. Disable ad blockers for this site, or try again.");
      }
      const classFeatures = take(0);
      const suaFeatures = take(1);
      const airportFeatures = take(2);
      const uasfmFeatures = take(3);
      const nsufrFeatures = take(4);

      const classItems = summarizeClass(classFeatures);
      const sua = summarizeSua(suaFeatures);
      const airports = summarizeAirports(airportFeatures, place.lat, place.lon);
      const uasfm = closestUasfm(uasfmFeatures, place.lat, place.lon);
      const flags = buildFlags({ classItems, sua, uasfm });
      if (nsufrFeatures.length) {
        flags.unshift({
          level: "alert",
          title: "National Security UAS Flight Restriction (part-time) nearby",
          detail: "NSUFR polygon(s) in radius—confirm active times before flight.",
        });
      }
      render(place, {
        classItems,
        sua,
        airports,
        uasfm,
        flags,
        classFeatures,
        suaFeatures,
        airportFeatures,
        uasfmFeatures,
        nsufrFeatures,
      });
      setStatus("Map ready · ~11 nm radius · click map to re-check · advisory only", "ok");
      if (window.AsapAirspaceAuth && typeof window.AsapAirspaceAuth.logCheck === "function") {
        const summary =
          "flags=" +
          flags.length +
          "; class=" +
          classItems.length +
          "; airports=" +
          airports.length +
          "; uasfm=" +
          (uasfm && uasfm.ceiling != null ? uasfm.ceiling + "ft" : "n/a");
        window.AsapAirspaceAuth.logCheck(place, summary);
      }
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Lookup failed.", "err");
      showResults(false);
    } finally {
      setBusy(false);
    }
  }

  async function runFromMapClick(lat, lon) {
    if (!requireSignedIn()) return;
    setStatus("Map pin set — resolving address…", "info");
    setBusy(true);
    try {
      let place;
      try {
        place = await reverseGeocode(lat, lon);
      } catch (e) {
        place = { lat, lon, label: lat.toFixed(5) + ", " + lon.toFixed(5) };
      }
      place.lat = lat;
      place.lon = lon;
      selectedPlace = place;
      if ($("as-address")) $("as-address").value = place.label;
      hideSuggest();
      await runCheckWithPlace(place);
    } catch (err) {
      setStatus(err.message || "Map check failed.", "err");
      setBusy(false);
    }
  }

  async function runFromTypedAddress() {
    const addr = ($("as-address").value || "").trim();
    if (addr.length < 3) {
      setStatus("Type an address, pick a suggestion, or tap Use my location.", "err");
      return;
    }
    if (selectedPlace && selectedPlace.label === addr) {
      await runCheckWithPlace(selectedPlace);
      return;
    }
    setStatus("Finding address…", "info");
    setBusy(true);
    try {
      const place = await findAddress(addr);
      selectedPlace = place;
      $("as-address").value = place.label;
      await runCheckWithPlace(place);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Address lookup failed.", "err");
      showResults(false);
      setBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setStatus("This browser can’t share location. Type an address instead.", "err");
      return;
    }
    setStatus("Browser will ask to use your location…", "info");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setStatus("Got GPS — resolving address…", "info");
          let place;
          try {
            place = await reverseGeocode(lat, lon);
          } catch (e) {
            place = { lat, lon, label: lat.toFixed(5) + ", " + lon.toFixed(5) };
          }
          place.lat = lat;
          place.lon = lon;
          selectedPlace = place;
          $("as-address").value = place.label;
          hideSuggest();
          await runCheckWithPlace(place);
        } catch (err) {
          setStatus(err.message || "Location check failed.", "err");
          setBusy(false);
        }
      },
      (err) => {
        let msg = "Could not get location.";
        if (err && err.code === 1) msg = "Location blocked. Allow location for asap-nj.com, or type an address.";
        if (err && err.code === 2) msg = "Location unavailable. Type an address instead.";
        if (err && err.code === 3) msg = "Location timed out. Try again or type an address.";
        setStatus(msg, "err");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  }

  async function runDemo() {
    // Known good Toms River point
    const place = {
      lat: 39.95373,
      lon: -74.19792,
      label: "Toms River, NJ (demo)",
    };
    selectedPlace = place;
    $("as-address").value = place.label;
    hideSuggest();
    await runCheckWithPlace(place);
  }

  function init() {
    const form = $("as-form");
    const input = $("as-address");
    if (!form || !input) {
      setStatus("Page error: form missing.", "err");
      return;
    }

    // Prove script loaded (visible after free-account unlock)
    const ready = $("as-ready");
    if (ready) {
      ready.hidden = false;
      ready.textContent = "Tool loaded — type an address, use location, or click the map.";
    }

    // Interactive map (Leaflet) — idle view + click-to-check
    if (window.AsapAirspaceMap) {
      window.AsapAirspaceMap.ensure();
      window.AsapAirspaceMap.showIdle();
      window.AsapAirspaceMap.setClickHandler(runFromMapClick);
      // When auth gate unlocks, map container becomes visible — fix size
      const app = $("as-app");
      if (app && typeof MutationObserver !== "undefined") {
        const mo = new MutationObserver(() => {
          if (!app.hidden) window.AsapAirspaceMap.invalidate();
        });
        mo.observe(app, { attributes: true, attributeFilter: ["hidden"] });
      }
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!requireSignedIn()) return;
      hideSuggest();
      runFromTypedAddress();
    });

    input.addEventListener("input", () => scheduleSuggest(input.value));
    input.addEventListener("keydown", (e) => {
      const box = $("as-suggest");
      if (!box || box.hidden || !suggestions.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeSuggest = Math.min(activeSuggest + 1, suggestions.length - 1);
        highlightSuggest();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeSuggest = Math.max(activeSuggest - 1, 0);
        highlightSuggest();
      } else if (e.key === "Enter" && activeSuggest >= 0) {
        e.preventDefault();
        pickSuggest(activeSuggest);
      } else if (e.key === "Escape") {
        hideSuggest();
      }
    });
    input.addEventListener("blur", () => setTimeout(hideSuggest, 200));

    const loc = $("as-locate");
    if (loc) loc.addEventListener("click", (e) => { e.preventDefault(); if (!requireSignedIn()) return; useMyLocation(); });
    const demo = $("as-demo");
    if (demo) demo.addEventListener("click", (e) => { e.preventDefault(); if (!requireSignedIn()) return; runDemo(); });

    const params = new URLSearchParams(location.search);
    const q = params.get("q") || params.get("address");
    if (q && requireSignedIn()) {
      input.value = q;
      runFromTypedAddress();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
