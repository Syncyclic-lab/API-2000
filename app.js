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
    fill: 'm³/hr', heat: 'J/kg',
    insulThick: 'mm', insulK: 'W/(m·K)', insulH: 'W/(m²·K)',
    area: 'm²', flow: 'Nm³/hr', heatRate: 'W',
    pipeDiam: 'mm',
  },
  US: {
    vol: 'BBL', dim: 'ft', press: 'psi(g)', temp: '°F',
    fill: 'BPH', heat: 'BTU/lb',
    insulThick: 'in', insulK: 'BTU·in/(hr·ft²·°F)', insulH: 'BTU/(hr·ft²·°F)',
    area: 'ft²', flow: 'SCFH', heatRate: 'BTU/hr',
    pipeDiam: 'in',
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
const form             = $('calcForm');
const disclaimerCheck  = $('disclaimerCheck');
const calcBtn          = $('calcBtn');
const resultsContainer = $('resultsContainer');
const insulationType   = $('insulationType');
const insulationFields = $('insulationFields');
const coverageField    = $('coverageFractionField');
const unitSystemSelect = $('unitSystem');

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
  const defK = (window.API2000.FLAME_ARRESTOR && window.API2000.FLAME_ARRESTOR.DEFAULT_K) || {};
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
  const defK = (window.API2000.FLAME_ARRESTOR && window.API2000.FLAME_ARRESTOR.DEFAULT_K) || {};
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
  card.dataset.deviceId = id;

  card.innerHTML = `
    <div class="device-card-header">
      <span class="device-label">Device #${id}</span>
      <button type="button" class="btn-remove-device" data-remove-device="${id}">Remove</button>
    </div>
    <div class="field-grid">
      <div class="field">
        <label>Device Type</label>
        <select class="dev-type" data-field="type">
          <option value="PVRV">Normal PVRV / Breather Valve</option>
          <option value="EPRV">Emergency Relief Valve (EPRV)</option>
          <option value="FREE_VENT">Free Vent / Gooseneck</option>
        </select>
      </div>
      <div class="field">
        <label>Relief Direction</label>
        <select class="dev-direction" data-field="direction">
          <option value="BOTH">Outbreathing &amp; Inbreathing</option>
          <option value="OUTBREATHING">Outbreathing (Pressure) Only</option>
          <option value="INBREATHING">Inbreathing (Vacuum) Only</option>
        </select>
      </div>
      <div class="field dev-field-capacity-source" style="display:none;">
        <label>Capacity Source</label>
        <div class="radio-group">
          <label class="radio-item"><input type="radio" name="cap-src-${id}" class="dev-cap-src" value="manufacturer" checked><span>Manufacturer Rated</span></label>
          <label class="radio-item"><input type="radio" name="cap-src-${id}" class="dev-cap-src" value="calculated"><span>Calculate from Pipe Geometry (Eq. 25/26)</span></label>
        </div>
      </div>
      <div class="field dev-field-sp">
        <label>Set Pressure <span class="unit press-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-sp" data-field="set_pressure" placeholder="e.g. 0.5">
        <div class="hint">Pressure at which valve opens</div>
      </div>
      <div class="field dev-field-sv">
        <label>Set Vacuum <span class="unit press-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-sv" data-field="set_vacuum" placeholder="e.g. 0.2">
        <div class="hint">Vacuum at which valve opens</div>
      </div>
      <div class="field dev-field-flow-out">
        <label>Rated Outbreathing Flow <span class="unit flow-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-flow-out" data-field="flow_out">
      </div>
      <div class="field dev-field-flow-in">
        <label>Rated Inbreathing Flow <span class="unit flow-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-flow-in" data-field="flow_in">
      </div>
      <div class="field dev-field-overpressure">
        <label>Rated at Overpressure <span class="unit">%</span></label>
        <input type="number" step="any" min="0" class="dev-overpressure" data-field="rated_overpressure" value="10" placeholder="e.g. 10 or 100">
        <div class="hint">Flow capacity rated at this % overpressure</div>
      </div>
      <div class="field dev-field-pipe-diam" style="display:none;">
        <label>Pipe Inner Diameter <span class="unit pipe-diam-unit"></span></label>
        <input type="number" step="any" min="0" class="dev-pipe-diam" data-field="pipe_diameter">
        <div class="hint">Internal diameter of the vent pipe</div>
      </div>
      <div class="field dev-field-cd" style="display:none;">
        <label>Coefficient of Discharge (C<sub>d</sub>)</label>
        <input type="number" step="0.01" min="0" max="1" class="dev-cd" data-field="discharge_coefficient" value="0.5">
        <div class="hint">Typical range: 0.3–0.8 for pipe fittings</div>
      </div>
    </div>

    <!-- ── Flame arrestor sub-block (optional, default off) ─────────── -->
    <div class="arrestor-block" data-fa-block>
      <label class="arrestor-toggle">
        <input type="checkbox" class="fa-enabled" data-field="flame_arrestor_enabled">
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
            <select class="fa-class" data-field="arrestor_class_key">
              ${buildArrestorClassOptions()}
            </select>
            <div class="hint">Selecting a class pre-fills K (editable).</div>
          </div>
          <div class="field">
            <label>Resistance Coefficient (K) <span class="unit">dimensionless</span></label>
            <input type="number" class="fa-k" data-field="fa_K" step="0.1" min="0.1" value="5.0">
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
            <input type="number" class="fa-diameter" data-field="fa_diameter" step="any" min="0" value="101.6">
            <div class="hint">Default 4" (101.6 mm). Set to the arrestor's nominal ID.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  deviceRoster.appendChild(card);
  applyTypeVisibility(card);
  updateUnitLabels(card);
  applyArrestorVisibility(card);
  renumberDeviceCards();
}

// --- Flame-arrestor helpers -------------------------------------------------

function applyArrestorVisibility(card) {
  const block   = card.querySelector('[data-fa-block]');
  if (!block) return;
  const enabled = card.querySelector('.fa-enabled').checked;
  block.classList.toggle('enabled', enabled);
}

// Convert the user's entered diameter to metres based on the active unit toggle
function getArrestorDiameterMetres(card) {
  const input = card.querySelector('.fa-diameter');
  const v     = parseFloat(input.value);
  if (isNaN(v) || v <= 0) return null;
  const activeBtn = card.querySelector('[data-fa-diam-toggle] button.active');
  const unit      = activeBtn ? activeBtn.dataset.faDiamUnit : 'mm';
  const C         = window.API2000.CONVERSIONS;
  if (unit === 'in') return v * C.IN_TO_M;
  if (unit === 'm')  return v;
  return v * C.MM_TO_M; // default mm
}

function applyDirectionVisibility(card) {
  const dir    = card.querySelector('.dev-direction').value;
  const type   = card.querySelector('.dev-type').value;
  const capSrc = card.querySelector('.dev-cap-src:checked')?.value || 'manufacturer';
  const isCalcFreeVent = type === 'FREE_VENT' && capSrc === 'calculated';

  const showPressure = dir === 'BOTH' || dir === 'OUTBREATHING';
  const showVacuum   = dir === 'BOTH' || dir === 'INBREATHING';

  // Free vents have no set pressure / set vacuum / overpressure
  const showSetP = showPressure && type !== 'FREE_VENT';
  const showSetV = showVacuum   && type !== 'FREE_VENT';
  card.querySelector('.dev-field-sp').style.display           = showSetP ? '' : 'none';
  card.querySelector('.dev-field-sv').style.display           = showSetV ? '' : 'none';
  card.querySelector('.dev-field-overpressure').style.display = showSetP ? '' : 'none';

  card.querySelector('.dev-field-flow-out').style.display = (showPressure && !isCalcFreeVent) ? '' : 'none';
  card.querySelector('.dev-field-flow-in').style.display  = (showVacuum   && !isCalcFreeVent) ? '' : 'none';

  card.querySelector('.dev-field-pipe-diam').style.display = isCalcFreeVent ? '' : 'none';
  card.querySelector('.dev-field-cd').style.display        = isCalcFreeVent ? '' : 'none';
}

function applyTypeVisibility(card) {
  const type = card.querySelector('.dev-type').value;
  const isFreeVent = type === 'FREE_VENT';

  card.querySelector('.dev-field-capacity-source').style.display = isFreeVent ? '' : 'none';

  if (!isFreeVent) {
    const mfgRadio = card.querySelector('.dev-cap-src[value="manufacturer"]');
    if (mfgRadio) mfgRadio.checked = true;
  }

  applyDirectionVisibility(card);
  updateFluidFieldsVisibility();
}

function renumberDeviceCards() {
  const cards = deviceRoster.querySelectorAll('.device-card');
  cards.forEach((card, idx) => {
    card.querySelector('.device-label').textContent = `Device #${idx + 1}`;
  });
}

