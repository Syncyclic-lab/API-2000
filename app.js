// ============================================================
// public/app.js  â  API 2000 Venting Calculator Frontend
// Gathers form inputs, assembles the JSON payload per
// input.schema.json, calls the backend, and renders
// formatted results.
// ============================================================

'use strict';

// ââ Unit label maps (keyed by unit system) âââââââââââââââââââââââââââââââââââ

const UNITS = {
  SI: {
    vol: 'mÂ³', dim: 'm', press: 'kPa(g)', temp: 'Â°C',
    vp: 'kPa(a)', fill: 'mÂ³/hr', heat: 'J/kg',
    insulThick: 'mm', insulK: 'W/(mÂ·K)', insulH: 'W/(mÂ²Â·K)',
    area: 'mÂ²', flow: 'NmÂ³/hr', heatRate: 'W',
    pipeDiam: 'mm',
  },
  US: {
    vol: 'BBL', dim: 'ft', press: 'psi(g)', temp: 'Â°F',
    vp: 'psia', fill: 'BPH', heat: 'BTU/lb',
    insulThick: 'in', insulK: 'BTUÂ·in/(hrÂ·ftÂ²Â·Â°F)', insulH: 'BTU/(hrÂ·ftÂ²Â·Â°F)',
    area: 'ftÂ²', flow: 'SCFH', heatRate: 'BTU/hr',
    pipeDiam: 'in',
  },
};

// Map of CSS class â UNITS key for dynamic label swapping
const UNIT_CLASS_MAP = {
  'vol-unit':        'vol',
  'dim-unit':        'dim',
  'press-unit':      'press',
  'temp-unit':       'temp',
  'vp-unit':         'vp',
  'fill-unit':       'fill',
  'heat-unit':       'heat',
  'insul-thick-unit':'insulThick',
  'insul-k-unit':    'insulK',
  'insul-h-unit':    'insulH',
  'area-unit':       'area',
  'flow-unit':       'flow',
  'pipe-diam-unit':  'pipeDiam',
};

// ââ DOM References âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const $  = (id) => document.getElementById(id);
const form              = $('calcForm');
const disclaimerCheck   = $('disclaimerCheck');
const calcBtn           = $('calcBtn');
const resultsContainer  = $('resultsContainer');
const insulationType    = $('insulationType');
const insulationFields  = $('insulationFields');
const coverageField     = $('coverageFractionField');
const unitSystemSelect  = $('unitSystem');

// ââ Tab Switching ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

