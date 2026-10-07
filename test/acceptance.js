// ============================================================
// test/acceptance.js — acceptance and regression checks (plain assertions).
//   Node:     node test/acceptance.js        (exit code 1 on any failure)
//   Browser:  serve the repo folder over http and open test/acceptance.html
// Not loaded by index.html.
// ============================================================

'use strict';

(function () {
  const isNode = typeof window === 'undefined';
  if (isNode) {
    const path = require('path');
    global.window = {};
    for (const f of ['constants.js', 'unitConverter.js', 'api2000Engine.js', 'flameArrestor.js', 'twoPhase.js', 'index.js']) {
      require(path.join(__dirname, '..', f));
    }
  }
  const { engine, runCalculation, AIR_PROPERTIES: AIR } = window.API2000;

  // --- Assertions ------------------------------------------------------------

  const results = [];
  const record = (group, name, pass, actual, expected) =>
    results.push({ group, name, pass: !!pass, actual: String(actual), expected: String(expected) });
  const fmt = (v) => (typeof v === 'number' ? +v.toPrecision(7) : v);
  let group = '';
  // |actual − expected| ≤ tol
  const near = (name, actual, expected, tol) =>
    record(group, name, Number.isFinite(actual) && Math.abs(actual - expected) <= tol, fmt(actual), `${expected} ± ${tol}`);
  // |actual / expected − 1| ≤ rel
  const within = (name, actual, expected, rel) =>
    record(group, name, Number.isFinite(actual) && Math.abs(actual / expected - 1) <= rel, fmt(actual), `${expected} ± ${rel * 100} %`);
  const equal = (name, actual, expected) => record(group, name, Object.is(actual, expected), fmt(actual), fmt(expected));
  const ok = (name, condition, detail = '') => record(group, name, condition, detail || condition, 'true');

  // --- Problem 1: free-vent capacity with a flame arrestor --------------------

  group = 'Free vent + flame arrestor';
  const P_ATM = 101.325;
  const PIPE_ID = 0.2027;
  const CD = 0.5;
  const MAWP = 3.5;
  const MAWV = 0.5;
  const T_OUT_K = 310.65;   // relieving vapour 37.5 °C
  const T_IN_K = 288.75;    // ambient 15.6 °C
  const FA = { K: 3.5, diameter_m: 0.2032 };
  const nozzle = (pIn, pOut, T) => engine.calculateOpenVentCapacity(PIPE_ID, pIn, pOut, AIR.k, T, AIR.M, 1, CD);
  const calculatedVent = (fa) => ({
    type: 'FREE_VENT', direction: 'BOTH', capacity_source: 'calculated', flame_arrestor: fa,
    capacity_out: (p) => nozzle(P_ATM + p, P_ATM, T_OUT_K),
    capacity_in:  (p) => nozzle(P_ATM, P_ATM - p, T_IN_K),
    rated_flow_outbreathing: nozzle(P_ATM + MAWP, P_ATM, T_OUT_K),
    rated_flow_inbreathing:  nozzle(P_ATM, P_ATM - MAWV, T_IN_K),
  });
  const air = (T_K, P) => ({ molecular_weight: AIR.M, compressibility_factor: 1, temperature_C: T_K - 273.15, pressure_kPa_abs: P });
  const ctx = { out: air(T_OUT_K, P_ATM + MAWP), in: air(T_IN_K, P_ATM) };
  const vent = (dev) => engine.calcActualVenting([dev], MAWP, MAWV, ctx).devices[0];

  near('No arrestor, out-breathing @ 3.5 kPa(g), 310.65 K', nozzle(P_ATM + MAWP, P_ATM, T_OUT_K), 4004.1, 0.1);
  near('No arrestor, inbreathing @ 0.5 kPa, 288.75 K', nozzle(P_ATM, P_ATM - MAWV, T_IN_K), 1567.5, 0.1);

  const bare = vent(calculatedVent(undefined));
  near('No arrestor via calcActualVenting, out', bare.flow_out, 4004.1, 0.1);
  near('No arrestor via calcActualVenting, in', bare.flow_in, 1567.5, 0.1);

  const arrested = vent(calculatedVent(FA));
  const ao = arrested.arrestor.out;
  const ai = arrested.arrestor.in;
  within('With arrestor, out-breathing capacity', arrested.flow_out, 2956, 0.03);
  within('With arrestor, out-breathing ΔP (kPa)', ao.deltaP_kPa, 1.59, 0.03);
  within('With arrestor, out-breathing budget (%)', ao.budget_pct, 46, 0.03);
  within('With arrestor, pressure left at the nozzle (kPa)', MAWP - ao.deltaP_kPa, 1.91, 0.03);
  near('Self-consistent: nozzle flow at (MAWP − ΔP) equals the flow', nozzle(P_ATM + MAWP - ao.deltaP_kPa, P_ATM, T_OUT_K), arrested.flow_out, 0.01);
  within('With arrestor, inbreathing capacity', arrested.flow_in, 1150, 0.03);
  within('With arrestor, inbreathing ΔP (kPa)', ai.deltaP_kPa, 0.23, 0.03);
  near('Self-consistent: nozzle flow at (MAWV − ΔP) equals the flow', nozzle(P_ATM, P_ATM - (MAWV - ai.deltaP_kPa), T_IN_K), arrested.flow_in, 0.01);
  near('Undereated capacity is reported, out', ao.unarrested_flow, 4004.1, 0.1);
  near('Undereated capacity is reported, in', ai.unarrested_flow, 1567.5, 0.1);
  equal('Out-breathing badge at the converged flow', ao.badge, 'PASS');

  const rated = vent({
    type: 'FREE_VENT', direction: 'BOTH', capacity_source: 'manufacturer', flame_arrestor: FA,
    rated_flow_outbreathing: 4004.1, rated_flow_inbreathing: 1567.5,
  });
  within('Manufacturer-rated 4,004.1 @ 3.5 kPa(g), same arrestor, out', rated.flow_out, 2956, 0.03);
  within('Manufacturer-rated 1,567.5 @ 0.5 kPa, same arrestor, in', rated.flow_in, 1150, 0.03);

  for (const K of [1e6, 1e12, 1e100]) {
    const big = vent(calculatedVent({ K, diameter_m: FA.diameter_m }));
    const values = [big.flow_out, big.flow_in, big.arrestor.out.deltaP_kPa, big.arrestor.in.deltaP_kPa,
      big.arrestor.out.budget_pct, big.arrestor.in.budget_pct];
    ok(`K = ${K}: all results finite`, values.every(Number.isFinite), values.map(fmt).join(', '));
    ok(`K = ${K}: capacity trends to 0 (< 1 % of unarrested)`, big.flow_out < 40 && big.flow_in < 15.7,
      `${fmt(big.flow_out)} / ${fmt(big.flow_in)}`);
    equal(`K = ${K}: badge`, big.arrestor.badge, 'FAIL');
  }

  const zeroK = vent(calculatedVent({ K: 0, diameter_m: FA.diameter_m }));
  equal('K = 0: out-breathing identical to no arrestor', zeroK.flow_out, bare.flow_out);
  equal('K = 0: inbreathing identical to no arrestor', zeroK.flow_in, bare.flow_in);

  // Devices without an arrestor are evaluated exactly as before.
  const plain = engine.calcActualVenting([
    { type: 'PVRV', direction: 'BOTH', set_pressure: 1, set_vacuum: 0.25, rated_flow_outbreathing: 400, rated_flow_inbreathing: 300, rated_overpressure_pct: 100 },
    { type: 'FREE_VENT', direction: 'BOTH', rated_flow_outbreathing: 250, rated_flow_inbreathing: 120 },
  ], 1.5, 0.4).devices;
  equal('No arrestor: PVRV out = linear partial lift', plain[0].flow_out, engine.calcDeviceFlow(1, 400, 100, 1.5));
  equal('No arrestor: PVRV in = linear partial lift', plain[0].flow_in, engine.calcDeviceFlow(0.25, 300, 100, 0.4));
  equal('No arrestor: rated free vent out = rated flow', plain[1].flow_out, 250);
  equal('No arrestor: rated free vent in = rated flow', plain[1].flow_in, 120);

  // --- Full calculation: the reported test case --------------------------------

  const payload = (edit = () => {}) => {
    const p = {
      meta: { disclaimer_accepted: true, unit_system: 'SI', method: 'GENERAL' },
      tank: { shape: 'VERTICAL_CYLINDER', volume: 785, mawp: 3.5, mawv: 0.5, diameter: 10, height_or_length: 10 },
      fluid: {
        vapor_pressure_class: 'HIGHER', relieving_temp: 37.5, max_fill_rate: 200, max_empty_rate: 150,
        latent_heat: 357_000, molecular_weight: 72.15,
      },
      environment: {
        latitude_zone: 'BELOW_42N', insulation_type: 'FULLY_INSULATED',
        insulation_thickness: 100, insulation_conductivity: 0.04, inside_htc: 4,
      },
      scenarios: {},
      fire: { include: true, basis: 'FLUID', environmental_factor: 'INSULATED' },
      devices: [],
    };
    edit(p);
    return p;
  };
  const gooseneck = (fa) => ({
    type: 'FREE_VENT', direction: 'BOTH', capacity_source: 'calculated', pipe_diameter: 202.7, discharge_coefficient: 0.5,
    ...(fa ? { flame_arrestor: { ...fa, arrestor_class_key: 'END_OF_LINE_DEFLAGRATION' } } : {}),
  });
  const hasWarning = (r, text, severity) => r.warnings.some(w => w.message.includes(text) && (!severity || w.severity === severity));
  const audit = (r, label) => {
    const row = r.intermediates.find(([l]) => l === label);
    return row ? row[1] : NaN;
  };

  group = 'runCalculation: gooseneck + arrestor';
  const withFA = runCalculation(payload(p => { p.devices = [gooseneck(FA)]; }));
  const noFA = runCalculation(payload(p => { p.devices = [gooseneck(null)]; }));
  equal('No errors', withFA.errors.length, 0);
  const dev = withFA.outputs.actual_venting.devices[0];
  near('Without arrestor: out-breathing', noFA.outputs.actual_venting.devices[0].flow_out, 4004.1, 0.05);
  near('Without arrestor: inbreathing', noFA.outputs.actual_venting.devices[0].flow_in, 1567.5, 0.05);
  within('With arrestor: out-breathing', dev.flow_out, 2956, 0.03);
  within('With arrestor: inbreathing', dev.flow_in, 1150, 0.03);
  near('Device row shows the undereated out-breathing capacity', dev.arrestor.out.unarrested_flow, 4004.1, 0.05);
  near('Device row shows the undereated inbreathing capacity', dev.arrestor.in.unarrested_flow, 1567.5, 0.05);
  equal('Device row effective out-breathing = derated flow', dev.arrestor.out.effective_flow, dev.flow_out);
  within('ΔP at the converged flow (mbar)', dev.arrestor.out.deltaP_mbar, 15.9, 0.03);
  within('Budget at the converged flow (%)', dev.arrestor.out.budget_pct, 46, 0.03);
  ok('Old "capacity is not reduced" notice removed', !hasWarning(withFA, 'not reduced'));
  ok('Note that capacities include the arrestor ΔP', hasWarning(withFA, 'include the arrestor pressure drop', 'NOTICE'));
  near('Audit: arrestor K', audit(withFA, 'Device #1 arrestor — K'), 3.5, 0);
  near('Audit: arrestor ID (mm)', audit(withFA, 'Device #1 arrestor — nominal ID'), 203.2, 1e-9);
  near('Audit: density basis M', audit(withFA, 'Device #1 arrestor, out-breathing — density basis M'), 28.96, 0);
  near('Audit: density basis T (out = vapour 37.5 °C)', audit(withFA, 'Device #1 arrestor, out-breathing — density basis T'), 310.65, 1e-9);
  near('Audit: density basis P (out = Patm + MAWP)', audit(withFA, 'Device #1 arrestor, out-breathing — density basis P'), 104.825, 1e-9);
  near('Audit: density basis T (in = ambient 15.6 °C)', audit(withFA, 'Device #1 arrestor, inbreathing — density basis T'), 288.75, 1e-9);
  near('Audit: density basis P (in = Patm)', audit(withFA, 'Device #1 arrestor, inbreathing — density basis P'), 101.325, 1e-9);

  const rated2 = runCalculation(payload(p => {
    p.devices = [{ type: 'FREE_VENT', direction: 'BOTH', capacity_source: 'manufacturer',
      rated_flow_outbreathing: 4004.1, rated_flow_inbreathing: 1567.5, flame_arrestor: FA }];
  }));
  within('Manufacturer-rated vent + arrestor: out-breathing', rated2.outputs.actual_venting.devices[0].flow_out, 2956, 0.03);
  ok('Manufacturer-rated vent: √p scaling assumption noted', hasWarning(rated2, 'scaled as Q ∝ √p', 'NOTICE'));

  const bigK = runCalculation(payload(p => { p.devices = [gooseneck({ K: 1e9, diameter_m: 0.2032 })]; }));
  const bigDev = bigK.outputs.actual_venting.devices[0];
  ok('Very large K: capacity ≈ 0', bigDev.flow_out < 5 && bigDev.flow_in < 5, `${bigDev.flow_out} / ${bigDev.flow_in}`);
  equal('Very large K: badge', bigDev.arrestor.badge, 'FAIL');
  ok('Very large K: adequacy fails', bigK.outputs.actual_venting.adequacy.normal_out === false);
  ok('Non-finite K is rejected', runCalculation(payload(p => { p.devices = [gooseneck({ K: Infinity, diameter_m: 0.2032 })]; }))
    .errors.some(e => e.includes('flame arrestor K')));

  // --- Problem 2: insulated F below Table 9 ------------------------------------

  group = 'Table 9 insulated F range';
  const ins = runCalculation(payload());
  const ev = ins.outputs.emergency_venting;
  near('F extrapolated with note b (0.04 / 0.1 → 0.4 W/m²K)', engine.calcEnvironmentalFactor('INSULATED', { thickness_m: 0.1, conductivity: 0.04 }), 0.005364, 0.000001);
  near('Required venting unchanged (default result)', ev.required, 116.7, 0.05);
  ok('Extrapolation flagged in the fire results', ev.table9_extrapolated != null);
  equal('Table 9 minimum F', ev.table9_extrapolated.F_min, 0.025);
  near('Venting at Table 9 minimum F', ev.table9_extrapolated.required_at_F_min, 544.0, 0.05);
  ok('WARNING in the warnings list', hasWarning(ins, 'below the lowest tabulated Table 9 row', 'WARNING'));
  ok('Warning gives the Table 9 minimum flow and asks for judgment',
    hasWarning(ins, '544 Nm³/h') && hasWarning(ins, 'Engineering judgment is required'));
  ok('Note-a notice kept', hasWarning(ins, 'Table 9 note a', 'NOTICE'));
  const thin = runCalculation(payload(p => { p.environment.insulation_thickness = 10; }));   // 4 W/m²K
  ok('No Table 9 warning at 4 W/m²K', !hasWarning(thin, 'Table 9 row') && thin.outputs.emergency_venting.table9_extrapolated == null);

  // --- Problem 3a: regression values (hand calculation) ------------------------

  group = 'Regression (hand calc)';
  const nv = ins.outputs.normal_venting;
  near('Rᵢ', nv.Ri, 0.0909, 0.00005);
  near('Thermal out-breathing', nv.thermal_out, 11.7, 0.05);
  near('Thermal inbreathing', nv.thermal_in, 62.8, 0.05);
  near('Liquid out-breathing', nv.liquid_out, 400, 0.05);
  near('Liquid inbreathing', nv.liquid_in, 150, 0.05);
  near('Total normal out-breathing', nv.total_out, 411.7, 0.05);
  near('Total normal inbreathing', nv.total_in, 212.8, 0.05);
  near('Wetted area (m²)', ev.wetted_area, 287.1, 0.05);
  near('Heat input Q (W)', ev.heat_input, 4_129_700, 0.5);

  const fireAt = (edit) => runCalculation(payload(edit)).outputs.emergency_venting.required;
  near('Fire q at F = 1', fireAt(p => { p.fire.environmental_factor = 'BARE'; }), 21_761, 0.5);
  near('Fire q at F = 0.005364', ev.required, 116.7, 0.05);
  near('Fire q at F = 0.025', fireAt(p => { Object.assign(p.fire, { environmental_factor: 'CUSTOM', custom_factor: 0.025 }); }), 544.0, 0.05);

  const scenario = (key, data) => runCalculation(payload(p => {
    p.scenarios = { [key]: { enabled: true, relieved_by: 'NORMAL', ...data } };
  }));
  const cv = scenario('control_valve_failure', { failed_inflow: 300, failed_outflow: 250, coincident: true }).outputs.scenarios[0];
  near('Control valve failure out (incl. normal)', cv.total_out, 611.7, 0.05);
  near('Control valve failure in (incl. normal)', cv.total_in, 312.8, 0.05);
  const exo = scenario('exothermic_reaction', { heat_input: 300, gas_generation: 250, gas_mw: 44.01 }).outputs.scenarios[0];
  near('Exothermic reaction (not coincident)', exo.total_out, 1748, 0.5);
  const vb = scenario('pressure_transfer_vapor_breakthrough', { supply_pressure: 500, diameter: 50, cd: 0.62, gas_mw: 28.01 });
  near('Vapor breakthrough', vb.outputs.scenarios[0].total_out, 5169, 0.5);

  // --- Problem 3b: inputs echoed to the audit trail ----------------------------

  group = 'Audit trail';
  const vbLabel = (l) => audit(vb, `Pressure transfer / vapor breakthrough — ${l}`);
  near('Breakthrough supply pressure (kPa(g))', vbLabel('Supply pressure'), 500, 0);
  near('Breakthrough flow diameter (mm)', vbLabel('Flow diameter'), 50, 1e-9);
  near('Breakthrough Cd', vbLabel('Discharge coefficient Cd'), 0.62, 0);
  near('Breakthrough gas temperature used (°C)', vbLabel('Gas temperature (nozzle flow)'), 15.6, 1e-9);
  near('Breakthrough vent temperature used (K)', vbLabel('Vent temperature (air equivalent)'), 310.65, 1e-9);

  // --- Two-phase venting (DIERS drift flux, homogeneous vessel, omega method) --

  group = 'Two-phase venting';
  near('η_c(ω = 1) = e^−½ (isothermal ideal gas)', engine.omegaCriticalRatio(1), Math.exp(-0.5), 1e-12);
  const api520Fit = (w) => Math.pow(1 + (1.0446 - 0.0093431 * Math.sqrt(w)) * Math.pow(w, -0.56261), -0.70356 + 0.014685 * Math.log(w));
  for (const w of [0.5, 2, 10, 100]) within(`η_c(ω = ${w}) matches the API 520 explicit fit`, engine.omegaCriticalRatio(w), api520Fit(w), 0.001);
  {
    const ec = engine.omegaCriticalRatio(5);
    within('Mass flux continuous at η_c (ω = 5)', engine.omegaMassFlux(5, 1e5, 1e5 * (ec + 1e-8), 0.01).G,
      engine.omegaMassFlux(5, 1e5, 1e5 * (ec - 1e-8), 0.01).G, 1e-6);
  }
  near('Churn-turbulent α = ψ / (2 + 1.5ψ) at ψ = 0.248', engine.averageVoidFraction('CHURN', 0.248), 0.248 / (2 + 1.5 * 0.248), 1e-12);
  {
    const a = engine.averageVoidFraction('BUBBLY', 0.3);
    near('Bubbly α satisfies ψ = α(1−α)² / ((1−α³)(1−1.2α))', a * (1 - a) ** 2 / ((1 - a ** 3) * (1 - 1.2 * a)), 0.3, 1e-9);
  }
  near('Horizontal cylinder half full: surface = D × L', engine.liquidSurfaceArea('HORIZONTAL_CYLINDER', 4, 10, 0.5), 40, 1e-6);
  near('Sphere half full: surface = πR²', engine.liquidSurfaceArea('SPHERE', 10, null, 0.5), Math.PI * 25, 1e-6);
  {
    const rated = nozzle(P_ATM + 3.5, P_ATM, 288.75);
    within('Cd·A backed out of an air rating = true Cd·A', engine.effectiveAreaFromAirRating(rated, 3.5), CD * Math.PI * PIPE_ID ** 2 / 4, 1e-9);
  }
  {
    const Q = 300e3, L = 357000, M = 72.15, rhoL = 650, T0 = 310.65, P0 = 104.825;
    const r = engine.evaluateTwoPhase({ sources: [{ kind: 'vapor', kgS: Q / L, M }], regime: 'HOMOGENEOUS', fillFraction: 0.8,
      rhoL, Cp: 2200, sigma: 0.02, latent: L, fluidM: M, T0_K: T0, P0_kPa: P0, Pa_kPa: P_ATM,
      tank: { volume_m3: 785, shape: 'VERTICAL_CYLINDER', diameter_m: 10, length_m: 10 }, ventArea: null });
    const vfg = 8314.46 * T0 / (P0 * 1000 * M) - 1 / rhoL;
    within('Homogeneous vessel W = Q·v_fg / (v·h_fg) (Leung)', r.required_kgS, Q * vfg / (r.vAvg * L), 1e-12);
  }

  const tpPayload = (regime, fill) => payload(p => {
    Object.assign(p.environment, { insulation_type: 'UNINSULATED' });
    p.fire.environmental_factor = 'BARE';
    p.scenarios = { exothermic_reaction: { enabled: true, relieved_by: 'NORMAL', heat_input: 300, gas_generation: 250, gas_mw: 44.01 } };
    p.two_phase = { enabled: true, regime, fill_percent: fill, liquid_density: 650, liquid_cp: 2200, surface_tension: 20,
      scenarios: ['fire', 'exothermic_reaction'] };
    p.devices = [gooseneck(null), { type: 'EPRV', direction: 'OUTBREATHING', set_pressure: 2.5, rated_flow_outbreathing: 25000, rated_overpressure_pct: 10 }];
  });
  const churn80 = runCalculation(tpPayload('CHURN', 80));
  equal('Churn-turbulent, 80 % full: no errors', churn80.errors.length, 0);
  ok('Churn-turbulent, 80 % full: vapor-only venting for fire and exothermic',
    churn80.outputs.two_phase.items.every(t => t.two_phase === false), churn80.outputs.two_phase.items.map(t => t.swell_pct).join(' / '));
  near('Churn-turbulent, 80 % full: fire swell (% of tank)', churn80.outputs.two_phase.items[0].swell_pct, 89.4, 0.05);
  const churn92 = runCalculation(tpPayload('CHURN', 92));
  ok('Churn-turbulent, 92 % full: fire becomes two-phase', churn92.outputs.two_phase.items[0].two_phase === true);
  equal('Churn-turbulent, 92 % full: two-phase deficiency flagged', churn92.outputs.actual_venting.adequacy.two_phase, false);
  const foamy = runCalculation(tpPayload('HOMOGENEOUS', 80));
  const foamyExo = foamy.outputs.two_phase.items.find(t => t.label === 'Exothermic reaction');
  ok('Foamy: exothermic reaction vents two-phase', foamyExo.two_phase === true);
  within('Foamy: exothermic required Cd·A (m²)', foamyExo.required_area, 0.1531, 0.002);
  ok('Two-phase check off: no two-phase output', runCalculation(payload()).outputs.two_phase === null);
  ok('Two-phase check validates its inputs', runCalculation(payload(p => { p.two_phase = { enabled: true, scenarios: [] }; }))
    .errors.some(e => e.startsWith('Two-phase check')));

  // --- Report -------------------------------------------------------------------

  const failed = results.filter(r => !r.pass);
  if (isNode) {
    let last = '';
    for (const r of results) {
      if (r.group !== last) console.log(`\n${(last = r.group)}`);
      console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}: ${r.actual}${r.pass ? '' : `  (expected ${r.expected})`}`);
    }
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exitCode = failed.length ? 1 : 0;
  } else {
    const cell = (tag, text, cls) => {
      const el = document.createElement(tag);
      el.textContent = text;
      if (cls) el.className = cls;
      return el;
    };
    const summary = document.getElementById('summary');
    summary.textContent = `${results.length - failed.length}/${results.length} passed`;
    summary.className = failed.length ? 'fail' : 'pass';
    const tbody = document.getElementById('results');
    for (const r of results) {
      const tr = document.createElement('tr');
      tr.append(cell('td', r.pass ? 'PASS' : 'FAIL', r.pass ? 'pass' : 'fail'), cell('td', r.group),
        cell('td', r.name), cell('td', r.actual), cell('td', r.expected));
      tbody.append(tr);
    }
  }
})();
