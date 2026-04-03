// ============================================================
// unitConverter.js  (browser build)
// Bidirectional unit conversion helpers.
// Depends on: constants.js (must be loaded first)
// ============================================================

'use strict';

(function () {
  const C       = window.API2000.CONVERSIONS;
  const PHYSICAL = window.API2000.PHYSICAL;

  // ─── VOLUME ─────────────────────────────────────────────────────────────────
  const bblToM3 = v => v * C.BBL_TO_M3;
  const m3ToBbl = v => v * C.M3_TO_BBL;
  const toM3 = (value, unitSystem) =>
    unitSystem === 'US' ? bblToM3(value) : value;

  // ─── VOLUMETRIC FLOW ────────────────────────────────────────────────────────
  const scfhToNm3hr = v => v * C.SCFH_TO_NM3HR;
  const nm3hrToScfh = v => v * C.NM3HR_TO_SCFH;
  const liquidFlowToM3hr = (rate, unitSystem) =>
    unitSystem === 'US' ? rate * C.BBL_TO_M3 : rate;
  const ventingFlowToOutput = (nm3hr, unitSystem) =>
    unitSystem === 'US' ? nm3hrToScfh(nm3hr) : nm3hr;

  // ─── AREA ───────────────────────────────────────────────────────────────────
  const ft2ToM2 = a => a * C.FT2_TO_M2;
  const m2ToFt2 = a => a * C.M2_TO_FT2;
  const toM2 = (value, unitSystem) =>
    unitSystem === 'US' ? ft2ToM2(value) : value;
  const areaToOutput = (m2, unitSystem) =>
    unitSystem === 'US' ? m2ToFt2(m2) : m2;

  // ─── LENGTH ─────────────────────────────────────────────────────────────────
  const ftToM = l => l * C.FT_TO_M;
  const mToFt = l => l * C.M_TO_FT;
  const toMetres = (value, unitSystem) =>
    unitSystem === 'US' ? ftToM(value) : value;

  // ─── PRESSURE ───────────────────────────────────────────────────────────────
  const psiToKpa = p => p * C.PSI_TO_KPA;
  const kpaToPsi = p => p * C.KPA_TO_PSI;
  const toKpa = (value, unitSystem) =>
    unitSystem === 'US' ? psiToKpa(value) : value;
  const gaugeToAbsKpa = kpag => kpag + PHYSICAL.P_ATM_KPA;

  // ─── TEMPERATURE ────────────────────────────────────────────────────────────
  const fToC = t => (t - 32) / 1.8;
  const cToF = t => t * 1.8 + 32;
  const fToR = t => t + C.F_TO_R;
  const cToK = t => t + C.C_TO_K;
  const toC = (value, unitSystem) =>
    unitSystem === 'US' ? fToC(value) : value;

  // ─── HEAT / ENTHALPY ───────────────────────────────────────────────────────
  const btuhrToW  = q => q * C.BTU_HR_TO_W;
  const wToBtuhr  = q => q * C.W_TO_BTU_HR;
  const btulbToJkg = h => h * C.BTU_LB_TO_J_KG;
  const jkgToBtulb = h => h * C.J_KG_TO_BTU_LB;
  const toJkg = (value, unitSystem) =>
    unitSystem === 'US' ? btulbToJkg(value) : value;
  const heatToOutput = (watts, unitSystem) =>
    unitSystem === 'US' ? wToBtuhr(watts) : watts;

  // ─── PIPE DIAMETER (small bore: inches ↔ mm → metres) ────────────────────
  const inToM  = l => l * 0.0254;
  const mmToM  = l => l * 0.001;
  const pipeDiamToM = (value, unitSystem) =>
    unitSystem === 'US' ? inToM(value) : mmToM(value);

  // ─── DIAMETER / DIMENSIONS ──────────────────────────────────────────────────
  const convertDimsToSI = (dims, unitSystem) => {
    if (!dims) return {};
    const convert = v => (v != null ? toMetres(v, unitSystem) : null);
    return {
      diameter:          convert(dims.diameter),
      height_or_length:  convert(dims.height_or_length),
      cone_roof_angle:   dims.cone_roof_angle ?? dims.cone_roof_angle_deg,
    };
  };

  // ─── EXPORT ─────────────────────────────────────────────────────────────────
  window.API2000.uc = {
    bblToM3, m3ToBbl, toM3,
    scfhToNm3hr, nm3hrToSc
