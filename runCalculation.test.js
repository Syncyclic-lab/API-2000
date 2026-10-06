/**
 * @jest-environment jsdom
 */

require('./constants.js');
require('./unitConverter.js');
require('./api2000Engine.js');
require('./flameArrestor.js');
require('./index.js');

const { runCalculation, CONVERSIONS: C } = window.API2000;

// 1000 m³ vertical tank, volatile stock, atmospheric-ish design.
const payload = (edit = () => {}) => {
  const p = {
    meta: { disclaimer_accepted: true, unit_system: 'SI', method: 'ANNEX_A' },
    tank: { shape: 'VERTICAL_CYLINDER', volume: 1000, mawp: 2, mawv: 0.5, diameter: 12, height_or_length: 9 },
    fluid: { flash_point: 20, vapor_pressure_class: 'HEXANE', operating_temp: 20, max_fill_rate: 100, max_empty_rate: 100 },
    environment: { latitude_zone: 'BETWEEN_42N_AND_58N', insulation_type: 'UNINSULATED' },
    scenarios: {},
    fire: { include: true, basis: 'HEXANE', environmental_factor: 'BARE' },
    devices: [],
  };
  edit(p);
  return p;
};
const hasWarning = (r, text) => r.warnings.some(w => w.message.includes(text));

