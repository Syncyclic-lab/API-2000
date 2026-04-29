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
