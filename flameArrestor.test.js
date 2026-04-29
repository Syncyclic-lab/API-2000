/**
 * @jest-environment jsdom
 */

require('./constants.js');
require('./api2000Engine.js');
require('./flameArrestor.js');

const engine = window.API2000.engine;
const PHYSICAL = window.API2000.PHYSICAL;

describe('evaluateFlameArrestor', () => {

  // Helper to assert properties are close
  const assertClose = (a, b, tolPct = 2) => {
    const rel = Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
    expect(rel).toBeLessThanOrEqual(tolPct / 100);
  };

  it('Case 1: Sanity, air at STP - happy path', () => {
    const result = engine.evaluateFlameArrestor({
      K: 5,
      diameter_m: 0.1016,
      flow_Nm3hr: 1000,
      molecular_weight: 28.96,
      compressibility_factor: 1.0,
      relieving_temperature_C: 20,
      relieving_pressure_kPa_abs: 101.325,
    });

    // Result formatting structure check
    expect(result).toHaveProperty('deltaP_Pa');
    expect(result).toHaveProperty('deltaP_kPa');
    expect(result).toHaveProperty('deltaP_mbar');
    expect(result).toHaveProperty('deltaP_inH2O');
    expect(result).toHaveProperty('velocity_m_s');
    expect(result).toHaveProperty('density_kg_m3');
    expect(result).toHaveProperty('area_m2');
    expect(result).toHaveProperty('Q_actual_m3s');
    expect(result).toHaveProperty('T_actual_K');

    // Values close to dev mode check
    assertClose(result.deltaP_Pa, 4069);
    assertClose(result.velocity_m_s, 36.77);
    assertClose(result.density_kg_m3, 1.2039);
  });

  it('Case 1: Q² scaling - doubling flow must 4x ΔP', () => {
    const baseResult = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0.1016, flow_Nm3hr: 1000,
      molecular_weight: 28.96, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: 101.325,
    });

    const scaledResult = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0.1016, flow_Nm3hr: 2000,
      molecular_weight: 28.96, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: 101.325,
    });

    assertClose(scaledResult.deltaP_Pa / baseResult.deltaP_Pa, 4.0, 0.5);
  });

  it('Case 1: 1/D⁴ scaling - halving diameter must 16x ΔP', () => {
    const baseResult = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0.1016, flow_Nm3hr: 1000,
      molecular_weight: 28.96, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: 101.325,
    });

    const scaledResult = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0.0508, flow_Nm3hr: 1000,
      molecular_weight: 28.96, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: 101.325,
    });

    assertClose(scaledResult.deltaP_Pa / baseResult.deltaP_Pa, 16.0, 0.5);
  });

  it('Case 3: Density correction - propane/air ratio', () => {
    const airResult = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0.1016, flow_Nm3hr: 1000,
      molecular_weight: 28.96, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: 101.325,
    });

    const propResult = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0.1016, flow_Nm3hr: 1000,
      molecular_weight: 44.0, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: 101.325,
    });

    assertClose(propResult.deltaP_Pa / airResult.deltaP_Pa, 44 / 28.96, 0.5);
  });

  it('Default values logic for optional parameters', () => {
    // Both calls should result in the same output when explicitly giving the defaults vs leaving them out
    const resultWithDefaults = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0.1016, flow_Nm3hr: 1000,
      molecular_weight: 28.96
    });

    const expectedTActual = 20 + PHYSICAL.C_TO_K;
    const expectedPActual = PHYSICAL.P_ATM_KPA;

    expect(resultWithDefaults.T_actual_K).toBe(expectedTActual);

    // Testing logic indirectly by providing identical explicit defaults
    const resultExplicit = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0.1016, flow_Nm3hr: 1000,
      molecular_weight: 28.96, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: PHYSICAL.P_ATM_KPA
    });

    expect(resultWithDefaults.deltaP_Pa).toBeCloseTo(resultExplicit.deltaP_Pa, 5);
  });



  it('Edge case: K=0 or diameter_m=0', () => {
    const zeroK = engine.evaluateFlameArrestor({
      K: 0, diameter_m: 0.1016, flow_Nm3hr: 1000,
      molecular_weight: 28.96, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: 101.325,
    });
    expect(zeroK.deltaP_Pa).toBe(0);

    const zeroD = engine.evaluateFlameArrestor({
      K: 5, diameter_m: 0, flow_Nm3hr: 1000,
      molecular_weight: 28.96, compressibility_factor: 1.0,
      relieving_temperature_C: 20, relieving_pressure_kPa_abs: 101.325,
    });
    expect(zeroD.deltaP_Pa).toBe(0);
  });
});
