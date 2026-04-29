const test = require('node:test');
const assert = require('node:assert');

// Set up the environment expected by the engine
global.window = {};
require('./constants.js');
require('./api2000Engine.js');

const engine = window.API2000.engine;

test('API 2000 Engine - calculateOpenVentCapacity', async (t) => {
  await t.test('returns 0 if required arguments are missing or falsy', () => {
    // Missing diameter
    assert.strictEqual(
      engine.calculateOpenVentCapacity(0, 110, 101.325, 1.4, 300, 29, 1.0, 0.62),
      0
    );
    // Missing p_inlet_kpa
    assert.strictEqual(
      engine.calculateOpenVentCapacity(0.1, 0, 101.325, 1.4, 300, 29, 1.0, 0.62),
      0
    );
    // Missing p_outlet_kpa
    assert.strictEqual(
      engine.calculateOpenVentCapacity(0.1, 110, 0, 1.4, 300, 29, 1.0, 0.62),
      0
    );
    // Missing k
    assert.strictEqual(
      engine.calculateOpenVentCapacity(0.1, 110, 101.325, 0, 300, 29, 1.0, 0.62),
      0
    );
    // Missing T_inlet_K
    assert.strictEqual(
      engine.calculateOpenVentCapacity(0.1, 110, 101.325, 1.4, 0, 29, 1.0, 0.62),
      0
    );
    // Missing M
    assert.strictEqual(
      engine.calculateOpenVentCapacity(0.1, 110, 101.325, 1.4, 300, 0, 1.0, 0.62),
      0
    );
  });

  await t.test('returns 0 if p_outlet_kpa >= p_inlet_kpa', () => {
    // Equal pressure
    assert.strictEqual(
      engine.calculateOpenVentCapacity(0.1, 101.325, 101.325, 1.4, 300, 29, 1.0, 0.62),
      0
    );
    // Reverse flow
    assert.strictEqual(
      engine.calculateOpenVentCapacity(0.1, 100, 101.325, 1.4, 300, 29, 1.0, 0.62),
      0
    );
  });

  await t.test('calculates correct capacity for subsonic flow (r > r_crit)', () => {
    // r = 101.325 / 110 = 0.921
    // r_crit for k=1.4 is ~0.528
    // So r > r_crit (subsonic)
    const result = engine.calculateOpenVentCapacity(
      0.1,     // diameter_m
      110,     // p_inlet_kpa
      101.325, // p_outlet_kpa
      1.4,     // k
      300,     // T_inlet_K
      29,      // M
      1.0,     // Zi
      0.62     // Cd
    );

    // Result expected is approximately 1931.1 Nm3/hr
    assert.ok(result > 1930 && result < 1932, `Expected ~1931.1, got ${result}`);
    // Check more precision
    assert.strictEqual(Math.round(result * 10) / 10, 1931.1);
  });

  await t.test('calculates correct capacity for sonic (choked) flow (r <= r_crit)', () => {
    // r = 101.325 / 250 = 0.405
    // r_crit for k=1.4 is ~0.528
    // So r <= r_crit (sonic)
    const result = engine.calculateOpenVentCapacity(
      0.1,     // diameter_m
      250,     // p_inlet_kpa
      101.325, // p_outlet_kpa
      1.4,     // k
      300,     // T_inlet_K
      29,      // M
      1.0,     // Zi
      0.62     // Cd
    );

    // Result expected is approximately 11184.1 Nm3/hr
    assert.ok(result > 11183 && result < 11185, `Expected ~11184.1, got ${result}`);
    // Check more precision
    assert.strictEqual(Math.round(result * 10) / 10, 11184.1);
  });
});