function collectDeviceData() {
  const devices = [];
  deviceRoster.querySelectorAll('.device-card').forEach(card => {
    const dir  = card.querySelector('.dev-direction').value;
    const type = card.querySelector('.dev-type').value;
    const device = { type, direction: dir };

    if (type === 'FREE_VENT') {
      const capSrc = card.querySelector('.dev-cap-src:checked')?.value || 'manufacturer';
      device.capacity_source = capSrc;

      if (capSrc === 'calculated') {
        const pd = parseFloat(card.querySelector('.dev-pipe-diam').value);
        if (!isNaN(pd)) device.pipe_diameter = pd;

        const cd = parseFloat(card.querySelector('.dev-cd').value);
        if (!isNaN(cd)) device.discharge_coefficient = cd;

        const kVal = num('fluidK');
        if (kVal != null) device.specific_heat_ratio = kVal;
        const ziVal = num('fluidZi');
        if (ziVal != null) device.compressibility_factor = ziVal;
      }
    }

    const isCalcFreeVent = type === 'FREE_VENT' && device.capacity_source === 'calculated';

    if ((dir === 'BOTH' || dir === 'OUTBREATHING') && !isCalcFreeVent) {
      const sp = parseFloat(card.querySelector('.dev-sp').value);
      if (!isNaN(sp)) device.set_pressure = sp;

      const flowOut = parseFloat(card.querySelector('.dev-flow-out').value);
      if (!isNaN(flowOut)) device.rated_flow_outbreathing = flowOut;

      const op = parseFloat(card.querySelector('.dev-overpressure').value);
      if (!isNaN(op)) device.rated_overpressure_pct = op;
    }

    if ((dir === 'BOTH' || dir === 'INBREATHING') && !isCalcFreeVent) {
      const sv = parseFloat(card.querySelector('.dev-sv').value);
      if (!isNaN(sv)) device.set_vacuum = sv;

      const flowIn = parseFloat(card.querySelector('.dev-flow-in').value);
      if (!isNaN(flowIn)) device.rated_flow_inbreathing = flowIn;
    }

    // Flame arrestor — always emitted in SI (metres, dimensionless K).
    const faCheckbox = card.querySelector('.fa-enabled');
    if (faCheckbox && faCheckbox.checked) {
      const K = parseFloat(card.querySelector('.fa-k').value);
      const D = getArrestorDiameterMetres(card);
      if (!isNaN(K) && K > 0 && D && D > 0) {
        device.flame_arrestor = {
          type: 'FLAME_ARRESTOR',
          K,
          diameter_m: D,
          arrestor_class_key: card.querySelector('.fa-class').value,
        };
      }
    }

    devices.push(device);
  });
  return devices;
}

