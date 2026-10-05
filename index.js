// ============================================================
// index.js  (browser build — orchestrator)
// Converts the form payload to SI, validates it, runs the API 2000
// calculations, and returns { outputs, intermediates, warnings, errors }.
// Depends on: constants.js, unitConverter.js, api2000Engine.js, flameArrestor.js
// ============================================================

'use strict';

(function () {
  const {
    uc, engine, PHYSICAL, AIR_PROPERTIES: AIR, OPEN_VENT,
    GENERAL_METHOD: GEN, ANNEX_A, FIRE, MAX_SCOPE_PRESSURE_KPA, CONVERSIONS,
  } = window.API2000;

  const METHOD_LABELS = {
    GENERAL: 'API 2000 §3.3.2 general method',
    ANNEX_A: 'API 2000 Annex A alternative method',
  };
  const TYPE_LABELS = { PVRV: 'PVRV', EPRV: 'EPRV', FREE_VENT: 'Free Vent' };
  const AMBIENT_C = OPEN_VENT.AMBIENT_AIR_TEMP_C;

  const round = (v, n = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** n) / 10 ** n);
  const isNonNegative = (v) => Number.isFinite(v) && v >= 0;
  const isFraction = (v) => isNonNegative(v) && v <= 1;
  const relievesOut = (d) => d.direction !== 'INBREATHING';
  const relievesIn  = (d) => d.direction !== 'OUTBREATHING';

  // --- Input conversion and validation ---------------------------------------

  function toSI(p) {
    const us = p.meta.unit_system;
    const c = (fn, v) => (v == null ? null : fn(v, us));
    const { tank = {}, fluid = {}, environment: env = {}, fire = {} } = p;
    return {
      us,
      method: p.meta.method === 'GENERAL' ? 'GENERAL' : 'ANNEX_A',
      tank: {
        shape:       tank.shape,
        volume_m3:   c(uc.toM3, tank.volume),
        mawp_kpag:   c(uc.toKpa, tank.mawp),
        mawv_kpag:   c(uc.toKpa, tank.mawv),
        diameter_m:  c(uc.toMetres, tank.diameter),
        length_m:    c(uc.toMetres, tank.height_or_length),
        elevation_m: c(uc.toMetres, tank.elevation_above_grade) ?? 0,
      },
      fluid: {
        flash_point_C:        c(uc.toC, fluid.flash_point),
        vapor_pressure_class: fluid.vapor_pressure_class || 'HIGHER',
        operating_temp_C:     c(uc.toC, fluid.operating_temp),
        relieving_temp_C:     c(uc.toC, fluid.relieving_temp),
        fill_m3hr:            c(uc.toM3, fluid.max_fill_rate),
        empty_m3hr:           c(uc.toM3, fluid.max_empty_rate),
        latent_J_kg:          c(uc.toJkg, fluid.latent_heat),
        molecular_weight:     fluid.molecular_weight ?? null,
      },
      env: {
        latitude:                     env.latitude_zone,
        insulation_type:              env.insulation_type || 'UNINSULATED',
        thickness_m:                  c(uc.smallLengthToM, env.insulation_thickness),
        conductivity:                 c(uc.insulConductivityToSI, env.insulation_conductivity),
        h_inside:                     c(uc.insulHTCToSI, env.inside_htc),
        coverage_fraction:            env.coverage_fraction ?? null,
        outside_containment_fraction: env.outside_containment_fraction ?? null,
      },
      fire: {
        include:              fire.include !== false,
        environmental_factor: fire.environmental_factor || 'BARE',
        custom_factor:        fire.custom_factor ?? null,
        manual_wetted_m2:     c(uc.toM2, fire.manual_wetted_area),
      },
      abnormal: p.abnormal_scenarios || {},
      devices:  p.devices || [],
    };
  }

  function validate(s) {
    const errors = [];
    const need = (ok, message) => { if (!ok) errors.push(message); };
    const { method, tank, fluid, env, fire } = s;
    const insulated = env.insulation_type === 'FULLY_INSULATED' || env.insulation_type === 'PARTIALLY_INSULATED';

    need(tank.volume_m3 > 0, 'Enter a tank volume greater than zero.');
    need(isNonNegative(tank.mawp_kpag), 'Enter the tank MAWP (0 for an atmospheric tank).');
    need(isNonNegative(tank.mawv_kpag), 'Enter the tank MAWV (0 for an atmospheric tank).');
    need(isNonNegative(fluid.fill_m3hr), 'Enter the maximum fill rate (0 if none).');
    need(isNonNegative(fluid.empty_m3hr), 'Enter the maximum empty rate (0 if none).');

    if (method === 'ANNEX_A') {
      need(fluid.flash_point_C != null, 'Flash point is required for the Annex A method (volatility per Table A.1).');
    } else {
      if (insulated) need(env.thickness_m > 0 && env.conductivity > 0, 'Enter the insulation thickness and thermal conductivity for an insulated tank.');
      if (env.insulation_type === 'PARTIALLY_INSULATED') need(isFraction(env.coverage_fraction), 'Enter the insulated fraction of the tank surface (0–1).');
      if (env.insulation_type === 'DOUBLE_WALL') need(isFraction(env.outside_containment_fraction), 'Enter the fraction of the tank surface outside the containment tank (0–1).');
    }

    if (fire.include) {
      if (fire.environmental_factor === 'INSULATED') {
        need(insulated && env.thickness_m > 0 && env.conductivity > 0,
          'The insulated environmental factor needs an insulated tank type with insulation thickness and thermal conductivity.');
      }
      if (fire.environmental_factor === 'CUSTOM') need(isFraction(fire.custom_factor), 'Enter a custom environmental factor F between 0 and 1.');
      if (fire.manual_wetted_m2 == null) {
        need(tank.diameter_m > 0, 'Enter the tank diameter (or a manual wetted area) for the fire case.');
        if (tank.shape !== 'SPHERE') need(tank.length_m > 0, 'Enter the tank height/length (or a manual wetted area) for the fire case.');
      } else {
        need(isNonNegative(fire.manual_wetted_m2), 'The manual wetted area cannot be negative.');
      }
    }
    return errors;
  }

  // --- Calculation steps ------------------------------------------------------

  function calcNormalVenting(s) {
    const { method, tank, fluid, env } = s;
    let isVolatile, thermal, Ri = null;
    if (method === 'GENERAL') {
      isVolatile = fluid.vapor_pressure_class !== 'NONVOLATILE';
      Ri = engine.calcInsulationReduction(env);
      thermal = engine.calcThermalGeneral(tank.volume_m3, env.latitude, fluid.vapor_pressure_class, fluid.operating_temp_C, Ri);
    } else {
      isVolatile = fluid.flash_point_C < ANNEX_A.VOLATILE_FLASH_POINT_C;
      thermal = engine.calcThermalAnnexA(tank.volume_m3, isVolatile);
    }
    const liquid = engine.calcLiquidMovement(method, fluid.fill_m3hr, fluid.empty_m3hr, isVolatile);
    return {
      ...thermal,
      ...liquid,
      Ri,
      is_volatile: isVolatile,
      total_in:  thermal.thermal_in + liquid.liquid_in,
      total_out: thermal.thermal_out + liquid.liquid_out,
    };
  }

  function calcFireCase(s) {
    const { tank, fluid, env, fire } = s;
    const wetted = fire.manual_wetted_m2 != null
      ? { wetted_area_m2: fire.manual_wetted_m2, limit_governs: false, method: 'Manual override' }
      : engine.calcWettedArea(tank.shape, tank.diameter_m, tank.length_m, tank.elevation_m);
    const heat_input_W = engine.calcFireHeatInput(wetted.wetted_area_m2, tank.mawp_kpag);
    const F = engine.calcEnvironmentalFactor(fire.environmental_factor, {
      thickness_m: env.thickness_m, conductivity: env.conductivity, custom: fire.custom_factor,
    });

    const userFluid = fluid.latent_J_kg > 0 && fluid.molecular_weight > 0;
    const relieving_temp_C = fluid.relieving_temp_C ?? fluid.operating_temp_C ?? AMBIENT_C;
    const basis = userFluid
      ? { L: fluid.latent_J_kg, M: fluid.molecular_weight, T_K: relieving_temp_C + PHYSICAL.C_TO_K }
      : FIRE.HEXANE;
    return {
      ...wetted,
      heat_input_W,
      F,
      basis: userFluid ? 'FLUID' : 'HEXANE',
      L: basis.L,
      M: basis.M,
      T_K: basis.T_K,
      ...engine.calcEmergencyVenting(heat_input_W, F, basis.L, basis.M, basis.T_K),
    };
  }

  // Converts devices to SI and computes calculated open-vent capacities.
  function devicesToSI(s) {
    const { us, tank, fluid } = s;
    const c = (fn, v) => (v == null ? null : fn(v, us));
    const P_ATM = PHYSICAL.P_ATM_KPA;
    // Open vents are sized at the tank allowable pressure/vacuum with air
    // properties (air-equivalent flow, Annex D.9). Atmospheric tanks entered with
    // MAWP/MAWV = 0 use a default allowable accumulation instead.
    const allowP = tank.mawp_kpag > 0 ? tank.mawp_kpag : OPEN_VENT.ATM_DEFAULT_ALLOWABLE_KPA;
    const allowV = tank.mawv_kpag > 0 ? tank.mawv_kpag : OPEN_VENT.ATM_DEFAULT_ALLOWABLE_KPA;
    const vapourTempC = fluid.relieving_temp_C ?? fluid.operating_temp_C ?? AMBIENT_C;
    let atmDefaultUsed = false;

    const devices = s.devices.map(d => {
      const dev = {
        ...d,
        set_pressure:            c(uc.toKpa, d.set_pressure),
        set_vacuum:              c(uc.toKpa, d.set_vacuum),
        rated_flow_outbreathing: c(uc.toNm3hr, d.rated_flow_outbreathing),
        rated_flow_inbreathing:  c(uc.toNm3hr, d.rated_flow_inbreathing),
      };
      if (d.type === 'FREE_VENT' && d.capacity_source === 'calculated') {
        const diameter = c(uc.smallLengthToM, d.pipe_diameter);
        const Cd = d.discharge_coefficient ?? OPEN_VENT.DEFAULT_CD;
        const capacity = (pIn, pOut, tempC) => engine.calculateOpenVentCapacity(
          diameter, pIn, pOut, AIR.k, tempC + PHYSICAL.C_TO_K, AIR.M, AIR.Zi, Cd);
        dev.pipe_diameter_m = diameter;
        dev.discharge_coefficient = Cd;
        if (relievesOut(d)) {
          dev.rated_flow_outbreathing = capacity(P_ATM + allowP, P_ATM, vapourTempC);
          atmDefaultUsed = atmDefaultUsed || !(tank.mawp_kpag > 0);
        }
        if (relievesIn(d)) {
          dev.rated_flow_inbreathing = capacity(P_ATM, Math.max(P_ATM - allowV, 0.1), AMBIENT_C);
          atmDefaultUsed = atmDefaultUsed || !(tank.mawv_kpag > 0);
        }
      }
      return dev;
    });
    return { devices, atmDefaultUsed };
  }

  // --- Warnings ---------------------------------------------------------------

  function collectWarnings(s, fireCase, actual, atmDefaultUsed) {
    const out = [];
    const warn = (message) => out.push({ severity: 'WARNING', message });
    const notice = (message) => out.push({ severity: 'NOTICE', message });
    const { method, tank, fluid, env, fire } = s;

    // Normal venting basis
    if (method === 'ANNEX_A') {
      if (env.insulation_type !== 'UNINSULATED') {
        warn('Annex A applies only to uninsulated tanks (A.1.2). No insulation or double-wall reduction ' +
          'has been applied; use the §3.3.2 general method to take credit for it.');
      }
      if (tank.volume_m3 > ANNEX_A.MAX_VOLUME_M3) {
        warn(`Tank volume (${tank.volume_m3.toFixed(0)} m³) exceeds the 30,000 m³ limit of Annex A ` +
          '(Table A.3 note a). Table A.3 has been extrapolated; use the §3.3.2 general method.');
      }
      if (Math.max(fluid.operating_temp_C ?? -Infinity, fluid.relieving_temp_C ?? -Infinity) > ANNEX_A.MAX_TEMP_C) {
        warn('A temperature above 48.9 °C was entered. Annex A is limited to vapour-space temperatures of ' +
          'about 48.9 °C (A.1.2, A.3.1.4); use the §3.3.2 general method.');
      }
    } else {
      if (fluid.operating_temp_C == null && fluid.vapor_pressure_class !== 'HIGHER') {
        notice('Average storage temperature not entered; the Table 2 C-factor for ≥ 25 °C has been used (conservative).');
      }
      if (fluid.operating_temp_C > GEN.AIR_EQUIVALENT_TEMP_LIMIT_C) {
        notice('Storage temperature exceeds 49 °C. Filling out-breathing should be converted to an ' +
          'air-equivalent flow per Annex D.9 (§3.3.2.2.1); it is reported here unconverted.');
      }
    }

    const abnormal = Object.entries(s.abnormal)
      .filter(([, v]) => v === true)
      .map(([k]) => k.replace(/_/g, ' '));
    if (abnormal.length > 0) {
      notice(`These scenarios are selected but NOT included in the results: ${abnormal.join(', ')}. ` +
        'Quantify these loads separately per API 2000 §3.2.5.');
    }

    // Emergency venting
    if (!fire.include) {
      notice('Emergency (fire-case) venting is excluded. This is only appropriate where justified, e.g. a tank ' +
        'with a weak roof-to-shell attachment (§3.3.3.2).');
    } else {
      if (fireCase.basis === 'HEXANE') {
        notice('Latent heat and/or molecular weight not provided, so emergency venting uses the hexane basis of ' +
          'Tables 5 and 7 (§3.3.3.3.3). Enter both to apply Eq. (14) to the stored fluid.');
      } else if (fluid.relieving_temp_C == null) {
        notice(`Relieving vapour temperature not entered; ${(fireCase.T_K - PHYSICAL.C_TO_K).toFixed(1)} °C ` +
          'has been used in Eq. (14). Enter the bubble point at the relieving pressure.');
      }
      if (fire.manual_wetted_m2 == null) {
        if (fireCase.wetted_area_m2 === 0) {
          notice(`No tank surface lies within ${FIRE.GRADE_LIMIT_M} m of grade, so the fire-case requirement is zero.`);
        } else if (fireCase.limit_governs) {
          notice(`The surface within ${FIRE.GRADE_LIMIT_M} m of grade exceeds the 55 %/75 % fraction and governs the ` +
            'wetted area, as written in Table 5 note a. Use the manual wetted-area override if a different basis is justified.');
        }
        if (tank.shape === 'VERTICAL_CYLINDER' && tank.elevation_m > 0) {
          notice('For a vertical tank supported above grade, part of the bottom area should be added to the wetted ' +
            'area by engineering judgment (Table 5 note a). Use the manual wetted-area override to include it.');
        }
      }
      if (fire.environmental_factor === 'INSULATED') {
        notice('Insulation F-factor credit requires fire-resistant insulation over the wetted area that resists ' +
          'dislodgment by fire-fighting equipment (Table 9 note a).');
      }
    }

    if (tank.mawp_kpag > MAX_SCOPE_PRESSURE_KPA) {
      warn(`MAWP (${tank.mawp_kpag.toFixed(1)} kPa / ${(tank.mawp_kpag * CONVERSIONS.KPA_TO_PSI).toFixed(1)} psig) ` +
        'exceeds the API Std 2000 scope limit of 103.4 kPa (15 psig). Consult the applicable pressure vessel code.');
    }

    // Installed devices
    const devices = actual ? actual.devices : [];
    if (devices.length > 0) {
      if (!devices.some(relievesOut)) {
        warn('No installed device provides out-breathing (pressure) relief.');
      } else if (!devices.some(d => relievesOut(d) && d.type !== 'EPRV')) {
        warn('Only emergency relief valves (EPRV) provide pressure relief. EPRVs do not satisfy normal out-breathing requirements.');
      }
      if (!devices.some(relievesIn)) warn('No installed device provides inbreathing (vacuum) relief.');

      devices.forEach((d, i) => {
        const label = `Device #${i + 1} (${TYPE_LABELS[d.type] || d.type})`;
        if (d.type === 'FREE_VENT' && d.capacity_source === 'calculated') {
          if (!(d.pipe_diameter_m > 0)) warn(`${label}: pipe inner diameter not entered; capacity taken as zero.`);
          else if (d.pipe_diameter_m < OPEN_VENT.MIN_PIPE_DIAM_M) warn(`${label}: pipe inner diameter is below 1 inch (25.4 mm); verify the input.`);
          if (d.discharge_coefficient < OPEN_VENT.CD_MIN || d.discharge_coefficient > OPEN_VENT.CD_MAX) {
            warn(`${label}: discharge coefficient Cd = ${d.discharge_coefficient} is outside the typical ` +
              `${OPEN_VENT.CD_MIN}–${OPEN_VENT.CD_MAX} range; verify it for the fitting geometry.`);
          }
          return;
        }
        const checks = [
          [relievesOut(d), d.rated_flow_outbreathing, d.set_pressure, tank.mawp_kpag, 'out-breathing', 'set pressure', 'MAWP'],
          [relievesIn(d),  d.rated_flow_inbreathing,  d.set_vacuum,   tank.mawv_kpag, 'inbreathing',   'set vacuum',   'MAWV'],
        ];
        for (const [applies, flow, setPoint, limit, dir, setName, limitName] of checks) {
          if (!applies) continue;
          if (!(flow > 0)) warn(`${label}: rated ${dir} flow not entered; capacity taken as zero.`);
          if (d.type === 'FREE_VENT') continue;
          if (setPoint == null) warn(`${label}: ${setName} not entered; ${dir} capacity taken as zero.`);
          else if (setPoint >= limit) {
            warn(`${label}: ${setName} is at or above the tank ${limitName}, so the valve provides no ` +
              `${dir} capacity at the tank's allowable ${limitName === 'MAWP' ? 'pressure' : 'vacuum'}.`);
          }
        }
      });
    }

    if (atmDefaultUsed) {
      notice(`One or more open vents were sized at the default allowable of ${OPEN_VENT.ATM_DEFAULT_ALLOWABLE_KPA} kPa ` +
        '(≈ 2 in H₂O) because the tank MAWP and/or MAWV is 0. Enter the actual allowable pressure/vacuum to refine the capacity.');
    }

    out.push(...engine.generateArrestorWarnings(devices));
    return out;
  }

  // --- Entry point ------------------------------------------------------------

  function runCalculation(inputs) {
    if (!inputs.meta.disclaimer_accepted) {
      return { errors: ['Calculation cannot proceed until the engineering disclaimer is accepted.'], warnings: [] };
    }

    try {
      const s = toSI(inputs);
      const errors = validate(s);
      if (errors.length > 0) return { errors, warnings: [] };

      const { us, method, tank } = s;
      const normal   = calcNormalVenting(s);
      const fireCase = s.fire.include ? calcFireCase(s) : null;
      const emergencyOut = fireCase ? fireCase.emergency_out : 0;

      let actual = null;
      let atmDefaultUsed = false;
      if (s.devices.length > 0) {
        const converted = devicesToSI(s);
        atmDefaultUsed = converted.atmDefaultUsed;
        // Venting capacities are air-equivalent flows (Annex D.9), so the arrestor
        // ΔP is evaluated with air at normal temperature and the relieving pressure.
        actual = engine.calcActualVenting(converted.devices, tank.mawp_kpag, tank.mawv_kpag, {
          molecular_weight:       AIR.M,
          compressibility_factor: AIR.Zi,
          temperature_C:          0,
          pressure_kPa_abs:       PHYSICAL.P_ATM_KPA + tank.mawp_kpag,
        });
      }

      const warnings = collectWarnings(s, fireCase, actual, atmDefaultUsed);

      // --- Output in display units ---
      const flow = (nm3hr) => round(uc.flowToOutput(nm3hr, us), 1);
      const governingOut = Math.max(normal.total_out, emergencyOut);
      const meta = inputs.meta;

      const outputs = {
        unit_system: us,
        flow_unit:   us === 'US' ? 'SCFH' : 'Nm³/h',
        area_unit:   us === 'US' ? 'ft²' : 'm²',
        heat_unit:   us === 'US' ? 'BTU/h' : 'W',
        mass_unit:   us === 'US' ? 'lb/h' : 'kg/h',
        project: {
          tag_number:   meta.tag_number ?? null,
          project_name: meta.project_name ?? null,
          prepared_by:  meta.prepared_by ?? null,
          fluid_name:   inputs.fluid?.name ?? null,
        },
        method,
        method_label: METHOD_LABELS[method],

        normal_venting: {
          is_volatile: normal.is_volatile,
          thermal_in:  flow(normal.thermal_in),
          thermal_out: flow(normal.thermal_out),
          liquid_in:   flow(normal.liquid_in),
          liquid_out:  flow(normal.liquid_out),
          total_in:    flow(normal.total_in),
          total_out:   flow(normal.total_out),
          Y:           normal.Y ?? null,
          C:           normal.C ?? null,
          Ri:          round(normal.Ri, 4),
        },

        emergency_venting: fireCase ? {
          wetted_area:        round(uc.areaToOutput(fireCase.wetted_area_m2, us), 1),
          wetted_area_method: fireCase.method,
          heat_input:         round(uc.heatToOutput(fireCase.heat_input_W, us), 0),
          F:                  round(fireCase.F, 4),
          basis:              fireCase.basis,
          required:           flow(fireCase.emergency_out),
          vapour_mass_flow:   round(uc.massToOutput(fireCase.vapour_mass_flow_kg_hr, us), 1),
        } : null,

        governing: {
          outbreathing:      flow(governingOut),
          inbreathing:       flow(normal.total_in),
          emergency_governs: emergencyOut > normal.total_out,
        },

        actual_venting: actual ? {
          normal_out:    flow(actual.normal_out),
          emergency_out: flow(actual.emergency_out),
          inbreathing:   flow(actual.inbreathing),
          adequacy: {
            normal_out:    actual.normal_out >= normal.total_out,
            emergency_out: fireCase ? actual.emergency_out >= fireCase.emergency_out : null,
            inbreathing:   actual.inbreathing >= normal.total_in,
          },
          devices: actual.devices.map(d => ({
            type:      d.type,
            direction: d.direction,
            flow_out:  flow(d.flow_out),
            flow_in:   flow(d.flow_in),
            arrestor:  d.arrestor ? {
              deltaP_mbar:    round(d.arrestor.deltaP_mbar, 2),
              deltaP_inH2O:   round(d.arrestor.deltaP_inH2O, 2),
              budget_pct:     round(d.arrestor.budget_pct, 1),
              effective_flow: flow(d.arrestor.effective_flow_Nm3hr),
              badge:          d.arrestor.badge,
            } : null,
          })),
        } : null,
      };

      // SI audit trail: [label, value, unit]
      const intermediates = [
        ['Volume',                  round(tank.volume_m3, 3),       'm³'],
        ['MAWP',                    round(tank.mawp_kpag, 3),       'kPa(g)'],
        ['MAWV',                    round(tank.mawv_kpag, 3),       'kPa(g)'],
        ['Fill rate',               round(s.fluid.fill_m3hr, 3),    'm³/h'],
        ['Empty rate',              round(s.fluid.empty_m3hr, 3),   'm³/h'],
        ['Flash point',             round(s.fluid.flash_point_C, 2), '°C'],
        ['Thermal inbreathing',     round(normal.thermal_in, 2),    'Nm³/h'],
        ['Thermal out-breathing',   round(normal.thermal_out, 2),   'Nm³/h'],
        ['Liquid-movement inbreathing',   round(normal.liquid_in, 2),  'Nm³/h'],
        ['Liquid-movement out-breathing', round(normal.liquid_out, 2), 'Nm³/h'],
      ];
      if (method === 'GENERAL') {
        intermediates.push(['Y-factor (Table 1)', normal.Y, ''], ['C-factor (Table 2)', normal.C, ''],
          ['Insulation reduction factor Rᵢ', round(normal.Ri, 4), '']);
      }
      if (fireCase) {
        intermediates.push(
          ['Wetted area A_TWS',             round(fireCase.wetted_area_m2, 2), 'm²'],
          ['Heat input Q (Table 3)',        round(fireCase.heat_input_W, 0),   'W'],
          ['Environmental factor F',        round(fireCase.F, 4),              ''],
          ['Latent heat L',                 round(fireCase.L, 0),              'J/kg'],
          ['Molecular weight M',            round(fireCase.M, 2),              ''],
          ['Relieving temperature T',       round(fireCase.T_K, 2),            'K'],
          ['Emergency venting (Eq. 14)',    round(fireCase.emergency_out, 1),  'Nm³/h'],
        );
      }

      return { outputs, intermediates, warnings, errors: [] };
    } catch (err) {
      return { errors: [err.message || String(err)], warnings: [] };
    }
  }

  window.API2000.runCalculation = runCalculation;
})();
