// ============================================================
// constants.js  (browser build — no require/module.exports)
// API Std 2000 (7th Edition) lookup tables and physical constants.
// ============================================================

'use strict';

window.API2000 = window.API2000 || {};

// ─── PHYSICAL CONSTANTS ───────────────────────────────────────────────────────

window.API2000.PHYSICAL = {
  R_BTU:    0.7302,
  R_SI:     8314.46,
  T_STD_US: 519.67,
  P_STD_US: 14.696,
  T_STD_SI: 273.15,
  P_STD_SI: 101.325,
  T_FIRE_F: 1000,
  T_FIRE_C: 537.8,
  P_ATM_PSIA: 14.696,
  P_ATM_KPA:  101.325,
  C_TO_K:   273.15,
};

// ─── TABLE 1 ─ THERMAL VENTING REQUIREMENTS (UNINSULATED TANKS) ──────────────

window.API2000.TABLE1_US = [
  [        60,       60,       40 ],
  [       100,      100,       66 ],
  [       500,      500,      330 ],
  [     1_000,    1_000,      660 ],
  [     2_000,    1_800,    1_100 ],
  [     5_000,    3_800,    2_200 ],
  [    10_000,    6_600,    3_800 ],
  [    20_000,   11_000,    6_300 ],
  [    50_000,   22_000,   12_000 ],
  [   100_000,   35_000,   20_000 ],
  [   200_000,   55_000,   30_000 ],
  [   500_000,  101_000,   55_000 ],
  [ 1_000_000,  166_000,   90_000 ],
];

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

// ─── LATITUDE ZONE MULTIPLIERS (API 2000 §6.3.1) ─────────────────────────────

window.API2000.LATITUDE_FACTORS = {
  BELOW_42N: {
    inbreathing:  0.60,
    outbreathing: 1.00,
  },
  BETWEEN_42N_AND_58N: {
    inbreathing:  1.00,
    outbreathing: 1.00,
  },
  ABOVE_58N: {
    inbreathing:  1.45,
    outbreathing: 0.75,
  },
};

// ─── FIRE-CASE HEAT INPUT CONSTANTS (API 2000 §7.3.2) ────────────────────────

window.API2000.FIRE_CASE = {
  US: {
    exponent:       0.82,
    NO_CREDIT:      34_500,
    DRAINAGE_CREDIT: 21_000,
  },
  SI: {
    exponent:       0.82,
    NO_CREDIT:      70_900,
    DRAINAGE_CREDIT: 43_200,
  },
  F_BARE: 1.0,
  MAX_WETTED_AREA_FT2: 2_800,
  MAX_WETTED_AREA_M2:    260,
  GRADE_LIMIT_FT: 30,
  GRADE_LIMIT_M:   9.14,
  T_FIRE_SURFACE_F: 1_660,
  T_FIRE_SURFACE_C:   904,
};

// ─── OPERATIONAL VENTING MULTIPLIERS (API 2000 §6.3.2) ───────────────────────

window.API2000.OPERATIONAL = {
  INBREATHING_FACTOR: 1.00,
  NON_VOLATILE_OUTBREATHING_FACTOR: 1.00,
  VOLATILE_OUTBREATHING_FACTOR:     2.00,
  NON_VOLATILE_FACTOR: 1.00,
  VOLATILE_VP_THRESHOLD_KPA:  5.0,
  VOLATILE_VP_THRESHOLD_PSIA: 0.725,
};

// ─── UNIT CONVERSIONS ─────────────────────────────────────────────────────────

window.API2000.CONVERSIONS = {
  BBL_TO_M3:       0.158987,
  M3_TO_BBL:       6.28981,
  FT3_PER_BBL:     5.614583,
  SCFH_TO_NM3HR:   0.026853,
  NM3HR_TO_SCFH:  37.2399,
  FT2_TO_M2:       0.092903,
  M2_TO_FT2:      10.7639,
  BTU_HR_TO_W:     0.293071,
  W_TO_BTU_HR:     3.41214,
  BTU_LB_TO_J_KG:  2326.0,
  J_KG_TO_BTU_LB:  4.2992e-4,
  PSI_TO_KPA:      6.89476,
  KPA_TO_PSI:      0.145038,
  FT_TO_M:         0.3048,
  M_TO_FT:         3.28084,
  F_TO_R:        459.67,
  C_TO_K:        273.15,
};
