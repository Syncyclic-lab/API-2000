/**
 * @jest-environment jsdom
 */

require('./constants.js');
require('./api2000Engine.js');

const engine = window.API2000.engine;
const { ANNEX_A, FIRE } = window.API2000;

// Relative-tolerance assertion (tol as a fraction).
const expectRel = (actual, expected, tol = 0.001) => {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(tol);
};

describe('interpolate', () => {
  it('returns table values at table points', () => {
    expect(engine.interpolate(ANNEX_A.TABLE_A3, 1000, 1)).toBe(169);
    expect(engine.interpolate(ANNEX_A.TABLE_A3, 30000, 2)).toBe(1497);
  });

  it('interpolates linearly between points', () => {
    expect(engine.interpolate(ANNEX_A.TABLE_A3, 3500, 1)).toBeCloseTo(537 + 320 / 820 * 110, 6);
  });

  it('scales proportionally below the first point', () => {
    expect(engine.interpolate(ANNEX_A.TABLE_A3, 5, 1)).toBeCloseTo(0.845, 6);
  });
});

describe('Normal venting — Annex A', () => {
  it('reads Table A.3 for non-volatile and volatile stocks', () => {
    expect(engine.calcThermalAnnexA(1000, false)).toEqual({ thermal_in: 169, thermal_out: 101 });
    expect(engine.calcThermalAnnexA(1000, true)).toEqual({ thermal_in: 169, thermal_out: 169 });
  });

  it('uses the Table A.1 liquid-movement factors', () => {
    const vol = engine.calcLiquidMovement('ANNEX_A', 100, 50, true);
    expect(vol.liquid_in).toBeCloseTo(47, 9);
    expect(vol.liquid_out).toBeCloseTo(202, 9);
    expect(engine.calcLiquidMovement('ANNEX_A', 100, 50, false).liquid_out).toBeCloseTo(101, 9);
  });
});

describe('Normal venting — §3.3.2 general method', () => {
  it('applies Eq. 7 and Eq. 9 with Table 1 and Table 2 factors', () => {
    const r = engine.calcThermalGeneral(1000, 'BETWEEN_42N_AND_58N', 'HEXANE', 20, 1);
    expect(r.Y).toBe(0.25);
    expect(r.C).toBe(3);
    expectRel(r.thermal_out, 0.25 * Math.pow(1000, 0.9));
    expectRel(r.thermal_in, 3 * Math.pow(1000, 0.7));
  });

  it('selects the C-factor from vapour pressure and average storage temperature', () => {
    const C = (lat, vp, t) => engine.calcThermalGeneral(100, lat, vp, t, 1).C;
    expect(C('BELOW_42N', 'HEXANE', 20)).toBe(4);
    expect(C('BELOW_42N', 'HEXANE', 25)).toBe(6.5);
    expect(C('BELOW_42N', 'HIGHER', 20)).toBe(6.5);
    expect(C('ABOVE_58N', 'NONVOLATILE', 10)).toBe(2.5);
    expect(C('BETWEEN_42N_AND_58N', 'HEXANE', null)).toBe(5); // unknown temperature → conservative
  });

  it('uses the Eq. 1/3/5 liquid-movement factors', () => {
    expect(engine.calcLiquidMovement('GENERAL', 100, 50, true)).toEqual({ liquid_in: 50, liquid_out: 200 });
    expect(engine.calcLiquidMovement('GENERAL', 100, 50, false)).toEqual({ liquid_in: 50, liquid_out: 100 });
  });

  it('reproduces the Eq. 11 example (R_in = 0.11) and Eq. 12/13', () => {
    const ins = { thickness_m: 0.1, conductivity: 0.05, h_inside: 4 };
    expect(engine.calcInsulationReduction({ ...ins, insulation_type: 'FULLY_INSULATED' })).toBeCloseTo(1 / 9, 9);
    expect(engine.calcInsulationReduction({ ...ins, h_inside: null, insulation_type: 'FULLY_INSULATED' })).toBeCloseTo(1 / 9, 9);
    expect(engine.calcInsulationReduction({ ...ins, insulation_type: 'PARTIALLY_INSULATED', coverage_fraction: 0.5 }))
      .toBeCloseTo(0.5 / 9 + 0.5, 9);
    expect(engine.calcInsulationReduction({ insulation_type: 'DOUBLE_WALL', outside_containment_fraction: 0.4 })).toBeCloseTo(0.55, 9);
    expect(engine.calcInsulationReduction({ insulation_type: 'UNINSULATED' })).toBe(1);
  });
});

