/**
 * ASAP NJ airspace check — interactive Leaflet map
 * Free tiles (OSM + Esri imagery). FAA polygons from query geometry.
 */
(function () {
  "use strict";

  const NJ = [39.95, -74.2];
  const DEFAULT_ZOOM = 10;

  let map = null;
  let siteMarker = null;
  let radiusCircle = null;
  let layers = {
    class: null,
    sua: null,
    airports: null,
    uasfm: null,
    nsufr: null,
  };
  let basemaps = {};
  let onMapClickCheck = null;
  let clickHintTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function classStyle(cls) {
    const c = String(cls || "").toUpperCase().replace("CLASS_", "");
    const colors = {
      B: { color: "#ff4d5a", fill: "#ff4d5a", fillOpacity: 0.18 },
      C: { color: "#f0a020", fill: "#f0a020", fillOpacity: 0.16 },
      D: { color: "#f5d76e", fill: "#f5d76e", fillOpacity: 0.14 },
      E: { color: "#3ec4e8", fill: "#3ec4e8", fillOpacity: 0.1 },
      A: { color: "#b388ff", fill: "#b388ff", fillOpacity: 0.08 },
      G: { color: "#3dd68c", fill: "#3dd68c", fillOpacity: 0.06 },
    };
    return colors[c] || { color: "#9aa3b2", fill: "#9aa3b2", fillOpacity: 0.1 };
  }

  function esriGeomToLatLngs(geom) {
    if (!geom) return null;
    // Point
    if (geom.x != null && geom.y != null) {
      return { type: "point", latlng: [geom.y, geom.x] };
    }
    // Polygon / multipolygon rings
    if (geom.rings && geom.rings.length) {
      const latlngs = geom.rings.map((ring) =>
        ring.map((pt) => [pt[1], pt[0]])
      );
      return { type: "polygon", latlngs };
    }
    // Polyline
    if (geom.paths && geom.paths.length) {
      const latlngs = geom.paths.map((path) =>
        path.map((pt) => [pt[1], pt[0]])
      );
      return { type: "polyline", latlngs };
    }
    return null;
  }

  function ensureMap() {
    if (map) {
      setTimeout(() => map.invalidateSize(), 80);
      return map;
    }
    if (typeof L === "undefined") {
      console.warn("Leaflet not loaded");
      return null;
    }
    const el = $("as-map");
    if (!el) return null;

    map = L.map("as-map", {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView(NJ, DEFAULT_ZOOM);

    const streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    });

    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri",
      }
    );

    const labels = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, opacity: 0.85, attribution: "Labels &copy; Esri" }
    );

    basemaps = {
      streets: streets,
      satellite: L.layerGroup([satellite, labels]),
    };
    basemaps.streets.addTo(map);

    layers.class = L.layerGroup().addTo(map);
    layers.sua = L.layerGroup().addTo(map);
    layers.airports = L.layerGroup().addTo(map);
    layers.uasfm = L.layerGroup().addTo(map);
    layers.nsufr = L.layerGroup().addTo(map);

    const overlays = {
      "Class airspace": layers.class,
      "Special-use": layers.sua,
      "UAS Facility Map": layers.uasfm,
      Airports: layers.airports,
      "Security UAS (NSUFR)": layers.nsufr,
    };

    L.control
      .layers(
        { Streets: basemaps.streets, Satellite: basemaps.satellite },
        overlays,
        { collapsed: true, position: "topright" }
      )
      .addTo(map);

    // Scale
    L.control.scale({ imperial: true, metric: true, position: "bottomleft" }).addTo(map);

    map.on("click", (e) => {
      if (!onMapClickCheck) return;
      const hint = $("as-map-hint");
      if (hint) {
        hint.textContent =
          "Checking " + e.latlng.lat.toFixed(5) + "°, " + e.latlng.lng.toFixed(5) + "°…";
      }
      onMapClickCheck(e.latlng.lat, e.latlng.lng);
    });

    // Basemap toggle buttons in page UI
    const btnStreet = $("as-basemap-street");
    const btnSat = $("as-basemap-sat");
    if (btnStreet) {
      btnStreet.addEventListener("click", () => {
        map.removeLayer(basemaps.satellite);
        if (!map.hasLayer(basemaps.streets)) basemaps.streets.addTo(map);
        btnStreet.classList.add("is-active");
        if (btnSat) btnSat.classList.remove("is-active");
      });
    }
    if (btnSat) {
      btnSat.addEventListener("click", () => {
        map.removeLayer(basemaps.streets);
        if (!map.hasLayer(basemaps.satellite)) basemaps.satellite.addTo(map);
        btnSat.classList.add("is-active");
        if (btnStreet) btnStreet.classList.remove("is-active");
      });
    }

    setTimeout(() => map.invalidateSize(), 120);
    return map;
  }

  function clearOverlays() {
    Object.keys(layers).forEach((k) => {
      if (layers[k]) layers[k].clearLayers();
    });
  }

  function setSite(place, radiusM) {
    const m = ensureMap();
    if (!m || !place) return;

    const latlng = [place.lat, place.lon];
    if (siteMarker) m.removeLayer(siteMarker);
    if (radiusCircle) m.removeLayer(radiusCircle);

    const icon = L.divIcon({
      className: "as-site-marker",
      html: '<div class="as-site-pin"><span></span></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    siteMarker = L.marker(latlng, { icon, zIndexOffset: 1000 })
      .addTo(m)
      .bindPopup(
        "<strong>Job site</strong><br>" +
          (place.label || "") +
          "<br><span style='opacity:.75'>" +
          place.lat.toFixed(5) +
          "°, " +
          place.lon.toFixed(5) +
          "°</span>"
      );

    radiusCircle = L.circle(latlng, {
      radius: radiusM || 20000,
      color: "#3ec4e8",
      weight: 2,
      dashArray: "6 8",
      fillColor: "#3ec4e8",
      fillOpacity: 0.05,
    }).addTo(m);

    siteMarker.openPopup();
  }

  function addClassFeatures(features) {
    if (!layers.class || !features) return;
    features.forEach((f) => {
      const a = f.attributes || {};
      const name = a.NAME || "Class airspace";
      if (/CONTIGUOUS UNITED STATES CLASS A/i.test(name)) return;
      if (a.LOWER_CODE === "MSL" && Number(a.LOWER_VAL) >= 10000) return;

      const conv = esriGeomToLatLngs(f.geometry);
      if (!conv || conv.type !== "polygon") return;

      const cls = a.CLASS || (a.LOCAL_TYPE || "").replace("CLASS_", "") || "?";
      const st = classStyle(cls);
      const poly = L.polygon(conv.latlngs, {
        color: st.color,
        weight: 2,
        fillColor: st.fill,
        fillOpacity: st.fillOpacity,
      });
      poly.bindPopup(
        "<strong>" +
          name +
          "</strong><br>Class " +
          cls +
          (a.LOCAL_TYPE ? " · " + a.LOCAL_TYPE : "") +
          "<br>Lower: " +
          (a.LOWER_VAL != null ? a.LOWER_VAL + " " + (a.LOWER_UOM || "") : "—") +
          "<br>Upper: " +
          (a.UPPER_VAL != null ? a.UPPER_VAL + " " + (a.UPPER_UOM || "") : "—")
      );
      poly.addTo(layers.class);
    });
  }

  function addSuaFeatures(features) {
    if (!layers.sua || !features) return;
    features.forEach((f) => {
      const a = f.attributes || {};
      const conv = esriGeomToLatLngs(f.geometry);
      if (!conv) return;
      const high = a.TYPE_CODE === "R" || a.TYPE_CODE === "P";
      const color = high ? "#f07178" : "#f0a020";
      let layer;
      if (conv.type === "polygon") {
        layer = L.polygon(conv.latlngs, {
          color,
          weight: 2,
          dashArray: "4 6",
          fillColor: color,
          fillOpacity: high ? 0.2 : 0.12,
        });
      } else if (conv.type === "polyline") {
        layer = L.polyline(conv.latlngs, { color, weight: 2, dashArray: "4 6" });
      } else return;
      layer.bindPopup(
        "<strong>" +
          (a.NAME || "Special-use") +
          "</strong><br>Type: " +
          (a.TYPE_CODE || "—") +
          (a.TIMESOFUSE ? "<br>Times: " + a.TIMESOFUSE : "")
      );
      layer.addTo(layers.sua);
    });
  }

  function addNsufrFeatures(features) {
    if (!layers.nsufr || !features) return;
    features.forEach((f) => {
      const a = f.attributes || {};
      const conv = esriGeomToLatLngs(f.geometry);
      if (!conv || conv.type !== "polygon") return;
      L.polygon(conv.latlngs, {
        color: "#c084fc",
        weight: 2,
        fillColor: "#c084fc",
        fillOpacity: 0.22,
      })
        .bindPopup(
          "<strong>National Security UAS restriction</strong><br>" +
            (a.NAME || a.BASE || "NSUFR") +
            "<br>Confirm active times before flight."
        )
        .addTo(layers.nsufr);
    });
  }

  function addUasfmFeatures(features) {
    if (!layers.uasfm || !features) return;
    let count = 0;
    features.forEach((f) => {
      if (count > 40) return; // keep map light
      const a = f.attributes || {};
      const conv = esriGeomToLatLngs(f.geometry);
      const ceil = a.CEILING;
      let color = "#3ec4e8";
      if (ceil === 0 || ceil === "0") color = "#f07178";
      else if (Number(ceil) > 0 && Number(ceil) < 400) color = "#f0a020";
      else if (Number(ceil) >= 400) color = "#3dd68c";

      if (conv && conv.type === "polygon") {
        L.polygon(conv.latlngs, {
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.22,
        })
          .bindPopup(
            "<strong>UAS Facility Map grid</strong><br>Ceiling: " +
              (ceil != null ? ceil + " " + (a.UNIT || "ft") + " AGL" : "n/a") +
              (a.APT1_NAME ? "<br>Airport: " + a.APT1_NAME : "")
          )
          .addTo(layers.uasfm);
        count++;
      } else if (Number.isFinite(Number(a.LATITUDE)) && Number.isFinite(Number(a.LONGITUDE))) {
        L.circleMarker([Number(a.LATITUDE), Number(a.LONGITUDE)], {
          radius: 6,
          color,
          fillColor: color,
          fillOpacity: 0.7,
          weight: 1,
        })
          .bindPopup(
            "<strong>UASFM</strong><br>Ceiling: " +
              (ceil != null ? ceil + " ft AGL" : "n/a")
          )
          .addTo(layers.uasfm);
        count++;
      }
    });
  }

  function parseDms(str) {
    if (str == null || typeof str !== "string") return null;
    const m = str.trim().match(/^(\d+)-(\d+)-([\d.]+)([NSEW])$/i);
    if (!m) return null;
    let val = +m[1] + +m[2] / 60 + +m[3] / 3600;
    if (m[4] === "S" || m[4] === "W") val = -val;
    return val;
  }

  function addAirportFeatures(features) {
    if (!layers.airports || !features) return;
    features.forEach((f) => {
      const a = f.attributes || {};
      let lat = null;
      let lon = null;
      const conv = esriGeomToLatLngs(f.geometry);
      if (conv && conv.type === "point") {
        lat = conv.latlng[0];
        lon = conv.latlng[1];
      } else {
        lat = parseDms(a.LATITUDE) ?? (typeof a.LATITUDE === "number" ? a.LATITUDE : null);
        lon = parseDms(a.LONGITUDE) ?? (typeof a.LONGITUDE === "number" ? a.LONGITUDE : null);
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const isHeli = /HELI|HP/i.test(String(a.TYPE_CODE || a.TYPE || ""));
      const marker = L.circleMarker([lat, lon], {
        radius: isHeli ? 5 : 7,
        color: "#fff",
        weight: 1.5,
        fillColor: isHeli ? "#a78bfa" : "#3ec4e8",
        fillOpacity: 0.95,
      });
      marker.bindPopup(
        "<strong>" +
          (a.NAME || "Facility") +
          "</strong>" +
          (a.IDENT || a.ICAO_ID ? " (" + (a.IDENT || a.ICAO_ID) + ")" : "") +
          "<br>" +
          (a.TYPE_CODE || a.TYPE || "Airport") +
          (a.SERVCITY ? " · " + a.SERVCITY : "")
      );
      marker.addTo(layers.airports);
    });
  }

  function fitToContent(place, radiusM) {
    if (!map || !place) return;
    const r = radiusM || 20000;
    // Rough degrees for padding
    const pad = r / 111000;
    const bounds = L.latLngBounds(
      [place.lat - pad, place.lon - pad],
      [place.lat + pad, place.lon + pad]
    );
    try {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
    } catch (_) {
      map.setView([place.lat, place.lon], 11);
    }
    setTimeout(() => map.invalidateSize(), 100);
  }

  /**
   * @param {object} place {lat, lon, label}
   * @param {object} geo raw feature arrays with geometry
   * @param {number} radiusM
   */
  function showResult(place, geo, radiusM) {
    ensureMap();
    clearOverlays();
    setSite(place, radiusM);
    if (geo) {
      addClassFeatures(geo.classFeatures || []);
      addSuaFeatures(geo.suaFeatures || []);
      addAirportFeatures(geo.airportFeatures || []);
      addUasfmFeatures(geo.uasfmFeatures || []);
      addNsufrFeatures(geo.nsufrFeatures || []);
    }
    fitToContent(place, radiusM);

    const card = $("as-map-card");
    if (card) card.hidden = false;

    const hint = $("as-map-hint");
    if (hint) {
      hint.textContent =
        "Pan / zoom · click any point to re-check · use layers (top-right) · satellite toggle below";
    }

    const stats = $("as-map-stats");
    if (stats && geo) {
      const nClass = (geo.classFeatures || []).length;
      const nSua = (geo.suaFeatures || []).length;
      const nApt = (geo.airportFeatures || []).length;
      const nUas = (geo.uasfmFeatures || []).length;
      stats.innerHTML =
        "<span><strong>" +
        nClass +
        "</strong> class</span>" +
        "<span><strong>" +
        nSua +
        "</strong> special-use</span>" +
        "<span><strong>" +
        nApt +
        "</strong> airports</span>" +
        "<span><strong>" +
        nUas +
        "</strong> UASFM cells</span>";
    }
  }

  function showIdle() {
    ensureMap();
    const card = $("as-map-card");
    if (card) card.hidden = false;
    const hint = $("as-map-hint");
    if (hint) {
      hint.textContent =
        "Interactive map ready — run a check, or click the map to pick a job site.";
    }
  }

  function setClickHandler(fn) {
    onMapClickCheck = fn;
  }

  function invalidate() {
    if (map) setTimeout(() => map.invalidateSize(), 50);
  }

  window.AsapAirspaceMap = {
    ensure: ensureMap,
    showResult,
    showIdle,
    setClickHandler,
    invalidate,
  };
})();
