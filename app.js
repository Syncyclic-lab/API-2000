// ============================================================
// app.js — API 2000 Venting Calculator frontend
// Gathers form inputs, assembles the calculation payload,
// runs the in-browser engine, and renders formatted results.
// ============================================================

'use strict';

// --- Unit label maps (keyed by unit system) ---------------------------------

const UNITS = {
  SI: {
    vol: 'm³', dim: 'm', press: 'kPa(g)', temp: '°C',
    fill: 'm³/h', heat: 'J/kg',
    insulThick: 'mm', insulK: 'W/(m·K)', insulH: 'W/(m²·K)',
    area: 'm²', flow: 'Nm³/h', pipeDiam: 'mm',
  },
  US: {
    vol: 'BBL', dim: 'ft', press: 'psi(g)', temp: '°F',
    fill: 'BBL/h', heat: 'BTU/lb',
    insulThick: 'in', insulK: 'BTU·in/(h·ft²·°F)', insulH: 'BTU/(h·ft²·°F)',
    area: 'ft²', flow: 'SCFH', pipeDiam: 'in',
  },
};

const UNIT_CLASS_MAP = {
  'vol-unit':         'vol',
  'dim-unit':         'dim',
  'press-unit':       'press',
  'temp-unit':        'temp',
  'fill-unit':        'fill',
  'heat-unit':        'heat',
  'insul-thick-unit': 'insulThick',
  'insul-k-unit':     'insulK',
  'insul-h-unit':     'insulH',
  'area-unit':        'area',
  'flow-unit':        'flow',
  'pipe-diam-unit':   'pipeDiam',
};

// --- DOM references ---------------------------------------------------------

const $ = (id) => document.getElementById(id);
const show = (el, visible) => { if (el) el.style.display = visible ? '' : 'none'; };
const form             = $('calcForm');
const disclaimerCheck  = $('disclaimerCheck');
const calcBtn          = $('calcBtn');
const resultsContainer = $('resultsContainer');
const insulationType   = $('insulationType');
const unitSystemSelect = $('unitSystem');
const ventMethod       = $('ventMethod');
const vaporPressure    = $('vaporPressureClass');

// --- Tab switching ----------------------------------------------------------

