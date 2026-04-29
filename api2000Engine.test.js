const test = require('node:test');
const assert = require('node:assert');
const { logLogInterp } = require('./api2000Engine.js');

const EPSILON = 1e-10;
function near(a, b) {
  if (!isFinite(a) || !isFinite(b)) return a === b;
  return Math.abs(a - b) < EPSILON || Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) < EPSILON;
}

test('basic interpolation', () => {
  // y = x
  assert.ok(near(logLogInterp(10, 1, 1, 100, 100), 10));
  // y = x^2
  assert.ok(near(logLogInterp(2, 1, 1, 4, 16), 4));
  assert.ok(near(logLogInterp(3, 1, 1, 4, 16), 9));
});

test('boundary cases', () => {
  assert.ok(near(logLogInterp(1, 1, 10, 100, 1000), 10));
  assert.ok(near(logLogInterp(100, 1, 10, 100, 1000), 1000));
});

test('extrapolation', () => {
  // y = x, extrapolate below
  assert.ok(near(logLogInterp(0.5, 1, 1, 10, 10), 0.5));
  // y = x, extrapolate above
  assert.ok(near(logLogInterp(20, 1, 1, 10, 10), 20));
});

test('edge cases - identical y values', () => {
  assert.ok(near(logLogInterp(5, 1, 10, 10, 10), 10));
});

test('edge cases - large values', () => {
  assert.ok(near(logLogInterp(1e10, 1e9, 1e9, 1e11, 1e11), 1e10));
});

test('edge cases - small values', () => {
  assert.ok(near(logLogInterp(1e-10, 1e-11, 1e-11, 1e-9, 1e-9), 1e-10));
});

test('special cases - division by zero (identical x0, x1)', () => {
  const res = logLogInterp(5, 10, 10, 10, 20);
  assert.ok(isNaN(res) || !isFinite(res) || res === 0);
});

test('special cases - non-positive values', () => {
  // log(0) is -Infinity. Math.exp(-Infinity) is 0.
  const res0 = logLogInterp(0, 1, 1, 10, 10);
  assert.strictEqual(res0, 0);

  assert.ok(isNaN(logLogInterp(-1, 1, 1, 10, 10)));
  assert.ok(isNaN(logLogInterp(5, 0, 1, 10, 10)));
  assert.ok(isNaN(logLogInterp(5, 1, 0, 10, 10)));
});
