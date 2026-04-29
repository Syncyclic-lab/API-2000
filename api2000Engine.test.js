/**
 * @jest-environment jsdom
 */

require('./constants.js');
require('./api2000Engine.js');

const engine = window.API2000.engine;
const FIRE_CASE = window.API2000.FIRE_CASE;

describe('Emergency Venting Logic Edge-Case Simulations', () => {

  describe('Wetted Area Limits (Strictly capped at 9.14 m / 30 ft above grade)', () => {

    it('Vertical cylinder wetted area is capped at 9.14 m above grade', () => {
      // Tank height 20m, elevated 0m
      const tank1 = { shape: 'VERTICAL_CYLINDER', dims: { diameter: 10, height_or_length: 20 }, elevation_above_grade: 0 };
      const res1 = engine.calcWettedArea(tank1);
      expect(res1.wetted_area_m2).toBeCloseTo(Math.PI * 10 * 9.14);

      // Tank height 20m, elevated 2m
      const tank2 = { shape: 'VERTICAL_CYLINDER', dims: { diameter: 10, height_or_length: 20 }, elevation_above_grade: 2 };
      const res2 = engine.calcWettedArea(tank2);
      expect(res2.wetted_area_m2).toBeCloseTo(Math.PI * 10 * (9.14 - 2));

      // Tank elevated completely above 9.14m
      const tank3 = { shape: 'VERTICAL_CYLINDER', dims: { diameter: 10, height_or_length: 20 }, elevation_above_grade: 10 };
      const res3 = engine.calcWettedArea(tank3);
      expect(res3.wetted_area_m2).toBe(0);
    });

    it('Horizontal cylinder wetted area is properly calculated given the grade limit', () => {
      // Tank diameter 10, length 20, elevated 0
      // 9.14m limit falls on the cylinder
      const tank1 = { shape: 'HORIZONTAL_CYLINDER', dims: { diameter: 10, height_or_length: 20 }, elevation_above_grade: 0 };
      const res1 = engine.calcWettedArea(tank1);

      const R = 5;
      const h_above_centre = 9.14 - 5; // 4.14
      const half_angle = Math.acos(h_above_centre / R);
      const wetted_angle_rad = 2 * (Math.PI - half_angle);
      const shell_area = wetted_angle_rad * R * 20;
      const head_area = 0.5 * R * R * (wetted_angle_rad - Math.sin(wetted_angle_rad));
      expect(res1.wetted_area_m2).toBeCloseTo(shell_area + head_area);

      // Tank diameter 10, length 20, elevated 10
      // Completely above 9.14m
      const tank2 = { shape: 'HORIZONTAL_CYLINDER', dims: { diameter: 10, height_or_length: 20 }, elevation_above_grade: 10 };
      const res2 = engine.calcWettedArea(tank2);
      expect(res2.wetted_area_m2).toBe(0);
    });

    it('Sphere wetted area is capped at 9.14 m above grade', () => {
      // Sphere diameter 10, elevated 0
      const tank1 = { shape: 'SPHERE', dims: { diameter: 10 }, elevation_above_grade: 0 };
      const res1 = engine.calcWettedArea(tank1);
      expect(res1.wetted_area_m2).toBeCloseTo(2 * Math.PI * 5 * 9.14);

      // Sphere elevated completely above 9.14m
      const tank2 = { shape: 'SPHERE', dims: { diameter: 10 }, elevation_above_grade: 10 };
      const res2 = engine.calcWettedArea(tank2);
      expect(res2.wetted_area_m2).toBe(0);
    });

  });

  describe('F-Factor Constraints (Environmental reduction factors)', () => {
    it('Applies F-factor correctly for bare tanks with and without drainage and fireproofing', () => {
      const wettedArea = 100;

      // No drainage, no fireproofing
      const res1 = engine.calcFireHeatInputBare(wettedArea, false, false);
      expect(res1.C_used).toBe(FIRE_CASE.NO_CREDIT);
      expect(res1.F_used).toBe(FIRE_CASE.F_BARE);

      // Drainage credit
      const res2 = engine.calcFireHeatInputBare(wettedArea, true, false);
      expect(res2.C_used).toBe(FIRE_CASE.DRAINAGE_CREDIT);
      expect(res2.F_used).toBe(FIRE_CASE.F_BARE);

      // Fireproofing credit
      const res3 = engine.calcFireHeatInputBare(wettedArea, false, true);
      expect(res3.C_used).toBe(FIRE_CASE.NO_CREDIT);
      expect(res3.F_used).toBe(FIRE_CASE.F_BARE * FIRE_CASE.FIREPROOFING_FACTOR);

      // Both drainage and fireproofing
      const res4 = engine.calcFireHeatInputBare(wettedArea, true, true);
      expect(res4.C_used).toBe(FIRE_CASE.DRAINAGE_CREDIT);
      expect(res4.F_used).toBe(FIRE_CASE.F_BARE * FIRE_CASE.FIREPROOFING_FACTOR);
    });

    it('Does not mutually compound F-factors beyond allowable limits (Insulation)', () => {
      const wettedArea = 100;
      const environment = {
        insulation_type: 'FULLY_INSULATED',
        insulation: { thermal_conductivity: 0.05, insulation_thickness: 0.1 }
      };

      const T_contents_C = 20;
      // Even if drainage or fireproofing are passed as true, it uses insulated_conduction, which doesn't use F-factors
      const res1 = engine.calcFireHeatInput(environment, wettedArea, T_contents_C, true, true);

      expect(res1.method).toBe('insulated_conduction');
      expect(res1.C_used).toBeNull();
      expect(res1.F_used).toBeNull();

      const expectedHeatInput = (0.05 / 0.1) * wettedArea * (904 - 20);
      expect(res1.heat_input_W).toBeCloseTo(expectedHeatInput);
    });
  });

});