describe('Wetted area (Table 5 note a)', () => {
  it('vertical cylinder: shell within 9.14 m of grade', () => {
    expect(engine.calcWettedArea('VERTICAL_CYLINDER', 10, 20, 0).wetted_area_m2).toBeCloseTo(Math.PI * 10 * 9.14, 6);
    expect(engine.calcWettedArea('VERTICAL_CYLINDER', 10, 20, 2).wetted_area_m2).toBeCloseTo(Math.PI * 10 * 7.14, 6);
    expect(engine.calcWettedArea('VERTICAL_CYLINDER', 10, 5, 0).wetted_area_m2).toBeCloseTo(Math.PI * 10 * 5, 6);
    expect(engine.calcWettedArea('VERTICAL_CYLINDER', 10, 20, 10).wetted_area_m2).toBe(0);
  });

  it('horizontal cylinder: greater of 75 % of total and the surface within 9.14 m', () => {
    const total = Math.PI * 3 * 10 + 2 * Math.PI * 1.5 * 1.5;
    const atGrade = engine.calcWettedArea('HORIZONTAL_CYLINDER', 3, 10, 0);
    expect(atGrade.wetted_area_m2).toBeCloseTo(total, 6);
    expect(atGrade.limit_governs).toBe(true);
    const elevated = engine.calcWettedArea('HORIZONTAL_CYLINDER', 3, 10, 10);
    expect(elevated.wetted_area_m2).toBeCloseTo(0.75 * total, 6);
    expect(elevated.limit_governs).toBe(false);

    // Limit cuts through a 10 m diameter tank.
    const R = 5;
    const theta = 2 * Math.acos(1 - 9.14 / R);
    const below = theta * R * 20 + R * R * (theta - Math.sin(theta));
    expect(engine.calcWettedArea('HORIZONTAL_CYLINDER', 10, 20, 0).wetted_area_m2).toBeCloseTo(below, 6);
  });

  it('sphere: greater of 55 % of total and the surface within 9.14 m', () => {
    expect(engine.calcWettedArea('SPHERE', 20, null, 0).wetted_area_m2).toBeCloseTo(0.55 * Math.PI * 400, 6);
    expect(engine.calcWettedArea('SPHERE', 5, null, 0).wetted_area_m2).toBeCloseTo(Math.PI * 25, 6);
    expect(engine.calcWettedArea('SPHERE', 10, null, 10).wetted_area_m2).toBeCloseTo(0.55 * Math.PI * 100, 6);
  });

  it('throws for missing dimensions', () => {
    expect(() => engine.calcWettedArea('VERTICAL_CYLINDER', null, 10, 0)).toThrow();
    expect(() => engine.calcWettedArea('HORIZONTAL_CYLINDER', 3, null, 0)).toThrow();
  });
});

describe('Fire heat input (Table 3)', () => {
  it('evaluates each band', () => {
    expect(engine.calcFireHeatInput(10, 0)).toBeCloseTo(631_500, 6);
    expect(engine.calcFireHeatInput(50, 0)).toBeCloseTo(224_200 * Math.pow(50, 0.566), 6);
    expect(engine.calcFireHeatInput(100, 0)).toBeCloseTo(630_400 * Math.pow(100, 0.338), 6);
    expect(engine.calcFireHeatInput(300, 7)).toBe(4_129_700);
    expect(engine.calcFireHeatInput(300, 10)).toBeCloseTo(43_200 * Math.pow(300, 0.82), 6);
  });

  it('is continuous across band boundaries', () => {
    for (const A of [18.6, 93, 260]) {
      expectRel(engine.calcFireHeatInput(A - 1e-9, 50), engine.calcFireHeatInput(A, 50), 0.002);
    }
    expectRel(engine.calcFireHeatInput(259.999, 0), engine.calcFireHeatInput(260, 0), 0.001);
  });
});

describe('Environmental factor (Table 9)', () => {
  it('reproduces the insulated F-factors from conductance', () => {
    const F = (U) => engine.calcEnvironmentalFactor('INSULATED', { thickness_m: 1, conductivity: U });
    expect(F(22.7)).toBeCloseTo(0.3, 2);
    expect(F(11.4)).toBeCloseTo(0.15, 2);
    expect(F(5.7)).toBeCloseTo(0.075, 2);
    expect(F(1.9)).toBeCloseTo(0.025, 2);
    expect(F(1e6)).toBe(1);
  });

  it('returns the fixed and custom factors', () => {
    expect(engine.calcEnvironmentalFactor('BARE')).toBe(1);
    expect(engine.calcEnvironmentalFactor('IMPOUNDMENT')).toBe(0.5);
    expect(engine.calcEnvironmentalFactor('EARTH_COVERED')).toBe(0.03);
    expect(engine.calcEnvironmentalFactor('UNDERGROUND')).toBe(0);
    expect(engine.calcEnvironmentalFactor('CUSTOM', { custom: 0.42 })).toBe(0.42);
  });
});