document.querySelectorAll('.tab-button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

// --- Actual venting device management ---------------------------------------

const btnAddDevice = $('btnAddDevice');
const deviceRoster = $('deviceRoster');
let deviceIdCounter = 0;

// DEFAULT_K contents are developer-controlled static data from constants.js,
// so direct string interpolation (without runtime escape) is safe here.
function buildArrestorRefRows() {
  const defK = window.API2000.FLAME_ARRESTOR.DEFAULT_K;
  return Object.entries(defK).map(([key, row]) => `
    <tr>
      <td>${row.label}</td>
      <td class="k-range">${row.k_low}&nbsp;–&nbsp;${row.k_high}</td>
      <td class="k-range">${row.k_default}</td>
      <td><button type="button" class="btn-use-default" data-fa-use-default="${key}">Use default</button></td>
    </tr>
  `).join('');
}

function buildArrestorClassOptions() {
  const defK = window.API2000.FLAME_ARRESTOR.DEFAULT_K;
  return Object.entries(defK).map(([key, row]) =>
    `<option value="${key}">${row.label} (K ${row.k_low}–${row.k_high})</option>`
  ).join('');
}

function renderDeviceRow() {
  deviceIdCounter++;
  const id = deviceIdCounter;

  const card = document.createElement('div');
  card.className = 'device-card';
  card.id = `device-card-${id}`;

  card.innerHTML = `
    <div class="device-card-header">
      <span class="device-label">Device #${id}</span>
      <button type="button" class="btn-remove-device" data-remove-device="${id}">Remove</button>
    </div>
    <div class="field-grid">
      <div class="field">
        <label>Device Type</label>
        <select class="dev-type">
          <option value="PVRV">Normal PVRV / Breather Valve</option>
          <option value="EPRV">Emergency Relief Valve (EPRV)</option>
          <option value="FREE_VENT">Free Vent / Gooseneck</option>
        </select>
      </div>
      <div class="field">
        <label>Relief Direction</label>
        <select class="dev-direction">
          <option value="BOTH">Outbreathing &amp; Inbreathing</option>
          <option value="OUTBREATHING">Outbreathing (Pressure) Only</option>
          <option value="INBREATHING">Inbreathing (Vacuum) Only</option>
        </select>
      </div>
      <div class="field dev-field-capacity-source" style="display:none;">
        <label>Capacity Source</label>
        <div class="radio-group">
          <label class="radio-item"><input type="radio" name="cap-src-${id}" class="dev-cap-src" value="manufacturer" checked><span>Manufacturer Rated</span></label>
          <label class="radio-item"><input type="radio" name="cap-src-${id}" class="dev-cap-src" value="calculated"><span>Calculate from Pipe Geometry (Annex D nozzle flow)</span></label>
        </div>
      </div>
      <div class="field dev-field-sp">
        <label>Set Pressure <span class="unit press-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-sp" placeholder="e.g. 0.5">
        <div class="hint">Pressure at which valve opens</div>
      </div>
      <div class="field dev-field-sv">
        <label>Set Vacuum <span class="unit press-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-sv" placeholder="e.g. 0.2">
        <div class="hint">Vacuum at which valve opens</div>
      </div>
      <div class="field dev-field-flow-out">
        <label>Rated Outbreathing Flow <span class="unit flow-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-flow-out">
      </div>
      <div class="field dev-field-flow-in">
        <label>Rated Inbreathing Flow <span class="unit flow-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-flow-in">
      </div>
      <div class="field dev-field-overpressure">
        <label>Rated at Overpressure <span class="unit">%</span></label>
        <input type="number" step="any" min="0" class="dev-overpressure" value="10" placeholder="e.g. 10 or 100">
        <div class="hint">Flow capacity rated at this % above set point</div>
      </div>
      <div class="field dev-field-pipe-diam" style="display:none;">
        <label>Pipe Inner Diameter <span class="unit pipe-diam-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-pipe-diam">
        <div class="hint">Internal diameter of the vent pipe</div>
      </div>
      <div class="field dev-field-cd" style="display:none;">
        <label>Coefficient of Discharge (C<sub>d</sub>)</label>
        <input type="number" step="0.01" min="0" max="1" class="dev-cd" value="0.5">
        <div class="hint">Typical range: 0.3–0.8 for pipe fittings</div>
      </div>
    </div>

    <!-- ── Flame arrestor sub-block (optional, default off) ─────────── -->
    <div class="arrestor-block" data-fa-block>
      <label class="arrestor-toggle">
        <input type="checkbox" class="fa-enabled">
        <span>This device has a flame arrestor (ISO 16852)</span>
      </label>
      <div class="arrestor-body">
        <div class="arrestor-note">
          Reference K-values are generic approximations. For regulatory sizing,
          use the manufacturer's certified ΔP-vs-Q capacity curve (ISO 16852).
        </div>
        <table class="arrestor-ref-table" aria-label="Reference K-values">
          <thead>
            <tr>
              <th>Arrestor class</th>
              <th>Typical K</th>
              <th>Default</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${buildArrestorRefRows()}</tbody>
        </table>
        <div class="field-grid">
          <div class="field">
            <label>Arrestor Class</label>
            <select class="fa-class">
              ${buildArrestorClassOptions()}
            </select>
            <div class="hint">Selecting a class pre-fills K (editable).</div>
          </div>
          <div class="field">
            <label>Resistance Coefficient (K) <span class="unit">dimensionless</span></label>
            <input type="number" class="fa-k" step="0.1" min="0.1" value="3.5">
            <div class="hint">Override with manufacturer value if available.</div>
          </div>
          <div class="field">
            <label>Nominal Inside Diameter
              <span class="diam-unit-toggle" data-fa-diam-toggle>
                <button type="button" data-fa-diam-unit="mm" class="active">mm</button>
                <button type="button" data-fa-diam-unit="in">in</button>
                <button type="button" data-fa-diam-unit="m">m</button>
              </span>
            </label>
            <input type="number" class="fa-diameter" step="any" min="0" value="101.6">
            <div class="hint">Default 4" (101.6 mm). Set to the arrestor's nominal ID.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  deviceRoster.appendChild(card);
  applyDeviceVisibility(card);
  updateUnitLabels(card);
  renumberDeviceCards();
}

// Convert the entered arrestor diameter to metres based on the active unit toggle
function getArrestorDiameterMetres(card) {
  const v = parseFloat(card.querySelector('.fa-diameter').value);
  if (isNaN(v) || v <= 0) return null;
  const activeBtn = card.querySelector('[data-fa-diam-toggle] button.active');
  const unit = activeBtn ? activeBtn.dataset.faDiamUnit : 'mm';
  const C = window.API2000.CONVERSIONS;
  if (unit === 'in') return v * C.IN_TO_M;
  if (unit === 'm')  return v;
  return v * C.MM_TO_M;
}

function applyDeviceVisibility(card) {
  const dir    = card.querySelector('.dev-direction').value;
  const type   = card.querySelector('.dev-type').value;
  const isFreeVent = type === 'FREE_VENT';
  if (!isFreeVent) card.querySelector('.dev-cap-src[value="manufacturer"]').checked = true;
  const isCalcFreeVent = isFreeVent && card.querySelector('.dev-cap-src:checked').value === 'calculated';
  const showPressure = dir !== 'INBREATHING';
  const showVacuum   = dir !== 'OUTBREATHING';

  show(card.querySelector('.dev-field-capacity-source'), isFreeVent);
  // Free vents have no set pressure / set vacuum / overpressure
  show(card.querySelector('.dev-field-sp'), showPressure && !isFreeVent);
  show(card.querySelector('.dev-field-sv'), showVacuum && !isFreeVent);
  show(card.querySelector('.dev-field-overpressure'), !isFreeVent);
  show(card.querySelector('.dev-field-flow-out'), showPressure && !isCalcFreeVent);
  show(card.querySelector('.dev-field-flow-in'), showVacuum && !isCalcFreeVent);
  show(card.querySelector('.dev-field-pipe-diam'), isCalcFreeVent);
  show(card.querySelector('.dev-field-cd'), isCalcFreeVent);
  card.querySelector('[data-fa-block]').classList.toggle('enabled', card.querySelector('.fa-enabled').checked);
}

function renumberDeviceCards() {
  deviceRoster.querySelectorAll('.device-card').forEach((card, idx) => {
    card.querySelector('.device-label').textContent = `Device #${idx + 1}`;
  });
}

