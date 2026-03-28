// ============================================================
// public/app.js  –  API 2000 Venting Calculator Frontend
// Gathers form inputs, assembles the JSON payload per
// input.schema.json, calls the backend, and renders
// formatted results.
// ============================================================

'use strict';

// ── Unit label maps (keyed by unit system) ───────────────────────────────────

const UNITS = {
  SI: {
    vol: 'm³', dim: 'm', press: 'kPa(g)', temp: '°C',
    vp: 'kPa(a)', fill: 'm³/hr', heat: 'J/kg',
    insulThick: 'mm', insulK: 'W/(m·K)', insulH: 'W/(m²·K)',
    area: 'm²', flow: 'Nm³/hr', heatRate: 'W',
  },
  US: {
    vol: 'BBL', dim: 'ft', press: 'psi(g)', temp: '°F',
    vp: 'psia', fill: 'BPH', heat: 'BTU/lb',
    insulThick: 'in', insulK: 'BTU·in/(hr·ft²·°F)', insulH: 'BTU/(hr·ft²·°F)',
    area: 'ft²', flow: 'SCFH', heatRate: 'BTU/hr',
  },
};

// Map of CSS class → UNITS key for dynamic label swapping
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
};

// ── DOM References ───────────────────────────────────────────────────────────

const $  = (id) => document.getElementById(id);
const form              = $('calcForm');
const disclaimerCheck   = $('disclaimerCheck');
const calcBtn           = $('calcBtn');
const resultsContainer  = $('resultsContainer');
const insulationType    = $('insulationType');
const insulationFields  = $('insulationFields');
const coverageField     = $('coverageFractionField');
const unitSystemSelect  = $('unitSystem');

// ── Unit label updater ───────────────────────────────────────────────────────

function updateUnitLabels() {
  const us = unitSystemSelect.value;
  const units = UNITS[us];
  for (const [cls, key] of Object.entries(UNIT_CLASS_MAP)) {
    document.querySelectorAll(`.${cls}`).forEach(el => {
      el.textContent = units[key];
    });
  }
}

unitSystemSelect.addEventListener('change', updateUnitLabels);
updateUnitLabels(); // initial run

// ── Disclaimer toggle ────────────────────────────────────────────────────────

disclaimerCheck.addEventListener('change', () => {
  calcBtn.disabled = !disclaimerCheck.checked;
});

// ── Insulation visibility toggle ─────────────────────────────────────────────

insulationType.addEventListener('change', () => {
  const show = insulationType.value !== 'UNINSULATED';
  insulationFields.classList.toggle('visible', show);
  coverageField.style.display =
    insulationType.value === 'PARTIALLY_INSULATED' ? '' : 'none';
});

// ── Auto-determine volatility from vapor pressure ────────────────────────────

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
  const threshold = us === 'SI' ? 5.0 : 0.725;
  const isVolatile = vp > threshold;
  const threshLabel = us === 'SI' ? '5 kPa' : '0.725 psia';
  if (isVolatile) {
    volatilityIndicator.textContent = `Volatile (VP > ${threshLabel})`;
    volatilityIndicator.className = 'volatility-badge volatile';
  } else {
    volatilityIndicator.textContent = `Non-Volatile (VP ≤ ${threshLabel})`;
    volatilityIndicator.className = 'volatility-badge non-volatile';
  }
}

vaporPressureInput.addEventListener('input', updateVolatilityIndicator);
unitSystemSelect.addEventListener('change', updateVolatilityIndicator);
updateVolatilityIndicator(); // initial run

// ── Helper: read numeric input (returns undefined if blank) ──────────────────

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