describe('calculateOpenVentCapacity', () => {

  it('returns 0 when any required argument is missing or zero', () => {
    expect(engine.calculateOpenVentCapacity(0,   110,     101.325, 1.4, 300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 0,       101.325, 1.4, 300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 110,     0,       1.4, 300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 110,     101.325, 0,   300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 110,     101.325, 1.4, 0,   29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 110,     101.325, 1.4, 300, 0,  1.0, 0.62)).toBe(0);
  });

  it('returns 0 when outlet pressure >= inlet pressure (no flow)', () => {
    expect(engine.calculateOpenVentCapacity(0.1, 101.325, 101.325, 1.4, 300, 29, 1.0, 0.62)).toBe(0);
    expect(engine.calculateOpenVentCapacity(0.1, 100,     101.325, 1.4, 300, 29, 1.0, 0.62)).toBe(0);
  });

  it('computes subsonic flow capacity (r > r_crit)', () => {
    // r = 101.325 / 110 ≈ 0.921, r_crit (k=1.4) ≈ 0.528 → subsonic
    const result = engine.calculateOpenVentCapacity(0.1, 110, 101.325, 1.4, 300, 29, 1.0, 0.62);
    expect(result).toBeGreaterThan(1930);
    expect(result).toBeLessThan(1932);
  });

  it('computes sonic (choked) flow capacity (r <= r_crit)', () => {
    // r = 101.325 / 250 ≈ 0.405 → sonic
    const result = engine.calculateOpenVentCapacity(0.1, 250, 101.325, 1.4, 300, 29, 1.0, 0.62);
    expect(result).toBeGreaterThan(11183);
    expect(result).toBeLessThan(11185);
  });

});

describe('logLogInterp', () => {

  it('interpolates linear y = x correctly', () => {
    expect(engine.logLogInterp(10, 1, 1, 100, 100)).toBeCloseTo(10);
  });

  it('interpolates power-law y = x^2 correctly', () => {
    expect(engine.logLogInterp(2, 1, 1, 4, 16)).toBeCloseTo(4);
    expect(engine.logLogInterp(3, 1, 1, 4, 16)).toBeCloseTo(9);
  });

  it('returns endpoint values at boundaries', () => {
    expect(engine.logLogInterp(1,   1, 10, 100, 1000)).toBeCloseTo(10);
    expect(engine.logLogInterp(100, 1, 10, 100, 1000)).toBeCloseTo(1000);
  });

  it('extrapolates beyond the bracketed range', () => {
    expect(engine.logLogInterp(0.5, 1, 1, 10, 10)).toBeCloseTo(0.5);
    expect(engine.logLogInterp(20,  1, 1, 10, 10)).toBeCloseTo(20);
  });

  it('returns the constant when y0 == y1', () => {
    expect(engine.logLogInterp(5, 1, 10, 10, 10)).toBeCloseTo(10);
  });

  it('handles very large values', () => {
    expect(engine.logLogInterp(1e10, 1e9, 1e9, 1e11, 1e11)).toBeCloseTo(1e10, -5);
  });

  it('handles very small values', () => {
    expect(engine.logLogInterp(1e-10, 1e-11, 1e-11, 1e-9, 1e-9)).toBeCloseTo(1e-10, 15);
  });

  it('returns NaN/Infinity when x0 == x1 (degenerate bracket)', () => {
    const res = engine.logLogInterp(5, 10, 10, 10, 20);
    expect(Number.isFinite(res)).toBe(false);
  });

  it('returns 0 for x = 0 (log → -Infinity collapses to 0)', () => {
    expect(engine.logLogInterp(0, 1, 1, 10, 10)).toBe(0);
  });

  it('returns NaN for non-positive inputs that produce indeterminate forms', () => {
    expect(Number.isNaN(engine.logLogInterp(-1, 1, 1, 10, 10))).toBe(true);
    expect(Number.isNaN(engine.logLogInterp(5,  0, 1, 10, 10))).toBe(true);
    expect(Number.isNaN(engine.logLogInterp(5,  1, 0, 10, 10))).toBe(true);
  });

});