function collectDeviceData() {
  const devices = [];
  deviceRoster.querySelectorAll('.device-card').forEach(card => {
    const value = (selector) => {
      const v = parseFloat(card.querySelector(selector).value);
      return isNaN(v) ? undefined : v;
    };
    const direction = card.querySelector('.dev-direction').value;
    const type = card.querySelector('.dev-type').value;
    const device = { type, direction };
    const relievesOut = direction !== 'INBREATHING';
    const relievesIn  = direction !== 'OUTBREATHING';

    if (type === 'FREE_VENT') {
      device.capacity_source = card.querySelector('.dev-cap-src:checked').value;
    } else {
      device.rated_overpressure_pct = value('.dev-overpressure');
      if (relievesOut) device.set_pressure = value('.dev-sp');
      if (relievesIn)  device.set_vacuum   = value('.dev-sv');
    }

    if (device.capacity_source === 'calculated') {
      device.pipe_diameter         = value('.dev-pipe-diam');
      device.discharge_coefficient = value('.dev-cd');
    } else {
      if (relievesOut) device.rated_flow_outbreathing = value('.dev-flow-out');
      if (relievesIn)  device.rated_flow_inbreathing  = value('.dev-flow-in');
    }

    // Flame arrestor — always emitted in SI (metres, dimensionless K).
    if (card.querySelector('.fa-enabled').checked) {
      const K = value('.fa-k');
      const D = getArrestorDiameterMetres(card);
      if (K > 0 && D > 0) {
        device.flame_arrestor = { K, diameter_m: D, arrestor_class_key: card.querySelector('.fa-class').value };
      }
    }

    devices.push(device);
  });
  return devices;
}

deviceRoster.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-remove-device]');
  if (removeBtn) {
    const card = $(`device-card-${removeBtn.dataset.removeDevice}`);
    if (card) {
      card.remove();
      renumberDeviceCards();
    }
    return;
  }

  // "Use default" in the reference table pre-fills K and selects the class.
  const useDefaultBtn = e.target.closest('[data-fa-use-default]');
  if (useDefaultBtn) {
    const card = useDefaultBtn.closest('.device-card');
    const key  = useDefaultBtn.dataset.faUseDefault;
    const row  = window.API2000.FLAME_ARRESTOR.DEFAULT_K[key];
    if (card && row) {
      card.querySelector('.fa-k').value = row.k_default;
      card.querySelector('.fa-class').value = key;
    }
    return;
  }

  // Diameter unit-toggle pill buttons.
  const diamBtn = e.target.closest('[data-fa-diam-unit]');
  if (diamBtn) {
    diamBtn.closest('[data-fa-diam-toggle]').querySelectorAll('button')
      .forEach(b => b.classList.toggle('active', b === diamBtn));
  }
});