describe('Emergency venting (Eq. 14)', () => {
  const { L, M, T_K } = FIRE.HEXANE;
  const hexane = (Q, F = 1) => engine.calcEmergencyVenting(Q, F, L, M, T_K).emergency_out;

  it('reproduces Table 5 (19,910 Nm³/h) on the hexane basis', () => {
    expectRel(hexane(4_129_700), 19_910);
  });

  it('reproduces Table 7 and the Eq. 16 constant (208.2)', () => {
    expectRel(hexane(engine.calcFireHeatInput(50, 0)), 9_895);
    expectRel(hexane(engine.calcFireHeatInput(200, 0)), 18_220);
    expectRel(hexane(engine.calcFireHeatInput(500, 10), 0.5), 208.2 * 0.5 * Math.pow(500, 0.82));
  });

  it('reports the vapour generation rate Q·F/L', () => {
    const r = engine.calcEmergencyVenting(1e6, 0.5, 250_000, 50, 300);
    expect(r.vapour_mass_flow_kg_hr).toBeCloseTo(1e6 * 0.5 / 250_000 * 3600, 9);
    expect(r.emergency_out).toBeCloseTo(906.6 * 2 * Math.sqrt(300 / 50), 9);
  });
});

describe('calculateOpenVentCapacity', () => {
  it('returns 0 when any required argument is missing or zero', () => {
    expect(engine.calculateOpenVentCapacity(0,   110, 101.325, 1.4, 300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 0,   101.325, 1.4, 300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 110, 0,       1.4, 300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 110, 101.325, 0,   300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 110, 101.325, 1.4, 0,   29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 110, 101.325, 1.4, 300, 0,  1.0, 0.62)).toBe(0);
  });

  it('returns 0 when outlet pressure >= inlet pressure', () => {
    expect(engine.calculateOpenVentCapacity(0.1, 101.325, 101.325, 1.4, 300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 100, 101.325, 1.4, 300, 29, 1.0, 0.62)).toBe(0);
  });

  it('computes subsonic flow (r > r_crit)', () => {
    expectRel(engine.calculateOpenVentCapacity(0.1, 110, 101.325, 1.4, 300, 29, 1.0, 0.62), 1931.3);
  });

  it('computes choked flow (r <= r_crit), continuous with subsonic flow', () => {
    expectRel(engine.calculateOpenVentCapacity(0.1, 250, 101.325, 1.4, 300, 29, 1.0, 0.62), 7908.4);
    const rCrit = Math.pow(2 / 2.4, 1.4 / 0.4);
    const pCrit = 101.325 / rCrit;
    expectRel(
      engine.calculateOpenVentCapacity(0.1, pCrit * 0.999, 101.325, 1.4, 300, 29, 1, 0.62),
      engine.calculateOpenVentCapacity(0.1, pCrit * 1.001, 101.325, 1.4, 300, 29, 1, 0.62),
      0.003);
    // Choked flow is proportional to inlet pressure.
    expectRel(
      engine.calculateOpenVentCapacity(0.1, 300, 101.325, 1.4, 300, 29, 1, 0.62) /
      engine.calculateOpenVentCapacity(0.1, 250, 101.325, 1.4, 300, 29, 1, 0.62), 1.2, 1e-9);
  });
});

describe('Installed devices', () => {
  it('calcDeviceFlow applies a linear partial lift between set and rated pressure', () => {
    expect(engine.calcDeviceFlow(1, 100, 10, 0.5)).toBe(0);
    expect(engine.calcDeviceFlow(1, 100, 10, 1.05)).toBeCloseTo(50, 9);
    expect(engine.calcDeviceFlow(1, 100, 10, 1.1)).toBe(100);
    expect(engine.calcDeviceFlow(1, 100, 0, 1.01)).toBe(100);
    expect(engine.calcDeviceFlow(null, 100, 10, 2)).toBe(0);
  });

  it('calcActualVenting separates normal, emergency and inbreathing capacity', () => {
    const r = engine.calcActualVenting([
      { type: 'PVRV', direction: 'BOTH', set_pressure: 1, set_vacuum: 0.5, rated_flow_outbreathing: 100, rated_flow_inbreathing: 80, rated_overpressure_pct: 10 },
      { type: 'EPRV', direction: 'OUTBREATHING', set_pressure: 1.5, rated_flow_outbreathing: 500, rated_overpressure_pct: 10 },
      { type: 'FREE_VENT', direction: 'INBREATHING', rated_flow_inbreathing: 30 },
    ], 2, 1);
    expect(r.normal_out).toBe(100);
    expect(r.emergency_out).toBe(600);
    expect(r.inbreathing).toBe(110);
    expect(r.devices.map(d => [d.flow_out, d.flow_in])).toEqual([[100, 80], [500, 0], [0, 30]]);
  });
});