// ── Assemble payload ─────────────────────────────────────────────────────────

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
  // API 2000 §6.3.2: volatile if VP > 5 kPa (≈ 0.725 psia)
  const vp = num('vaporPressure');
  const volatilityThreshold = us === 'SI' ? 5.0 : 0.725;
  const isVolatile = (vp != null && vp > volatilityThreshold);

  const fluid = {
    is_volatile:    isVolatile,
    vapor_pressure: vp,
    max_fill_rate:  num('maxFillRate'),
    max_empty_rate: num('maxEmptyRate'),
  };
  if (str('fluidName'))                fluid.name = str('fluidName');
  if (num('operatingTemp') != null)    fluid.normal_operating_temp = num('operatingTemp');
  if (num('latentHeat') != null)       fluid.latent_heat_of_vaporization = num('latentHeat');
  if (num('molWeight') != null)        fluid.molecular_weight = num('molWeight');
  if (num('relievingTemp') != null)    fluid.relieving_vapor_temp = num('relievingTemp');
  if (num('flashPoint') != null)       fluid.flash_point = num('flashPoint');
  if (num('specificGravity') != null)  fluid.specific_gravity = num('specificGravity');

  // Environment
  const environment = {
    latitude_zone:   $('latitudeZone').value,
    insulation_type: insulationType.value,
  };
  if (insulationType.value !== 'UNINSULATED') {
    const ins = {};
    if (num('insulThickness') != null)    ins.thickness = num('insulThickness');
    if (num('insulSurfArea') != null)     ins.surface_area = num('insulSurfArea');
    if (num('insulConductivity') != null) ins.thermal_conductivity = num('insulConductivity');
    if (num('insulHTC') != null)          ins.internal_heat_transfer_coefficient = num('insulHTC');
    if (insulationType.value === 'PARTIALLY_INSULATED' && num('coverageFraction') != null) {
      ins.coverage_fraction = num('coverageFraction');
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

  return { meta, tank, fluid, environment, abnormal_scenarios, calculation_options };
}

// ── Render helpers ───────────────────────────────────────────────────────────

function fmtVal(v, unit) {
  if (v == null || v === '') return '—';
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Render full results ──────────────────────────────────────────────────────

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

  // Governing requirements (featured prominently)
  if (o.governing) {
    html += `
      <div class="result-section governing-box">
        <h3>Governing Requirements</h3>
        <table class="result-table">
          ${tableRow('Governing Outbreathing (pressure)', fmtVal(o.governing.governing_outbreathing, fu))}
          ${tableRow('Governing Inbreathing (vacuum)', fmtVal(o.governing.governing_inbreathing, fu))}
          ${tableRow('Emergency Governs?', o.governing.emergency_governs ? 'Yes — Fire case controls outbreathing' : 'No — Normal venting controls')}
        </table>
      </div>`;
  }

  // Normal venting — Thermal
  if (o.normal_venting) {
    const nv = o.normal_venting;
    html += `
      <div class="result-section">
        <h3>Normal Venting — Thermal Breathing</h3>
        <table class="result-table">
          ${tableRow('Thermal Inbreathing', fmtVal(nv.thermal.inbreathing, fu))}
          ${tableRow('Thermal Outbreathing', fmtVal(nv.thermal.outbreathing, fu))}
          ${tableRow('Insulation Factor', fmtVal(nv.thermal.insulation_factor))}
          ${tableRow('Latitude Zone', nv.thermal.latitude_zone.replace(/_/g, ' '))}
        </table>
      </div>`;

    // Normal venting — Operational
    html += `
      <div class="result-section">
        <h3>Normal Venting — Operational Breathing</h3>
        <table class="result-table">
          ${tableRow('Operational Inbreathing', fmtVal(nv.operational.inbreathing, fu))}
          ${tableRow('Operational Outbreathing', fmtVal(nv.operational.outbreathing, fu))}
          ${tableRow('Vaporisation Component', fmtVal(nv.operational.vaporisation_component, fu))}
          ${tableRow('Is Volatile?', nv.operational.is_volatile ? 'Yes' : 'No')}
        </table>
      </div>`;

    // Normal venting — Totals
    html += `
      <div class="result-section">
        <h3>Normal Venting — Totals</h3>
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
          <h3>Emergency Venting — Fire Case</h3>
          <table class="result-table">${evRows}</table>
        </div>`;
    }
  }

  // Intermediates (collapsible)
  if (result.intermediates) {
    const im = result.intermediates;
    html += `
      <div class="result-section">
        <div class="collapsible-toggle" data-collapsible>
          <h3 style="margin:0;">Intermediates (SI Audit Trail)</h3>
          <span class="arrow">▶</span>
        </div>
        <div class="collapsible-body">
          <table class="result-table">
            ${tableRow('Volume', fmtVal(im.volume_m3, 'm³'))}
            ${tableRow('MAWP', fmtVal(im.mawp_kpa, 'kPa'))}
            ${tableRow('MAWV', fmtVal(im.mawv_kpa, 'kPa'))}
            ${tableRow('Fill Rate', fmtVal(im.fill_rate_m3hr, 'm³/hr'))}
            ${tableRow('Empty Rate', fmtVal(im.empty_rate_m3hr, 'm³/hr'))}
            ${tableRow('Vapor Pressure', fmtVal(im.vapor_pressure_kpa, 'kPa(a)'))}
            ${tableRow('Relieving Pressure', fmtVal(im.relieving_pressure_kpa_a, 'kPa(a)'))}
            ${tableRow('Relieving Temp', fmtVal(im.relieving_temp_C, '°C'))}
            ${tableRow('Thermal In', fmtVal(im.thermal_in_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Thermal Out', fmtVal(im.thermal_out_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Operational In', fmtVal(im.operational_in_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Operational Out', fmtVal(im.operational_out_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Total In', fmtVal(im.total_in_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Total Out', fmtVal(im.total_out_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Wetted Area', fmtVal(im.wetted_area_m2, 'm²'))}
            ${tableRow('Heat Input', fmtVal(im.heat_input_W, 'W'))}
            ${tableRow('Emergency Out', fmtVal(im.emergency_out_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Governing Out', fmtVal(im.governing_out_Nm3hr, 'Nm³/hr'))}
            ${tableRow('Governing In', fmtVal(im.governing_in_Nm3hr, 'Nm³/hr'))}
          </table>
        </div>
      </div>`;
  }

  // Engine info
  html += `
    <div style="margin-top:16px; font-size:0.75rem; color:#bdc1c6; text-align:right;">
      Engine v${result.engine_version || '—'} &bull; ${result.calculated_at ? new Date(result.calculated_at).toLocaleString() : ''}
    </div>`;

  resultsContainer.innerHTML = html;

  // Bind collapsible toggles (replaces inline onclick for CSP compliance)
  resultsContainer.querySelectorAll('[data-collapsible]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      toggle.nextElementSibling.classList.toggle('open');
    });
  });
}