document.querySelectorAll('.tab-button').forEach(btn => {
  btn.addEventListener('click', () => {
    // Deactivate all tab buttons
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    // Deactivate all tab content panes
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    // Activate clicked button and its target pane
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

// ââ Actual Venting Device Management âââââââââââââââââââââââââââââââââââââââââ

const btnAddDevice = $('btnAddDevice');
const deviceRoster = $('deviceRoster');
let deviceIdCounter = 0;

/**
 * renderDeviceRow()  â  Phase 2 (Step 2.3)
 * Injects a new device card into the DOM with all required fields.
 * Fields conditionally show/hide based on the selected relief direction.
 */
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
        <div class="hint">Typical range: 0.3â0.8 for pipe fittings</div>
      </div>
    </div>
  `;

  deviceRoster.appendChild(card);
  applyTypeVisibility(card);
  updateUnitLabels(card);
  renumberDeviceCards();
}

/**
 * applyDirectionVisibility()
 * Shows or hides set-pressure, set-vacuum, and flow fields based on the
 * currently selected relief direction for a given device card.
 */
function applyDirectionVisibility(card) {
  const dir  = card.querySelector('.dev-direction').value;
  const type = card.querySelector('.dev-type').value;
  const capSrc = card.querySelector('.dev-cap-src:checked')?.value || 'manufacturer';
  const isCalcFreeVent = type === 'FREE_VENT' && capSrc === 'calculated';

  const showPressure = dir === 'BOTH' || dir === 'OUTBREATHING';
  const showVacuum   = dir === 'BOTH' || dir === 'INBREATHING';

  // Free vents have no set pressure / set vacuum / overpressure
  const showSetP = showPressure && type !== 'FREE_VENT';
  const showSetV = showVacuum   && type !== 'FREE_VENT';
  card.querySelector('.dev-field-sp').style.display       = showSetP ? '' : 'none';
  card.querySelector('.dev-field-sv').style.display       = showSetV ? '' : 'none';
  card.querySelector('.dev-field-overpressure').style.display = showSetP ? '' : 'none';

  // Rated flow fields: only for manufacturer-rated devices
  card.querySelector('.dev-field-flow-out').style.display = (showPressure && !isCalcFreeVent) ? '' : 'none';
  card.querySelector('.dev-field-flow-in').style.display  = (showVacuum && !isCalcFreeVent)   ? '' : 'none';

  // Pipe geometry fields: only for calculated free vents
  card.querySelector('.dev-field-pipe-diam').style.display = isCalcFreeVent ? '' : 'none';
  card.querySelector('.dev-field-cd').style.display        = isCalcFreeVent ? '' : 'none';
}

/**
 * applyTypeVisibility()
 * Shows or hides type-specific fields (capacity source radio) when device
 * type changes, and re-runs direction visibility to update dependent fields.
 */
function applyTypeVisibility(card) {
  const type = card.querySelector('.dev-type').value;
  const isFreeVent = type === 'FREE_VENT';

  card.querySelector('.dev-field-capacity-source').style.display = isFreeVent ? '' : 'none';

  // Reset to manufacturer if switching away from FREE_VENT
  if (!isFreeVent) {
    const mfgRadio = card.querySelector('.dev-cap-src[value="manufacturer"]');
    if (mfgRadio) mfgRadio.checked = true;
  }

  applyDirectionVisibility(card);
  updateFluidFieldsVisibility();
}

/**
 * renumberDeviceCards()
 * Re-labels the visible device cards sequentially (Device #1, #2, â¦)
 * after any addition or removal so numbering stays tidy.
 */
function renumberDeviceCards() {
  const cards = deviceRoster.querySelectorAll('.device-card');
  cards.forEach((card, idx) => {
    card.querySelector('.device-label').textContent = `Device #${idx + 1}`;
  });
}

/**
 * collectDeviceData()  â  Phase 2 (Step 2.3)
 * Scrapes every device card in the DOM and returns a clean array of
 * device objects suitable for the calculation payload.
 */
function collectDeviceData() {
  const devices = [];
  deviceRoster.querySelectorAll('.device-card').forEach(card => {
    const dir  = card.querySelector('.dev-direction').value;
    const type = card.querySelector('.dev-type').value;

    const device = { type, direction: dir };

    // Capacity source for FREE_VENT
    if (type === 'FREE_VENT') {
      const capSrc = card.querySelector('.dev-cap-src:checked')?.value || 'manufacturer';
      device.capacity_source = capSrc;

      if (capSrc === 'calculated') {
        const pd = parseFloat(card.querySelector('.dev-pipe-diam').value);
        if (!isNaN(pd)) device.pipe_diameter = pd;

        const cd = parseFloat(card.querySelector('.dev-cd').value);
        if (!isNaN(cd)) device.discharge_coefficient = cd;

        // Pull k and Zi from fluid section
        const kVal = num('fluidK');
        if (kVal != null) device.specific_heat_ratio = kVal;
        const ziVal = num('fluidZi');
        if (ziVal != null) device.compressibility_factor = ziVal;
      }
    }

    // Only collect fields that are relevant to the selected direction
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

    devices.push(device);
  });
  return devices;
}

/**
 * updateFluidFieldsVisibility()
 * Shows the k and Zi fluid fields only when at least one device uses
 * calculated pipe-geometry capacity, to avoid confusing users otherwise.
 */
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

// Event delegation for device roster: remove cards, direction & type changes
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
});

btnAddDevice.addEventListener('click', renderDeviceRow);

// Add one device by default to prompt the user
renderDeviceRow();

