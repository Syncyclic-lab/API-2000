// ============================================================
// constants.js  (browser build)
// API Std 2000 (7th Edition, March 2014) tables and physical constants.
// SI-only. index.js converts user inputs to SI at the boundary.
// Section/table numbers below refer to API Std 2000, 7th Edition.
// ============================================================

'use strict';

window.API2000 = window.API2000 || {};

// --- PHYSICAL CONSTANTS ------------------------------------------------------

window.API2000.PHYSICAL = {
  R:                8314.46,  // J/(kmol·K)
  T_NORMAL_K:       273.15,   // Normal conditions: 0 °C, 101.325 kPa (Annex D.2)
  P_ATM_KPA:        101.325,  // kPa absolute
  C_TO_K:           273.15,
  MOLAR_VOL_NM3:    22.414,   // Nm³/kmol at normal conditions (Annex D.2)
  SECONDS_PER_HOUR: 3600,
};

// --- NORMAL VENTING: GENERAL METHOD (§3.3.2) ---------------------------------

window.API2000.GENERAL_METHOD = {
  // Table 1 — Y-factor for thermal out-breathing, Eq. (7): V_OT = Y · V_tk^0.9 · R_i
  Y: { BELOW_42N: 0.32, BETWEEN_42N_AND_58N: 0.25, ABOVE_58N: 0.2 },
  // Table 2 — C-factor for thermal inbreathing, Eq. (9): V_IT = C · V_tk^0.7 · R_i
  //   cool:  vapour pressure similar to hexane AND average storage temperature < 25 °C
  //   other: every other case (hexane-like ≥ 25 °C, higher than hexane, or unknown)
  C: {
    BELOW_42N:           { cool: 4,   other: 6.5 },
    BETWEEN_42N_AND_58N: { cool: 3,   other: 5   },
    ABOVE_58N:           { cool: 2.5, other: 4   },
  },
  C_TEMP_THRESHOLD_C: 25,
  // §3.3.2.2: liquid movement. Nonvolatile = vapour pressure ≤ 5.0 kPa.
  EMPTY_FACTOR:            1.0,  // Eq. (5)
  FILL_FACTOR_NONVOLATILE: 1.0,  // Eq. (1)
  FILL_FACTOR_VOLATILE:    2.0,  // Eq. (3)
  // Out-breathing must be converted to air-equivalent flow above 49 °C (§3.3.2.2.1, D.9).
  AIR_EQUIVALENT_TEMP_LIMIT_C: 49,
  // NOTE to Eq. (11): inside heat-transfer coefficient commonly assumed, W/(m²·K).
  H_INSIDE_DEFAULT: 4,
  // Eq. (13): R_c = 0.25 + 0.75 · A_c / A  (double-wall tanks)
  DOUBLE_WALL_BASE: 0.25,
};

// --- NORMAL VENTING: ANNEX A ALTERNATIVE METHOD ------------------------------

window.API2000.ANNEX_A = {
  // Table A.3 — [tank capacity m³, inbreathing (col. 2), out-breathing for
  // flash point ≥ 37.8 °C (col. 3)], all Nm³/h of air. Out-breathing for
  // flash point < 37.8 °C (col. 4) equals inbreathing. Interpolation allowed.
  TABLE_A3: [
    [    10,    1.69,    1.01 ],
    [    20,    3.38,    2.02 ],
    [   100,   16.9,    10.1  ],
    [   200,   33.8,    20.3  ],
    [   300,   50.4,    30.4  ],
    [   500,   84.5,    50.7  ],
    [   700,  118,      71.0  ],
    [  1000,  169,     101    ],
    [  1500,  254,     152    ],
    [  2000,  338,     203    ],
    [  3000,  507,     304    ],
    [  3180,  537,     322    ],
    [  4000,  647,     388    ],
    [  5000,  787,     472    ],
    [  6000,  896,     538    ],
    [  7000, 1003,     602    ],
    [  8000, 1077,     646    ],
    [  9000, 1136,     682    ],
    [ 10000, 1210,     726    ],
    [ 12000, 1345,     807    ],
    [ 14000, 1480,     888    ],
    [ 16000, 1615,     969    ],
    [ 18000, 1750,    1047    ],
    [ 20000, 1877,    1126    ],
    [ 25000, 2179,    1307    ],
    [ 30000, 2495,    1497    ],
  ],
  // Table A.1 — Nm³/h of air per m³/h of liquid movement.
  EMPTY_FACTOR:            0.94,
  FILL_FACTOR_NONVOLATILE: 1.01,
  FILL_FACTOR_VOLATILE:    2.02,
  VOLATILE_FLASH_POINT_C:  37.8,
  // A.1.2 service conditions.
  MAX_VOLUME_M3: 30_000,
  MAX_TEMP_C:    48.9,
};

// --- EMERGENCY VENTING: FIRE EXPOSURE (§3.3.3) --------------------------------