deviceRoster.addEventListener('change', (e) => {
  const card = e.target.closest('.device-card');
  if (!card) return;
  // Selecting a class pre-fills K with that class's default (still editable).
  if (e.target.classList.contains('fa-class')) {
    const row = window.API2000.FLAME_ARRESTOR.DEFAULT_K[e.target.value];
    if (row) card.querySelector('.fa-k').value = row.k_default;
  }
  applyDeviceVisibility(card);
});

btnAddDevice.addEventListener('click', renderDeviceRow);
renderDeviceRow();

// --- Unit labels and conditional fields -------------------------------------

function updateUnitLabels(scope) {
  const root = scope || document;
  const units = UNITS[unitSystemSelect.value];
  for (const [cls, key] of Object.entries(UNIT_CLASS_MAP)) {
    root.querySelectorAll(`.${cls}`).forEach(el => { el.textContent = units[key]; });
  }
}

function updateMethodFields() {
  const general = ventMethod.value === 'GENERAL';
  show($('latitudeField'), general);
  show($('vaporPressureField'), general);
  show($('flashPointField'), !general);
  $('volatilityHint').textContent = general
    ? 'General method: volatile if vapor pressure > 5.0 kPa (0.73 psia)'
    : 'Annex A: volatile if flash point < 37.8 °C (100 °F)';
  updateVolatilityIndicator();
}

function updateInsulationFields() {
  const type = insulationType.value;
  const insulated = type === 'FULLY_INSULATED' || type === 'PARTIALLY_INSULATED';
  $('insulationFields').classList.toggle('visible', type !== 'UNINSULATED');
  document.querySelectorAll('.insul-prop').forEach(el => show(el, insulated));
  show($('coverageFractionField'), type === 'PARTIALLY_INSULATED');
  show($('containmentFractionField'), type === 'DOUBLE_WALL');
}

const volatilityIndicator = $('volatilityIndicator');
const flashPointInput     = $('flashPoint');

function setVolatility(text, cls) {
  volatilityIndicator.textContent = text;
  volatilityIndicator.className = `volatility-badge ${cls}`;
}

function updateVolatilityIndicator() {
  if (ventMethod.value === 'GENERAL') {
    if (vaporPressure.value === 'NONVOLATILE') setVolatility('Non-Volatile (VP ≤ 5.0 kPa)', 'non-volatile');
    else setVolatility('Volatile (VP > 5.0 kPa)', 'volatile');
    return;
  }
  const fp = parseFloat(flashPointInput.value);
  if (isNaN(fp)) {
    setVolatility('Enter flash point', 'neutral');
    return;
  }
  const us = unitSystemSelect.value === 'US';
  const threshold = us ? 100 : 37.8;
  const label = us ? '100 °F' : '37.8 °C';
  if (fp < threshold) setVolatility(`Volatile (FP < ${label})`, 'volatile');
  else setVolatility(`Non-Volatile (FP ≥ ${label})`, 'non-volatile');
}

unitSystemSelect.addEventListener('change', () => {
  updateUnitLabels();
  updateVolatilityIndicator();
});
ventMethod.addEventListener('change', updateMethodFields);
vaporPressure.addEventListener('change', updateVolatilityIndicator);
flashPointInput.addEventListener('input', updateVolatilityIndicator);
insulationType.addEventListener('change', updateInsulationFields);
$('envFactor').addEventListener('change', (e) => show($('customEnvFactorField'), e.target.value === 'CUSTOM'));
disclaimerCheck.addEventListener('change', () => { calcBtn.disabled = !disclaimerCheck.checked; });

updateUnitLabels();
updateMethodFields();
updateInsulationFields();

// --- Input helpers ----------------------------------------------------------

function num(id) {
  const v = $(id).value.trim();
  if (v === '') return undefined;
  const parsed = Number(v);
  return isNaN(parsed) ? undefined : parsed;
}
function str(id) {
  const v = $(id).value.trim();
  return v === '' ? undefined : v;
}
const bool = (id) => $(id).checked;

