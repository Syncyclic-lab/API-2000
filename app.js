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
    heatRate: 'kW', massFlow: 'kg/h', density: 'kg/m³', pressRate: 'kPa/h', cp: 'J/(kg·K)',
  },
  US: {
    vol: 'BBL', dim: 'ft', press: 'psi(g)', temp: '°F',
    fill: 'BBL/h', heat: 'BTU/lb',
    insulThick: 'in', insulK: 'BTU·in/(h·ft²·°F)', insulH: 'BTU/(h·ft²·°F)',
    area: 'ft²', flow: 'SCFH', pipeDiam: 'in',
    heatRate: 'BTU/h', massFlow: 'lb/h', density: 'lb/ft³', pressRate: 'psi/h', cp: 'BTU/(lb·°F)',
  },
};

const UNIT_CLASS_MAP = {
  'heat-rate-unit':   'heatRate',
  'mass-flow-unit':   'massFlow',
  'density-unit':     'density',
  'press-rate-unit':  'pressRate',
  'cp-unit':          'cp',
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
const show = (el, visible) => { if (el) el.hidden = !visible; };
const form             = $('calcForm');
const disclaimerCheck  = $('disclaimerCheck');
const calcBtn          = $('calcBtn');
const resultsContainer = $('resultsContainer');
const insulationType   = $('insulationType');
const unitSystemSelect = $('unitSystem');
const ventMethod       = $('ventMethod');
const vaporPressure    = $('vaporPressureClass');

// --- Tab switching (WAI-ARIA tabs: roving tabindex, arrow/Home/End keys) -----

const tabButtons = [...document.querySelectorAll('[role="tab"]')];
function selectTab(btn, focus) {
  tabButtons.forEach(b => {
    const selected = b === btn;
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
    $(b.getAttribute('aria-controls')).hidden = !selected;
  });
  if (focus) btn.focus();
}
tabButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => selectTab(btn, false));
  btn.addEventListener('keydown', (e) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabButtons.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    selectTab(tabButtons[(next + tabButtons.length) % tabButtons.length], true);
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
      <td><button type="button" class="btn btn-secondary btn-small" data-fa-use-default="${key}" aria-label="Use default K ${row.k_default} for ${row.label}">Use</button></td>
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

  const uid = (name) => `dev${id}-${name}`;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-labelledby', uid('label'));

  card.innerHTML = `
    <div class="device-card-header">
      <span class="device-label" id="${uid('label')}">Device #${id}</span>
      <button type="button" class="btn-danger-link" data-remove-device="${id}" aria-describedby="${uid('label')}">Remove</button>
    </div>
    <div class="field-grid">
      <div class="field">
        <label for="${uid('type')}">Device type</label>
        <select class="dev-type" id="${uid('type')}">
          <option value="PVRV">Normal PVRV / breather valve</option>
          <option value="EPRV">Emergency relief valve (EPRV)</option>
          <option value="FREE_VENT">Free vent / gooseneck</option>
        </select>
      </div>
      <div class="field">
        <label for="${uid('dir')}">Relief direction</label>
        <select class="dev-direction" id="${uid('dir')}">
          <option value="BOTH">Outbreathing &amp; inbreathing</option>
          <option value="OUTBREATHING">Outbreathing (pressure) only</option>
          <option value="INBREATHING">Inbreathing (vacuum) only</option>
        </select>
      </div>
      <div class="field full-width dev-field-capacity-source" hidden>
        <span class="label" id="${uid('src')}">Capacity source</span>
        <div class="radio-group" role="radiogroup" aria-labelledby="${uid('src')}">
          <label class="radio-item"><input type="radio" name="cap-src-${id}" class="dev-cap-src" value="manufacturer" checked><span>Manufacturer rated</span></label>
          <label class="radio-item"><input type="radio" name="cap-src-${id}" class="dev-cap-src" value="calculated"><span>Calculate from pipe geometry (Annex D nozzle flow)</span></label>
        </div>
      </div>
      <div class="field dev-field-sp">
        <label for="${uid('sp')}">Set pressure <span class="unit press-unit"></span></label>
        <input type="number" step="any" min="0" inputmode="decimal" class="dev-sp" id="${uid('sp')}" placeholder="e.g. 0.5" aria-describedby="${uid('sp-hint')}">
        <p class="hint" id="${uid('sp-hint')}">Pressure at which the valve opens</p>
      </div>
      <div class="field dev-field-sv">
        <label for="${uid('sv')}">Set vacuum <span class="unit press-unit"></span></label>
        <input type="number" step="any" min="0" inputmode="decimal" class="dev-sv" id="${uid('sv')}" placeholder="e.g. 0.2" aria-describedby="${uid('sv-hint')}">
        <p class="hint" id="${uid('sv-hint')}">Vacuum at which the valve opens</p>
      </div>
      <div class="field dev-field-flow-out">
        <label for="${uid('flow-out')}">Rated outbreathing flow <span class="unit flow-unit"></span></label>
        <input type="number" step="any" min="0" inputmode="decimal" class="dev-flow-out" id="${uid('flow-out')}">
      </div>
      <div class="field dev-field-flow-in">
        <label for="${uid('flow-in')}">Rated inbreathing flow <span class="unit flow-unit"></span></label>
        <input type="number" step="any" min="0" inputmode="decimal" class="dev-flow-in" id="${uid('flow-in')}">
      </div>
      <div class="field dev-field-overpressure">
        <label for="${uid('op')}">Rated at overpressure <span class="unit">%</span></label>
        <input type="number" step="any" min="0" inputmode="decimal" class="dev-overpressure" id="${uid('op')}" value="10" placeholder="e.g. 10 or 100" aria-describedby="${uid('op-hint')}">
        <p class="hint" id="${uid('op-hint')}">Flow capacity is rated at this % above the set point</p>
      </div>
      <div class="field dev-field-pipe-diam" hidden>
        <label for="${uid('pipe')}">Pipe inner diameter <span class="unit pipe-diam-unit"></span></label>
        <input type="number" step="any" min="0" inputmode="decimal" class="dev-pipe-diam" id="${uid('pipe')}">
      </div>
      <div class="field dev-field-cd" hidden>
        <label for="${uid('cd')}">Discharge coefficient (C<sub>d</sub>)</label>
        <input type="number" step="0.01" min="0" max="1" inputmode="decimal" class="dev-cd" id="${uid('cd')}" value="0.5" aria-describedby="${uid('cd-hint')}">
        <p class="hint" id="${uid('cd-hint')}">Typical range 0.3–0.8 for pipe fittings</p>
      </div>
    </div>

    <div class="arrestor-block" data-fa-block>
      <label class="arrestor-toggle">
        <input type="checkbox" class="fa-enabled">
        <span>This device has a flame arrestor (ISO 16852)</span>
      </label>
      <div class="arrestor-body">
        <p class="arrestor-note">
          Reference K-values are generic approximations. For regulatory sizing,
          use the manufacturer's certified ΔP-vs-Q capacity curve (ISO 16852).
        </p>
        <div class="table-wrap">
          <table class="arrestor-ref-table">
            <caption class="visually-hidden">Reference K-values by arrestor class</caption>
            <thead>
              <tr><th scope="col">Arrestor class</th><th scope="col">Typical K</th><th scope="col">Default</th><th scope="col"><span class="visually-hidden">Action</span></th></tr>
            </thead>
            <tbody>${buildArrestorRefRows()}</tbody>
          </table>
        </div>
        <div class="field-grid">
          <div class="field">
            <label for="${uid('fa-class')}">Arrestor class</label>
            <select class="fa-class" id="${uid('fa-class')}" aria-describedby="${uid('fa-class-hint')}">
              ${buildArrestorClassOptions()}
            </select>
            <p class="hint" id="${uid('fa-class-hint')}">Selecting a class pre-fills K (editable).</p>
          </div>
          <div class="field">
            <label for="${uid('fa-k')}">Resistance coefficient K <span class="unit">dimensionless</span></label>
            <input type="number" class="fa-k" id="${uid('fa-k')}" step="0.1" min="0.1" inputmode="decimal" value="3.5" aria-describedby="${uid('fa-k-hint')}">
            <p class="hint" id="${uid('fa-k-hint')}">Override with the manufacturer's value if available.</p>
          </div>
          <div class="field">
            <label for="${uid('fa-d')}">Nominal inside diameter <span class="unit" data-fa-diam-label>mm</span></label>
            <input type="number" class="fa-diameter" id="${uid('fa-d')}" step="any" min="0" inputmode="decimal" value="101.6" aria-describedby="${uid('fa-d-hint')}">
            <div class="hint" id="${uid('fa-d-hint')}">
              <span class="diam-unit-toggle" role="group" aria-label="Arrestor diameter unit" data-fa-diam-toggle>
                <button type="button" data-fa-diam-unit="mm" aria-pressed="true">mm</button><button type="button" data-fa-diam-unit="in" aria-pressed="false">in</button><button type="button" data-fa-diam-unit="m" aria-pressed="false">m</button>
              </span>
              Default 4" (101.6 mm)
            </div>
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
  const activeBtn = card.querySelector('[data-fa-diam-toggle] button[aria-pressed="true"]');
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

    // Skip cards left blank (e.g. the default card when no devices are being checked).
    const entered = ['set_pressure', 'set_vacuum', 'rated_flow_outbreathing', 'rated_flow_inbreathing', 'pipe_diameter'];
    if (!entered.some(k => device[k] != null)) return;

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
      .forEach(b => b.setAttribute('aria-pressed', String(b === diamBtn)));
    diamBtn.closest('.field').querySelector('[data-fa-diam-label]').textContent = diamBtn.dataset.faDiamUnit;
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

// --- Other circumstances (§3.2.5) -------------------------------------------
// Inputs per scenario; `unit` is a UNITS key. Field names match the
// converters in index.js (SCENARIO_FIELD_UNITS). All content is static.

const CD_FIELD = { name: 'cd', label: 'Discharge Coefficient C<sub>d</sub>', value: 0.62 };

const SCENARIO_UI = [
  { key: 'control_valve_failure', label: 'Control valve failure', ref: '§3.2.5.12',
    outbreathing: true, coincident: true,
    hint: 'Load is the increase over the normal maximum fill / empty rate. Gas blow-through after the upstream vessel empties is covered by Pressure transfer.',
    fields: [
      { name: 'failed_inflow',  label: 'Inflow, Inlet Valve Failed Open',   unit: 'fill' },
      { name: 'failed_outflow', label: 'Outflow, Outlet Valve Failed Open', unit: 'fill' },
    ] },
  { key: 'blanket_gas_equipment_failure', label: 'Blanket gas equipment failure', ref: '§3.2.5.3',
    outbreathing: true, coincident: true,
    hint: 'Supply regulator failed wide open (pressure); back-pressure regulator failed open to vapor recovery (vacuum).',
    fields: [
      { name: 'supply_pressure', label: 'Blanket Gas Supply Pressure', unit: 'press' },
      { name: 'diameter',        label: 'Regulator Flow Diameter',     unit: 'pipeDiam' },
      CD_FIELD,
      { name: 'gas_mw',          label: 'Gas Molecular Weight', value: 28.01, hint: 'N₂ 28.01, air 28.96' },
      { name: 'known_flow',      label: 'Known Wide-Open Capacity', unit: 'flow', hint: 'Optional — overrides the orifice calculation' },
      { name: 'vacuum_flow',     label: 'Vapor-Recovery Suction',   unit: 'flow', hint: 'Optional vacuum load' },
    ] },
  { key: 'abnormal_heat_transfer', label: 'Abnormal heat transfer', ref: '§3.2.5.4', outbreathing: true,
    hint: 'Heating-control failure or loss of cooling. Vapor = Q / L with the fluid latent heat and molecular weight.',
    fields: [{ name: 'heat_input', label: 'Uncontrolled Heat Input', unit: 'heatRate' }] },
  { key: 'internal_heat_exchanger_failure', label: 'Internal heat exchanger failure', ref: '§3.2.5.5', outbreathing: true,
    hint: 'Double-ended rupture of one coil/tube releasing the heating or cooling medium as gas (defaults: steam).',
    fields: [
      { name: 'supply_pressure', label: 'Medium Pressure',      unit: 'press' },
      { name: 'gas_temp',        label: 'Medium Temperature',   unit: 'temp' },
      { name: 'diameter',        label: 'Tube Inside Diameter', unit: 'pipeDiam' },
      CD_FIELD,
      { name: 'gas_mw',          label: 'Medium Molecular Weight', value: 18.02, hint: 'Steam 18.02' },
      { name: 'k',               label: 'Ratio of Specific Heats k', value: 1.33, hint: 'Steam 1.33' },
    ] },
  { key: 'uninsulated_hot_tank_in_rain', label: 'Uninsulated hot tank in rain', ref: '§3.2.5.14',
    hint: 'Rain cools a hot vapor space: dV/dt = R·h·A·ΔT / (p·Cp), Annex A Eq. (A.3). Replaces thermal inbreathing.',
    fields: [
      { name: 'vapor_temp',   label: 'Vapor-Space Temperature',   unit: 'temp' },
      { name: 'wall_temp',    label: 'Rain-Cooled Wall Temperature', unit: 'temp', hint: 'Blank = 15.6 °C (60 °F)' },
      { name: 'exposed_area', label: 'Exposed Shell + Roof Area', unit: 'area', hint: 'Blank = from tank dimensions' },
      { name: 'htc',          label: 'Inside HT Coeff.',          unit: 'insulH', hint: 'Blank = 4 W/(m²·K)' },
    ] },
  { key: 'exothermic_reaction', label: 'Exothermic reaction', ref: '§3.2.5.9', outbreathing: true,
    hint: 'Vapor from the reaction heat (Q / L, fluid properties) plus any non-condensable gas generated.',
    fields: [
      { name: 'heat_input',     label: 'Reaction Heat Release', unit: 'heatRate' },
      { name: 'gas_generation', label: 'Gas Generation Rate',   unit: 'massFlow' },
      { name: 'gas_mw',         label: 'Generated Gas Molecular Weight' },
    ] },
  { key: 'mixing_of_products', label: 'Mixing of products', ref: '§3.2.5.16', outbreathing: true,
    hint: 'A more volatile material entering the tank flashes; vapor = inflow × density × fraction vaporized.',
    fields: [
      { name: 'volatile_flow', label: 'Inflow of Volatile Material', unit: 'fill' },
      { name: 'density',       label: 'Liquid Density',              unit: 'density' },
      { name: 'flash_percent', label: 'Fraction Vaporized',          unitText: '%' },
      { name: 'gas_mw',        label: 'Vapor Molecular Weight' },
    ] },
  { key: 'liquid_overfill', label: 'Liquid overfill', ref: '§3.2.5.10', noLoad: true,
    hint: 'Tank vents must not be used for overfill protection, so no venting load is calculated.',
    fields: [{ name: 'protection_provided', label: 'Independent overfill protection provided (API 2350 / EN 13616)', type: 'checkbox' }] },
  { key: 'pressure_transfer_vapor_breakthrough', label: 'Pressure transfer / vapor breakthrough', ref: '§3.2.5.2', outbreathing: true,
    hint: 'Gas blowing through the transfer line once the supply vessel empties, into the tank at MAWP.',
    fields: [
      { name: 'supply_pressure', label: 'Supply Vessel / Truck Pressure', unit: 'press' },
      { name: 'diameter',        label: 'Line / Valve Flow Diameter',     unit: 'pipeDiam' },
      CD_FIELD,
      { name: 'gas_mw',          label: 'Gas Molecular Weight', value: 28.96, hint: 'Air 28.96, N₂ 28.01' },
      { name: 'known_flow',      label: 'Known Gas Flow', unit: 'flow', hint: 'Optional — overrides the line calculation' },
    ] },
  { key: 'atmospheric_pressure_change', label: 'Atmospheric pressure change', ref: '§3.2.5.11',
    outbreathing: true, coincident: true,
    hint: 'Barometric change acting on the full tank volume: dV/dt = V · (dp/dt) / p. Loads both directions.',
    fields: [{ name: 'rate', label: 'Barometric Change Rate', unit: 'pressRate', hint: 'Severe storms ≈ 0.2–0.5 kPa/h' }] },
];

const UNIT_KEY_CLASS = Object.fromEntries(Object.entries(UNIT_CLASS_MAP).map(([cls, key]) => [key, cls]));

// Static, developer-controlled content (labels and hints are not user input).
function scenarioField(sc, f) {
  if (f.type === 'checkbox') {
    return `<label class="check-item"><input type="checkbox" data-sc-field="${f.name}"><span>${f.label}</span></label>`;
  }
  const id = `sc-${sc.key}-${f.name}`;
  const unit = f.unit ? `<span class="unit ${UNIT_KEY_CLASS[f.unit]}"></span>` : (f.unitText ? `<span class="unit">${f.unitText}</span>` : '');
  return `
    <div class="field">
      <label for="${id}">${f.label} ${unit}</label>
      <input type="number" step="any" inputmode="decimal" id="${id}" data-sc-field="${f.name}"${f.value != null ? ` value="${f.value}"` : ''}${f.hint ? ` aria-describedby="${id}-hint"` : ''}>
      ${f.hint ? `<p class="hint" id="${id}-hint">${f.hint}</p>` : ''}
    </div>`;
}

function renderScenarios() {
  $('scenarioList').innerHTML = SCENARIO_UI.map(sc => `
    <div class="scenario" data-scenario="${sc.key}">
      <label class="check-item"><input type="checkbox" class="sc-enabled" aria-controls="sc-${sc.key}-body"><span>${sc.label}<span class="ref">${sc.ref}</span></span></label>
      <div class="scenario-body" id="sc-${sc.key}-body">
        <p class="hint">${sc.hint}</p>
        <div class="field-grid">
          ${sc.fields.map(f => scenarioField(sc, f)).join('')}
          ${sc.outbreathing ? `
            <div class="field">
              <label for="sc-${sc.key}-relieved_by">Pressure load relieved by</label>
              <select id="sc-${sc.key}-relieved_by" data-sc-field="relieved_by" aria-describedby="sc-${sc.key}-relieved_by-hint">
                <option value="NORMAL">Normal venting devices</option>
                <option value="EMERGENCY">Emergency devices (incl. EPRV)</option>
              </select>
              <p class="hint" id="sc-${sc.key}-relieved_by-hint">§3.6.1</p>
            </div>` : ''}
          ${sc.noLoad ? '' : `
            <label class="check-item"><input type="checkbox" data-sc-field="coincident"${sc.coincident ? ' checked' : ''}>
              <span>Coincident with normal venting${sc.key === 'uninsulated_hot_tank_in_rain' ? ' (liquid movement)' : ''}</span></label>`}
        </div>
      </div>
    </div>`).join('');
  updateUnitLabels($('scenarioList'));
}

function collectScenarios() {
  const scenarios = {};
  document.querySelectorAll('#scenarioList .scenario').forEach(el => {
    if (!el.querySelector('.sc-enabled').checked) return;
    const data = { enabled: true };
    el.querySelectorAll('[data-sc-field]').forEach(input => {
      const name = input.dataset.scField;
      if (input.type === 'checkbox') data[name] = input.checked;
      else if (input.tagName === 'SELECT') data[name] = input.value;
      else if (input.value.trim() !== '' && !isNaN(Number(input.value))) data[name] = Number(input.value);
    });
    scenarios[el.dataset.scenario] = data;
  });
  return scenarios;
}

$('scenarioList').addEventListener('change', (e) => {
  if (e.target.classList.contains('sc-enabled')) {
    e.target.closest('.scenario').classList.toggle('enabled', e.target.checked);
  }
});
renderScenarios();

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
// Two-phase check: inputs appear when enabled; the homogeneous regime needs no surface tension.
$('tpEnabled').addEventListener('change', (e) => show($('tpFields'), e.target.checked));
$('tpRegime').addEventListener('change', (e) => show($('tpSigmaField'), e.target.value !== 'HOMOGENEOUS'));
$('fireBasis').addEventListener('change', (e) => {
  $('fireBasisHint').textContent = e.target.value === 'HEXANE'
    ? 'Hexane properties (L = 334,900 J/kg, M = 86.17). Only for fluids similar to hexane.'
    : 'Uses the latent heat, molecular weight and relieving vapor temperature from step 3.';
});
disclaimerCheck.addEventListener('change', () => {
  calcBtn.disabled = !disclaimerCheck.checked;
  $('runHint').hidden = disclaimerCheck.checked;
});

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
    scenarios: collectScenarios(),
    fire: {
      include:              bool('opt_fireCaseEnabled'),
      basis:                $('fireBasis').value,
      environmental_factor: $('envFactor').value,
      custom_factor:        num('customEnvFactor'),
      manual_wetted_area:   num('manualWettedArea'),
    },
    devices: collectDeviceData(),
    two_phase: {
      enabled:         bool('tpEnabled'),
      regime:          $('tpRegime').value,
      fill_percent:    num('tpFill'),
      liquid_density:  num('tpDensity'),
      liquid_cp:       num('tpCp'),
      surface_tension: num('tpSigma'),
      scenarios:       [...document.querySelectorAll('.tp-scenario:checked')].map(cb => cb.value),
    },
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

const svg = (size, body) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">${body}</svg>`;
const ICONS = {
  error:   svg(16, '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  warning: svg(16, '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  notice:  svg(16, '<path d="M8 1.5l6.5 12H1.5L8 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v3M8 11.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  pass:    svg(18, '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5 8.5l2 2 4-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
  fail:    svg(18, '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
};

// The kind is spelled out (visually hidden) so it is not conveyed by colour alone.
const alertBox = (cls, icon, kind, message) =>
  `<div class="alert ${cls}">${icon}<span><span class="visually-hidden">${kind}: </span>${escapeHtml(message)}</span></div>`;

function renderAlerts(warnings, errors) {
  return (errors || []).map(e => alertBox('alert-error', ICONS.error, 'Error', e)).join('') +
    (warnings || []).map(w => (w.severity === 'WARNING'
      ? alertBox('alert-error', ICONS.warning, 'Warning', w.message)
      : alertBox('alert-warn', ICONS.notice, 'Note', w.message))).join('');
}

// Errors and warnings stay visible; notes are grouped in a collapsible list.
function renderNotices(warnings, errors) {
  const notes = (warnings || []).filter(w => w.severity !== 'WARNING');
  const urgent = (warnings || []).filter(w => w.severity === 'WARNING');
  let html = renderAlerts(urgent, errors);
  if (notes.length > 0) {
    html += `
      <details class="alerts-group" open>
        <summary>Notes and assumptions (${notes.length})</summary>
        ${renderAlerts(notes, [])}
      </details>`;
  }
  return html;
}

function tableRow(label, value, highlight) {
  return `<tr${highlight ? ' class="highlight"' : ''}><th scope="row">${escapeHtml(String(label))}</th><td>${escapeHtml(String(value))}</td></tr>`;
}

function section(title, rows, extraClass = '', after = '') {
  return `
    <div class="result-section ${extraClass}">
      <h3>${escapeHtml(title)}</h3>
      <div class="table-wrap"><table class="result-table">${rows}</table></div>
      ${after}
    </div>`;
}

// --- Render full results ----------------------------------------------------

function renderSummaryTiles(o) {
  const fu = o.flow_unit;
  const d = o.design;
  const tile = (label, value, basis, accent) => `
    <div class="stat${accent ? ' accent' : ''}">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(fmtVal(value))} <span class="unit">${escapeHtml(fu)}</span></div>
      <div class="stat-basis">${escapeHtml(basis)}</div>
    </div>`;
  return `
    <h3 class="visually-hidden">Governing requirements</h3>
    <div class="stat-grid">
      ${tile('Governing outbreathing', o.governing.outbreathing, o.governing.outbreathing_basis, true)}
      ${tile('Governing inbreathing', o.governing.inbreathing, o.governing.inbreathing_basis, true)}
      ${tile('Normal venting devices', d.normal_out, d.normal_out_basis)}
      ${d.emergency_out != null ? tile('Emergency venting (all devices)', d.emergency_out, d.emergency_out_basis) : ''}
    </div>`;
}

function complianceRows(o) {
  const av = o.actual_venting;
  const rows = [
    { label: 'Normal outbreathing', required: o.design.normal_out, actual: av.normal_out, pass: av.adequacy.normal_out },
  ];
  if (av.adequacy.emergency_out != null) {
    rows.push({ label: 'Emergency outbreathing', required: o.design.emergency_out, actual: av.emergency_out, pass: av.adequacy.emergency_out });
  }
  rows.push({ label: 'Inbreathing (vacuum)', required: o.design.inbreathing, actual: av.inbreathing, pass: av.adequacy.inbreathing });
  return rows;
}

// Two-phase cases that start two-phase venting, checked against the devices (mass flow).
function twoPhaseRows(o) {
  if (!o.two_phase) return [];
  return o.two_phase.items.filter(t => t.two_phase && t.adequate != null)
    .map(t => ({ label: t.label, required: t.required, actual: t.capacity, pass: t.adequate }));
}

const allRequirementsMet = (o) =>
  complianceRows(o).every(r => r.pass) && twoPhaseRows(o).every(r => r.pass);

function complianceTable(rows, unit, firstHeader) {
  return `
      <div class="table-wrap">
        <table class="compliance-table">
          <thead>
            <tr>
              <th scope="col">${escapeHtml(firstHeader)}</th>
              <th scope="col">Required <span class="unit">${escapeHtml(unit)}</span></th>
              <th scope="col">Installed <span class="unit">${escapeHtml(unit)}</span></th>
              <th scope="col" class="col-status">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const chip = (cls) => `<span class="status-chip ${cls} ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'Pass' : 'Fail'}</span>`;
              return `
              <tr>
                <th scope="row">${escapeHtml(r.label)}</th>
                <td>${escapeHtml(fmtVal(r.required))}</td>
                <td class="${r.pass ? 'actual-pass' : 'actual-fail'}">${escapeHtml(fmtVal(r.actual))}${chip('status-inline')}</td>
                <td class="col-status">${chip('')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
}

function renderCompliance(o) {
  const allPass = allRequirementsMet(o);
  const tpRows = twoPhaseRows(o);
  return `
    <div class="compliance-summary">
      <h3 class="compliance-header ${allPass ? 'all-pass' : 'has-fail'}">
        ${allPass ? ICONS.pass : ICONS.fail}
        ${allPass ? 'All venting requirements met' : 'Venting deficiency — review required'}
      </h3>
      ${complianceTable(complianceRows(o), o.flow_unit, 'Requirement')}
      ${tpRows.length > 0 ? complianceTable(tpRows, o.mass_unit, 'Two-phase venting') : ''}
    </div>`;
}

function renderTwoPhase(o) {
  const tp = o.two_phase;
  const mu = o.mass_unit;
  const au = o.area_unit;
  const result = (t) => {
    if (!t.two_phase) return '<span class="status-chip pass">Vapor only</span>';
    if (t.adequate == null) return '<span class="status-chip fail">Two-phase</span>';
    return `<span class="status-chip ${t.adequate ? 'pass' : 'fail'}">${t.adequate ? 'Pass' : 'Fail'}</span>`;
  };
  return `
    <div class="device-breakdown">
      <h3>Two-phase venting check (DIERS) — engineering estimate</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th scope="col">Scenario</th><th scope="col">Liquid swell</th><th scope="col">Required</th><th scope="col">Installed</th><th scope="col">Result</th></tr>
          </thead>
          <tbody>
            ${tp.items.map(t => `<tr>
              <td>${escapeHtml(t.label)}<br><small>${t.path === 'EMERGENCY' ? 'Emergency path' : 'Normal path'}</small></td>
              <td class="mono-val">${t.swell_pct == null ? 'Foams to top' : `${fmtVal(t.swell_pct, '%')}<br><small>void ${fmtVal(t.void_pct, '%')}</small>`}</td>
              <td class="mono-val">${t.two_phase ? `${fmtVal(t.required, mu)}<br><small>Cd·A ${fmtVal(t.required_area, au)}</small>` : '—'}</td>
              <td class="mono-val">${t.two_phase && t.capacity != null ? `${fmtVal(t.capacity, mu)}<br><small>Cd·A ${fmtVal(t.installed_area, au)}</small>` : '—'}</td>
              <td>${result(t)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="table-note">Liquid behaviour: ${escapeHtml(tp.regime_label)}. Liquid swell is the swollen liquid volume as a
        share of the tank; two-phase venting starts at 100 %. Flows are vapor–liquid mixture at the tank's allowable pressure.</p>
    </div>`;
}

function renderScenarioResults(o) {
  const fu = o.flow_unit;
  const cell = (load, total, coincident) => (load > 0
    ? `${escapeHtml(fmtVal(total, fu))}${coincident ? '<br><small>incl. normal</small>' : ''}`
    : '—');
  return `
    <div class="device-breakdown">
      <h3>Other circumstances (§3.2.5) — engineering estimates</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th scope="col">Scenario</th><th scope="col">Pressure load</th><th scope="col">Vacuum load</th><th scope="col">Relief path</th></tr>
          </thead>
          <tbody>
            ${o.scenarios.map(sc => `<tr>
              <td>${escapeHtml(sc.label)} <span class="ref">${escapeHtml(sc.ref)}</span></td>
              <td class="mono-val">${cell(sc.out, sc.total_out, sc.coincident)}</td>
              <td class="mono-val">${cell(sc.in, sc.total_in, sc.coincident)}</td>
              <td>${sc.out > 0 ? (sc.relieved_by === 'EMERGENCY' ? 'Emergency' : 'Normal') : (sc.in > 0 ? 'Vacuum' : 'No load')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderDevices(o) {
  const devs = o.actual_venting.devices;
  const fu = o.flow_unit;
  const typeLabels = { PVRV: 'PVRV', EPRV: 'EPRV', FREE_VENT: 'Free vent' };
  const typeCls    = { PVRV: 'pvrv', EPRV: 'eprv', FREE_VENT: 'free-vent' };
  let html = '';

  if (devs.some(d => d.arrestor)) {
    const badgeCls = { PASS: 'pass', WARN: 'warn', FAIL: 'fail' };
    const paths = [['out', 'Pressure'], ['in', 'Vacuum']];
    html += `
      <div class="result-section">
        <h3>Flame arrestor — pressure drop at effective flow (ISO 16852)</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th scope="col">Device</th><th scope="col">ΔP</th><th scope="col">Velocity</th><th scope="col">Budget used</th><th scope="col">Status</th></tr>
            </thead>
            <tbody>
              ${devs.map((d, i) => paths.map(([dir, pathLabel]) => {
                const a = d.arrestor && d.arrestor[dir];
                if (!a) return '';
                return `<tr>
                  <td>#${i + 1} — ${escapeHtml(typeLabels[d.type] || d.type)}<br><small>${pathLabel}</small></td>
                  <td class="mono-val">${fmtVal(a.deltaP_mbar, 'mbar')}<br><small>${fmtVal(a.deltaP_inH2O, 'inH₂O')}</small></td>
                  <td class="mono-val">${fmtVal(a.velocity_m_s, 'm/s')}</td>
                  <td class="mono-val">${fmtVal(a.budget_pct, '%')}</td>
                  <td><span class="fa-badge ${badgeCls[a.badge] || ''}">${escapeHtml(a.badge)}</span></td>
                </tr>`;
              }).join('')).join('')}
            </tbody>
          </table>
        </div>
        <p class="table-note">Budget used: arrestor ΔP at the effective flow as a share of the allowable pressure/vacuum
          (open vents) or of the margin between set point and allowable (valves). WARN ≥ 50 %, FAIL ≥ 90 %.</p>
      </div>`;
  }

  // Effective capacity; behind an arrestor, also the capacity without it.
  const capacityCell = (d, dir, value) => {
    if (!(value > 0)) return '—';
    const a = d.arrestor && d.arrestor[dir];
    return escapeHtml(fmtVal(value, fu)) +
      (a ? `<br><small>${escapeHtml(fmtVal(a.unarrested_flow, fu))} without arrestor</small>` : '');
  };

  html += `
    <div class="device-breakdown">
      <h3>Installed device contributions at MAWP / MAWV</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th scope="col">#</th><th scope="col">Type</th><th scope="col">Direction</th><th scope="col">Outbreathing</th><th scope="col">Inbreathing</th></tr>
          </thead>
          <tbody>
            ${devs.map((d, i) => {
              const dirLabel = d.direction === 'BOTH' ? 'Both' : d.direction === 'OUTBREATHING' ? 'Pressure' : 'Vacuum';
              return `<tr>
                <td>${i + 1}</td>
                <td><span class="type-badge ${typeCls[d.type] || ''}">${escapeHtml(typeLabels[d.type] || d.type)}</span></td>
                <td>${escapeHtml(dirLabel)}</td>
                <td class="mono-val">${capacityCell(d, 'out', d.flow_out)}</td>
                <td class="mono-val">${capacityCell(d, 'in', d.flow_in)}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" class="total-label">Total installed capacity</td>
              <td class="mono-val">${fmtVal(o.actual_venting.emergency_out, fu)}</td>
              <td class="mono-val">${fmtVal(o.actual_venting.inbreathing, fu)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
  return html;
}

function renderResults(result) {
  if (!result.outputs) {
    resultsContainer.innerHTML = `
      <h3 class="results-heading" id="resultsHeading" tabindex="-1">Please check your inputs</h3>
      ${renderAlerts(result.warnings, result.errors)}`;
    $('btnPrint').hidden = true;
    return { status: `Calculation not run. ${(result.errors || []).length} input issue(s) listed in the results.` };
  }

  const o  = result.outputs;
  const fu = o.flow_unit;
  const nv = o.normal_venting;
  const p  = o.project;

  let html = `
    <div class="print-only">
      <p><strong>API 2000 Venting Calculator</strong> — ${escapeHtml(new Date().toLocaleString())}</p>
    </div>
    <h3 class="results-heading" id="resultsHeading" tabindex="-1">${p.tag_number ? `Results for ${escapeHtml(p.tag_number)}` : 'Calculation results'}</h3>`;

  if (o.actual_venting) html += renderCompliance(o);
  html += renderSummaryTiles(o);
  html += renderNotices(result.warnings, result.errors);

  const projectRows = [
    ['Tag number', p.tag_number], ['Project', p.project_name], ['Prepared by', p.prepared_by], ['Fluid', p.fluid_name],
  ].filter(([, v]) => v).map(([k, v]) => tableRow(k, v)).join('');
  html += section('Calculation basis', projectRows + tableRow('Normal venting method', o.method_label));

  let thermalRows =
    tableRow('Thermal inbreathing',  fmtVal(nv.thermal_in, fu)) +
    tableRow('Thermal outbreathing', fmtVal(nv.thermal_out, fu));
  if (o.method === 'GENERAL') {
    thermalRows +=
      tableRow('Y-factor (Table 1)', fmtVal(nv.Y)) +
      tableRow('C-factor (Table 2)', fmtVal(nv.C)) +
      tableRow('Insulation reduction factor Rᵢ', fmtVal(nv.Ri));
  }
  html += section('Normal venting — thermal', thermalRows);
  html += section('Normal venting — liquid movement',
    tableRow('Inbreathing (emptying)', fmtVal(nv.liquid_in, fu)) +
    tableRow('Outbreathing (filling)', fmtVal(nv.liquid_out, fu)) +
    tableRow('Volatile?', nv.is_volatile ? 'Yes' : 'No'));
  html += section('Normal venting — totals',
    tableRow('Total normal inbreathing',  fmtVal(nv.total_in, fu), true) +
    tableRow('Total normal outbreathing', fmtVal(nv.total_out, fu), true));

  const ev = o.emergency_venting;
  if (ev) {
    const t9 = ev.table9_extrapolated;
    html += section('Emergency venting — fire exposure',
      tableRow('Wetted area', fmtVal(ev.wetted_area, o.area_unit)) +
      tableRow('Wetted area basis', ev.wetted_area_method) +
      tableRow('Heat input Q (Table 3)', fmtVal(ev.heat_input, o.heat_unit)) +
      tableRow('Environmental factor F (Table 9)', t9 ? `${t9.F} (extrapolated with note b)` : fmtVal(ev.F)) +
      tableRow('Fire venting basis', ev.basis === 'HEXANE' ? 'Hexane-like fluid (Tables 5 & 7, Eq. 16)' : 'Stored fluid (Eq. 14)') +
      tableRow('Vapor generation', fmtVal(ev.vapour_mass_flow, o.mass_unit)) +
      tableRow('Required emergency venting', fmtVal(ev.required, fu), true) +
      (t9
        ? tableRow('Table 9 minimum F (lowest tabulated row)', fmtVal(t9.F_min)) +
          tableRow('Emergency venting at Table 9 minimum F', fmtVal(t9.required_at_F_min, fu))
        : ''),
      '',
      t9 ? renderAlerts([{ severity: 'WARNING', message: t9.message }], []) : '');
  }

  if (o.scenarios.length > 0) html += renderScenarioResults(o);
  if (o.two_phase && o.two_phase.items.length > 0) html += renderTwoPhase(o);
  if (o.actual_venting && o.actual_venting.devices.length > 0) html += renderDevices(o);

  if (result.intermediates) {
    html += `
      <details class="audit">
        <summary>Intermediates (SI audit trail)</summary>
        <div class="table-wrap">
          <table class="result-table">
            ${result.intermediates.map(([label, value, unit]) => tableRow(label, fmtVal(value, unit))).join('')}
          </table>
        </div>
      </details>`;
  }

  resultsContainer.innerHTML = html;
  $('btnPrint').hidden = false;

  const verdict = o.actual_venting
    ? (allRequirementsMet(o) ? 'All venting requirements met.' : 'Venting deficiency found.')
    : '';
  return {
    status: `Calculation complete. ${verdict} Governing outbreathing ${fmtVal(o.governing.outbreathing, fu)}, ` +
      `inbreathing ${fmtVal(o.governing.inbreathing, fu)}.`,
  };
}

function announce(message) {
  const status = $('resultsStatus');
  status.textContent = '';
  // A fresh text node after a tick makes screen readers announce repeated messages.
  setTimeout(() => { status.textContent = message; }, 50);
}

// --- Worked example ---------------------------------------------------------
// Fills the form only; the user still ticks the acknowledgement and runs it.

function setField(el, value) {
  if (el.type === 'checkbox' || el.type === 'radio') el.checked = value;
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Every §3.2.5 circumstance, in SI display units (the example selects SI).
// Fields not listed are cleared; large upsets are routed to the emergency valve.
const EXAMPLE_SCENARIOS = {
  control_valve_failure:                { failed_inflow: 300, failed_outflow: 250, coincident: true, relieved_by: 'NORMAL' },
  blanket_gas_equipment_failure:        { supply_pressure: 700, diameter: 6, cd: 0.62, gas_mw: 28.01, vacuum_flow: 80,
                                          coincident: true, relieved_by: 'NORMAL' },
  abnormal_heat_transfer:               { heat_input: 150, relieved_by: 'NORMAL' },
  internal_heat_exchanger_failure:      { supply_pressure: 1000, gas_temp: 184, diameter: 20, cd: 0.62, gas_mw: 18.02, k: 1.33,
                                          relieved_by: 'EMERGENCY' },
  uninsulated_hot_tank_in_rain:         { vapor_temp: 65, coincident: true },
  exothermic_reaction:                  { heat_input: 300, gas_generation: 250, gas_mw: 44.01, relieved_by: 'NORMAL' },
  mixing_of_products:                   { volatile_flow: 10, density: 650, flash_percent: 5, gas_mw: 58.12, relieved_by: 'NORMAL' },
  liquid_overfill:                      { protection_provided: true },
  pressure_transfer_vapor_breakthrough: { supply_pressure: 500, diameter: 50, cd: 0.62, gas_mw: 28.01, relieved_by: 'EMERGENCY' },
  atmospheric_pressure_change:          { rate: 0.5, coincident: true, relieved_by: 'NORMAL' },
};

function loadExampleScenarios() {
  for (const [key, data] of Object.entries(EXAMPLE_SCENARIOS)) {
    const el = document.querySelector(`#scenarioList [data-scenario="${key}"]`);
    setField(el.querySelector('.sc-enabled'), true);
    el.querySelectorAll('[data-sc-field]').forEach(input => {
      const value = data[input.dataset.scField];
      if (input.type === 'checkbox') setField(input, !!value);
      else if (input.tagName === 'SELECT') { if (value != null) setField(input, value); }
      else setField(input, value ?? '');
    });
  }
}

function loadExample() {
  const values = {
    unitSystem: 'SI', ventMethod: 'GENERAL', tagNumber: 'EX-101', projectName: 'Worked example', preparedBy: '',
    tankShape: 'VERTICAL_CYLINDER', tankVolume: 785, tankDiameter: 10, tankHeight: 10, tankMAWP: 3.5, tankMAWV: 0.5,
    tankElevation: 0, fluidName: 'Light hydrocarbon (example)', vaporPressureClass: 'HIGHER', operatingTemp: '',
    maxFillRate: 200, maxEmptyRate: 150, latentHeat: 357000, molWeight: 72.15, relievingTemp: 37.5,
    latitudeZone: 'BELOW_42N', insulationType: 'UNINSULATED', fireBasis: 'FLUID', envFactor: 'BARE', manualWettedArea: '',
  };
  for (const [id, v] of Object.entries(values)) setField($(id), v);
  setField($('opt_fireCaseEnabled'), true);
  loadExampleScenarios();

  // Two-phase check on every eligible scenario: a non-foamy hydrocarbon, 80 % full.
  setField($('tpEnabled'), true);
  for (const [id, v] of Object.entries({ tpRegime: 'CHURN', tpFill: 80, tpDensity: 650, tpCp: 2200, tpSigma: 20 })) {
    setField($(id), v);
  }
  document.querySelectorAll('.tp-scenario').forEach(cb => setField(cb, true));

  // A gooseneck behind a flame arrestor, plus an emergency relief valve for the fire case.
  deviceRoster.innerHTML = '';
  renderDeviceRow();
  renderDeviceRow();
  const [vent, eprv] = deviceRoster.querySelectorAll('.device-card');
  setField(vent.querySelector('.dev-type'), 'FREE_VENT');
  setField(vent.querySelector('.dev-cap-src[value="calculated"]'), true);
  setField(vent.querySelector('.dev-pipe-diam'), 202.7);
  setField(vent.querySelector('.dev-cd'), 0.5);
  setField(vent.querySelector('.fa-enabled'), true);
  setField(vent.querySelector('.fa-k'), 3.5);
  setField(vent.querySelector('.fa-diameter'), 203.2);
  setField(eprv.querySelector('.dev-type'), 'EPRV');
  setField(eprv.querySelector('.dev-direction'), 'OUTBREATHING');
  setField(eprv.querySelector('.dev-sp'), 2.5);
  setField(eprv.querySelector('.dev-flow-out'), 25000);
  setField(eprv.querySelector('.dev-overpressure'), 10);

  selectTab(tabButtons[0], false);

  // Already acknowledged: show the example's results straight away.
  if (disclaimerCheck.checked) {
    form.requestSubmit();
    return;
  }
  resultsContainer.innerHTML = `
    <div class="results-placeholder example-loaded">
      ${ICONS.pass}
      <h3 class="results-heading" id="resultsHeading" tabindex="-1">Example tank loaded</h3>
      <p>A 785 m³ vertical tank (MAWP 3.5 kPa, MAWV 0.5 kPa) with a gooseneck vent behind a flame arrestor and an
        emergency relief valve is now filled in, together with all ten §3.2.5 other circumstances (step 5) and a
        two-phase venting check (step 7).
        Review or edit the inputs, then tick the acknowledgement and run the calculation.</p>
      <button type="button" class="btn btn-primary" id="btnGoRun">Go to Run calculation</button>
    </div>`;
  announce('Example tank loaded into the form. Tick the acknowledgement and run the calculation.');
  $('resultsHeading').focus();
}

// Brings the acknowledgement and Run button into view and briefly highlights them.
function goToRun() {
  const bar = document.querySelector('.run-bar');
  bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
  disclaimerCheck.focus({ preventScroll: true });
  bar.classList.remove('attention');
  void bar.offsetWidth;   // restart the highlight animation
  bar.classList.add('attention');
}

// --- Form submission and actions --------------------------------------------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const { status } = renderResults(window.API2000.runCalculation(assemblePayload()));
  announce(status);
  $('resultsHeading').focus();
});

resultsContainer.addEventListener('click', (e) => {
  if (e.target.closest('#btnExample')) loadExample();
  if (e.target.closest('#btnGoRun')) goToRun();
});
$('btnPrint').addEventListener('click', () => window.print());
// Printed reports include the full audit trail.
window.addEventListener('beforeprint', () => {
  resultsContainer.querySelectorAll('details').forEach(d => { d.open = true; });
});