window.API2000.FIRE = {
  // Table 5 note a — wetted area rules.
  GRADE_LIMIT_M:       9.14,
  SPHERE_FRACTION:     0.55,
  HORIZONTAL_FRACTION: 0.75,
  // Table 3 — heat input Q (W) for A_TWS < 260 m²: [upper area bound m², coefficient, exponent]
  HEAT_INPUT_BANDS: [
    [  18.6,  63_150, 1     ],
    [  93,   224_200, 0.566 ],
    [ 260,   630_400, 0.338 ],
  ],
  LARGE_AREA_M2:          260,
  LARGE_AREA_COEFF:       43_200,     // Q = 43,200 · A^0.82 when design pressure > 7 kPa(g)
  LARGE_AREA_EXPONENT:    0.82,
  LARGE_AREA_LOW_P_Q_W:   4_129_700,  // constant Q when design pressure ≤ 7 kPa(g)
  LOW_PRESSURE_LIMIT_KPA: 7,
  MAX_DESIGN_PRESSURE_KPA: 103.4,     // scope limit of Table 3
  // Eq. (14): q = 906.6 · Q · F / L · (T / M)^0.5
  EQ14_COEFF: 906.6,
  // Hexane basis of Tables 5 and 7 and Eq. (16) (§3.3.3.3.3). The published
  // values (e.g. 19,910 Nm³/h and the 208.2 constant) are reproduced by Eq. (14)
  // with T = 273.15 K, so that temperature is used here.
  HEXANE: { L: 334_900, M: 86.17, T_K: 273.15 },
  // Table 9 — environmental factor F (credit for one factor only).
  ENV_FACTORS: { BARE: 1.0, IMPOUNDMENT: 0.5, EARTH_COVERED: 0.03, UNDERGROUND: 0 },
  // Table 9 note b — insulated F = conductance · 887.9 K / 66,200 W/m².
  INSULATION_DT_K:           887.9,
  INSULATION_HEAT_FLUX_W_M2: 66_200,
};

// --- OTHER CIRCUMSTANCES (§3.2.5) --------------------------------------------
// API 2000 gives no calculation methods for these (§3.2.5.1); the engineering
// estimates use the Annex D nozzle-flow and air-equivalent relationships.

window.API2000.SCENARIOS = {
  DEFAULT_CD:       0.62,     // sharp-edged orifice / ruptured tube
  GAS_K:            1.4,      // blanket / transfer gas (N₂, air)
  STEAM_M:          18.02,
  STEAM_K:          1.33,
  AIR_CP_J_KMOL_K:  29_100,   // vapour space taken as air (Annex A.3.3)
  RAIN_WALL_TEMP_C: 15.6,     // rain-cooled wall temperature (Annex A.3.3.3)
};

// Scope limit of API Std 2000 (§1): 103.4 kPa(g) / 15 psig.
window.API2000.MAX_SCOPE_PRESSURE_KPA = 103.4;

// --- AIR PROPERTIES (venting capacities are air-equivalent flows) -------------

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
  // Allowable pressure/vacuum (gauge kPa) used to size open vents on
  // atmospheric tanks when MAWP/MAWV is 0. 0.5 kPa ≈ 2 in H2O.
  ATM_DEFAULT_ALLOWABLE_KPA: 0.5,
  // Inbreathing air is drawn from ambient, taken as 15.6 °C (Annex A.3.3.3).
  AMBIENT_AIR_TEMP_C: 15.6,
};

// --- UNIT CONVERSIONS --------------------------------------------------------

window.API2000.CONVERSIONS = {
  BBL_TO_M3:      0.158987,
  // Nm³ (0 °C) per SCF (60 °F), ratio of ideal-gas molar volumes — Annex D, Eq. (D.2).
  SCF_TO_NM3:     0.026793,
  FT_TO_M:        0.3048,
  FT2_TO_M2:      0.09290304,
  IN_TO_M:        0.0254,
  MM_TO_M:        0.001,
  PSI_TO_KPA:     6.894757,
  KPA_TO_PSI:     0.1450377,
  W_TO_BTU_HR:    3.412142,
  KW_TO_W:        1000,
  LB_FT3_TO_KG_M3: 16.01846,
  BTU_LB_TO_J_KG: 2326.0,
  KG_TO_LB:       2.204623,
  // BTU·in/(hr·ft²·°F) to W/(m·K)
  BTU_IN_HR_FT2_F_TO_W_M_K: 0.1442279,
  // BTU/(hr·ft²·°F) to W/(m²·K)
  BTU_HR_FT2_F_TO_W_M2_K:   5.678263,
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
  // Warn if arrestor ΔP at rated flow consumes more than this fraction of MAWP
  BUDGET_WARNING_FRACTION: 0.5,
  // Fail if ΔP exceeds this fraction (adequacy failure risk)
  BUDGET_FAILURE_FRACTION: 0.9,
};