// --- Payload assembly -------------------------------------------------------

function assemblePayload() {
  const insulation = insulationType.value;
  return {
    meta: {
      disclaimer_accepted: bool('disclaimerCheck'),
      unit_system:  unitSystemSelect.value,
      method:       ventMethod.value,
      tag_number:   str('tagNumber'),
      project_name: str('projectName'),
      prepared_by:  str('preparedBy'),
    },
    tank: {
      shape:                 $('tankShape').value,
      volume:                num('tankVolume'),
      mawp:                  num('tankMAWP'),
      mawv:                  num('tankMAWV'),
      diameter:              num('tankDiameter'),
      height_or_length:      num('tankHeight'),
      elevation_above_grade: num('tankElevation'),
    },
    fluid: {
      name:                 str('fluidName'),
      flash_point:          num('flashPoint'),
      vapor_pressure_class: vaporPressure.value,
      operating_temp:       num('operatingTemp'),
      relieving_temp:       num('relievingTemp'),
      max_fill_rate:        num('maxFillRate'),
      max_empty_rate:       num('maxEmptyRate'),
      latent_heat:          num('latentHeat'),
      molecular_weight:     num('molWeight'),
    },
    environment: {
      latitude_zone:                $('latitudeZone').value,
      insulation_type:              insulation,
      insulation_thickness:         num('insulThickness'),
      insulation_conductivity:      num('insulConductivity'),
      inside_htc:                   num('insulHTC'),
      coverage_fraction:            insulation === 'PARTIALLY_INSULATED' ? num('coverageFraction') : undefined,
      outside_containment_fraction: insulation === 'DOUBLE_WALL' ? num('containmentFraction') : undefined,
    },
    abnormal_scenarios: {
      control_valve_failure:                bool('ab_controlValve'),
      blanket_gas_equipment_failure:        bool('ab_blanketGas'),
      abnormal_heat_transfer:               bool('ab_abnormalHeat'),
      internal_heat_exchanger_failure:      bool('ab_heatExchanger'),
      uninsulated_hot_tank_in_rain:         bool('ab_hotTankRain'),
      exothermic_reaction:                  bool('ab_exothermic'),
      mixing_of_products:                   bool('ab_mixing'),
      liquid_overfill:                      bool('ab_overfill'),
      pressure_transfer_vapor_breakthrough: bool('ab_vaporBreak'),
      atmospheric_pressure_change:          bool('ab_atmChange'),
    },
    fire: {
      include:              bool('opt_fireCaseEnabled'),
      environmental_factor: $('envFactor').value,
      custom_factor:        num('customEnvFactor'),
      manual_wetted_area:   num('manualWettedArea'),
    },
    devices: collectDeviceData(),
  };
}

// --- Render helpers ---------------------------------------------------------

const _escapeDiv = document.createElement('div');
function escapeHtml(text) {
  _escapeDiv.textContent = text;
  return _escapeDiv.innerHTML;
}

function fmtVal(v, unit) {
  if (v == null || v === '') return '—';
  return `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${unit || ''}`.trim();
}

