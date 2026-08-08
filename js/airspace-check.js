/**
 * ASAP NJ — public job-site airspace awareness check.
 * Geocode + autocomplete: Photon (Komoot / OSM)
 * Airspace: FAA ArcGIS open services
 * Geolocation: browser GPS + reverse geocode
 * Advisory only — not LAANC authorization or waiver approval.
 */
(function () {
  "use strict";

  const FAA =
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
  const PHOTON = "https://photon.komoot.io";
  const RADIUS_M = 20000;

  const $ = (id) => document.getElementById(id);

  let suggestTimer = null;
  let suggestItems = [];
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
    $("as-results").hidden = !show;
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      mode: "cors",
    });
    if (!res.ok) throw new Error("Network error (" + res.status + "). Try again.");
    return res.json();
  }

  function formatPhotonProps(p) {
    const parts = [
      [p.housenumber, p.street].filter(Boolean).join(" "),
      p.name && p.name !== p.street ? p.name : null,
      p.city || p.town || p.village || p.locality,
      p.county,
      p.state,
      p.postcode,
      p.country,
    ].filter(Boolean);
    // de-dupe consecutive
    const out = [];
    for (const x of parts) {
      if (!out.length || out[out.length - 1] !== x) out.push(x);
    }
    return out.join(", ") || p.name || "Selected location";
  }

  function photonFeatureToPlace(f) {
    if (!f || !f.geometry || !f.geometry.coordinates) return null;
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties || {};
    return {
      lat: Number(lat),
      lon: Number(lon),
      label: formatPhotonProps(p),
      raw: p,
    };
  }

  async function searchPhoton(query, limit) {
    const url =
      PHOTON +
      "/api/?" +
      new URLSearchParams({
        q: query,
        limit: String(limit || 6),
        lang: "en",
      });
    const data = await fetchJson(url);
    const feats = data.features || [];
    // Prefer US results when mixed
    const scored = feats
      .map((f) => {
        const p = f.properties || {};
        let score = 0;
        const cc = (p.countrycode || "").toUpperCase();
        if (cc === "US") score += 10;
        if ((p.state || "").toUpperCase() === "NJ" || /new jersey/i.test(p.state || ""))
          score += 15;
        if (p.housenumber || p.street) score += 3;
        return { f, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored.map((s) => s.f);
  }

  async function reversePhoton(lat, lon) {
    const url =
      PHOTON +
      "/reverse?" +
      new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        lang: "en",
      });
    const data = await fetchJson(url);
    const f = (data.features || [])[0];
    if (f) return photonFeatureToPlace(f);
    return {
      lat,
      lon,
      label: lat.toFixed(5) + ", " + lon.toFixed(5),
      raw: {},
    };
  }

  async function geocode(query) {
    const feats = await searchPhoton(query, 8);
    if (!feats.length) {
      throw new Error(
        "No location found. Try a fuller address (street, city, state) or use “Use my location”."
      );
    }
    const place = photonFeatureToPlace(feats[0]);
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) {
      throw new Error("Could not read coordinates for that place.");
    }
    return place;
  }

  function hideSuggest() {
    const box = $("as-suggest");
    if (!box) return;
    box.hidden = true;
    box.innerHTML = "";
    suggestItems = [];
    activeSuggest = -1;
  }

  function showSuggest(features) {
    const box = $("as-suggest");
    if (!box) return;
    suggestItems = features.map(photonFeatureToPlace).filter(Boolean);
    if (!suggestItems.length) {
      hideSuggest();
      return;
    }
    box.innerHTML = "";
    suggestItems.forEach((place, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "as-suggest-item";
      btn.setAttribute("role", "option");
      btn.textContent = place.label;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus handling clean
        pickSuggest(i);
      });
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  function pickSuggest(i) {
    const place = suggestItems[i];
    if (!place) return;
    selectedPlace = place;
    $("as-address").value = place.label;
    hideSuggest();
    runCheckWithPlace(place);
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
        const feats = await searchPhoton(q.trim(), 6);
        showSuggest(feats);
      } catch (e) {
        hideSuggest();
      }
    }, 280);
  }

  function arcgisQuery(service, lat, lon, distanceM) {
    const params = new URLSearchParams({
      geometry: lon + "," + lat,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(distanceM),
      units: "esriSRUnit_Meter",
      outFields: "*",
      returnGeometry: "false",
      f: "json",
      resultRecordCount: "50",
    });
    return fetchJson(
      FAA + "/" + service + "/FeatureServer/0/query?" + params.toString()
    ).then((j) => {
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

  function classPriority(cls) {
    const order = { B: 1, C: 2, D: 3, E: 4, G: 5, A: 9 };
    return order[cls] || 8;
  }

  function formatAlt(val, uom, code) {
    if (val == null || val === "" || Number(val) === -9998) {
      if (code === "SFC") return "Surface";
      if (code === "AA" || code === "UNLTD") return "Unlimited / above";
      return "—";
    }
    const u = (uom || "FT") + (code ? " " + code : "");
    return val + " " + u;
  }

  function summarizeClass(features) {
    const items = [];
    for (const f of features) {
      const a = f.attributes || {};
      const cls = (a.CLASS || a.LOCAL_TYPE || "").toString().replace("CLASS_", "");
      const name = a.NAME || "Class airspace";
      if (/CONTIGUOUS UNITED STATES CLASS A/i.test(name)) continue;
      if (a.LOWER_CODE === "MSL" && Number(a.LOWER_VAL) >= 10000) continue;

      const needsAuth =
        a.CLASS === "B" ||
        a.CLASS === "C" ||
        a.CLASS === "D" ||
        a.LOCAL_TYPE === "CLASS_B" ||
        a.LOCAL_TYPE === "CLASS_C" ||
        a.LOCAL_TYPE === "CLASS_D" ||
        a.LOCAL_TYPE === "CLASS_E2" ||
        a.LOCAL_TYPE === "CLASS_E3" ||
        a.LOCAL_TYPE === "CLASS_E4";

      items.push({
        name,
        class: a.CLASS || cls || "—",
        localType: a.LOCAL_TYPE || "",
        lower: formatAlt(a.LOWER_VAL, a.LOWER_UOM, a.LOWER_CODE),
        upper: formatAlt(a.UPPER_VAL, a.UPPER_UOM, a.UPPER_CODE),
        needsAuth: !!needsAuth,
      });
    }
    items.sort((a, b) => classPriority(a.class) - classPriority(b.class));
    return items;
  }

  function summarizeSua(features) {
    return (features || []).map((f) => {
      const a = f.attributes || {};
      const typeMap = {
        R: "Restricted",
        P: "Prohibited",
        A: "Alert",
        W: "Warning",
        MOA: "MOA",
      };
      return {
        name: a.NAME || "Special-use airspace",
        type: typeMap[a.TYPE_CODE] || a.TYPE_CODE || "Special use",
        typeCode: a.TYPE_CODE || "",
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
      const typeMap = {
        AIRPORT: "Airport",
        HP: "Heliport",
        HELIPORT: "Heliport",
        SP: "Seaplane base",
      };
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
    let best = null;
    let bestD = Infinity;
    for (const f of features) {
      const a = f.attributes || {};
      const glat = Number(a.LATITUDE);
      const glon = Number(a.LONGITUDE);
      if (!Number.isFinite(glat) || !Number.isFinite(glon)) continue;
      const d = haversineKm(lat, lon, glat, glon);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best
      ? {
          ceiling: best.CEILING,
          unit: best.UNIT || "Feet",
          airspace: [best.AIRSPACE_1, best.AIRSPACE_2, best.AIRSPACE_3]
            .filter((x) => x && String(x).trim())
            .join(", "),
          airports: [
            best.APT1_NAME && {
              name: best.APT1_NAME,
              faa: best.APT1_FAAID,
              laanc: best.APT1_LAANC,
            },
            best.APT2_NAME && {
              name: best.APT2_NAME,
              faa: best.APT2_FAAID,
              laanc: best.APT2_LAANC,
            },
          ].filter(Boolean),
          mapEff: best.MAP_EFF,
          distKm: bestD,
        }
      : null;
  }

  function buildFlags({ classItems, sua, uasfm }) {
    const flags = [];
    const authClass = classItems.filter((c) => c.needsAuth);
    if (authClass.length) {
      flags.push({
        level: "warn",
        title: "Controlled airspace may require authorization",
        detail:
          "Class B / C / D (and some surface Class E) under Part 107 typically need FAA airspace authorization (LAANC or DroneZone) before flight. Nearby: " +
          authClass
            .slice(0, 3)
            .map((c) => c.name)
            .join("; ") +
          ".",
      });
    } else {
      flags.push({
        level: "ok",
        title: "No Class B/C/D volume flagged at this point",
        detail:
          "Still verify with official sources. Class E, TFRs, NOTAMs, and facility rules can still apply.",
      });
    }

    const highSua = sua.filter((s) => s.highImpact);
    if (highSua.length) {
      flags.push({
        level: "alert",
        title: "Restricted / prohibited special-use airspace nearby",
        detail:
          highSua.map((s) => s.name + (s.times ? " (" + s.times + ")" : "")).join("; ") +
          ". Restricted areas often require specific authorization when active.",
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
        flags.push({
          level: "alert",
          title: "UAS Facility Map grid ceiling is 0 ft AGL here",
          detail:
            "Automated LAANC approval at altitude is unlikely in this grid. Further coordination may be required.",
        });
      } else if (ceil != null && ceil < 400) {
        flags.push({
          level: "warn",
          title: "UAS Facility Map max altitude " + ceil + " " + (uasfm.unit || "ft") + " AGL",
          detail:
            "Grid-based ceiling near associated airports. Do not exceed authorized altitude. Map effective: " +
            (uasfm.mapEff || "see FAA") +
            ".",
        });
      } else if (ceil != null) {
        flags.push({
          level: "ok",
          title: "UAS Facility Map grid ceiling " + ceil + " " + (uasfm.unit || "ft") + " AGL",
          detail: "Confirm on official UAS Facility Maps before flight.",
        });
      }

      const laancAirports = (uasfm.airports || []).filter((a) => Number(a.laanc) === 1);
      if (laancAirports.length) {
        flags.push({
          level: "info",
          title: "LAANC-enabled facility association on grid",
          detail:
            laancAirports.map((a) => a.name + (a.faa ? " (" + a.faa + ")" : "")).join("; ") +
            ". Authorization may be requestable via a LAANC USS (AirData, Aloft, etc.) when eligible.",
        });
      }
    } else {
      flags.push({
        level: "info",
        title: "No UAS Facility Map grid cell matched nearby",
        detail:
          "Common outside mapped airport grids. Uncontrolled airspace still has Part 107 rules; TFRs/NOTAMs can appear anytime.",
      });
    }

    flags.push({
      level: "info",
      title: "Waivers are separate from airspace authorization",
      detail:
        "Night, BVLOS, over people, etc. use Part 107 waivers—not the same as LAANC. ASAP NJ can advise when you hire us.",
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
    $("as-coords").textContent =
      place.lat.toFixed(5) + "°, " + place.lon.toFixed(5) + "°";
    $("as-map-link").href =
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(place.lat + "," + place.lon);
    $("as-faa-map-link").href =
      "https://faa.maps.arcgis.com/apps/webappviewer/index.html?id=9c2e4406710048e19806ebf6a06754ad";

    const flagsHost = $("as-flags");
    flagsHost.innerHTML = "";
    for (const f of data.flags) {
      const card = el("article", "as-flag as-flag--" + f.level);
      card.appendChild(el("strong", null, f.title));
      card.appendChild(el("p", null, f.detail));
      flagsHost.appendChild(card);
    }

    const uHost = $("as-uasfm");
    uHost.innerHTML = "";
    if (data.uasfm) {
      const u = data.uasfm;
      uHost.appendChild(
        el(
          "p",
          null,
          "Nearest UAS Facility Map grid: ceiling " +
            (u.ceiling != null ? u.ceiling + " " + (u.unit || "ft") + " AGL" : "n/a") +
            (u.airspace ? " · associated class tags: " + u.airspace : "") +
            (u.mapEff ? " · map effective " + u.mapEff : "") +
            "."
        )
      );
      if (u.airports && u.airports.length) {
        const ul = el("ul");
        u.airports.forEach((a) => {
          ul.appendChild(
            el(
              "li",
              null,
              a.name +
                (a.faa ? " (" + a.faa + ")" : "") +
                (Number(a.laanc) === 1 ? " · LAANC flag: yes" : " · LAANC flag: no/unknown")
            )
          );
        });
        uHost.appendChild(ul);
      }
    } else {
      uHost.appendChild(el("p", "muted", "No UASFM grid cell found within the search radius."));
    }

    const cHost = $("as-class");
    cHost.innerHTML = "";
    if (!data.classItems.length) {
      cHost.appendChild(
        el("p", "muted", "No class airspace polygons returned in radius—verify manually.")
      );
    } else {
      const table = el("table", "as-table");
      const thead = el("thead");
      const hr = el("tr");
      ["Name", "Class", "Lower", "Upper", "Auth likely?"].forEach((h) =>
        hr.appendChild(el("th", null, h))
      );
      thead.appendChild(hr);
      table.appendChild(thead);
      const tb = el("tbody");
      data.classItems.forEach((c) => {
        const tr = el("tr");
        tr.appendChild(el("td", null, c.name));
        tr.appendChild(el("td", null, c.class + (c.localType ? " (" + c.localType + ")" : "")));
        tr.appendChild(el("td", null, c.lower));
        tr.appendChild(el("td", null, c.upper));
        tr.appendChild(
          el("td", null, c.needsAuth ? "Often yes (LAANC / DroneZone)" : "Usually no for B/C/D")
        );
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      cHost.appendChild(table);
    }

    const sHost = $("as-sua");
    sHost.innerHTML = "";
    if (!data.sua.length) {
      sHost.appendChild(el("p", "muted", "No special-use airspace polygons in the awareness radius."));
    } else {
      const ul = el("ul");
      data.sua.forEach((s) => {
        ul.appendChild(
          el(
            "li",
            null,
            s.name +
              " · " +
              s.type +
              " · " +
              s.lower +
              "–" +
              s.upper +
              (s.times ? " · " + s.times : "")
          )
        );
      });
      sHost.appendChild(ul);
    }

    const aHost = $("as-airports");
    aHost.innerHTML = "";
    if (!data.airports.length) {
      aHost.appendChild(el("p", "muted", "No airports/heliports returned in radius."));
    } else {
      const ul = el("ul");
      data.airports.forEach((a) => {
        ul.appendChild(
          el(
            "li",
            null,
            (a.distNm != null ? a.distNm.toFixed(1) + " nm · " : "") +
              a.name +
              (a.ident ? " (" + a.ident + ")" : "") +
              " · " +
              a.type +
              (a.private ? " · private" : " · public") +
              (a.city ? " · " + a.city : "")
          )
        );
      });
      aHost.appendChild(ul);
    }

    const q = $("as-quote-link");
    if (q) {
      q.href = "index.html#contact?job_site=" + encodeURIComponent(place.label);
    }

    showResults(true);
  }

  async function runCheckWithPlace(place) {
    setStatus("Querying FAA airspace layers…", "info");
    showResults(false);
    $("as-run").disabled = true;
    const locBtn = $("as-locate");
    if (locBtn) locBtn.disabled = true;
    try {
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) {
        throw new Error("Invalid coordinates.");
      }

      const settled = await Promise.allSettled([
        arcgisQuery("Class_Airspace", place.lat, place.lon, RADIUS_M),
        arcgisQuery("Special_Use_Airspace", place.lat, place.lon, RADIUS_M),
        arcgisQuery("US_Airport", place.lat, place.lon, RADIUS_M),
        arcgisQuery("FAA_UAS_FacilityMap_Data", place.lat, place.lon, 8000),
        arcgisQuery(
          "Part_Time_National_Security_UAS_Flight_Restrictions",
          place.lat,
          place.lon,
          RADIUS_M
        ),
      ]);

      const take = (i, label) => {
        const s = settled[i];
        if (s.status === "fulfilled") return s.value;
        console.warn(label, s.reason);
        return [];
      };

      const classFeats = take(0, "class");
      const suaFeats = take(1, "sua");
      const aptFeats = take(2, "apt");
      const uasfmFeats = take(3, "uasfm");
      const nsufrFeats = take(4, "nsufr");

      if (
        settled[0].status === "rejected" &&
        settled[1].status === "rejected" &&
        settled[2].status === "rejected"
      ) {
        throw new Error(
          "Could not reach FAA map services from this browser. Try again, disable blockers for this site, or check your connection."
        );
      }

      const classItems = summarizeClass(classFeats);
      const sua = summarizeSua(suaFeats);
      const airports = summarizeAirports(aptFeats, place.lat, place.lon);
      const uasfm = closestUasfm(uasfmFeats, place.lat, place.lon);
      const flags = buildFlags({ classItems, sua, uasfm });

      if (nsufrFeats && nsufrFeats.length) {
        flags.unshift({
          level: "alert",
          title: "National Security UAS Flight Restriction (part-time) nearby",
          detail: "NSUFR polygon(s) intersect the search radius. Confirm active times before flight.",
        });
      }

      render(place, { classItems, sua, airports, uasfm, flags });
      setStatus(
        "Advisory results ready · ~" +
          Math.round(RADIUS_M / 1852) +
          " nm radius · verify before flight",
        "ok"
      );
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Lookup failed.", "err");
      showResults(false);
    } finally {
      $("as-run").disabled = false;
      if (locBtn) locBtn.disabled = false;
    }
  }

  async function runCheckFromInput() {
    const addr = ($("as-address").value || "").trim();
    if (addr.length < 3) {
      setStatus("Enter a job site address, or use “Use my location”.", "err");
      return;
    }
    // If user picked a suggestion, use those coordinates
    if (
      selectedPlace &&
      selectedPlace.label &&
      addr === selectedPlace.label
    ) {
      await runCheckWithPlace(selectedPlace);
      return;
    }
    setStatus("Finding that address…", "info");
    $("as-run").disabled = true;
    try {
      const place = await geocode(addr);
      selectedPlace = place;
      $("as-address").value = place.label;
      await runCheckWithPlace(place);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Address lookup failed.", "err");
      showResults(false);
      $("as-run").disabled = false;
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setStatus("This browser does not support location. Type an address instead.", "err");
      return;
    }
    setStatus("Requesting your location… (browser will ask permission)", "info");
    $("as-run").disabled = true;
    const locBtn = $("as-locate");
    if (locBtn) locBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setStatus("Resolving address near you…", "info");
          const place = await reversePhoton(lat, lon);
          // Prefer precise GPS coords over reverse pin
          place.lat = lat;
          place.lon = lon;
          selectedPlace = place;
          $("as-address").value = place.label;
          hideSuggest();
          await runCheckWithPlace(place);
        } catch (err) {
          console.error(err);
          setStatus(err.message || "Could not reverse-geocode your location.", "err");
          $("as-run").disabled = false;
          if (locBtn) locBtn.disabled = false;
        }
      },
      (err) => {
        let msg = "Location permission denied or unavailable.";
        if (err && err.code === 1) msg = "Location permission denied. Type an address instead.";
        if (err && err.code === 2) msg = "Location unavailable. Type an address instead.";
        if (err && err.code === 3) msg = "Location request timed out. Try again or type an address.";
        setStatus(msg, "err");
        $("as-run").disabled = false;
        if (locBtn) locBtn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  function init() {
    const form = $("as-form");
    const input = $("as-address");
    if (!form || !input) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      hideSuggest();
      runCheckFromInput();
    });

    input.addEventListener("input", () => {
      scheduleSuggest(input.value);
    });
    input.addEventListener("keydown", (e) => {
      const box = $("as-suggest");
      if (!box || box.hidden || !suggestItems.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeSuggest = Math.min(activeSuggest + 1, suggestItems.length - 1);
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
    input.addEventListener("blur", () => {
      setTimeout(hideSuggest, 180);
    });

    const locBtn = $("as-locate");
    if (locBtn) locBtn.addEventListener("click", useMyLocation);

    const params = new URLSearchParams(location.search);
    const q = params.get("q") || params.get("address");
    if (q) {
      input.value = q;
      runCheckFromInput();
    }
  }

  function highlightSuggest() {
    const box = $("as-suggest");
    if (!box) return;
    [...box.querySelectorAll(".as-suggest-item")].forEach((node, i) => {
      node.classList.toggle("is-active", i === activeSuggest);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