function updateFluidFieldsVisibility() {
  const hasCalcFreeVent = Array.from(deviceRoster.querySelectorAll('.device-card')).some(card => {
    const type = card.querySelector('.dev-type').value;
    const src  = card.querySelector('.dev-cap-src:checked')?.value;
    return type === 'FREE_VENT' && src === 'calculated';
  });
  const kField  = $('fluidKField');
  const ziField = $('fluidZiField');
  if (kField)  kField.style.display  = hasCalcFreeVent ? '' : 'none';
  if (ziField) ziField.style.display = hasCalcFreeVent ? '' : 'none';
}

deviceRoster.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-remove-device]');
  if (removeBtn) {
    const id = removeBtn.dataset.removeDevice;
    const card = $(`device-card-${id}`);
    if (card) {
      card.remove();
      renumberDeviceCards();
      updateFluidFieldsVisibility();
    }
    return;
  }

  // "Use default" in the reference table pre-fills the K input and selects
  // the matching class in the dropdown.
  const useDefaultBtn = e.target.closest('[data-fa-use-default]');
  if (useDefaultBtn) {
    const card = useDefaultBtn.closest('.device-card');
    const key  = useDefaultBtn.dataset.faUseDefault;
    const row  = window.API2000.FLAME_ARRESTOR?.DEFAULT_K?.[key];
    if (card && row) {
      card.querySelector('.fa-k').value = row.k_default;
      const sel = card.querySelector('.fa-class');
      if (sel) sel.value = key;
    }
    return;
  }

  // Diameter unit-toggle pill buttons.
  const diamBtn = e.target.closest('[data-fa-diam-unit]');
  if (diamBtn) {
    const group = diamBtn.closest('[data-fa-diam-toggle]');
    if (group) group.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === diamBtn));
    return;
  }
});