const ICONS = {
  error: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  notice: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l6.5 12H1.5L8 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v3M8 11.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  pass: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5 8.5l2 2 4-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  statusPass: '<svg class="status-pass" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6 9.5l2 2 4-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  statusFail: '<svg class="status-fail" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

function renderAlerts(warnings, errors) {
  const alert = (cls, icon, message) => `<div class="alert ${cls}">${icon}<span>${escapeHtml(message)}</span></div>`;
  return (errors || []).map(e => alert('alert-error', ICONS.error, e)).join('') +
    (warnings || []).map(w => (w.severity === 'WARNING'
      ? alert('alert-error', ICONS.warning, w.message)
      : alert('alert-warn', ICONS.notice, w.message))).join('');
}

function tableRow(label, value, highlight) {
  return `<tr${highlight ? ' class="highlight"' : ''}><th>${escapeHtml(String(label))}</th><td>${escapeHtml(String(value))}</td></tr>`;
}

function section(title, rows, extraClass = '') {
  return `
    <div class="result-section ${extraClass}">
      <h3>${escapeHtml(title)}</h3>
      <table class="result-table">${rows}</table>
    </div>`;
}

// --- Render full results ----------------------------------------------------

function renderCompliance(o) {
  const av = o.actual_venting;
  const fu = o.flow_unit;
  const rows = [
    { label: 'Normal Outbreathing', required: o.normal_venting.total_out, actual: av.normal_out, pass: av.adequacy.normal_out },
  ];
  if (av.adequacy.emergency_out != null) {
    rows.push({ label: 'Emergency Outbreathing', required: o.emergency_venting.required, actual: av.emergency_out, pass: av.adequacy.emergency_out });
  }
  rows.push({ label: 'Inbreathing (Vacuum)', required: o.normal_venting.total_in, actual: av.inbreathing, pass: av.adequacy.inbreathing });
  const allPass = rows.every(r => r.pass);

  return `
    <div class="compliance-summary">
      <div class="compliance-header ${allPass ? 'all-pass' : 'has-fail'}">
        ${allPass ? ICONS.pass : ICONS.warning}
        ${allPass ? 'All Venting Requirements Met' : 'Venting Deficiency Detected — Review Required'}
      </div>
      <div class="compliance-row-header">
        <span>Requirement</span><span>Required</span><span>Actual</span><span></span>
      </div>
      <div class="compliance-rows">
        ${rows.map(r => `
          <div class="compliance-row">
            <span class="cr-label">${escapeHtml(r.label)}</span>
            <span class="cr-value required">${escapeHtml(fmtVal(r.required, fu))}</span>
            <span class="cr-value ${r.pass ? 'actual-pass' : 'actual-fail'}">${escapeHtml(fmtVal(r.actual, fu))}</span>
            <span class="cr-status">${r.pass ? ICONS.statusPass : ICONS.statusFail}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderDevices(o) {
  const devs = o.actual_venting.devices;
  const fu = o.flow_unit;
  const typeLabels = { PVRV: 'PVRV', EPRV: 'EPRV', FREE_VENT: 'Free Vent' };
  const typeCls    = { PVRV: 'pvrv', EPRV: 'eprv', FREE_VENT: 'free-vent' };
  let html = '';

  if (devs.some(d => d.arrestor)) {
    const badgeCls = { PASS: 'pass', WARN: 'warn', FAIL: 'fail' };
    html += `
      <div class="result-section">
        <h3>Flame Arrestor — Pressure Drop &amp; Budget (ISO 16852)</h3>
        <table class="arrestor-results-table">
          <thead>
            <tr><th>Device</th><th>ΔP (mbar)</th><th>ΔP (inH₂O)</th><th>% of MAWP at Rated</th><th>Eff. Flow</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${devs.map((d, i) => {
              const a = d.arrestor;
              if (!a) return '';
              return `<tr>
                <td>#${i + 1} — ${escapeHtml(typeLabels[d.type] || d.type)}</td>
                <td>${fmtVal(a.deltaP_mbar, 'mbar')}</td>
                <td>${fmtVal(a.deltaP_inH2O, 'inH₂O')}</td>
                <td>${fmtVal(a.budget_pct, '%')}</td>
                <td>${fmtVal(a.effective_flow, fu)}</td>
                <td><span class="fa-badge ${badgeCls[a.badge] || ''}">${escapeHtml(a.badge)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  html += `
    <div class="device-breakdown">
      <h3>Installed Device Contributions at MAWP / MAWV</h3>
      <table class="device-breakdown-table">
        <thead>
          <tr><th>#</th><th>Type</th><th>Direction</th><th>Outbreathing</th><th>Inbreathing</th></tr>
        </thead>
        <tbody>
          ${devs.map((d, i) => {
            const dirLabel = d.direction === 'BOTH' ? 'Both' : d.direction === 'OUTBREATHING' ? 'Pressure' : 'Vacuum';
            return `<tr>
              <td>${i + 1}</td>
              <td><span class="type-badge ${typeCls[d.type] || ''}">${escapeHtml(typeLabels[d.type] || d.type)}</span></td>
              <td>${escapeHtml(dirLabel)}</td>
              <td class="mono-val">${d.flow_out > 0 ? fmtVal(d.flow_out, fu) : '—'}</td>
              <td class="mono-val">${d.flow_in > 0 ? fmtVal(d.flow_in, fu) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700; border-top: 2px solid var(--gray-200);">
            <td colspan="3" style="text-align:right; color:var(--gray-600);">Total Installed Capacity</td>
            <td class="mono-val">${fmtVal(o.actual_venting.emergency_out, fu)}</td>
            <td class="mono-val">${fmtVal(o.actual_venting.inbreathing, fu)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  return html;
}

function renderResults(result) {
  if (!result.outputs) {
    resultsContainer.innerHTML = renderAlerts(result.warnings, result.errors);
    return;
  }

  const o  = result.outputs;
  const fu = o.flow_unit;
  const nv = o.normal_venting;
  let html = renderAlerts(result.warnings, result.errors);

  const p = o.project;
  const projectRows = [
    ['Tag Number', p.tag_number], ['Project', p.project_name], ['Prepared By', p.prepared_by], ['Fluid', p.fluid_name],
  ].filter(([, v]) => v).map(([k, v]) => tableRow(k, v)).join('');
  html += section('Calculation Basis', projectRows + tableRow('Normal Venting Method', o.method_label));

  if (o.actual_venting) html += renderCompliance(o);

  html += section('Governing Requirements',
    tableRow('Governing Outbreathing (pressure)', fmtVal(o.governing.outbreathing, fu)) +
    tableRow('Governing Inbreathing (vacuum)',    fmtVal(o.governing.inbreathing, fu)) +
    tableRow('Emergency Governs?', o.governing.emergency_governs ? 'Yes — fire case controls outbreathing' : 'No — normal venting controls'),
    'governing-box');

  let thermalRows =
    tableRow('Thermal Inbreathing',  fmtVal(nv.thermal_in, fu)) +
    tableRow('Thermal Outbreathing', fmtVal(nv.thermal_out, fu));
  if (o.method === 'GENERAL') {
    thermalRows +=
      tableRow('Y-factor (Table 1)', fmtVal(nv.Y)) +
      tableRow('C-factor (Table 2)', fmtVal(nv.C)) +
      tableRow('Insulation Reduction Factor Rᵢ', fmtVal(nv.Ri));
  }
  html += section('Normal Venting — Thermal', thermalRows);
  html += section('Normal Venting — Liquid Movement',
    tableRow('Inbreathing (emptying)', fmtVal(nv.liquid_in, fu)) +
    tableRow('Outbreathing (filling)', fmtVal(nv.liquid_out, fu)) +
    tableRow('Volatile?', nv.is_volatile ? 'Yes' : 'No'));
  html += section('Normal Venting — Totals',
    tableRow('Total Normal Inbreathing',  fmtVal(nv.total_in, fu), true) +
    tableRow('Total Normal Outbreathing', fmtVal(nv.total_out, fu), true));

  const ev = o.emergency_venting;
  if (ev) {
    html += section('Emergency Venting — Fire Exposure',
      tableRow('Wetted Area', fmtVal(ev.wetted_area, o.area_unit)) +
      tableRow('Wetted Area Basis', ev.wetted_area_method) +
      tableRow('Heat Input Q (Table 3)', fmtVal(ev.heat_input, o.heat_unit)) +
      tableRow('Environmental Factor F (Table 9)', fmtVal(ev.F)) +
      tableRow('Fluid Basis', ev.basis === 'HEXANE' ? 'Hexane (Tables 5 & 7)' : 'Stored fluid (Eq. 14)') +
      tableRow('Vapor Generation', fmtVal(ev.vapour_mass_flow, o.mass_unit)) +
      tableRow('Required Emergency Venting', fmtVal(ev.required, fu), true));
  }

  if (o.actual_venting && o.actual_venting.devices.length > 0) html += renderDevices(o);

  if (result.intermediates) {
    html += `
      <div class="result-section">
        <div class="collapsible-toggle" data-collapsible>
          <h3 style="margin:0;">Intermediates (SI Audit Trail)</h3>
          <span class="arrow">&#9654;</span>
        </div>
        <div class="collapsible-body">
          <table class="result-table">
            ${result.intermediates.map(([label, value, unit]) => tableRow(label, fmtVal(value, unit))).join('')}
          </table>
        </div>
      </div>`;
  }

  resultsContainer.innerHTML = html;

  resultsContainer.querySelectorAll('[data-collapsible]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      toggle.nextElementSibling.classList.toggle('open');
    });
  });
}

// --- Form submission --------------------------------------------------------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  renderResults(window.API2000.runCalculation(assemblePayload()));
});
