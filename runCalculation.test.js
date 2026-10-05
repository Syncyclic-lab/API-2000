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
    abnormal_scenarios: {},
    fire: { include: true, environmental_factor: 'BARE' },
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
    expect(r.outputs.governing.emergency_governs).toBe(true);
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

  it('applies Eq. 14 when the fluid properties are given', () => {
    const r = runCalculation(payload(p => {
      Object.assign(p.fluid, { latent_heat: 334_900, molecular_weight: 86.17, relieving_temp: 0 });
      p.fire.environmental_factor = 'IMPOUNDMENT';
    }));
    expect(r.outputs.emergency_venting.basis).toBe('FLUID');
    expect(r.outputs.emergency_venting.F).toBe(0.5);
    expect(Math.abs(r.outputs.emergency_venting.required - 0.5 * 19_910) / 9_955).toBeLessThan(0.001);
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