// ââ Unit label updater âââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function updateUnitLabels(scope) {
  const root = scope || document;
  const us = unitSystemSelect.value;
  const units = UNITS[us];
  for (const [cls, key] of Object.entries(UNIT_CLASS_MAP)) {
    root.querySelectorAll(`.${cls}`).forEach(el => {
      el.textContent = units[key];
    });
  }
}

unitSystemSelect.addEventListener('change', () => updateUnitLabels());
updateUnitLabels(); // initial run

// ââ Disclaimer toggle ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

disclaimerCheck.addEventListener('change', () => {
  calcBtn.disabled = !disclaimerCheck.checked;
});

// ââ Insulation visibility toggle âââââââââââââââââââââââââââââââââââââââââââââ

insulationType.addEventListener('change', () => {
  const show = insulationType.value !== 'UNINSULATED';
  insulationFields.classList.toggle('visible', show);
  coverageField.style.display =
    insulationType.value === 'PARTIALLY_INSULATED' ? '' : 'none';
});

// ââ Auto-determine volatility from vapor pressure ââââââââââââââââââââââââââââ

const volatilityIndicator = $('volatilityIndicator');
const vaporPressureInput  = $('vaporPressure');

function updateVolatilityIndicator() {
  const us = unitSystemSelect.value;
  const vp = parseFloat(vaporPressureInput.value);
  if (isNaN(vp) || vp === 0) {
    volatilityIndicator.textContent = 'Enter vapor pressure';
    volatilityIndicator.className = 'volatility-badge neutral';
    return;
  }
  const OP = window.API2000.OPERATIONAL;
  const threshold = us === 'SI' ? OP.VOLATILE_VP_THRESHOLD_KPA : OP.VOLATILE_VP_THRESHOLD_PSIA;
  const isVolatile = vp > threshold;
  const threshLabel = us === 'SI' ? '5 kPa' : '0.725 psia';
  if (isVolatile) {
    volatilityIndicator.textContent = `Volatile (VP > ${threshLabel})`;
    volatilityIndicator.className = 'volatility-badge volatile';
  } else {
    volatilityIndicator.textContent = `Non-Volatile (VP â¤ ${threshLabel})`;
    volatilityIndicator.className = 'volatility-badge non-volatile';
  }
}

vaporPressureInput.addEventListener('input', updateVolatilityIndicator);
unitSystemSelect.addEventListener('change', updateVolatilityIndicator);
updateVolatilityIndicator(); // initial run

// ââ Helper: read numeric input (returns undefined if blank) ââââââââââââââââââ

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
function bool(id) {
  return $(id).checked;
}

