// ============================================================
// api2000Engine.js  (browser build)
// Core API Std 2000 (7th Edition) calculation functions.
// Depends on: constants.js (must be loaded first)
// ============================================================

'use strict';

(function () {
  const {
    TABLE1_SI,
    TABLE1_VOLUME_LIMITS_M3,
    LATITUDE_FACTORS,
    FIRE_CASE,
    OPERATIONAL,
    PHYSICAL,
    INSULATION,
    OPEN_VENT,
  } = window.API2000;

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
    throw new Error('tableInterp: could not bracket volume ' + volume);
  }

  // --- 1. THERMAL VENTING --------------------------------------------------

  function calcThermalVentingBare(volumeM3, latitudeZone) {
    const factors = LATITUDE_FACTORS[latitudeZone];
    if (!factors) throw new Error('Unknown latitude zone: ' + latitudeZone);
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
    const { thermal_conductivity: k, insulation_thickness: t, internal_heat_transfer_coeff: h_i } = ins;
    const U_ins = 1 / (1 / h_i + t / k + 1 / INSULATION.H_OUT_W_M2_K);
    const covered_fraction = insulation_type === 'PARTIALLY_INSULATED'
      ? (ins.coverage_fraction ?? 1.0)
      : 1.0;
    const uncovered_fraction = 1 - covered_fraction;
    const U_eff = covered_fraction * U_ins + uncovered_fraction * INSULATION.H_BARE_W_M2_K;
    const insulation_factor = U_eff / INSULATION.H_BARE_W_M2_K;
    return {
      thermal_in:  bareRates.thermal_in  * insulation_factor,
      thermal_out: bareRates.thermal_out * insulation_factor,
      insulation_factor,
    };
  }

  // --- 2. OPERATIONAL VENTING ----------------------------------------------

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

  // --- 3. WETTED AREA ------------------------------------------------------

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
        raw_area_m2 = Math.PI * D * wetted_height;
        method = `Vertical cylinder shell: π × ${D.toFixed(2)} m × ${wetted_height.toFixed(2)} m`;
        break;
      }
      case 'HORIZONTAL_CYLINDER': {
        if (!H) throw new Error('Tank length is required for a horizontal cylinder.');
        const tank_top_elev    = elevation_above_grade + D;
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
        const head_area  = 0.5 * R * R * (wetted_angle_rad - Math.sin(wetted_angle_rad));
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
        method = `Sphere cap: 2π × ${R.toFixed(2)} m × ${cap_height.toFixed(2)} m`;
        break;
      }
      default:
        throw new Error('Unknown tank shape: ' + shape);
    }

    return {
      wetted_area_m2:           raw_area_m2,
      exceeds_simplified_limit: raw_area_m2 > FIRE_CASE.MAX_WETTED_AREA_M2,
      method,
    };
  }

  // --- 4. FIRE-CASE HEAT INPUT ---------------------------------------------

  function calcFireHeatInputBare(wettedAreaM2, drainageCredit, fireproofingCredit) {
    const C_val = drainageCredit ? FIRE_CASE.DRAINAGE_CREDIT : FIRE_CASE.NO_CREDIT;
    const F_eff = fireproofingCredit ? FIRE_CASE.F_BARE * FIRE_CASE.FIREPROOFING_FACTOR : FIRE_CASE.F_BARE;
    const heat_input_W = C_val * F_eff * Math.pow(wettedAreaM2, FIRE_CASE.exponent);
    return { heat_input_W, C_used: C_val, F_used: F_eff, method: 'bare_formula' };
  }

  function calcFireHeatInputInsulated(wettedAreaM2, insulation, T_contents_C) {
    const { thermal_conductivity: k, insulation_thickness: t } = insulation;
    const dT = PHYSICAL.T_FIRE_SURFACE_C - T_contents_C;
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

  // --- 5. EMERGENCY OUTBREATHING (FIRE CASE) -------------------------------

  function calcEmergencyOutbreathing(heatInputW, latentHeatJkg, molecularWeight, relievingTempC, relievingPressureKpa) {
    if (!latentHeatJkg || latentHeatJkg <= 0) {
      throw new Error('Latent heat of vaporization is required for emergency venting calculation.');
    }
    if (!molecularWeight || molecularWeight <= 0) {
      throw new Error('Molecular weight is required for emergency venting calculation.');
    }
    const heatInputJ_hr     = heatInputW * PHYSICAL.SECONDS_PER_HOUR;
    const mass_flow_kg_hr   = heatInputJ_hr / latentHeatJkg;
    const mol_flow_kgmol_hr = mass_flow_kg_hr / molecularWeight;
    const nm3hr_std         = mol_flow_kgmol_hr * PHYSICAL.MOLAR_VOL_NM3_KGMOL;
    const sm3hr_std         = mol_flow_kgmol_hr * PHYSICAL.MOLAR_VOL_SM3_KGMOL;
    const T_relieve_K       = (relievingTempC ?? 20) + PHYSICAL.C_TO_K;
    const Q_actual_m3hr     = nm3hr_std * (T_relieve_K / PHYSICAL.T_STD_SI) * (PHYSICAL.P_ATM_KPA / relievingPressureKpa);
    return {
      emergency_out_Nm3hr:       nm3hr_std,
      emergency_out_Sm3hr:       sm3hr_std,
      emergency_out_actual_m3hr: Q_actual_m3hr,
      vapour_mass_flow_kg_hr:    mass_flow_kg_hr,
      reference_conditions:      'Normal: 0 °C, 101.325 kPa (Nm³/hr)',
    };
  }

  // --- 6. TOTAL NORMAL VENTING ---------------------------------------------

  function calcTotalNormalVenting(thermalIn, operIn, thermalOut, operOut) {
    return {
      total_in:  thermalIn  + operIn,
      total_out: thermalOut + operOut,
    };
  }

  // --- 7. GOVERNING REQUIREMENTS -------------------------------------------

  function calcGoverning(total_out_Nm3hr, emergency_out_Nm3hr, total_in_Nm3hr) {
    const governing_out = Math.max(total_out_Nm3hr, emergency_out_Nm3hr ?? 0);
    return {
      governing_out,
      governing_in:      total_in_Nm3hr,
      emergency_governs: (emergency_out_Nm3hr ?? 0) > total_out_Nm3hr,
    };
  }

  // --- 8. OPEN VENT CAPACITY (API 2000 Eq. 25, SI) -------------------------

  function calculateOpenVentCapacity(diameter_m, p_inlet_kpa, p_outlet_kpa, k, T_inlet_K, M, Zi, Cd) {
    if (!diameter_m || !p_inlet_kpa || !p_outlet_kpa || !k || !T_inlet_K || !M) return 0;
    if (p_outlet_kpa >= p_inlet_kpa) return 0;

    const A_m2 = Math.PI * Math.pow(diameter_m / 2, 2);
    const P1   = p_inlet_kpa * 1000;
    const P2   = p_outlet_kpa * 1000;

    const r      = P2 / P1;
    const r_crit = Math.pow(2 / (k + 1), k / (k - 1));

    const Fk = (r <= r_crit)
      ? Math.sqrt(k * Math.pow(2 / (k + 1), (k + 1) / (k - 1)))
      : Math.sqrt((k / (k - 1)) * (Math.pow(r, 2 / k) - Math.pow(r, (k + 1) / k)));

    const m_dot = Cd * A_m2 * P1 * Math.sqrt(2 * M / (Zi * PHYSICAL.R_SI * T_inlet_K)) * Fk;
    return (m_dot / M) * PHYSICAL.MOLAR_VOL_NM3_KGMOL * PHYSICAL.SECONDS_PER_HOUR;
  }

  // --- 9. ACTUAL VENTING DEVICES -------------------------------------------

  function calcDeviceFlow(setPressure, ratedFlow, overpressurePct, tankPressure) {
    if (setPressure == null || ratedFlow == null || tankPressure == null) return 0;
    if (tankPressure <= setPressure) return 0;
    const op = overpressurePct ?? 0;
    const ratedPressure = setPressure * (1 + op / 100);
    if (ratedPressure === setPressure) {
      return tankPressure >= setPressure ? ratedFlow : 0;
    }
    if (tankPressure >= ratedPressure) return ratedFlow;
    const partialLiftRatio = (tankPressure - setPressure) / (ratedPressure - setPressure);
    return ratedFlow * partialLiftRatio;
  }

  // NOTE: device set pressures/vacuums and the tank relieving pressure/vacuum
  // must all be passed as GAUGE kPa. The caller is responsible for consistency.
  function calcActualVenting(devices, relieving_pressure_kpag, relieving_vacuum_kpag) {
    let actual_normal_out    = 0;
    let actual_emergency_out = 0;
    let actual_in            = 0;

    const evaluated_devices = devices.map(dev => {
      let flow_out = 0;
      let flow_in  = 0;

      if (dev.direction === 'BOTH' || dev.direction === 'OUTBREATHING') {
        flow_out = dev.type === 'FREE_VENT'
          ? (dev.rated_flow_outbreathing || 0)
          : calcDeviceFlow(
              dev.set_pressure,
              dev.rated_flow_outbreathing,
              dev.rated_overpressure_pct,
              relieving_pressure_kpag,
            );

        if (dev.type === 'PVRV' || dev.type === 'FREE_VENT') {
          actual_normal_out    += flow_out;
          actual_emergency_out += flow_out;
        } else if (dev.type === 'EPRV') {
          actual_emergency_out += flow_out;
        }
      }

      if (dev.direction === 'BOTH' || dev.direction === 'INBREATHING') {
        flow_in = dev.type === 'FREE_VENT'
          ? (dev.rated_flow_inbreathing || 0)
          : calcDeviceFlow(
              dev.set_vacuum,
              dev.rated_flow_inbreathing,
              dev.rated_overpressure_pct,
              relieving_vacuum_kpag,
            );
        actual_in += flow_in;
      }

      return { ...dev, calculated_flow_out: flow_out, calculated_flow_in: flow_in };
    });

    return { actual_normal_out, actual_emergency_out, actual_in, evaluated_devices };
  }

  // --- 10. WARNING ACCUMULATOR ---------------------------------------------

  const API2000_MAWP_SCOPE_LIMIT_KPA = 103.4;
  const HIGH_VP_WARN_KPA = 80;

  function generateWarnings(inputs, intermediates) {
    const warnings = [];
    const push = (severity, message) => warnings.push({ severity, message });
    const { environment, fluid, abnormal_scenarios, calculation_options: opts } = inputs;

    if (environment.insulation_type !== 'UNINSULATED' && !environment.insulation) {
      push('WARNING',
        'Insulation type is not UNINSULATED but insulation properties are missing. ' +
        'Calculation has defaulted to UNINSULATED per API 2000 §4.4.2.');
    }

    if (intermediates.wetted?.exceeds_simplified_limit) {
      push('NOTICE',
        `Wetted area (${intermediates.wetted.wetted_area_m2.toFixed(1)} m²) exceeds the ` +
        `API 2000 simplified table maximum of ${FIRE_CASE.MAX_WETTED_AREA_M2} m² (2,800 ft²). ` +
        'The general formula Q = C × F × A^0.82 is applied using the full uncapped area per §7.2.1.');
    }

    if (fluid.is_volatile && fluid.vapor_pressure_kpa > HIGH_VP_WARN_KPA) {
      push('WARNING',
        'Vapour pressure is > 80 kPa absolute. The liquid may be near or above its ' +
        'atmospheric bubble point. Verify relieving temperature and latent heat inputs.');
    }

    if (inputs.tank.volume_m3 > TABLE1_VOLUME_LIMITS_M3.MAX) {
      push('NOTICE',
        `Tank volume (${inputs.tank.volume_m3.toFixed(0)} m³) exceeds API 2000 Table 1 ` +
        `maximum (${TABLE1_VOLUME_LIMITS_M3.MAX.toLocaleString()} m³). Log-log extrapolation is applied. ` +
        'Verify with the standard extended table or formula method.');
    }

    if (inputs.tank.volume_m3 < TABLE1_VOLUME_LIMITS_M3.MIN) {
      push('NOTICE',
        `Tank volume (${inputs.tank.volume_m3.toFixed(2)} m³) is below API 2000 Table 1 ` +
        `minimum (${TABLE1_VOLUME_LIMITS_M3.MIN} m³ / 60 BBL). Downward log-log extrapolation is applied. ` +
        'Results should be verified by the designer for very small tanks.');
    }

    const activeAbnormal = Object.entries(abnormal_scenarios)
      .filter(([, v]) => v === true)
      .map(([k]) => k.replace(/_/g, ' '));
    if (activeAbnormal.length > 0) {
      push('NOTICE',
        'The following abnormal scenarios are selected and are NOT included in the ' +
        `calculated results: ${activeAbnormal.join(', ')}. ` +
        'Additional venting loads from these scenarios are the responsibility of the ' +
        'tank designer/owner per API 2000 §4.2.');
    }

    if (!opts?.include_emergency_fire_case) {
      push('NOTICE',
        'Emergency fire-case venting is excluded from this calculation. ' +
        'Ensure this is appropriate for the installation and regulatory jurisdiction.');
    }

    if (opts?.include_emergency_fire_case && !fluid.latent_heat_J_kg) {
      push('WARNING',
        'Latent heat of vaporisation is not provided. ' +
        'Emergency outbreathing cannot be calculated without this value.');
    }

    if (inputs.tank.mawp_kpa > API2000_MAWP_SCOPE_LIMIT_KPA) {
      push('WARNING',
        `MAWP (${inputs.tank.mawp_kpa.toFixed(1)} kPa / ` +
        `${(inputs.tank.mawp_kpa * window.API2000.CONVERSIONS.KPA_TO_PSI).toFixed(1)} psig) exceeds the ` +
        'API Std 2000 scope limit of 103.4 kPa (15 psig). ' +
        'This tank may fall outside the scope of API 2000; consult the ' +
        'applicable pressure vessel code (e.g. ASME Section VIII).');
    }

    const devices = inputs.devices;
    if (devices && devices.length > 0) {
      const { mawp_kpa, mawv_kpa } = inputs.tank;

      const hasNormalOut       = devices.some(d => (d.type === 'PVRV' || d.type === 'FREE_VENT') && (d.direction === 'BOTH' || d.direction === 'OUTBREATHING'));
      const hasEmergencyOnly   = devices.some(d => d.type === 'EPRV');
      const hasAnyOutbreathing = devices.some(d => d.direction === 'BOTH' || d.direction === 'OUTBREATHING');
      const hasAnyInbreathing  = devices.some(d => d.direction === 'BOTH' || d.direction === 'INBREATHING');

      if (hasEmergencyOnly && !hasNormalOut) {
        push('WARNING',
          'An Emergency Relief Valve (EPRV) is installed but no Normal PVRV or Free Vent ' +
          'provides outbreathing for normal operating conditions. ' +
          'EPRVs only relieve during emergencies and do not satisfy normal venting ' +
          'requirements per API 2000 §4.3.2.');
      }
      if (!hasAnyOutbreathing) {
        push('WARNING',
          'No installed devices provide outbreathing (pressure relief). ' +
          'The tank has no capacity for thermal or operational outbreathing loads.');
      }
      if (!hasAnyInbreathing) {
        push('WARNING',
          'No installed devices provide inbreathing (vacuum relief). ' +
          'The tank has no capacity for thermal or operational inbreathing loads.');
      }

      devices.forEach((d, i) => {
        const label = `Device #${i + 1} (${d.type})`;

        if (d.type === 'FREE_VENT' && d.capacity_source === 'calculated') {
          if (d.specific_heat_ratio == null || d.compressibility_factor == null) {
            push('WARNING',
              `${label} uses calculated capacity but the ratio of specific heats (k) or ` +
              'compressibility factor (Zi) is missing. Calculated flow will be zero.');
          }
          if (d.discharge_coefficient != null &&
              (d.discharge_coefficient < OPEN_VENT.CD_MIN || d.discharge_coefficient > OPEN_VENT.CD_MAX)) {
            push('WARNING',
              `${label} discharge coefficient (Cd = ${d.discharge_coefficient}) is outside the ` +
              `typical range of ${OPEN_VENT.CD_MIN}–${OPEN_VENT.CD_MAX}. ` +
              'Verify the Cd value for your specific fitting geometry.');
          }
          if (d.pipe_diameter_m != null && d.pipe_diameter_m < OPEN_VENT.MIN_PIPE_DIAM_M) {
            push('WARNING',
              `${label} pipe inner diameter appears very small (< 1 inch / 25.4 mm). ` +
              'Verify the input value.');
          }
        }

        if (d.type === 'PVRV' && d.set_pressure != null && mawp_kpa != null && d.set_pressure > mawp_kpa * 1.1) {
          push('WARNING',
            `${label} set pressure significantly exceeds MAWP. ` +
            'The valve may not open at the tank relieving conditions.');
        }
        if (d.type === 'PVRV' && d.set_vacuum != null && mawv_kpa != null && d.set_vacuum > mawv_kpa * 1.1) {
          push('WARNING',
            `${label} set vacuum significantly exceeds MAWV. ` +
            'The valve may not open at the tank vacuum conditions.');
        }
      });
    }

    return warnings;
  }

  // --- EXPORT --------------------------------------------------------------

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
    calculateOpenVentCapacity,
    calcDeviceFlow,
    calcActualVenting,
    generateWarnings,
  };
})();
