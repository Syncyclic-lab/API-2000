global.window = { API2000: {} };
require('./constants');
require('./api2000Engine');

const { engine } = window.API2000;

function runBenchmark() {
  const start = process.hrtime.bigint();
  let result;
  for (let i = 0; i < 1000000; i++) {
    const vol = (i % 150000) + 10;
    result = engine.calcThermalVentingBare(vol, 'BELOW_42N');
  }

  const end = process.hrtime.bigint();
  console.log(`Execution time: ${Number(end - start) / 1000000} ms`);
}

runBenchmark();