// ââ Assemble payload âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function assemblePayload() {
  const us = unitSystemSelect.value;

  // Meta
  const meta = {
    disclaimer_accepted: true, // enforced by the checkbox gate
    unit_system: us,
  };
  if (str('tagNumber'))   meta.tag_number   = str('tagNumber');
  if (str('projectName')) meta.project_name  = str('projectName');
  if (str('preparedBy'))  meta.prepared_by   = str('preparedBy');

  // Tank
  const tank = {
    shape:  $('tankShape').value,
    volume: num('tankVolume'),
    mawp:   num('tankMAWP'),
    mawv:   num('tankMAWV'),
  };
  const dia = num('tankDiameter');
  const hgt = num('tankHeight');
  const cra = num('coneRoofAngle');
  if (dia != null || hgt != null) {
    tank.dimensions = {};
    if (dia != null) tank.dimensions.diameter = dia;
    if (hgt != null) tank.dimensions.height_or_length = hgt;
    if (cra != null) tank.dimensions.cone_roof_angle = cra;
  }
  const elev = num('tankElevation');
  if (elev != null) tank.elevation_above_grade = elev;

  // Fluid
  // API 2000 Â§6.3.2: volatile if VP > 5 kPa (â 0.725 psia)
  const vp = num('vaporPressure');
  const OPS = window.API2000.OPERATIONAL;
  const volatilityThreshold = us === 'SI' ? OPS.VOLATILE_VP_THRESHOLD_KPA : OPS.VOLATILE_VP_THRESHOLD_PSIA;
  const isVolatile = (vp != null && vp > volatilityThreshold);

  const fluid = {
    is_volatile:    isVolatile,
    vapor_pressure: vp,
    max_fill_rate:  num('maxFillRate'),
    max_empty_rate: num('maxEmptyRate'),
  };
  const fluidName = str('fluidName');
  if (fluidName)                       fluid.name = fluidName;
  const operTemp = num('operatingTemp');
  if (operTemp != null)                fluid.normal_operating_temp = operTemp;
  const latent = num('latentHeat');
  if (latent != null)                  fluid.latent_heat_of_vaporization = latent;
  const molWt = num('molWeight');
  if (molWt != null)                   fluid.molecular_weight = molWt;
  const relTemp = num('relievingTemp');
  if (relTemp != null)                 fluid.relieving_vapor_temp = relTemp;
  const flash = num('flashPoint');
  if (flash != null)                   fluid.flash_point = flash;
  const sg = num('specificGravity');
  if (sg != null)                      fluid.specific_gravity = sg;
  const kVal = num('fluidK');
  if (kVal != null)                    fluid.specific_heat_ratio = kVal;
  const ziVal = num('fluidZi');
  if (ziVal != null)                   fluid.compressibility_factor = ziVal;

  // Environment
  const environment = {
    latitude_zone:   $('latitudeZone').value,
    insulation_type: insulationType.value,
  };
  if (insulationType.value !== 'UNINSULATED') {
    const ins = {};
    const thick = num('insulThickness');
    if (thick != null)                    ins.thickness = thick;
    const surfA = num('insulSurfArea');
    if (surfA != null)                    ins.surface_area = surfA;
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
    control_valve_failure:          bool('ab_controlValve'),
    blanket_gas_equipment_failure:  bool('ab_blanketGas'),
    abnormal_heat_transfer:         bool('ab_abnormalHeat'),
    internal_heat_exchanger_failure:bool('ab_heatExchanger'),
    uninsulated_hot_tank_in_rain:   bool('ab_hotTankRain'),
    exothermic_reaction:            bool('ab_exothermic'),
    mixing_of_products:             bool('ab_mixing'),
    liquid_overfill:                bool('ab_overfill'),
    pressure_transfer_vapor_breakthrough: bool('ab_vaporBreak'),
    atmospheric_pressure_change:    bool('ab_atmChange'),
  };

  // Calculation options
  const calculation_options = {
    include_emergency_fire_case: bool('opt_fireCaseEnabled'),
    use_simplified_fire_table:   bool('opt_simplifiedTable'),
    credit_for_drainage:         bool('opt_drainage'),
    credit_for_fireproofing:     bool('opt_fireproofing'),
  };
  const manualWA = num('manualWettedArea');
  if (manualWA != null) calculation_options.manual_wetted_area_override = manualWA;

  // Collect installed venting devices from the Actual Venting tab
  const devices = collectDeviceData();

  return { meta, tank, fluid, environment, abnormal_scenarios, calculation_options, devices };
}

