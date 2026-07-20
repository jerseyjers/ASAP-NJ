(function () {
  const $ = (id) => document.getElementById(id);

  /* Tabs */
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('panel-' + tab.dataset.panel).classList.add('active');
    });
  });

  /* ---------- Loss estimator ---------- */
  function money(n) {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }

  function runLoss() {
    let kw = Number($('loss-kw').value) || 0;
    const modules = Number($('loss-modules').value) || 0;
    const w = Number($('loss-w').value) || 0;
    if ((!kw || kw <= 0) && modules && w) kw = (modules * w) / 1000;

    const sun = Number($('loss-sun').value) || 0;
    const pr = Number($('loss-pr').value) || 0.8;
    const rate = Number($('loss-rate').value) || 0;
    const failMod = Number($('loss-fail-mod').value) || 0;
    const failStr = Number($('loss-fail-str').value) || 0;
    const strSize = Number($('loss-str-size').value) || 0;
    const extraPct = Number($('loss-extra').value) || 0;

    const nameplateW = kw * 1000;
    const lostFromMods = failMod * w;
    const lostFromStr = failStr * strSize * w;
    // Avoid double-counting if user puts both; prefer explicit sum (field judgment)
    let lostW = lostFromMods + lostFromStr;
    lostW += nameplateW * (extraPct / 100);
    lostW = Math.min(lostW, nameplateW);

    const annualKwh = (lostW / 1000) * sun * 365 * pr;
    const annualMoney = annualKwh * rate;
    const pct = nameplateW > 0 ? (lostW / nameplateW) * 100 : 0;

    $('loss-out-w').textContent = lostW >= 1000
      ? (lostW / 1000).toFixed(2) + ' kW'
      : Math.round(lostW) + ' W';
    $('loss-out-kwh').textContent = Math.round(annualKwh).toLocaleString();
    $('loss-out-money').textContent = money(annualMoney);
    $('loss-out-pct').textContent = pct.toFixed(1) + '%';

    const notes = ($('loss-notes').value || '').trim();
    const blurb =
      'ASAP NJ — preliminary production impact estimate\n' +
      'System: ~' + kw.toFixed(2) + ' kW DC' +
      (modules ? ' (' + modules + ' × ' + w + ' W)' : '') + '\n' +
      'Findings modeled: ' + failMod + ' failed/bypassed module(s)' +
      (failStr ? '; ' + failStr + ' offline string(s) × ' + strSize + ' modules' : '') +
      (extraPct ? '; +' + extraPct + '% extra derate' : '') + '\n' +
      'Est. lost capacity: ~' + Math.round(lostW) + ' W (' + pct.toFixed(1) + '% of nameplate)\n' +
      'Est. annual energy: ~' + Math.round(annualKwh).toLocaleString() + ' kWh\n' +
      'Est. annual value: ~' + money(annualMoney) +
      ' @ $' + rate.toFixed(2) + '/kWh, ' + sun + ' PSH/day, PR ' + pr + '\n' +
      (notes ? 'Notes: ' + notes + '\n' : '') +
      'Assumptions: simple DC model for client discussion; confirm with production history and electrical tests. Not a utility bill guarantee.';

    $('loss-blurb').textContent = blurb;
    return blurb;
  }

  ['loss-kw', 'loss-modules', 'loss-w', 'loss-sun', 'loss-pr', 'loss-rate',
    'loss-fail-mod', 'loss-fail-str', 'loss-str-size', 'loss-extra', 'loss-notes'
  ].forEach((id) => {
    const node = $(id);
    if (node) node.addEventListener('input', runLoss);
  });

  $('loss-copy').addEventListener('click', async () => {
    const text = runLoss();
    try {
      await navigator.clipboard.writeText(text);
      $('loss-copy').textContent = 'Copied!';
      setTimeout(() => { $('loss-copy').textContent = 'Copy blurb'; }, 1500);
    } catch {
      alert('Copy failed — select the blurb manually.');
    }
  });

  $('loss-save').addEventListener('click', () => {
    const data = {};
    ['loss-kw', 'loss-modules', 'loss-w', 'loss-sun', 'loss-pr', 'loss-rate',
      'loss-fail-mod', 'loss-fail-str', 'loss-str-size', 'loss-extra', 'loss-notes'
    ].forEach((id) => { data[id] = $(id).value; });
    localStorage.setItem('asap-loss-v1', JSON.stringify(data));
    $('loss-save').textContent = 'Saved';
    setTimeout(() => { $('loss-save').textContent = 'Save to browser'; }, 1500);
  });

  try {
    const saved = JSON.parse(localStorage.getItem('asap-loss-v1') || 'null');
    if (saved) {
      Object.keys(saved).forEach((id) => {
        if ($(id)) $(id).value = saved[id];
      });
    }
  } catch (_) { /* ignore */ }

  runLoss();

  /* ---------- String helper ---------- */
  function runString() {
    const voc = Number($('str-voc').value) || 0;
    const coeff = Number($('str-coeff').value) || 0; // %/°C
    const count = Number($('str-count').value) || 0;
    const cold = Number($('str-cold').value);
    const maxV = Number($('str-max').value) || 0;
    const dt = cold - 25;
    const vocMod = voc * (1 + (coeff / 100) * dt);
    const vocStr = vocMod * count;
    const head = maxV - vocStr;

    $('str-dt').textContent = dt.toFixed(0) + ' °C';
    $('str-voc-mod').textContent = vocMod.toFixed(1) + ' V';
    $('str-voc-str').textContent = vocStr.toFixed(0) + ' V';
    $('str-head').textContent = head.toFixed(0) + ' V';
    $('str-head').style.color = head < 0 ? 'var(--hot)' : head < 25 ? 'var(--solar)' : 'var(--ok)';

    if (head < 0) {
      $('str-story').textContent = 'OVER inverter max at design cold temp. Reduce modules per string or confirm inverter rating / datasheet coeff.';
    } else if (head < 25) {
      $('str-story').textContent = 'Tight headroom. Double-check coldest design temp for the site and manufacturer cold Voc tables before signing off.';
    } else {
      $('str-story').textContent = 'Looks OK on paper for cold Voc vs inverter max. Still verify with the actual module datasheet and AHJ/inverter rules.';
    }
  }

  ['str-voc', 'str-coeff', 'str-count', 'str-cold', 'str-max'].forEach((id) => {
    $(id).addEventListener('input', runString);
  });
  runString();

  /* ---------- Flight checklist ---------- */
  const beforeItems = [
    'Part 107 current; airspace / LAANC checked for site',
    'Client permission & roof/array access plan',
    'Irradiance likely useful (often ≥ ~600 W/m²; avoid heavy cloud if possible)',
    'Array under load (not nighttime, not fully offline if avoidable)',
    'Thermal camera calibrated / correct lens; radiometric if required',
    'RGB + thermal both recording; enough battery & cards',
    'Wind / weather within aircraft limits',
    'Site hazards: power lines, people, reflective metal, RF',
    'Know inverter type (string / optimizers / micros) — changes interpretation',
    'Note ambient temp; plan low slow passes along rows'
  ];

  const afterItems = [
    'Capture overview + row-by-row thermal of full array',
    'Mark hotspot modules on map/sketch or geo tags',
    'Record sample ΔT (module vs neighbors / ambient notes)',
    'Photograph labels: inverter, combiner, disconnects',
    'If safe/authorized: string Voc/Isc or clamp checks on suspect strings',
    'Note soiling, shading, animal damage, cracked glass',
    'Export thermal with radiometry if available',
    'Run loss estimator with counts before leaving site',
    'Fill field report draft same day',
    'Schedule licensed electrician if corrective electrical work needed'
  ];

  function buildChecks(listEl, items, key) {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    listEl.innerHTML = '';
    items.forEach((text, i) => {
      const li = document.createElement('li');
      const id = key + '-' + i;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = !!saved[i];
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = text;
      input.addEventListener('change', () => {
        saved[i] = input.checked;
        localStorage.setItem(key, JSON.stringify(saved));
        updateChkProgress();
      });
      li.appendChild(input);
      li.appendChild(label);
      listEl.appendChild(li);
    });
  }

  function updateChkProgress() {
    const boxes = document.querySelectorAll('.checks input[type=checkbox]');
    const done = [...boxes].filter((b) => b.checked).length;
    $('chk-progress').textContent = done + ' / ' + boxes.length + ' complete';
  }

  buildChecks($('chk-before'), beforeItems, 'asap-chk-before');
  buildChecks($('chk-after'), afterItems, 'asap-chk-after');
  updateChkProgress();

  $('chk-reset').addEventListener('click', () => {
    localStorage.removeItem('asap-chk-before');
    localStorage.removeItem('asap-chk-after');
    buildChecks($('chk-before'), beforeItems, 'asap-chk-before');
    buildChecks($('chk-after'), afterItems, 'asap-chk-after');
    updateChkProgress();
  });

  /* ---------- Field report ---------- */
  if (!$('rep-date').value) {
    $('rep-date').valueAsDate = new Date();
  }

  function buildReport() {
    const lines = [
      'ASAP NJ DRONE SERVICES — SOLAR / THERMAL FIELD REPORT',
      '================================================',
      'Client / site: ' + ($('rep-client').value || '—'),
      'Date: ' + ($('rep-date').value || '—'),
      'System: ' + ($('rep-system').value || '—'),
      'Conditions: ' + ($('rep-wx').value || '—'),
      '',
      'THERMAL FINDINGS',
      $('rep-thermal').value || '—',
      '',
      'ELECTRICAL / TROUBLESHOOTING',
      $('rep-elec').value || '—',
      '',
      'PRODUCTION IMPACT (ESTIMATE)',
      $('rep-loss').value || '—',
      '',
      'RECOMMENDED NEXT STEPS',
      $('rep-next').value || '—',
      '',
      'Notes: Estimates depend on stated assumptions. Corrective electrical work performed only by appropriately licensed personnel where required.',
      'ASAP NJ Drone Services · asap-nj.com'
    ];
    const text = lines.join('\n');
    $('rep-out').textContent = text;
    return text;
  }

  $('rep-build').addEventListener('click', buildReport);
  $('rep-copy').addEventListener('click', async () => {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
      $('rep-copy').textContent = 'Copied!';
      setTimeout(() => { $('rep-copy').textContent = 'Copy report'; }, 1500);
    } catch {
      alert('Copy failed — select the report text manually.');
    }
  });
})();