// ── Render validation errors from server ─────────────────────────────────────

function renderValidationErrors(details) {
  const msgs = details.map(d => {
    const path = d.instancePath || d.dataPath || '';
    const msg  = d.message || 'Validation error';
    return `${path} ${msg}`.trim();
  });
  resultsContainer.innerHTML =
    `<div class="alert alert-error">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <div>
        <strong>Validation Failed</strong>
        <ul style="margin:6px 0 0 16px; font-size:0.83rem;">
          ${msgs.map(m => `<li>${escapeHtml(m)}</li>`).join('')}
        </ul>
      </div>
    </div>`;
}

// ── Form submission ──────────────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Set loading state
  calcBtn.disabled = true;
  calcBtn.innerHTML = '<span class="spinner"></span> Calculating…';
  resultsContainer.innerHTML = `
    <div class="results-placeholder">
      <span class="spinner" style="border-color:rgba(0,0,0,.1); border-top-color:#1a73e8; width:28px; height:28px; border-width:3px;"></span>
      <p style="margin-top:12px;">Running API 2000 calculations…</p>
    </div>`;

  try {
    const payload = assemblePayload();

    // Run calculation client-side (no server needed)
    const result = window.API2000.runCalculation(payload);
    renderResults(result);

  } catch (err) {
    resultsContainer.innerHTML = `
      <div class="alert alert-error">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span><strong>Request failed:</strong> ${escapeHtml(err.message)}</span>
      </div>`;
  } finally {
    calcBtn.innerHTML = 'Run Calculation';
    calcBtn.disabled = !disclaimerCheck.checked;
  }
});
