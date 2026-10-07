// ============================================================
// unitConverter.js  (browser build)
// Converts user inputs (SI or US) to SI, and SI results back to
// the display unit system.
// Depends on: constants.js (must be loaded first)
// ============================================================

'use strict';

(function () {
  const C = window.API2000.CONVERSIONS;
  const isUS = (unitSystem) => unitSystem === 'US';
  const scaleUS = (factor) => (value, unitSystem) => (isUS(unitSystem) ? value * factor : value);

  window.API2000.uc = {
    // --- Inputs to SI ---
    toM3:                  scaleUS(C.BBL_TO_M3),        // BBL → m³ (also BPH → m³/h)
    toMetres:              scaleUS(C.FT_TO_M),          // ft → m
    toM2:                  scaleUS(C.FT2_TO_M2),        // ft² → m²
    toKpa:                 scaleUS(C.PSI_TO_KPA),       // psi → kPa
    toJkg:                 scaleUS(C.BTU_LB_TO_J_KG),   // BTU/lb → J/kg
    toJkgK:                scaleUS(C.BTU_LB_F_TO_J_KG_K), // BTU/(lb·°F) → J/(kg·K)
    toNm3hr:               scaleUS(C.SCF_TO_NM3),       // SCFH → Nm³/h
    insulConductivityToSI: scaleUS(C.BTU_IN_HR_FT2_F_TO_W_M_K),
    insulHTCToSI:          scaleUS(C.BTU_HR_FT2_F_TO_W_M2_K),
    toKgM3:                scaleUS(C.LB_FT3_TO_KG_M3),  // lb/ft³ → kg/m³
    toKgH:                 scaleUS(1 / C.KG_TO_LB),     // lb/h → kg/h
    toC: (value, unitSystem) => (isUS(unitSystem) ? (value - 32) / 1.8 : value),
    // Heat rates are entered in BTU/h (US) or kW (SI).
    toW: (value, unitSystem) => (isUS(unitSystem) ? value / C.W_TO_BTU_HR : value * C.KW_TO_W),
    // Small-bore lengths are entered in inches (US) or millimetres (SI).
    smallLengthToM: (value, unitSystem) => value * (isUS(unitSystem) ? C.IN_TO_M : C.MM_TO_M),

    // --- SI results to display units ---
    flowToOutput: (nm3hr, unitSystem) => (isUS(unitSystem) ? nm3hr / C.SCF_TO_NM3 : nm3hr),
    areaToOutput: (m2, unitSystem) => (isUS(unitSystem) ? m2 / C.FT2_TO_M2 : m2),
    heatToOutput: scaleUS(C.W_TO_BTU_HR),
    massToOutput: scaleUS(C.KG_TO_LB),
  };
})();
