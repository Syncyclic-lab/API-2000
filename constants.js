// ============================================================
// constants.js  (browser build)
// API Std 2000 (7th Edition) lookup tables and physical constants.
// SI-only. The engine converts user inputs to SI at the boundary.
// ============================================================

'use strict';

window.API2000 = window.API2000 || {};

// --- PHYSICAL CONSTANTS ------------------------------------------------------

window.API2000.PHYSICAL = {
  R_SI:              8314.46,   // J/(kmol·K)
  T_STD_SI:          273.15,    // K
  P_ATM_KPA:         101.325,   // kPa absolute
  C_TO_K:            273.15,
  T_FIRE_SURFACE_C:  904,       // Flame surface temperature (API 2000 §7.3.2)
  MOLAR_VOL_NM3_KGMOL: 22.414,  // Normal conditions (0°C, 101.325 kPa)
  MOLAR_VOL_SM3_KGMOL: 23.6445, // Standard conditions (15°C, 101.325 kPa)
  SECONDS_PER_HOUR:    3600,
};

// --- TABLE 1: THERMAL VENTING (UNINSULATED TANKS, SI) ------------------------
// Columns: [tank volume m³, inbreathing Nm³/hr, outbreathing Nm³/hr]

window.API2000.TABLE1_SI = [
  [      9.5,     1.7,     1.1 ],
  [     15.9,     2.8,     1.9 ],
  [     79.5,    14.2,     9.3 ],
  [    158.9,    28.3,    18.7 ],
  [    317.9,    51.0,    31.1 ],
  [    794.9,   107.6,    62.3 ],
  [  1_589.9,   187.0,   107.6 ],
  [  3_179.7,   311.6,   178.5 ],
  [  7_949.4,   623.1,   340.0 ],
  [ 15_898.7, 1_002.0,   566.0 ],
  [ 31_797.5, 1_558.0,   850.0 ],
  [ 79_493.7, 2_861.0, 1_559.0 ],
  [158_987.3, 4_703.0, 2_550.0 ],
];

window.API2000.TABLE1_VOLUME_LIMITS_M3 = {
  MIN: 9.5,
  MAX: 158_987,
};

// --- LATITUDE ZONE MULTIPLIERS (API 2000 §6.3.1) ------------------------------

window.API2000.LATITUDE_FACTORS = {
  BELOW_42N:            { inbreathing: 0.60, outbreathing: 1.00 },
  BETWEEN_42N_AND_58N:  { inbreathing: 1.00, outbreathing: 1.00 },
  ABOVE_58N:            { inbreathing: 1.45, outbreathing: 0.75 },
};

// --- FIRE-CASE HEAT INPUT (API 2000 §7.3.2, SI only) --------------------------

window.API2000.FIRE_CASE = {
  exponent:            0.82,
  NO_CREDIT:           70_900,
  DRAINAGE_CREDIT:     43_200,
  F_BARE:              1.0,
  FIREPROOFING_FACTOR: 0.25,
  MAX_WETTED_AREA_M2:  260,
  GRADE_LIMIT_M:       9.14,
};

// --- OPERATIONAL VENTING (API 2000 §6.3.2) -----------------------------------

window.API2000.OPERATIONAL = {
  INBREATHING_FACTOR:               1.00,
  NON_VOLATILE_OUTBREATHING_FACTOR: 1.00,
  VOLATILE_OUTBREATHING_FACTOR:     2.00,
};

// --- AIR PROPERTIES (for inbreathing through open vents) ---------------------

window.API2000.AIR_PROPERTIES = {
  k:  1.4,
  M:  28.96,
  Zi: 1.0,
};

// --- OPEN VENT DEFAULTS -------------------------------------------------------

window.API2000.OPEN_VENT = {
  DEFAULT_CD: 0.5,
  CD_MIN:     0.3,
  CD_MAX:     0.8,
  MIN_PIPE_DIAM_M: 0.0254,
};

// --- INSULATION HEAT-TRANSFER DEFAULTS (API 2000 §4.4.2) ---------------------

window.API2000.INSULATION = {
  H_BARE_W_M2_K: 4.73,   // Reference bare-shell heat-transfer coefficient
  H_OUT_W_M2_K:  10.0,   // Outside film coefficient for insulated shell
};

// --- UNIT CONVERSIONS --------------------------------------------------------

window.API2000.CONVERSIONS = {
  BBL_TO_M3:      0.158987,
  M3_TO_BBL:      6.28981,
  SCFH_TO_NM3HR:  0.02832,
  NM3HR_TO_SCFH:  35.3147,
  FT2_TO_M2:      0.092903,
  M2_TO_FT2:      10.7639,
  FT_TO_M:        0.3048,
  IN_TO_M:        0.0254,
  MM_TO_M:        0.001,
  PSI_TO_KPA:     6.89476,
  KPA_TO_PSI:     0.145038,
  C_TO_K:         273.15,
  BTU_HR_TO_W:    0.293071,
  W_TO_BTU_HR:    3.41214,
  BTU_LB_TO_J_KG: 2326.0,
  // BTU·in/(hr·ft²·°F) to W/(m·K)
  BTU_IN_HR_FT2_F_TO_W_M_K: 0.1442,
  // BTU/(hr·ft²·°F) to W/(m²·K)
  BTU_HR_FT2_F_TO_W_M2_K:   5.678,
  // Pressure conversions used by the flame-arrestor module.
  PA_TO_MBAR:               0.01,
  PA_TO_INH2O:              0.00401463,
};

// --- FLAME ARRESTOR DEFAULTS (ISO 16852 reference data) ----------------------
// Generic K-factor ranges and pre-fill defaults for the flame-arrestor ΔP
// module. These are order-of-magnitude approximations only; for regulatory
// sizing, the manufacturer's certified ΔP-vs-Q capacity curve must be used.

window.API2000.FLAME_ARRESTOR = {
  DEFAULT_K: {
    END_OF_LINE_DEFLAGRATION:      { label: 'End-of-line deflagration',         k_low: 2,  k_high: 5,  k_default: 3.5 },
    INLINE_CONCENTRIC_DEFLAGRATION:{ label: 'Inline concentric deflagration',   k_low: 3,  k_high: 8,  k_default: 5.0 },
    INLINE_CONCENTRIC_DETONATION:  { label: 'Inline concentric detonation',     k_low: 10, k_high: 25, k_default: 17  },
    INLINE_ECCENTRIC_DETONATION:   { label: 'Inline eccentric detonation',      k_low: 15, k_high: 40, k_default: 25  },
    PRE_VOLUME_DETONATION:         { label: 'Pre-volume / unstable detonation', k_low: 20, k_high: 50, k_default: 35  },
  },
  // Warn if arrestor ΔP consumes more than this fraction of available relieving overpressure
  BUDGET_WARNING_FRACTION: 0.5,
  // Warn if ΔP exceeds this fraction (adequacy failure risk)
  BUDGET_FAILURE_FRACTION: 0.9,
  // Iteration cap for the ΔP ↔ device-flow fixed-point loop
  MAX_ITERATIONS:          2,
};
