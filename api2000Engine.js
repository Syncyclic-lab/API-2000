// ============================================================
// api2000Engine.js  (browser build)
// Core API Std 2000 (7th Edition) calculation functions. All
// inputs and outputs are SI; flows are Nm³/h of air.
// Depends on: constants.js (must be loaded first)
// ============================================================

'use strict';

(function () {
  const { PHYSICAL, GENERAL_METHOD: GEN, ANNEX_A, FIRE, SCENARIOS } = window.API2000;

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  // Linear interpolation on column `col` of a table sorted by column 0.
  // Below the first row the value scales proportionally from the origin (the
  // basis of Table A.3 for small tanks); above the last row the final segment
  // is extended.
  function interpolate(table, x, col) {
    const first = table[0];
    if (x <= first[0]) return first[col] * x / first[0];
    let i = 1;
    while (i < table.length - 1 && x > table[i][0]) i++;
    const [x0, x1] = [table[i - 1][0], table[i][0]];
    const [y0, y1] = [table[i - 1][col], table[i][col]];
    return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
  }

  // --- 1. NORMAL VENTING ---------------------------------------------------

  // Annex A, Table A.3. Out-breathing is col. 3 (flash point ≥ 37.8 °C) or
  // equal to inbreathing (col. 4, flash point < 37.8 °C).
  function calcThermalAnnexA(volumeM3, isVolatile) {
    const thermal_in = interpolate(ANNEX_A.TABLE_A3, volumeM3, 1);
    return {
      thermal_in,
      thermal_out: isVolatile ? thermal_in : interpolate(ANNEX_A.TABLE_A3, volumeM3, 2),
    };
  }

  // §3.3.2.3, Eq. (7) and Eq. (9) with Table 1 (Y) and Table 2 (C).
  // An unknown average storage temperature uses the conservative ≥ 25 °C column.
  function calcThermalGeneral(volumeM3, latitudeZone, vaporPressureClass, avgStorageTempC, Ri) {
    const Y = GEN.Y[latitudeZone];
    const cRow = GEN.C[latitudeZone];
    if (Y == null || !cRow) throw new Error('Unknown latitude zone: ' + latitudeZone);
    const cool = vaporPressureClass !== 'HIGHER'
      && avgStorageTempC != null && avgStorageTempC < GEN.C_TEMP_THRESHOLD_C;
    const C = cool ? cRow.cool : cRow.other;
    return {
      thermal_out: Y * Math.pow(volumeM3, 0.9) * Ri,
      thermal_in:  C * Math.pow(volumeM3, 0.7) * Ri,
      Y,
      C,
    };
  }

  // §3.3.2.4–3.3.2.5: insulation reduction factor R_i (SI inputs).
  function calcInsulationReduction(env) {
    switch (env.insulation_type) {
      case 'FULLY_INSULATED':
      case 'PARTIALLY_INSULATED': {
        const h = env.h_inside ?? GEN.H_INSIDE_DEFAULT;
        const R_in = 1 / (1 + h * env.thickness_m / env.conductivity);           // Eq. (11)
        if (env.insulation_type === 'FULLY_INSULATED') return R_in;
        const f = env.coverage_fraction;                                           // A_inp / A_TTS
        return f * R_in + (1 - f);                                                 // Eq. (12)
      }
      case 'DOUBLE_WALL':
        return GEN.DOUBLE_WALL_BASE + (1 - GEN.DOUBLE_WALL_BASE) * env.outside_containment_fraction; // Eq. (13)
      default:
        return 1;
    }
  }

  // Liquid movement: §3.3.2.2 Eqs. (1), (3), (5) or Annex A Table A.1.
  function calcLiquidMovement(method, fillM3hr, emptyM3hr, isVolatile) {
    const f = method === 'ANNEX_A' ? ANNEX_A : GEN;
    return {
      liquid_in:  emptyM3hr * f.EMPTY_FACTOR,
      liquid_out: fillM3hr * (isVolatile ? f.FILL_FACTOR_VOLATILE : f.FILL_FACTOR_NONVOLATILE),
    };
  }

  // --- 2. EMERGENCY VENTING (FIRE EXPOSURE) --------------------------------

  // Sphere / horizontal tank: the greater of a fraction of the total surface
  // or the surface within 9.14 m of grade (Table 5, note a).
  function greaterWettedArea(fraction, total, belowLimit) {
    const byFraction = fraction * total;
    const limitGoverns = belowLimit > byFraction;
    return {
      wetted_area_m2: Math.max(byFraction, belowLimit),
      limit_governs: limitGoverns,
      method: `Greater of ${Math.round(fraction * 100)} % of total surface (${byFraction.toFixed(1)} m²) and ` +
        `surface within ${FIRE.GRADE_LIMIT_M} m of grade (${belowLimit.toFixed(1)} m²)`,
    };
  }

  // Wetted surface area A_TWS per Table 5, note a. Horizontal tanks assume flat heads.
  function calcWettedArea(shape, diameterM, lengthM, elevationM = 0) {
    if (!(diameterM > 0)) throw new Error('Tank diameter is required to calculate the wetted area.');
    const D = diameterM;
    const R = D / 2;
    const limitAboveBottom = FIRE.GRADE_LIMIT_M - elevationM;

    switch (shape) {
      case 'VERTICAL_CYLINDER': {
        if (!(lengthM > 0)) throw new Error('Tank height is required for a vertical cylinder.');
        const h = clamp(limitAboveBottom, 0, lengthM);
        return {
          wetted_area_m2: Math.PI * D * h,
          limit_governs: false,
          method: `Shell within ${FIRE.GRADE_LIMIT_M} m of grade: π × ${D.toFixed(2)} m × ${h.toFixed(2)} m`,
        };
      }
      case 'HORIZONTAL_CYLINDER': {
        if (!(lengthM > 0)) throw new Error('Tank length is required for a horizontal cylinder.');
        const total = Math.PI * D * lengthM + 2 * Math.PI * R * R;
        // Central angle of the circumference lying below the 9.14 m limit.
        const theta = 2 * Math.acos(1 - clamp(limitAboveBottom, 0, D) / R);
        const belowLimit = theta * R * lengthM + R * R * (theta - Math.sin(theta));
        return greaterWettedArea(FIRE.HORIZONTAL_FRACTION, total, belowLimit);
      }
      case 'SPHERE': {
        const total = Math.PI * D * D;
        const belowLimit = 2 * Math.PI * R * clamp(limitAboveBottom, 0, D);
        return greaterWettedArea(FIRE.SPHERE_FRACTION, total, belowLimit);
      }
      default:
        throw new Error('Unknown tank shape: ' + shape);
    }
  }

  // Table 3 — heat input Q (W) from wetted area (m²) and design pressure (kPa g).
  function calcFireHeatInput(wettedAreaM2, designPressureKpag) {
    if (wettedAreaM2 < FIRE.LARGE_AREA_M2) {
      const [, coeff, exponent] = FIRE.HEAT_INPUT_BANDS.find(([maxArea]) => wettedAreaM2 < maxArea);
      return coeff * Math.pow(wettedAreaM2, exponent);
    }
    return designPressureKpag > FIRE.LOW_PRESSURE_LIMIT_KPA
      ? FIRE.LARGE_AREA_COEFF * Math.pow(wettedAreaM2, FIRE.LARGE_AREA_EXPONENT)
      : FIRE.LARGE_AREA_LOW_P_Q_W;
  }

  // Table 9 — environmental factor F. Insulated tanks use the note b basis
  // with the actual insulation conductance (λ / thickness).
  function calcEnvironmentalFactor(option, { thickness_m, conductivity, custom } = {}) {
    switch (option) {
      case 'INSULATED':
        return Math.min(1, (conductivity / thickness_m) * FIRE.INSULATION_DT_K / FIRE.INSULATION_HEAT_FLUX_W_M2);
      case 'CUSTOM':
        return custom;
      default:
        return FIRE.ENV_FACTORS[option] ?? 1;
    }
  }

  // Air-equivalent flow (Nm³/h) of a vented gas/vapour mass flow (kg/h) at
  // temperature T — Eq. (D.37) with the SI constants of Eq. (D.43).
  function airEquivalentFlow(massKgH, molecularWeight, tempK) {
    return FIRE.EQ14_COEFF * (massKgH / PHYSICAL.SECONDS_PER_HOUR) * Math.sqrt(tempK / molecularWeight);
  }

  // Eq. (14): required emergency venting, Nm³/h of air.
  function calcEmergencyVenting(heatInputW, F, latentHeatJkg, molecularWeight, relievingTempK) {
    const vapour_mass_flow_kg_hr = heatInputW * F / latentHeatJkg * PHYSICAL.SECONDS_PER_HOUR;  // Eq. (D.40)
    return {
      emergency_out: airEquivalentFlow(vapour_mass_flow_kg_hr, molecularWeight, relievingTempK),
      vapour_mass_flow_kg_hr,
    };
  }

  // --- 3. OTHER CIRCUMSTANCES (§3.2.5) — engineering estimates -------------

  // Shell + roof (vertical) or total surface (horizontal, sphere) exposed to weather.
  function calcExposedArea(shape, diameterM, lengthM) {
    if (!(diameterM > 0)) return null;
    const D = diameterM;
    switch (shape) {
      case 'VERTICAL_CYLINDER':   return lengthM > 0 ? Math.PI * D * lengthM + Math.PI * D * D / 4 : null;
      case 'HORIZONTAL_CYLINDER': return lengthM > 0 ? Math.PI * D * lengthM + Math.PI * D * D / 2 : null;
      case 'SPHERE':              return Math.PI * D * D;
      default:                    return null;
    }
  }

  // Vapour-space contraction of a hot tank cooled by rain, heat-transfer
  // limited as in Annex A Eq. (A.3): dV/dt = R·h·A·ΔT / (p·Cp), expressed as
  // Nm³/h of replacement air (contraction volume × T_normal / T_vapour).
  function calcHotTankInbreathing(exposedAreaM2, hInside, deltaTK, vapourTempK) {
    if (!(deltaTK > 0)) return 0;
    const actual_m3_s = PHYSICAL.R * hInside * exposedAreaM2 * deltaTK
      / (PHYSICAL.P_ATM_KPA * 1000 * SCENARIOS.AIR_CP_J_KMOL_K);
    return actual_m3_s * PHYSICAL.SECONDS_PER_HOUR * PHYSICAL.T_NORMAL_K / vapourTempK;
  }

  // Breathing caused by a barometric pressure change: dV/dt = V · (dp/dt) / p,
  // taken over the whole tank volume (empty tank), as Nm³/h.
  function calcBarometricBreathing(volumeM3, rateKpaPerH, vapourTempK) {
    return volumeM3 * rateKpaPerH / PHYSICAL.P_ATM_KPA * PHYSICAL.T_NORMAL_K / vapourTempK;
  }

  // --- 4. INSTALLED VENTING DEVICES ----------------------------------------

  // Isentropic nozzle flow of an ideal gas (Annex D, Eq. D.23), as Nm³/h.
  // When p_out/p_in is below the critical ratio the flow is choked and the
  // flow function is evaluated at the critical ratio.
  function calculateOpenVentCapacity(diameterM, pInKpa, pOutKpa, k, T_in_K, M, Z = 1, Cd = 1) {
    if (!(diameterM > 0 && pOutKpa > 0 && pInKpa > pOutKpa && k > 1 && T_in_K > 0 && M > 0)) return 0;
    const area = Math.PI * diameterM * diameterM / 4;
    const r = Math.max(pOutKpa / pInKpa, Math.pow(2 / (k + 1), k / (k - 1)));
    const flowFunction = (k / (k - 1)) * (Math.pow(r, 2 / k) - Math.pow(r, (k + 1) / k));
    const massFlow = Cd * area * pInKpa * 1000 * Math.sqrt(2 * M / (Z * PHYSICAL.R * T_in_K) * flowFunction);
    return massFlow / M * PHYSICAL.MOLAR_VOL_NM3 * PHYSICAL.SECONDS_PER_HOUR;
  }

  // Valve capacity at a given tank pressure (all gauge kPa): zero below the set
  // point, rated flow at set × (1 + overpressure), linear partial lift between.
  function calcDeviceFlow(setPressure, ratedFlow, overpressurePct, tankPressure) {
    if (setPressure == null || !(ratedFlow > 0) || tankPressure == null || tankPressure <= setPressure) return 0;
    const ratedPressure = setPressure * (1 + (overpressurePct ?? 0) / 100);
    if (tankPressure >= ratedPressure) return ratedFlow;
    return ratedFlow * (tankPressure - setPressure) / (ratedPressure - setPressure);
  }

  // Evaluates every device at the tank's allowable pressure and vacuum (gauge kPa).
  // Normal out-breathing excludes EPRVs; emergency out-breathing includes every
  // pressure-relieving device (§3.3.3.3.5). Devices carrying a flame arrestor are
  // evaluated by flameArrestor.js using `arrestorContext`.
  function calcActualVenting(devices, relievingPressureKpag, relievingVacuumKpag, arrestorContext) {
    let normal_out = 0;
    let emergency_out = 0;
    let inbreathing = 0;

    const evaluated = devices.map(dev => {
      let flow_out = 0;
      let flow_in = 0;
      let arrestor = null;

      if (dev.direction !== 'INBREATHING') {
        if (dev.flame_arrestor) {
          ({ flow_out, arrestor } = engine.calcArrestedOutflow(dev, relievingPressureKpag, arrestorContext));
        } else {
          flow_out = dev.type === 'FREE_VENT'
            ? (dev.rated_flow_outbreathing || 0)
            : calcDeviceFlow(dev.set_pressure, dev.rated_flow_outbreathing, dev.rated_overpressure_pct, relievingPressureKpag);
        }
        emergency_out += flow_out;
        if (dev.type !== 'EPRV') normal_out += flow_out;
      }

      if (dev.direction !== 'OUTBREATHING') {
        flow_in = dev.type === 'FREE_VENT'
          ? (dev.rated_flow_inbreathing || 0)
          : calcDeviceFlow(dev.set_vacuum, dev.rated_flow_inbreathing, dev.rated_overpressure_pct, relievingVacuumKpag);
        inbreathing += flow_in;
      }

      return { ...dev, flow_out, flow_in, arrestor };
    });

    return { normal_out, emergency_out, inbreathing, devices: evaluated };
  }

  // --- EXPORT --------------------------------------------------------------

  const engine = window.API2000.engine = {
    interpolate,
    calcThermalAnnexA,
    calcThermalGeneral,
    calcInsulationReduction,
    calcLiquidMovement,
    calcWettedArea,
    calcFireHeatInput,
    calcEnvironmentalFactor,
    airEquivalentFlow,
    calcEmergencyVenting,
    calcExposedArea,
    calcHotTankInbreathing,
    calcBarometricBreathing,
    calculateOpenVentCapacity,
    calcDeviceFlow,
    calcActualVenting,
  };
})();