describe('runCalculation', () => {
  it('computes Annex A normal venting and the hexane-basis fire case', () => {
    const r = runCalculation(payload());
    expect(r.errors).toEqual([]);
    const nv = r.outputs.normal_venting;
    expect(nv.thermal_in).toBe(169);
    expect(nv.thermal_out).toBe(169);
    expect(nv.liquid_in).toBe(94);
    expect(nv.liquid_out).toBe(202);
    expect(nv.total_in).toBe(263);
    expect(nv.total_out).toBe(371);
    // π·12·9 = 339 m² ≥ 260 m² at ≤ 7 kPa(g) → Table 5: 19,910 Nm³/h
    const ev = r.outputs.emergency_venting;
    expect(ev.wetted_area).toBeCloseTo(339.3, 1);
    expect(ev.heat_input).toBe(4_129_700);
    expect(Math.abs(ev.required - 19_910) / 19_910).toBeLessThan(0.001);
    expect(r.outputs.governing.outbreathing_basis).toBe('Fire exposure');
    expect(r.outputs.design.normal_out_basis).toBe('Normal venting');
    expect(hasWarning(r, 'hexane basis')).toBe(true);
  });

  it('computes the §3.3.2 general method', () => {
    const r = runCalculation(payload(p => { p.meta.method = 'GENERAL'; }));
    const nv = r.outputs.normal_venting;
    expect(nv.C).toBe(3);
    expect(nv.thermal_in).toBeCloseTo(3 * Math.pow(1000, 0.7), 1);
    expect(nv.thermal_out).toBeCloseTo(0.25 * Math.pow(1000, 0.9), 1);
    expect(nv.liquid_in).toBe(100);
    expect(nv.liquid_out).toBe(200);
  });

  it('converts SI insulation thickness from millimetres (Eq. 11 example: R_in = 0.11)', () => {
    const r = runCalculation(payload(p => {
      p.meta.method = 'GENERAL';
      Object.assign(p.environment, { insulation_type: 'FULLY_INSULATED', insulation_thickness: 100, insulation_conductivity: 0.05 });
    }));
    expect(r.errors).toEqual([]);
    expect(r.outputs.normal_venting.Ri).toBeCloseTo(0.1111, 4);
  });

  it('gives the same results in US units (SCFH at 60 °F ↔ Nm³/h at 0 °C)', () => {
    const si = runCalculation(payload()).outputs;
    const us = runCalculation(payload(p => {
      p.meta.unit_system = 'US';
      Object.assign(p.tank, {
        volume: 1000 / C.BBL_TO_M3, mawp: 2 / C.PSI_TO_KPA, mawv: 0.5 / C.PSI_TO_KPA,
        diameter: 12 / C.FT_TO_M, height_or_length: 9 / C.FT_TO_M,
      });
      Object.assign(p.fluid, { flash_point: 68, operating_temp: 68, max_fill_rate: 100 / C.BBL_TO_M3, max_empty_rate: 100 / C.BBL_TO_M3 });
    })).outputs;
    expect(us.flow_unit).toBe('SCFH');
    for (const key of ['thermal_in', 'total_in', 'total_out']) {
      expect(Math.abs(us.normal_venting[key] * C.SCF_TO_NM3 / si.normal_venting[key] - 1)).toBeLessThan(0.001);
    }
    expect(Math.abs(us.emergency_venting.required * C.SCF_TO_NM3 / si.emergency_venting.required - 1)).toBeLessThan(0.001);
    // Table A.4: 1 SCFH of thermal inbreathing per barrel below 20,000 bbl.
    expect(Math.abs(us.normal_venting.thermal_in / (1000 / C.BBL_TO_M3) - 1)).toBeLessThan(0.01);
  });

  it('applies Eq. 14 to the stored fluid when that basis is selected', () => {
    const r = runCalculation(payload(p => {
      Object.assign(p.fluid, { latent_heat: 334_900, molecular_weight: 86.17, relieving_temp: 0 });
      Object.assign(p.fire, { basis: 'FLUID', environmental_factor: 'IMPOUNDMENT' });
    }));
    expect(r.outputs.emergency_venting.basis).toBe('FLUID');
    expect(r.outputs.emergency_venting.F).toBe(0.5);
    expect(Math.abs(r.outputs.emergency_venting.required - 0.5 * 19_910) / 9_955).toBeLessThan(0.001);

    // Water at 100 °C: Eq. 14 differs strongly from the hexane basis.
    const water = runCalculation(payload(p => {
      Object.assign(p.fluid, { latent_heat: 2_257_000, molecular_weight: 18.02, relieving_temp: 100 });
      p.fire.basis = 'FLUID';
    }));
    const expected = 906.6 * (4_129_700 / 2_257_000) * Math.sqrt(373.15 / 18.02);
    expect(Math.abs(water.outputs.emergency_venting.required / expected - 1)).toBeLessThan(0.001);
  });

  it('requires latent heat, molecular weight and relieving temperature for Eq. 14', () => {
    const r = runCalculation(payload(p => {
      p.fire.basis = 'FLUID';
      p.fluid.latent_heat = 300_000;
    }));
    expect(r.outputs).toBeUndefined();
    expect(r.errors[0]).toMatch(/molecular weight, relieving vapor temperature/);
  });

  it('warns when the hexane basis is used for a fluid that is not hexane-like', () => {
    const r = runCalculation(payload(p => {
      Object.assign(p.fluid, { latent_heat: 2_257_000, molecular_weight: 18.02, relieving_temp: 100 });
    }));
    expect(r.outputs.emergency_venting.basis).toBe('HEXANE');
    expect(hasWarning(r, 'not hexane-like')).toBe(true);
    const hexaneLike = runCalculation(payload(p => {
      Object.assign(p.fluid, { latent_heat: 334_900, molecular_weight: 86.17, relieving_temp: 0 });
    }));
    expect(hasWarning(hexaneLike, 'not hexane-like')).toBe(false);
  });

  it('reports validation errors instead of NaN results', () => {
    expect(runCalculation(payload(p => { p.tank.volume = undefined; })).errors[0]).toMatch(/tank volume/);
    expect(runCalculation(payload(p => { p.fluid.flash_point = undefined; })).errors[0]).toMatch(/Flash point/);
    expect(runCalculation(payload(p => { p.tank.mawp = undefined; })).errors[0]).toMatch(/MAWP/);
    expect(runCalculation(payload(p => { p.meta.disclaimer_accepted = false; })).errors[0]).toMatch(/disclaimer/);
    expect(runCalculation(payload(p => { p.tank.diameter = undefined; })).errors[0]).toMatch(/diameter/);
  });

  it('evaluates installed devices and flags valves that cannot open', () => {
    const r = runCalculation(payload(p => {
      p.devices = [
        { type: 'PVRV', direction: 'BOTH', set_pressure: 1, set_vacuum: 0.25, rated_flow_outbreathing: 400, rated_flow_inbreathing: 300, rated_overpressure_pct: 100 },
        { type: 'EPRV', direction: 'OUTBREATHING', set_pressure: 2, rated_flow_outbreathing: 30_000, rated_overpressure_pct: 10 },
      ];
    }));
    const av = r.outputs.actual_venting;
    expect(av.normal_out).toBe(400);
    expect(av.inbreathing).toBe(300);
    expect(av.adequacy.normal_out).toBe(true);
    expect(av.adequacy.inbreathing).toBe(true);
    expect(av.adequacy.emergency_out).toBe(false);   // EPRV set at MAWP provides nothing
    expect(hasWarning(r, 'at or above the tank MAWP')).toBe(true);
  });

  it('sizes calculated open vents on atmospheric tanks with the default allowable', () => {
    const r = runCalculation(payload(p => {
      p.tank.mawp = 0;
      p.tank.mawv = 0;
      p.fire.include = false;
      p.devices = [{ type: 'FREE_VENT', direction: 'BOTH', capacity_source: 'calculated', pipe_diameter: 150, discharge_coefficient: 0.5 }];
    }));
    const dev = r.outputs.actual_venting.devices[0];
    expect(dev.flow_out).toBeGreaterThan(0);
    expect(dev.flow_in).toBeGreaterThan(0);
    expect(r.outputs.actual_venting.adequacy.emergency_out).toBeNull();
    expect(hasWarning(r, 'default allowable')).toBe(true);
  });
});