// ââ Render helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function fmtVal(v, unit) {
  if (v == null || v === '') return 'â';
  return `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${unit || ''}`.trim();
}

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) return '';
  return warnings.map(w => {
    const isWarn = w.startsWith('WARNING');
    const cls = isWarn ? 'alert-error' : 'alert-warn';
    const icon = isWarn
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l6.5 12H1.5L8 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v3M8 11.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    return `<div class="alert ${cls}">${icon}<span>${escapeHtml(w)}</span></div>`;
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

// ââ Render full results âââââââââââââââââââââââââââââââââââââââââââââââââââââ

function renderResults(result) {
  // Handle error-only responses
  if (result.errors && result.errors.length > 0 && !result.outputs) {
    resultsContainer.innerHTML = renderErrors(result.errors);
    return;
  }

  const o  = result.outputs;
  const fu = o.flow_unit;
  const au = o.area_unit;
  const hu = o.heat_unit;

  let html = '';

  // Warnings & errors
  html += renderWarnings(result.warnings);
  html += renderErrors(result.errors);

  // ââ Phase 5: Compliance Summary Dashboard âââââââââââââââââââââââââââââââ
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
      : 'Venting Deficiency Detected â Review Required';

    const passIcon = '<svg class="status-pass" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6 9.5l2 2 4-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const failIcon = '<svg class="status-fail" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

    // Build comparison rows
    const rows = [];

    // Normal outbreathing: required = normal total, actual = actual normal
    if (o.normal_venting && o.normal_venting.totals) {
      rows.push({
        label:    'Normal Outbreathing',
        required: fmtVal(o.normal_venting.totals.total_outbreathing, fu),
        actual:   fmtVal(av.actual_normal_outbreathing, fu),
        pass:     ad.normal_out,
      });
    }

    // Emergency outbreathing: required = governing outbreathing, actual = actual emergency
    rows.push({
      label:    'Emergency Outbreathing',
      required: fmtVal(o.governing.governing_outbreathing, fu),
      actual:   fmtVal(av.actual_emergency_outbreathing, fu),
      pass:     ad.emergency_out,
    });

    // Inbreathing: required = governing inbreathing, actual = actual inbreathing
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

  // Governing requirements (featured prominently)
  if (o.governing) {
    html += `
      <div class="result-section governing-box">
        <h3>Governing Requirements</h3>
        <table class="result-table">
          ${tableRow('Governing Outbreathing (pressure)', fmtVal(o.governing.governing_outbreathing, fu))}
          ${tableRow('Governing Inbreathing (vacuum)', fmtVal(o.governing.governing_inbreathing, fu))}
          ${tableRow('Emergency Governs?', o.governing.emergency_governs ? 'Yes â Fire case controls outbreathing' : 'No â Normal venting controls')}
        </table>
      </div>`;
  }

  // Normal venting â Thermal
  if (o.normal_venting) {
    const nv = o.normal_venting;
    html += `
      <div class="result-section">
        <h3>Normal Venting â Thermal Breathing</h3>
        <table class="result-table">
          ${tableRow('Thermal Inbreathing', fmtVal(nv.thermal.inbreathing, fu))}
          ${tableRow('Thermal Outbreathing', fmtVal(nv.thermal.outbreathing, fu))}
          ${tableRow('Insulation Factor', fmtVal(nv.thermal.insulation_factor))}
          ${tableRow('Latitude Zone', nv.thermal.latitude_zone.replace(/_/g, ' '))}
        </table>
      </div>`;

    // Normal venting â Operational
    html += `
      <div class="result-section">
        <h3>Normal Venting â Operational Breathing</h3>
        <table class="result-table">
          ${tableRow('Operational Inbreathing', fmtVal(nv.operational.inbreathing, fu))}
          ${tableRow('Operational Outbreathing', fmtVal(nv.operational.outbreathing, fu))}
          ${tableRow('Vaporisation Component', fmtVal(nv.operational.vaporisation_component, fu))}
          ${tableRow('Is Volatile?', nv.operational.is_volatile ? 'Yes' : 'No')}
        </table>
      </div>`;

    // Normal venting â Totals
    html += `
      <div class="result-section">
        <h3>Normal Venting â Totals</h3>
        <table class="result-table">
          ${tableRow('Total Normal Inbreathing', fmtVal(nv.totals.total_inbreathing, fu), true)}
          ${tableRow('Total Normal Outbreathing', fmtVal(nv.totals.total_outbreathing, fu), true)}
        </table>
      </div>`;
  }

  // Emergency venting
  if (o.emergency_venting) {
    const ev = o.emergency_venting;
    let evRows = '';
    if (ev.wetted_area != null)
      evRows += tableRow('Wetted Area', fmtVal(ev.wetted_area, au));
    if (ev.raw_wetted_area != null && ev.raw_wetted_area !== ev.wetted_area)
      evRows += tableRow('Raw Wetted Area (before cap)', fmtVal(ev.raw_wetted_area, au));
    if (ev.wetted_area_capped != null)
      evRows += tableRow('Wetted Area Capped?', ev.wetted_area_capped ? 'Yes' : 'No');
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
          <h3>Emergency Venting â Fire Case</h3>
          <table class="result-table">${evRows}</table>
        </div>`;
    }
  }

  // ââ Phase 5.3: Installed Device Breakdown ââââââââââââââââââââââââââââââ
  if (o.actual_venting && o.actual_venting.devices && o.actual_venting.devices.length > 0) {
    const devs = o.actual_venting.devices;
    const typeLabels = { PVRV: 'PVRV', EPRV: 'EPRV', FREE_VENT: 'Free Vent' };
    const typeCls    = { PVRV: 'pvrv', EPRV: 'eprv', FREE_VENT: 'free-vent' };

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
              const tLabel = typeLabels[d.type] || d.type;
              const tCls   = typeCls[d.type]   || '';
              const dirLabel = d.direction === 'BOTH' ? 'Both' : d.direction === 'OUTBREATHING' ? 'Pressure' : 'Vacuum';
              return `<tr>
                <td>${i + 1}</td>
                <td><span class="type-badge ${tCls}">${escapeHtml(tLabel)}</span></td>
                <td>${escapeHtml(dirLabel)}</td>
                <td class="mono-val">${d.flow_out != null && d.flow_out > 0 ? fmtVal(d.flow_out, fu) : 'â'}</td>
                <td class="mono-val">${d.flow_in != null && d.flow_in > 0 ? fmtVal(d.flow_in, fu) : 'â'}</td>
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

  // Intermediates (collapsible)
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
            ${tableRow('Volume', fmtVal(im.volume_m3, 'mÂ³'))}
            ${tableRow('MAWP', fmtVal(im.mawp_kpa, 'kPa(g)'))}
            ${tableRow('MAWV', fmtVal(im.mawv_kpa, 'kPa(g)'))}
            ${tableRow('Allowable Overpressure', fmtVal(im.allowable_overpressure_pct, '%'))}
            ${tableRow('Fill Rate', fmtVal(im.fill_rate_m3hr, 'mÂ³/hr'))}
            ${tableRow('Empty Rate', fmtVal(im.empty_rate_m3hr, 'mÂ³/hr'))}
            ${tableRow('Vapor Pressure', fmtVal(im.vapor_pressure_kpa, 'kPa(a)'))}
            ${tableRow('Latent Heat', fmtVal(im.latent_heat_J_kg, 'J/kg'))}
            ${tableRow('Relieving Pressure', fmtVal(im.relieving_pressure_kpa_a, 'kPa(a)'))}
            ${tableRow('Relieving Temperature', fmtVal(im.relieving_temp_C, 'Â°C'))}
            ${tableRow('Thermal Bare Inbreathing', fmtVal(im.thermal_bare_in_Nm3hr, 'NmÂ³/hr'))}
            ${tableRow('Thermal Bare Outbreathing', fmtVal(im.thermal_bare_out_Nm3hr, 'NmÂ³/hr'))}
            ${tableRow('Insulation Factor', fmtVal(im.insulation_factor))}
            ${im.wetted_area_m2 != null ? tableRow('Wetted Area', fmtVal(im.wetted_area_m2, 'mÂ²')) : ''}
            ${im.heat_input_W != null ? tableRow('Heat Input', fmtVal(im.heat_input_W, 'W')) : ''}
          </table>
        </div>
      </div>`;
  }

  resultsContainer.innerHTML = html;

  // ââ Wire up collapsible toggles ââââââââââââââââââââââââââââââââââââââââââ
  resultsContainer.querySelectorAll('[data-collapsible]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      toggle.nextElementSibling.classList.toggle('open');
    });
  });
}

// ââ Form submission ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = assemblePayload();
  const result = window.API2000.runCalculation(payload);
  renderResults(result);
});
