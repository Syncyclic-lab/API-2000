// ============================================================
// api2000Engine.js  (browser build)
// Core API Std 2000 (7th Edition) calculation functions.
// Depends on: constants.js (must be loaded first)
// ============================================================

'use strict';

(function () {
  const {
    TABLE1_SI,
    LATITUDE_FACTORS,
    FIRE_CASE,
    OPERATIONAL,
    PHYSICAL,
  } = window.API2000;

  // ─── INTERPOLATION ───────────────────────────────────────────────────────────

  function logLogInterp(x, x0, y0, x1, y1) {
    const lx  = Math.log(x);
    const lx0 = Math.log(x0);
    const lx1 = Math.log(x1);
    const ly0 = Math.log(y0);
    const ly1 = Math.log(y1);
    const ly  = ly0 + (lx - lx0) * (ly1 - ly0) / (lx1 - lx0);
    return Math.exp(ly);
  }

  function tableInterp(table, volume, col) {
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
    throw new Error(`tableInterp: could not bracket volume ${volume}`);
  }

  // ─── 1. THERMAL VENTING ──────────────────────────────────────────────────────

  function calcThermalVentingBare(volumeM3, latitudeZone) {
    const factors = LATITUDE_FACTORS[latitudeZone];
    if (!factors) throw new Error(`Unknown latitude zone: ${latitudeZone}`);
    const q_in_ref  = tableInterp(TABLE1_SI, volumeM3, 1);
    const q_out_ref = tableInterp(TABLE1_SI, volumeM3, 2);
    return {
      thermal_in:  q_in_ref  * factors.inbreathing,
      thermal_out: q_out_ref * factors.outbreathing,
    };
  }

  function applyInsulationFactor(bareRates, environment) {
    const { insulation_type, insulation: ins } = environment;
    if (insulation_type === 'UNINSULATED' || !ins) {
      return { ...bareRates, insulation_factor: 1.0 };
    }
    const H_BARE = 4.73;
    const H_OUT  = 10.0;
    const { thermal_conductivity: k, insulation_thickness: t, internal_heat_transfer_coeff: h_i } = ins;
    const U_ins = 1 / (1 / h_i + t / k + 1 / H_OUT);
    const covered_fraction = insulation_type === 'PARTIALLY_INSULATED'
      ? (ins.coverage_fraction ?? 1.0)
      : 1.0;
    const uncovered_fraction = 1 - covered_fraction;
    const U_eff = covered_fraction * U_ins + uncovered_fraction * H_BARE;
    const insulation_factor = U_eff / H_BARE;
    return {
      thermal_in:  bareRates.thermal_in  * insulation_factor,
      thermal_out: bareRates.thermal_out * insulation_factor,
      insulation_factor,
    };
  }

  // ─── 2. OPERATIONAL VENTING ──────────────────────────────────────────────────

  function calcOperationalInbreathing(emptyRateM3hr) {
    return emptyRateM3hr * OPERATIONAL.INBREATHING_FACTOR;
  }

  function calcOperationalOutbreathing(fillRateM3hr, isVolatile) {
    const multiplier = isVolatile
      ? OPERATIONAL.VOLATILE_OUTBREATHING_FACTOR
      : OPERATIONAL.NON_VOLATILE_OUTBREATHING_FACTOR;
    const operational_out = fillRateM3hr * multiplier;
    const vaporisation_component = isVolatile
      ? fillRateM3hr * (OPERATIONAL.VOLATILE_OUTBREATHING_FACTOR - OPERATIONAL.NON_VOLATILE_OUTBREATHING_FACTOR)
      : 0;
    return { operational_out, vaporisation_component };
  }

  // ─── 3. WETTED AREA ──────────────────────────────────────────────────────────

  function calcWettedArea(tank) {
    const { shape, dims = {}, elevation_above_grade = 0 } = tank;
    const { diameter: D, height_or_length: H } = dims;
    const GRADE_LIMIT = FIRE_CASE.GRADE_LIMIT_M;
    if (!D) throw new Error('Tank diameter is required for wetted area calculation.');
    const R = D / 2;
    const limit_above_base = Math.max(0, GRADE_LIMIT - elevation_above_grade);
    let raw_area_m2 = 0;
    let method = '';

    switch (shape) {
      case 'VERTICAL_CYLINDER': {
        if (!H) throw new Error('Tank height is required for a vertical cylinder.');
        const wetted_height = Math.min(H, limit_above_base);
        const shell_area = Math.PI * D * wetted_height;
        raw_area_m2 = shell_area;
        method = `Vertical cylinder shell: π × ${D.toFixed(2)}m × ${wetted_height.toFixed(2)}m`;
        break;
      }
      case 'HORIZONTAL_CYLINDER': {
        if (!H) throw new Error('Tank length is required for a horizontal cylinder.');
        const tank_top_elev = elevation_above_grade + D;
        const tank_centre_elev = elevation_above_grade + R;
        let wetted_angle_rad;
        if (GRADE_LIMIT >= tank_top_elev) {
          wetted_angle_rad = 2 * Math.PI;
        } else if (GRADE_LIMIT <= elevation_above_grade) {
          wetted_angle_rad = 0;
        } else {
          const h_above_centre = GRADE_LIMIT - tank_centre_elev;
          const half_angle = Math.acos(Math.max(-1, Math.min(1, h_above_centre / R)));
          wetted_angle_rad = 2 * (Math.PI - half_angle);
        }
        const shell_area = wetted_angle_rad * R * H;
        const head_area = 0.5 * R * R * (wetted_angle_rad - Math.sin(wetted_angle_rad));
        raw_area_m2 = shell_area + head_area;
        method = 'Horizontal cylinder — arc-weighted shell + heads';
        break;
      }
      case 'SPHERE': {
        const sphere_bottom_elev = elevation_above_grade;
        const sphere_top_elev    = elevation_above_grade + D;
        const wetted_top_elev    = Math.min(sphere_top_elev, GRADE_LIMIT);
        const cap_height         = Math.max(0, wetted_top_elev - sphere_bottom_elev);
        raw_area_m2 = 2 * Math.PI * R * cap_height;
        method = `Sphere cap: 2π × ${R.toFixed(2)}m × ${cap_height.toFixed(2)}m`;
        break;
      }
      default:
        throw new Error(`Unknown tank shape: ${shape}`);
    }

    const MAX = FIRE_CASE.MAX_WETTED_AREA_M2;
    const exceeds_simplified_limit = raw_area_m2 > MAX;
    return {
      wetted_area_m2:      raw_area_m2,
      raw_wetted_area_m2:  raw_area_m2,
      was_capped:          false,
      exceeds_simplified_limit,
      method,
    };
  }

  // ─── 4. FIRE-CASE HEAT INPUT ────────────────────────────────────────────────

  function calcFireHeatInputBare(wettedAreaM2, drainageCredit, fireproofingCredit) {
    const C_val = drainageCredit ? FIRE_CASE.SI.DRAINAGE_CREDIT : FIRE_CASE.SI.NO_CREDIT;
    const F_base = FIRE_CASE.F_BARE;
    const F_eff  = fireproofingCredit ? F_base * 0.25 : F_base;
    const heat_input_W = C_val * F_eff * Math.pow(wettedAreaM2, FIRE_CASE.SI.exponent);
    return { heat_input_W, C_used: C_val, F_used: F_eff, method: 'bare_formula' };
  }

  function calcFireHeatInputInsulated(wettedAreaM2, insulation, T_contents_C) {
    const { thermal_conductivity: k, insulation_thickness: t } = insulation;
    const dT = FIRE_CASE.T_FIRE_SURFACE_C - T_contents_C;
    const heat_input_W = (k / t) * wettedAreaM2 * dT;
    return { heat_input_W, C_used: null, F_used: null, method: 'insulated_conduction' };
  }

  function calcFireHeatInput(environment, wettedAreaM2, T_contents_C, drainageCredit, fireproofingCredit) {
    const isInsulated = environment.insulation_type !== 'UNINSULATED' && environment.insulation;
    if (isInsulated) {
      return calcFireHeatInputInsulated(wettedAreaM2, environment.insulation, T_contents_C);
    }
    return calcFireHeatInputBare(wettedAreaM2, drainageCredit, fireproofingCredit);
  }

  // ─── 6. EMERGENCY OUTBREATHING (FIRE CASE) ───────────────────────────────────

  function calcEmergencyOutbreathing(
    heatInputW,
    latentHeatJkg,
    molecularWeight,
    relievingTempC,
    relievingPressureKpa,
  ) {
    if (!latentHeatJkg || latentHeatJkg <= 0) {
      throw new Error('Latent heat of vaporization is required for emergency venting calculation.');
    }
    if (!molecularWeight || molecularWeight <= 0) {
      throw new Error('Molecular weight is required for emergency venting calculation.');
    }
    const heatInputJ_hr   = heatInputW * 3600;
    const mass_flow_kg_hr = heatInputJ_hr / latentHeatJkg;
    const MOLAR_VOL_NM3_KGMOL = 22.414;
    const MOLAR_VOL_SM3_KGMOL = 23.6445;
    const mol_flow_kgmol_hr = mass_flow_kg_hr / molecularWeight;
    const nm3hr_std = mol_flow_kgmol_hr * MOLAR_VOL_NM3_KGMOL;
    const sm3hr_std = mol_flow_kgmol_hr * MOLAR_VOL_SM3_KGMOL;
    const T_std_K      = PHYSICAL.T_STD_SI;
    const T_relieve_K  = (relievingTempC ?? 20) + PHYSICAL.C_TO_K;
    const Q_actual_m3hr = nm3hr_std * (T_relieve_K / T_std_K) * (PHYSICAL.P_ATM_KPA / relievingPressureKpa);
    return {
      emergency_out_Nm3hr:       nm3hr_std,
      emergency_out_Sm3hr:       sm3hr_std,
      emergency_out_actual_m3hr: Q_actual_m3hr,
      vapour_mass_flow_kg_hr:    mass_flow_kg_hr,
      reference_conditions:      'Normal: 0°C, 101.325 kPa (Nm³/hr)',
    };
  }

  // ─── 7. TOTAL NORMAL VENTING ─────────────────────────────────────────────────

  function calcTotalNormalVenting(thermalIn, operIn, thermalOut, operOut) {
    return {
      total_in:  thermalIn  + operIn,
      total_out: thermalOut + operOut,
    };
  }

  // ─── 8. GOVERNING REQUIREMENTS ───────────────────────────────────────────────

  function calcGoverning(total_out_Nm3hr, emergency_out_Nm3hr, total_in_Nm3hr) {
    const governing_out = Math.max(total_out_Nm3hr, emergency_out_Nm3hr ?? 0);
    return {
      governing_out,
      governing_in:      total_in_Nm3hr,
      emergency_governs: (emergency_out_Nm3hr ?? 0) > total_out_Nm3hr,
    };
  }

  // ─── 8.5 ACTUAL VENTING DEVICES (PHASE 3) ───────────────────────────────────

  /**
   * Calculates the actual flow for a single device given a specific tank pressure.
   * Assumes linear proportional lift between Set Pressure and Rated Pressure.
   */
  function calcDeviceFlow(setPressure, ratedFlow, overpressurePct, tankPressure) {
    if (setPressure == null || ratedFlow == null || tankPressure == null) return 0;
    
    // If the tank hasn't reached the set pressure, the valve is closed
    if (tankPressure <= setPressure) return 0;

    // Calculate the pressure at which the valve is fully open (rated capacity)
    const ratedPressure = setPressure * (1 + (overpressurePct / 100));

    // Guard against divide-by-zero if user enters 0% overpressure
    if (ratedPressure === setPressure) {
      return tankPressure >= setPressure ? ratedFlow : 0;
    }

    // If tank pressure meets or exceeds rated pressure, it flows at 100% rated capacity
    if (tankPressure >= ratedPressure) return ratedFlow;

    // If tank pressure is between set and rated, interpolate linearly (standard approximation)
    const partialLiftRatio = (tankPressure - setPressure) / (ratedPressure - setPressure);
    return ratedFlow * partialLiftRatio;
  }

  /**
   * Aggregates the flow of all installed devices at the tank's relieving conditions.
   * Note: This function expects all inputs to already be converted to SI units (kPa, Nm³/hr).
   */
  function calcActualVenting(devices, relieving_pressure_kpa, relieving_vacuum_kpa) {
    let actual_normal_out = 0;
    let actual_emergency_out = 0;
    let actual_in = 0;

    const evaluated_devices = devices.map(dev => {
      let flow_out = 0;
      let flow_in = 0;

      // 1. Evaluate Outbreathing (Pressure)
      if (dev.direction === 'BOTH' || dev.direction === 'OUTBREATHING') {
        // Free vents don't have a "set pressure" — they are always open.
        // We assume their rated flow was provided at the tank's relieving pressure.
        if (dev.type === 'FREE_VENT') {
          flow_out = dev.rated_flow_outbreathing || 0;
        } else {
          flow_out = calcDeviceFlow(
            dev.set_pressure, 
            dev.rated_flow_outbreathing, 
            dev.rated_overpressure_pct, 
            relieving_pressure_kpa
          );
        }

        // Categorize the outbreathing flow
        if (dev.type === 'PVRV' || dev.type === 'FREE_VENT') {
          actual_normal_out += flow_out;
          actual_emergency_out += flow_out; // Normal vents also relieve during emergencies
        } else if (dev.type === 'EPRV') {
          actual_emergency_out += flow_out; // Emergency vents ONLY count for emergencies
        }
      }

      // 2. Evaluate Inbreathing (Vacuum)
      if (dev.direction === 'BOTH' || dev.direction === 'INBREATHING') {
        if (dev.type === 'FREE_VENT') {
          flow_in = dev.rated_flow_inbreathing || 0;
        } else {
          flow_in = calcDeviceFlow(
            dev.set_vacuum, 
            dev.rated_flow_inbreathing, 
            dev.rated_overpressure_pct, 
            relieving_vacuum_kpa
          );
        }
        
        // All inbreathing devices contribute to total vacuum relief
        actual_in += flow_in;
      }

      return { ...dev, calculated_flow_out: flow_out, calculated_flow_in: flow_in };
    });

    return {
      actual_normal_out,
      actual_emergency_out,
      actual_in,
      evaluated_devices
    };
  }

  // ─── 9. WARNING ACCUMULATOR ──────────────────────────────────────────────────

  function generateWarnings(inputs, intermediates) {
    const warnings = [];
    const { environment, tank, fluid, abnormal_scenarios, calculation_options: opts } = inputs;

    if (environment.insulation_type !== 'UNINSULATED' && !environment.insulation) {
      warnings.push(
        'WARNING: Insulation type is not UNINSULATED but insulation properties are missing. ' +
        'Calculation has defaulted to UNINSULATED per API 2000 §4.4.2.'
      );
    }
    if (intermediates.wetted?.exceeds_simplified_limit) {
      warnings.push(
        `NOTICE: Wetted area (${intermediates.wetted.raw_wetted_area_m2.toFixed(1)} m²) ` +
        `exceeds the API 2000 simplified table maximum of 260 m² (2,800 ft²). ` +
        `The general formula Q = C × F × A^0.82 is applied using the full uncapped ` +
        `area per §7.2.1.`
      );
    }
    if (fluid.is_volatile && fluid.vapor_pressure_kpa > 80) {
      warnings.push(
        'WARNING: Vapour pressure is > 80 kPa absolute. The liquid may be near or above its ' +
        'atmospheric bubble point. Verify relieving temperature and latent heat inputs.'
      );
    }
    const MAX_TABLE_M3 = 158_987;
    const MIN_TABLE_M3 = 9.5;
    if (inputs.tank.volume_m3 > MAX_TABLE_M3) {
      warnings.push(
        `NOTICE: Tank volume (${inputs.tank.volume_m3.toFixed(0)} m³) exceeds API 2000 ` +
        `Table 1 maximum (158,987 m³). Log-log extrapolation is applied. ` +
        `Verify with the standard's extended table or formula method.`
      );
    }
    if (inputs.tank.volume_m3 < MIN_TABLE_M3) {
      warnings.push(
        `NOTICE: Tank volume (${inputs.tank.volume_m3.toFixed(2)} m³) is below API 2000 ` +
        `Table 1 minimum (9.5 m³ / 60 BBL). Downward log-log extrapolation is applied. ` +
        `Results should be verified by the designer for very small tanks.`
      );
    }
    const activeAbnormal = Object.entries(abnormal_scenarios)
      .filter(([k, v]) => v === true && k !== 'other_enabled')
      .map(([k]) => k.replace(/_/g, ' '));
    if (activeAbnormal.length > 0) {
      warnings.push(
        `NOTICE: The following abnormal scenarios are selected and are NOT included in the ` +
        `calculated results: ${activeAbnormal.join(', ')}. ` +
        `Additional venting loads from these scenarios are the responsibility of the ` +
        `tank designer/owner per API 2000 §4.2.`
      );
    }
    if (!opts?.include_emergency_fire_case) {
      warnings.push(
        'NOTICE: Emergency fire-case venting is excluded from this calculation. ' +
        'Ensure this is appropriate for the installation and regulatory jurisdiction.'
      );
    }
    if (opts?.include_emergency_fire_case && !fluid.latent_heat_J_kg) {
      warnings.push(
        'WARNING: Latent heat of vaporisation is not provided. ' +
        'Emergency outbreathing cannot be calculated without this value.'
      );
    }
    if (inputs.tank.mawp_kpa > 103.4) {
      warnings.push(
        `WARNING: MAWP (${inputs.tank.mawp_kpa.toFixed(1)} kPa / ` +
        `${(inputs.tank.mawp_kpa * 0.145038).toFixed(1)} psig) exceeds the ` +
        `API Std 2000 scope limit of 103.4 kPa (15 psig). ` +
        `This tank may fall outside the scope of API 2000; consult the ` +
        `applicable pressure vessel code (e.g. ASME Section VIII).`
      );
    }

    // ── Device-related warnings ─────────────────────────────────────────────
    const devices = inputs.devices;
    if (devices && devices.length > 0) {
      const mawp_kpa = inputs.tank.mawp_kpa;
      const mawv_kpa = inputs.tank.mawv_kpa;

      const hasNormalOut = devices.some(d =>
        (d.type === 'PVRV' || d.type === 'FREE_VENT') &&
        (d.direction === 'BOTH' || d.direction === 'OUTBREATHING')
      );
      const hasEmergencyOnly = devices.some(d => d.type === 'EPRV');
      const hasAnyInbreathing = devices.some(d =>
        d.direction === 'BOTH' || d.direction === 'INBREATHING'
      );
      const hasAnyOutbreathing = devices.some(d =>
        d.direction === 'BOTH' || d.direction === 'OUTBREATHING'
      );

      if (hasEmergencyOnly && !hasNormalOut) {
        warnings.push(
          'WARNING: An Emergency Relief Valve (EPRV) is installed but no Normal ' +
          'PVRV or Free Vent provides outbreathing for normal operating conditions. ' +
          'EPRVs only relieve during emergencies and do not satisfy normal venting ' +
          'requirements per API 2000 §4.3.2.'
        );
      }

      if (!hasAnyOutbreathing) {
        warnings.push(
          'WARNING: No installed devices provide outbreathing (pressure relief). ' +
          'The tank has no capacity for thermal or operational outbreathing loads.'
        );
      }

      if (!hasAnyInbreathing) {
        warnings.push(
          'WARNING: No installed devices provide inbreathing (vacuum relief). ' +
          'The tank has no capacity for thermal or operational inbreathing loads.'
        );
      }

      devices.forEach((d, i) => {
        const label = `Device #${i + 1} (${d.type})`;

        // Set pressure exceeds MAWP
        if (d.set_pressure != null && mawp_kpa != null && d.set_pressure > mawp_kpa) {
          warnings.push(
            `WARNING: ${label} set pressure (${d.set_pressure.toFixed(2)} kPa) ` +
            `exceeds the tank MAWP (${mawp_kpa.toFixed(2)} kPa). ` +
            `The device may not open before the tank's design pressure is exceeded.`
          );
        }

        // Set vacuum exceeds MAWV
        if (d.set_vacuum != null && mawv_kpa != null && d.set_vacuum > mawv_kpa) {
          warnings.push(
            `WARNING: ${label} set vacuum (${d.set_vacuum.toFixed(2)} kPa) ` +
            `exceeds the tank MAWV (${mawv_kpa.toFixed(2)} kPa). ` +
            `The device may not open before the tank's design vacuum is exceeded.`
          );
        }

        // Outbreathing direction but missing rated flow
        if ((d.direction === 'BOTH' || d.direction === 'OUTBREATHING') &&
            (d.rated_flow_outbreathing == null || d.rated_flow_outbreathing <= 0)) {
          warnings.push(
            `NOTICE: ${label} is configured for outbreathing but has no rated ` +
            `outbreathing flow. Its pressure relief contribution will be zero.`
          );
        }

        // Inbreathing direction but missing rated flow
        if ((d.direction === 'BOTH' || d.direction === 'INBREATHING') &&
            (d.rated_flow_inbreathing == null || d.rated_flow_inbreathing <= 0)) {
          warnings.push(
            `NOTICE: ${label} is configured for inbreathing but has no rated ` +
            `inbreathing flow. Its vacuum relief contribution will be zero.`
          );
        }
      });
    }

    return warnings;
  }

  // ─── EXPORT ─────────────────────────────────────────────────────────────────
  window.API2000.engine = {
    logLogInterp,
    tableInterp,
    calcThermalVentingBare,
    applyInsulationFactor,
    calcOperationalInbreathing,
    calcOperationalOutbreathing,
    calcWettedArea,
    calcFireHeatInputBare,
    calcFireHeatInputInsulated,
    calcFireHeatInput,
    calcEmergencyOutbreathing,
    calcTotalNormalVenting,
    calcGoverning,
    calcDeviceFlow,
    calcActualVenting,
    generateWarnings,
  };
})();