describe('runCalculation — other circumstances (§3.2.5)', () => {
  const engine = window.API2000.engine;
  const withScenario = (key, data, edit = () => {}) => runCalculation(payload(p => {
    p.scenarios = { [key]: { enabled: true, relieved_by: 'NORMAL', ...data } };
    edit(p);
  }));
  const VENT_K = 293.15;   // operating temperature 20 °C
  const expectRel = (actual, expected, tol = 0.002) => {
    expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(tol);
  };

  it('control valve failure adds the increase over normal fill/empty to normal venting', () => {
    const r = withScenario('control_valve_failure', { failed_inflow: 300, failed_outflow: 250, coincident: true });
    const sc = r.outputs.scenarios[0];
    expect(sc.out).toBeCloseTo(200 * 2.02, 1);
    expect(sc.in).toBeCloseTo(150 * 0.94, 1);
    expect(r.outputs.design.normal_out).toBeCloseTo(371 + 404, 1);
    expect(r.outputs.design.normal_out_basis).toBe('Control valve failure');
    expect(r.outputs.design.inbreathing).toBeCloseTo(263 + 141, 1);
  });

  it('blanket gas failure converts the gas flow to air-equivalent flow', () => {
    const r = withScenario('blanket_gas_equipment_failure', { gas_mw: 28.01, known_flow: 500, vacuum_flow: 80 });
    const sc = r.outputs.scenarios[0];
    expectRel(sc.out, 500 * Math.sqrt(28.01 * VENT_K / (29 * 273.15)));
    expect(sc.in).toBe(80);
    expect(sc.total_out).toBe(sc.out);   // not coincident
  });

  it('blanket gas regulator failure uses choked nozzle flow when no capacity is given', () => {
    const r = withScenario('blanket_gas_equipment_failure', { supply_pressure: 700, diameter: 10, cd: 0.62, gas_mw: 28.01 });
    const gasNm3h = engine.calculateOpenVentCapacity(0.01, 801.325, 103.325, 1.4, 288.75, 28.01, 1, 0.62);
    expectRel(r.outputs.scenarios[0].out, engine.airEquivalentFlow(gasNm3h * 28.01 / 22.414, 28.01, VENT_K));
  });

  it('routes a scenario to the emergency path when selected', () => {
    const r = withScenario('pressure_transfer_vapor_breakthrough',
      { gas_mw: 28.96, known_flow: 30_000, relieved_by: 'EMERGENCY' });
    expect(r.outputs.design.emergency_out_basis).toBe('Pressure transfer / vapor breakthrough');
    expect(r.outputs.design.normal_out_basis).toBe('Normal venting');
  });

  it('abnormal heat transfer and exothermic reaction vaporize Q / L of the stored fluid', () => {
    const fluid = (p) => Object.assign(p.fluid, { latent_heat: 334_900, molecular_weight: 86.17 });
    const heat = withScenario('abnormal_heat_transfer', { heat_input: 1000 }, fluid);
    expectRel(heat.outputs.scenarios[0].out, 906.6 * (1e6 / 334_900) * Math.sqrt(VENT_K / 86.17));

    const rxn = withScenario('exothermic_reaction', { gas_generation: 100, gas_mw: 44 });
    expectRel(rxn.outputs.scenarios[0].out, 906.6 * (100 / 3600) * Math.sqrt(VENT_K / 44));
    expect(hasWarning(rxn, 'DIERS')).toBe(true);
  });

  it('requires fluid properties for heat-driven scenarios', () => {
    const r = withScenario('abnormal_heat_transfer', { heat_input: 1000 });
    expect(r.errors[0]).toMatch(/latent heat/);
  });

  it('internal heat exchanger failure models a double-ended tube rupture', () => {
    const r = withScenario('internal_heat_exchanger_failure',
      { supply_pressure: 1000, gas_temp: 184, diameter: 20, cd: 0.62, gas_mw: 18.02, k: 1.33 });
    const single = engine.calculateOpenVentCapacity(0.02, 1101.325, 103.325, 1.33, 457.15, 18.02, 1, 0.62);
    expectRel(r.outputs.scenarios[0].out, engine.airEquivalentFlow(2 * single * 18.02 / 22.414, 18.02, VENT_K));
  });

  it('uninsulated hot tank in rain sets the inbreathing requirement', () => {
    const r = withScenario('uninsulated_hot_tank_in_rain', { vapor_temp: 150 });
    const area = Math.PI * 12 * 9 + Math.PI * 36;
    expectRel(r.outputs.scenarios[0].in, engine.calcHotTankInbreathing(area, 4, 150 - 15.6, 423.15));
    expect(r.outputs.design.inbreathing_basis).toBe('Uninsulated hot tank in rain');
  });

  it('mixing of products vaporizes the flashed fraction of the volatile inflow', () => {
    const r = withScenario('mixing_of_products', { volatile_flow: 10, density: 650, flash_percent: 5, gas_mw: 58 });
    expectRel(r.outputs.scenarios[0].out, 906.6 * (325 / 3600) * Math.sqrt(VENT_K / 58));
  });

  it('atmospheric pressure change loads both directions', () => {
    const r = withScenario('atmospheric_pressure_change', { rate: 0.5, coincident: true });
    const q = 1000 * 0.5 / 101.325 * 273.15 / VENT_K;
    expectRel(r.outputs.scenarios[0].out, q, 0.01);
    expectRel(r.outputs.scenarios[0].in, q, 0.01);
  });

  it('liquid overfill adds no load and warns without overfill protection', () => {
    const r = withScenario('liquid_overfill', { protection_provided: false });
    expect(r.outputs.scenarios[0].out).toBe(0);
    expect(r.outputs.design.normal_out_basis).toBe('Normal venting');
    expect(hasWarning(r, 'overfill protection')).toBe(true);
  });

  it('converts US scenario inputs to SI', () => {
    const { uc } = window.API2000;
    expect(uc.toW(3412.142, 'US')).toBeCloseTo(1000, 3);
    expect(uc.toW(1, 'SI')).toBe(1000);
    expect(uc.toKgM3(1, 'US')).toBeCloseTo(16.01846, 5);
    expect(uc.toKgH(2.204623, 'US')).toBeCloseTo(1, 6);
  });
});