deviceRoster.addEventListener('change', (e) => {
  const card = e.target.closest('.device-card');
  if (!card) return;

  if (e.target.classList.contains('dev-direction')) {
    applyDirectionVisibility(card);
  }
  if (e.target.classList.contains('dev-type')) {
    applyTypeVisibility(card);
  }
  if (e.target.classList.contains('dev-cap-src')) {
    applyDirectionVisibility(card);
    updateFluidFieldsVisibility();
  }
  if (e.target.classList.contains('fa-enabled')) {
    applyArrestorVisibility(card);
  }
  // Selecting a class pre-fills K with that class's default (still editable).
  if (e.target.classList.contains('fa-class')) {
    const key = e.target.value;
    const row = window.API2000.FLAME_ARRESTOR?.DEFAULT_K?.[key];
    if (row) card.querySelector('.fa-k').value = row.k_default;
  }
});

btnAddDevice.addEventListener('click', renderDeviceRow);
renderDeviceRow();

// --- Unit label updater -----------------------------------------------------

function updateUnitLabels(scope) {
  const root = scope || document;
  const units = UNITS[unitSystemSelect.value];
  for (const [cls, key] of Object.entries(UNIT_CLASS_MAP)) {
    root.querySelectorAll(`.${cls}`).forEach(el => {
      el.textContent = units[key];
    });
  }
}

unitSystemSelect.addEventListener('change', () => updateUnitLabels());
updateUnitLabels();

// --- Disclaimer toggle ------------------------------------------------------

disclaimerCheck.addEventListener('change', () => {
  calcBtn.disabled = !disclaimerCheck.checked;
});

// --- Insulation visibility toggle -------------------------------------------

insulationType.addEventListener('change', () => {
  const show = insulationType.value !== 'UNINSULATED';
  insulationFields.classList.toggle('visible', show);
  coverageField.style.display =
    insulationType.value === 'PARTIALLY_INSULATED' ? '' : 'none';
});

// --- Auto-determine volatility from flash point -----------------------------

const volatilityIndicator = $('volatilityIndicator');
const flashPointInput     = $('flashPoint');

function updateVolatilityIndicator() {
  const us = unitSystemSelect.value;
  const fp = parseFloat(flashPointInput.value);
  if (isNaN(fp)) {
    volatilityIndicator.textContent = 'Enter flash point';
    volatilityIndicator.className = 'volatility-badge neutral';
    return;
  }
  const threshold = us === 'SI' ? 38 : 100;
  const isVolatile = fp < threshold;
  const threshLabel = us === 'SI' ? '38 °C' : '100 °F';
  if (isVolatile) {
    volatilityIndicator.textContent = `Volatile (FP < ${threshLabel})`;
    volatilityIndicator.className = 'volatility-badge volatile';
  } else {
    volatilityIndicator.textContent = `Non-Volatile (FP ≥ ${threshLabel})`;
    volatilityIndicator.className = 'volatility-badge non-volatile';
  }
}

flashPointInput.addEventListener('input', updateVolatilityIndicator);
unitSystemSelect.addEventListener('change', updateVolatilityIndicator);
updateVolatilityIndicator();

// --- Input helpers ----------------------------------------------------------

function num(id) {
  const el = $(id);
  if (!el) return undefined;
  const v = el.value.trim();
  if (v === '') return undefined;
  const parsed = Number(v);
  return isNaN(parsed) ? undefined : parsed;
}
function str(id) {
  const el = $(id);
  if (!el) return undefined;
  const v = el.value.trim();
  return v === '' ? undefined : v;
}
function bool(id) {
  const el = $(id);
  return el ? el.checked : false;
}

