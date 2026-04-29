global.window = { API2000: {} };
require('./constants');

// --- INTERPOLATION -------------------------------------------------------

function logLogInterp(x, x0, y0, x1, y1) {
  const lx  = Math.log(x);
  const lx0 = Math.log(x0);
  const lx1 = Math.log(x1);
  const ly0 = Math.log(y0);
  const ly1 = Math.log(y1);
  const ly  = ly0 + (lx - lx0) * (ly1 - ly0) / (lx1 - lx0);
  return Math.exp(ly);
}

function tableInterpLinear(table, volume, col) {
  const n = table.length;
  if (volume <= table[0][0]) {
    return logLogInterp(volume, table[0][0], table[0][col], table[1][0], table[1][col]);
  }
  if (volume >= table[n - 1][0]) {
    return logLogInterp(
      volume,
      table[n - 2][0], table[n - 2][col],
      table[n - 1][0], table[n - 1][col],
    );
  }
  for (let i = 0; i < n - 1; i++) {
    if (volume >= table[i][0] && volume <= table[i + 1][0]) {
      return logLogInterp(
        volume,
        table[i][0], table[i][col],
        table[i + 1][0], table[i + 1][col],
      );
    }
  }
  throw new Error('tableInterp: could not bracket volume ' + volume);
}

function tableInterpBinary(table, volume, col) {
  const n = table.length;
  if (volume <= table[0][0]) {
    return logLogInterp(volume, table[0][0], table[0][col], table[1][0], table[1][col]);
  }
  if (volume >= table[n - 1][0]) {
    return logLogInterp(
      volume,
      table[n - 2][0], table[n - 2][col],
      table[n - 1][0], table[n - 1][col],
    );
  }

  let low = 0;
  let high = n - 2;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const vMid = table[mid][0];
    const vMid1 = table[mid + 1][0];

    if (volume >= vMid && volume <= vMid1) {
      return logLogInterp(
        volume,
        vMid, table[mid][col],
        vMid1, table[mid + 1][col]
      );
    } else if (volume < vMid) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  throw new Error('tableInterp: could not bracket volume ' + volume);
}

const { TABLE1_SI } = window.API2000;
console.log(`Table length: ${TABLE1_SI.length}`);

// We will test with a larger synthetic table to demonstrate the performance impact
// which is a common scenario for generic interpolation functions.
const largeTable = [];
let val = 10;
let y1 = 1;
let y2 = 2;
for (let i = 0; i < 1000; i++) {
  largeTable.push([val, y1, y2]);
  val += 10;
  y1 += 0.1;
  y2 += 0.2;
}


function runBenchmark(interpFn, name, table, maxVol) {
  const start = process.hrtime.bigint();
  let result;
  for (let i = 0; i < 100000; i++) {
    const vol = (i % (maxVol - 20)) + 10;
    result = interpFn(table, vol, 1);
  }
  const end = process.hrtime.bigint();
  console.log(`${name} Execution time: ${Number(end - start) / 1000000} ms`);
}

// Warmup
runBenchmark(tableInterpLinear, "Linear Small (Warmup)", TABLE1_SI, 158000);
runBenchmark(tableInterpBinary, "Binary Small (Warmup)", TABLE1_SI, 158000);

// Actual runs (Small Table)
runBenchmark(tableInterpLinear, "Linear Small", TABLE1_SI, 158000);
runBenchmark(tableInterpBinary, "Binary Small", TABLE1_SI, 158000);

// Actual runs (Large Table)
runBenchmark(tableInterpLinear, "Linear Large", largeTable, 10000);
runBenchmark(tableInterpBinary, "Binary Large", largeTable, 10000);