// --- Payload assembly -------------------------------------------------------

function assemblePayload() {
  const us = unitSystemSelect.value;

  const meta = {
    disclaimer_accepted: true,
    unit_system: us,
  };
  if (str('tagNumber'))   meta.tag_number   = str('tagNumber');
  if (str('projectName')) meta.project_name = str('projectName');
  if (str('preparedBy'))  meta.prepared_by  = str('preparedBy');

  // Tank
  const tank = {
    shape:  $('tankShape').value,
    volume: num('tankVolume'),
    mawp:   num('tankMAWP'),
    mawv:   num('tankMAWV'),
  };
  const dia = num('tankDiameter');
  const hgt = num('tankHeight');
  if (dia != null || hgt != null) {
    tank.dimensions = {};
    if (dia != null) tank.dimensions.diameter         = dia;
    if (hgt != null) tank.dimensions.height_or_length = hgt;
  }
  const elev = num('tankElevation');
  if (elev != null) tank.elevation_above_grade = elev;

  // Fluid — volatile if flash point < 38 °C (100 °F), per API 2000 §1.5/§4
  const fp = num('flashPoint');
  const volatilityThreshold = us === 'SI' ? 38 : 100;
  const isVolatile = (fp != null && fp < volatilityThreshold);

  const fluid = {
    is_volatile:    isVolatile,
    flash_point:    fp,
    max_fill_rate:  num('maxFillRate'),
    max_empty_rate: num('maxEmptyRate'),
  };
  const fluidName = str('fluidName');
  if (fluidName)                   fluid.name = fluidName;
  const operTemp = num('operatingTemp');
  if (operTemp != null)            fluid.normal_operating_temp = operTemp;
  const latent = num('latentHeat');
  if (latent != null)              fluid.latent_heat_of_vaporization = latent;
  const molWt = num('molWeight');
  if (molWt != null)               fluid.molecular_weight = molWt;
  const relTemp = num('relievingTemp');
  if (relTemp != null)             fluid.relieving_vapor_temp = relTemp;
  const kVal = num('fluidK');
  if (kVal != null)                fluid.specific_heat_ratio = kVal;
  const ziVal = num('fluidZi');
  if (ziVal != null)               fluid.compressibility_factor = ziVal;

  // Environment
  const environment = {
    latitude_zone:   $('latitudeZone').value,
    insulation_type: insulationType.value,
  };
  if (insulationType.value !== 'UNINSULATED') {
    const ins = {};
    const thick = num('insulThickness');
    if (thick != null)                    ins.thickness = thick;
    const condK = num('insulConductivity');
    if (condK != null)                    ins.thermal_conductivity = condK;
    const htc = num('insulHTC');
    if (htc != null)                      ins.internal_heat_transfer_coefficient = htc;
    if (insulationType.value === 'PARTIALLY_INSULATED') {
      const covFrac = num('coverageFraction');
      if (covFrac != null) ins.coverage_fraction = covFrac;
    }
    if (Object.keys(ins).length > 0) environment.insulation = ins;
  }

  // Abnormal scenarios
  const abnormal_scenarios = {
    control_valve_failure:               bool('ab_controlValve'),
    blanket_gas_equipment_failure:       bool('ab_blanketGas'),
    abnormal_heat_transfer:              bool('ab_abnormalHeat'),
    internal_heat_exchanger_failure:     bool('ab_heatExchanger'),
    uninsulated_hot_tank_in_rain:        bool('ab_hotTankRain'),
    exothermic_reaction:                 bool('ab_exothermic'),
    mixing_of_products:                  bool('ab_mixing'),
    liquid_overfill:                     bool('ab_overfill'),
    pressure_transfer_vapor_breakthrough: bool('ab_vaporBreak'),
    atmospheric_pressure_change:         bool('ab_atmChange'),
  };

  // Calculation options
  const calculation_options = {
    include_emergency_fire_case: bool('opt_fireCaseEnabled'),
    credit_for_drainage:         bool('opt_drainage'),
    credit_for_fireproofing:     bool('opt_fireproofing'),
  };
  const manualWA = num('manualWettedArea');
  if (manualWA != null) calculation_options.manual_wetted_area_override = manualWA;

  const devices = collectDeviceData();

  return { meta, tank, fluid, environment, abnormal_scenarios, calculation_options, devices };
}

// --- Render helpers ---------------------------------------------------------

function fmtVal(v, unit) {
  if (v == null || v === '') return '—';
  return `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${unit || ''}`.trim();
}

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) return '';
  return warnings.map(w => {
    const isWarn = w.severity === 'WARNING';
    const cls = isWarn ? 'alert-error' : 'alert-warn';
    const icon = isWarn
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l6.5 12H1.5L8 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v3M8 11.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    return `<div class="alert ${cls}">${icon}<span>${escapeHtml(w.message)}</span></div>`;
  }).join('');
}

function renderErrors(errors) {
  if (!errors || errors.length === 0) return '';
  return errors.map(e =>
    `<div class="alert alert-error">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <span>${escapeHtml(e)}</span>
    </div>`
  ).join('');
}

function tableRow(label, value, highlight) {
  const safeLabel = escapeHtml(String(label));
  const safeValue = escapeHtml(String(value));
  return `<tr${highlight ? ' class="highlight"' : ''}><th>${safeLabel}</th><td>${safeValue}</td></tr>`;
}

const _escapeDiv = document.createElement('div');
function escapeHtml(str) {
  _escapeDiv.textContent = str;
  return _escapeDiv.innerHTML;
}

// --- Render full results ----------------------------------------------------

function renderResults(result) {
  if (result.errors && result.errors.length > 0 && !result.outputs) {
    resultsContainer.innerHTML = renderErrors(result.errors);
    return;
  }

  const o  = result.outputs;
  const fu = o.flow_unit;
  const au = o.area_unit;
  const hu = o.heat_unit;

  let html = '';
  html += renderWarnings(result.warnings);
  html += renderErrors(result.errors);

  // --- Compliance summary (actual vs required) ---
  if (o.actual_venting && o.governing) {
    const av = o.actual_venting;
    const ad = av.adequacy;
    const allPass = ad.normal_out && ad.emergency_out && ad.inbreathing;
    const headerCls = allPass ? 'all-pass' : 'has-fail';
    const headerIcon = allPass
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5 8.5l2 2 4-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    const headerLabel = allPass
      ? 'All Venting Requirements Met'
      : 'Venting Deficiency Detected — Review Required';

    const passIcon = '<svg class="status-pass" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6 9.5l2 2 4-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const failIcon = '<svg class="status-fail" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

    const rows = [];
    if (o.normal_venting && o.normal_venting.totals) {
      rows.push({
        label:    'Normal Outbreathing',
        required: fmtVal(o.normal_venting.totals.total_outbreathing, fu),
        actual:   fmtVal(av.actual_normal_outbreathing, fu),
        pass:     ad.normal_out,
      });
    }
    rows.push({
      label:    'Emergency Outbreathing',
      required: fmtVal(o.governing.governing_outbreathing, fu),
      actual:   fmtVal(av.actual_emergency_outbreathing, fu),
      pass:     ad.emergency_out,
    });
    rows.push({
      label:    'Inbreathing (Vacuum)',
      required: fmtVal(o.governing.governing_inbreathing, fu),
      actual:   fmtVal(av.actual_inbreathing, fu),
      pass:     ad.inbreathing,
    });

    html += `
      <div class="compliance-summary">
        <div class="compliance-header ${headerCls}">${headerIcon} ${headerLabel}</div>
        <div class="compliance-row-header">
          <span>Requirement</span><span>Required</span><span>Actual</span><span></span>
        </div>
        <div class="compliance-rows">
          ${rows.map(r => `
            <div class="compliance-row">
              <span class="cr-label">${escapeHtml(r.label)}</span>
              <span class="cr-value required">${escapeHtml(r.required)}</span>
              <span class="cr-value ${r.pass ? 'actual-pass' : 'actual-fail'}">${escapeHtml(r.actual)}</span>
              <span class="cr-status">${r.pass ? passIcon : failIcon}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  if (o.governing) {
    html += `
      <div class="result-section governing-box">
        <h3>Governing Requirements</h3>
        <table class="result-table">
          ${tableRow('Governing Outbreathing (pressure)', fmtVal(o.governing.governing_outbreathing, fu))}
          ${tableRow('Governing Inbreathing (vacuum)',    fmtVal(o.governing.governing_inbreathing, fu))}
          ${tableRow('Emergency Governs?', o.governing.emergency_governs ? 'Yes — Fire case controls outbreathing' : 'No — Normal venting controls')}
        </table>
      </div>`;
  }

  if (o.normal_venting) {
    const nv = o.normal_venting;
    html += `
      <div class="result-section">
        <h3>Normal Venting — Thermal Breathing</h3>
        <table class="result-table">
          ${tableRow('Thermal Inbreathing',  fmtVal(nv.thermal.inbreathing, fu))}
          ${tableRow('Thermal Outbreathing', fmtVal(nv.thermal.outbreathing, fu))}
          ${tableRow('Insulation Factor',    fmtVal(nv.thermal.insulation_factor))}
          ${tableRow('Latitude Zone',        nv.thermal.latitude_zone.replace(/_/g, ' '))}
        </table>
      </div>
      <div class="result-section">
        <h3>Normal Venting — Operational Breathing</h3>
        <table class="result-table">
          ${tableRow('Operational Inbreathing',   fmtVal(nv.operational.inbreathing, fu))}
          ${tableRow('Operational Outbreathing',  fmtVal(nv.operational.outbreathing, fu))}
          ${tableRow('Vaporisation Component',    fmtVal(nv.operational.vaporisation_component, fu))}
          ${tableRow('Is Volatile?',              nv.operational.is_volatile ? 'Yes' : 'No')}
        </table>
      </div>
      <div class="result-section">
        <h3>Normal Venting — Totals</h3>
        <table class="result-table">
          ${tableRow('Total Normal Inbreathing',  fmtVal(nv.totals.total_inbreathing, fu),  true)}
          ${tableRow('Total Normal Outbreathing', fmtVal(nv.totals.total_outbreathing, fu), true)}
        </table>
      </div>`;
  }

  if (o.emergency_venting) {
    const ev = o.emergency_venting;
    let evRows = '';
    if (ev.wetted_area != null)
      evRows += tableRow('Wetted Area', fmtVal(ev.wetted_area, au));
    if (ev.wetted_area_method)
      evRows += tableRow('Calculation Method', ev.wetted_area_method);
    if (ev.heat_input != null)
      evRows += tableRow('Heat Input', fmtVal(ev.heat_input, hu));
    if (ev.F_factor != null)
      evRows += tableRow('Environmental Factor (F)', fmtVal(ev.F_factor));
    if (ev.emergency_outbreathing != null)
      evRows += tableRow('Emergency Outbreathing', fmtVal(ev.emergency_outbreathing, fu), true);
    if (ev.vapour_mass_flow != null)
      evRows += tableRow('Vapour Mass Flow', fmtVal(ev.vapour_mass_flow, 'kg/hr'));

    if (evRows) {
      html += `
        <div class="result-section">
          <h3>Emergency Venting — Fire Case</h3>
          <table class="result-table">${evRows}</table>
        </div>`;
    }
  }

  if (o.actual_venting && o.actual_venting.devices && o.actual_venting.devices.length > 0) {
    const devs = o.actual_venting.devices;
    const typeLabels = { PVRV: 'PVRV', EPRV: 'EPRV', FREE_VENT: 'Free Vent' };
    const typeCls    = { PVRV: 'pvrv', EPRV: 'eprv', FREE_VENT: 'free-vent' };

    // --- Per-device flame-arrestor breakdown (only if at least one is attached) ---
    const arrestorDevs = devs.filter(d => d.arrestor);
    if (arrestorDevs.length > 0) {
      const badgeCls = { PASS: 'pass', WARN: 'warn', FAIL: 'fail' };
      html += `
        <div class="result-section">
          <h3>Flame Arrestor — Pressure Drop &amp; Budget (ISO 16852)</h3>
          <table class="arrestor-results-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>ΔP (mbar)</th>
                <th>ΔP (inH₂O)</th>
                <th>% of Budget</th>
                <th>Eff. Flow</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${devs.map((d, i) => {
                if (!d.arrestor) return '';
                const a  = d.arrestor;
                const bc = badgeCls[a.badge] || 'pass';
                return `<tr>
                  <td>#${i + 1} — ${escapeHtml(typeLabels[d.type] || d.type)}</td>
                  <td>${fmtVal(a.deltaP_mbar, 'mbar')}</td>
                  <td>${fmtVal(a.deltaP_inH2O, 'inH₂O')}</td>
                  <td>${fmtVal(a.budget_pct, '%')}</td>
                  <td>${fmtVal(a.effective_flow, fu)}</td>
                  <td><span class="fa-badge ${bc}">${escapeHtml(a.badge)}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    html += `
      <div class="device-breakdown">
        <h3>Installed Device Contributions at Relieving Pressure</h3>
        <table class="device-breakdown-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Type</th>
              <th>Direction</th>
              <th>Outbreathing</th>
              <th>Inbreathing</th>
            </tr>
          </thead>
          <tbody>
            ${devs.map((d, i) => {
              const tLabel   = typeLabels[d.type] || d.type;
              const tCls     = typeCls[d.type]   || '';
              const dirLabel = d.direction === 'BOTH' ? 'Both' : d.direction === 'OUTBREATHING' ? 'Pressure' : 'Vacuum';
              return `<tr>
                <td>${i + 1}</td>
                <td><span class="type-badge ${tCls}">${escapeHtml(tLabel)}</span></td>
                <td>${escapeHtml(dirLabel)}</td>
                <td class="mono-val">${d.flow_out != null && d.flow_out > 0 ? fmtVal(d.flow_out, fu) : '—'}</td>
                <td class="mono-val">${d.flow_in  != null && d.flow_in  > 0 ? fmtVal(d.flow_in,  fu) : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="font-weight:700; border-top: 2px solid var(--gray-200);">
              <td colspan="3" style="text-align:right; color:var(--gray-600);">Total Installed Capacity</td>
              <td class="mono-val">${fmtVal(o.actual_venting.actual_emergency_outbreathing, fu)}</td>
              <td class="mono-val">${fmtVal(o.actual_venting.actual_inbreathing, fu)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  if (result.intermediates) {
    const im = result.intermediates;
    html += `
      <div class="result-section">
        <div class="collapsible-toggle" data-collapsible>
          <h3 style="margin:0;">Intermediates (SI Audit Trail)</h3>
          <span class="arrow">&#9654;</span>
        </div>
        <div class="collapsible-body">
          <table class="result-table">
            ${tableRow('Volume',                      fmtVal(im.volume_m3, 'm³'))}
            ${tableRow('MAWP',                        fmtVal(im.mawp_kpa, 'kPa(g)'))}
            ${tableRow('MAWV',                        fmtVal(im.mawv_kpa, 'kPa(g)'))}
            ${tableRow('Fill Rate',                   fmtVal(im.fill_rate_m3hr, 'm³/hr'))}
            ${tableRow('Empty Rate',                  fmtVal(im.empty_rate_m3hr, 'm³/hr'))}
            ${tableRow('Flash Point',                 fmtVal(im.flash_point_C, '°C'))}
            ${tableRow('Latent Heat',                 fmtVal(im.latent_heat_J_kg, 'J/kg'))}
            ${tableRow('Relieving Pressure',          fmtVal(im.relieving_pressure_kpa_a, 'kPa(a)'))}
            ${tableRow('Relieving Temperature',       fmtVal(im.relieving_temp_C, '°C'))}
            ${tableRow('Thermal Bare Inbreathing',    fmtVal(im.thermal_bare_in_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Thermal Bare Outbreathing',   fmtVal(im.thermal_bare_out_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Insulation Factor',           fmtVal(im.insulation_factor))}
            ${im.wetted_area_m2 != null ? tableRow('Wetted Area', fmtVal(im.wetted_area_m2, 'm²')) : ''}
            ${im.heat_input_W  != null ? tableRow('Heat Input',  fmtVal(im.heat_input_W, 'W'))    : ''}
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
  const payload = assemblePayload();
  const result = window.API2000.runCalculation(payload);
  renderResults(result);
});
