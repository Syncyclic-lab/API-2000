// ============================================================
// index.js  (browser build — orchestrator)
// Accepts a validated input object, runs all API 2000
// calculations, and returns a structured result object.
// Depends on: constants.js, unitConverter.js, api2000Engine.js
// ============================================================

'use strict';

(function () {
  const uc       = window.API2000.uc;
  const engine   = window.API2000.engine;
  const PHYSICAL = window.API2000.PHYSICAL;
  const AIR      = window.API2000.AIR_PROPERTIES;
  const OPEN_V   = window.API2000.OPEN_VENT;

  const round = (v, n = 2) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);
  const flowLabel = (us) => us === 'US' ? 'SCFH'   : 'Nm³/hr';
  const areaLabel = (us) => us === 'US' ? 'ft²'    : 'm²';
  const heatLabel = (us) => us === 'US' ? 'BTU/hr' : 'W';

  function convertInsulationToSI(ins, us) {
    if (!ins) return null;
    return {
      insulation_thickness:         ins.thickness != null ? uc.insulThicknessToM(ins.thickness, us) : null,
      thermal_conductivity:         ins.thermal_conductivity != null ? uc.insulConductivityToSI(ins.thermal_conductivity, us) : null,
      internal_heat_transfer_coeff: ins.internal_heat_transfer_coefficient != null ? uc.insulHTCToSI(ins.internal_heat_transfer_coefficient, us) : null,
      coverage_fraction:            ins.coverage_fraction,
    };
  }

  function runCalculation(inputs) {
    const errors = [];
    const us     = inputs.meta.unit_system;

    if (!inputs.meta.disclaimer_accepted) {
      return {
        errors: ['Calculation cannot proceed until the engineering disclaimer is accepted.'],
        warnings: [],
      };
    }

    try {
      const tank  = inputs.tank;
      const fluid = inputs.fluid;
      const env   = inputs.environment;
      const opts  = inputs.calculation_options ?? {};

      // --- Convert inputs to SI ---
      const volume_m3     = uc.toM3(tank.volume, us);
      const mawp_kpag     = uc.toKpa(tank.mawp, us);           // gauge kPa
      const mawv_kpag     = uc.toKpa(tank.mawv, us);           // gauge kPa
      const dims_si       = uc.convertDimsToSI(tank.dimensions, us);
      const elev_m        = uc.toMetres(tank.elevation_above_grade ?? 0, us);

      const fill_m3hr     = uc.liquidFlowToM3hr(fluid.max_fill_rate, us);
      const empty_m3hr    = uc.liquidFlowToM3hr(fluid.max_empty_rate, us);
      const fp_C          = fluid.flash_point != null ? uc.toC(fluid.flash_point, us) : null;
      const latent_J_kg   = fluid.latent_heat_of_vaporization != null
        ? uc.toJkg(fluid.latent_heat_of_vaporization, us)
        : null;
      const temp_contents_C = fluid.normal_operating_temp != null
        ? uc.toC(fluid.normal_operating_temp, us)
        : 20;
      const relieving_temp_C = fluid.relieving_vapor_temp != null
        ? uc.toC(fluid.relieving_vapor_temp, us)
        : temp_contents_C;

      // Relieving pressure for open-vent capacity calcs (absolute kPa)
      const relieving_P_kpaa = uc.gaugeToAbsKpa(mawp_kpag);

      const env_si = env.insulation
        ? { ...env, insulation: convertInsulationToSI(env.insulation, us) }
        : { ...env };

      const tank_si = {
        shape:                 tank.shape,
        dims:                  dims_si,
        elevation_above_grade: elev_m,
      };

      // --- Thermal venting ---
      const bare_thermal = engine.calcThermalVentingBare(volume_m3, env.latitude_zone);
      const thermal      = engine.applyInsulationFactor(bare_thermal, env_si);

      // --- Operational venting ---
      const operational_in = engine.calcOperationalInbreathing(empty_m3hr);
      const { operational_out, vaporisation_component } =
        engine.calcOperationalOutbreathing(fill_m3hr, fluid.is_volatile);

      // --- Totals ---
      const totals = engine.calcTotalNormalVenting(
        thermal.thermal_in, operational_in,
        thermal.thermal_out, operational_out,
      );

      // --- Emergency / fire case ---
      let wetted_result     = null;
      let heat_input_result = null;
      let emergency_result  = null;

      if (opts.include_emergency_fire_case !== false) {
        const manualOverrideM2 = opts.manual_wetted_area_override != null
          ? uc.toM2(opts.manual_wetted_area_override, us)
          : null;

        wetted_result = manualOverrideM2
          ? {
              wetted_area_m2:           manualOverrideM2,
              exceeds_simplified_limit: false,
              method:                   'Manual override provided by user',
            }
          : engine.calcWettedArea(tank_si);

        heat_input_result = engine.calcFireHeatInput(
          env_si,
          wetted_result.wetted_area_m2,
          temp_contents_C,
          opts.credit_for_drainage     ?? false,
          opts.credit_for_fireproofing ?? false,
        );

        if (latent_J_kg) {
          emergency_result = engine.calcEmergencyOutbreathing(
            heat_input_result.heat_input_W,
            latent_J_kg,
            fluid.molecular_weight,
            relieving_temp_C,
            relieving_P_kpaa,
          );
        } else {
          errors.push(
            'Emergency outbreathing requires latent heat of vaporisation and molecular weight. ' +
            'Provide these values to complete the fire-case calculation.'
          );
        }
      }

      // --- Governing requirements ---
      const governing = engine.calcGoverning(
        totals.total_out,
        emergency_result?.emergency_out_Nm3hr ?? null,
        totals.total_in,
      );

      // --- Actual installed venting devices ---
      let actual_venting_result = null;

      if (inputs.devices && inputs.devices.length > 0) {
        const flowToSI = (val) => val == null ? null : (us === 'US' ? uc.scfhToNm3hr(val) : val);
        const T_relieving_K = relieving_temp_C + PHYSICAL.C_TO_K;
        const T_ambient_K   = temp_contents_C  + PHYSICAL.C_TO_K;

        const actual_devices_si = inputs.devices.map(d => {
          const dev = {
            ...d,
            // Device set-pressures are gauge kPa once converted.
            set_pressure:            d.set_pressure != null ? uc.toKpa(d.set_pressure, us) : null,
            set_vacuum:              d.set_vacuum   != null ? uc.toKpa(d.set_vacuum, us)   : null,
            rated_flow_outbreathing: flowToSI(d.rated_flow_outbreathing),
            rated_flow_inbreathing:  flowToSI(d.rated_flow_inbreathing),
          };

          if (d.type === 'FREE_VENT' && d.capacity_source === 'calculated') {
            const pipe_d_m = d.pipe_diameter != null ? uc.pipeDiamToM(d.pipe_diameter, us) : null;
            const Cd       = d.discharge_coefficient ?? OPEN_V.DEFAULT_CD;
            const k_fluid  = d.specific_heat_ratio ?? fluid.specific_heat_ratio ?? null;
            const Zi_fluid = d.compressibility_factor ?? fluid.compressibility_factor ?? 1.0;
            const M_fluid  = fluid.molecular_weight ?? null;

            dev.pipe_diameter_m        = pipe_d_m;
            dev.discharge_coefficient  = Cd;
            dev.specific_heat_ratio    = k_fluid;
            dev.compressibility_factor = Zi_fluid;

            if ((d.direction === 'BOTH' || d.direction === 'OUTBREATHING')) {
              dev.rated_flow_outbreathing = (pipe_d_m && k_fluid && M_fluid)
                ? engine.calculateOpenVentCapacity(
                    pipe_d_m, relieving_P_kpaa, PHYSICAL.P_ATM_KPA,
                    k_fluid, T_relieving_K, M_fluid, Zi_fluid, Cd,
                  )
                : 0;
            }

            if ((d.direction === 'BOTH' || d.direction === 'INBREATHING')) {
              if (pipe_d_m) {
                const vacuum_abs_kpa = Math.max(PHYSICAL.P_ATM_KPA - mawv_kpag, 0.1);
                dev.rated_flow_inbreathing = engine.calculateOpenVentCapacity(
                  pipe_d_m, PHYSICAL.P_ATM_KPA, vacuum_abs_kpa,
                  AIR.k, T_ambient_K, AIR.M, AIR.Zi, Cd,
                );
              } else {
                dev.rated_flow_inbreathing = 0;
              }
            }
          }

          // Flame arrestor descriptor (already in SI from app.js).
          // We just ensure the dev object carries it forward unchanged.
          if (d.flame_arrestor && d.flame_arrestor.type === 'FLAME_ARRESTOR') {
            dev.flame_arrestor = { ...d.flame_arrestor };
          }

          return dev;
        });

        const anyArrestor = actual_devices_si.some(d =>
          d.flame_arrestor && d.flame_arrestor.type === 'FLAME_ARRESTOR');

        if (anyArrestor) {
          actual_venting_result = engine.calcActualVentingWithArrestor(
            actual_devices_si,
            mawp_kpag,
            mawv_kpag,
            {
              fluid: {
                molecular_weight:        fluid.molecular_weight,
                compressibility_factor:  fluid.compressibility_factor ?? 1.0,
                relieving_temperature_C: relieving_temp_C,
              },
              relieving_pressure_kPa_abs: relieving_P_kpaa,
              governing_out_Nm3hr:        governing.governing_out,
            },
          );
        } else {
          // Device comparison uses GAUGE pressure/vacuum — consistent with device set points.
          actual_venting_result = engine.calcActualVenting(
            actual_devices_si,
            mawp_kpag,
            mawv_kpag,
          );
        }
      }

      // --- Warnings ---
      const enriched_inputs = {
        ...inputs,
        tank:    { ...tank,  volume_m3, mawp_kpa: mawp_kpag, mawv_kpa: mawv_kpag },
        fluid:   { ...fluid, latent_heat_J_kg: latent_J_kg, flash_point_C: fp_C },
        devices: actual_venting_result
          ? actual_venting_result.evaluated_devices
          : (inputs.devices || []),
      };
      const warnings = engine.generateWarnings(enriched_inputs, { wetted: wetted_result });

      // Flame-arrestor warnings (additive; only non-empty when an arrestor is attached)
      if (actual_venting_result && actual_venting_result.evaluated_devices && engine.generateArrestorWarnings) {
        const fa_warnings = engine.generateArrestorWarnings(actual_venting_result.evaluated_devices);
        for (const w of fa_warnings) warnings.push(w);
      }

      // --- Output unit conversion ---
      const toFlow = (nm3hr) => nm3hr != null ? uc.ventingFlowToOutput(nm3hr, us) : null;
      const toArea = (m2)    => m2    != null ? uc.areaToOutput(m2, us)           : null;
      const toHeat = (w)     => w     != null ? uc.heatToOutput(w, us)            : null;

      const outputs = {
        unit_system: us,
        flow_unit:   flowLabel(us),
        area_unit:   areaLabel(us),
        heat_unit:   heatLabel(us),

        normal_venting: {
          thermal: {
            inbreathing:       round(toFlow(thermal.thermal_in), 1),
            outbreathing:      round(toFlow(thermal.thermal_out), 1),
            insulation_factor: round(thermal.insulation_factor, 4),
            latitude_zone:     env.latitude_zone,
          },
          operational: {
            inbreathing:            round(toFlow(operational_in), 1),
            outbreathing:           round(toFlow(operational_out), 1),
            vaporisation_component: round(toFlow(vaporisation_component), 1),
            is_volatile:            fluid.is_volatile,
          },
          totals: {
            total_inbreathing:  round(toFlow(totals.total_in), 1),
            total_outbreathing: round(toFlow(totals.total_out), 1),
          },
        },

        emergency_venting: wetted_result ? {
          wetted_area:                  round(toArea(wetted_result.wetted_area_m2), 1),
          exceeds_simplified_limit:     wetted_result.exceeds_simplified_limit ?? false,
          wetted_area_method:           wetted_result.method,
          heat_input:                   heat_input_result ? round(toHeat(heat_input_result.heat_input_W), 0) : null,
          heat_input_method:            heat_input_result?.method ?? null,
          F_factor:                     heat_input_result?.F_used != null ? round(heat_input_result.F_used, 4) : null,
          C_constant:                   heat_input_result?.C_used ?? null,
          emergency_outbreathing:       emergency_result ? round(toFlow(emergency_result.emergency_out_Nm3hr), 1) : null,
          emergency_outbreathing_Sm3hr: emergency_result ? round(emergency_result.emergency_out_Sm3hr, 1) : null,
          vapour_mass_flow:             emergency_result ? round(emergency_result.vapour_mass_flow_kg_hr, 2) : null,
          reference_conditions:         emergency_result?.reference_conditions ?? null,
        } : null,

        governing: {
          governing_outbreathing: round(toFlow(governing.governing_out), 1),
          governing_inbreathing:  round(toFlow(governing.governing_in), 1),
          emergency_governs:      governing.emergency_governs,
        },

        actual_venting: actual_venting_result ? {
          actual_normal_outbreathing:    round(toFlow(actual_venting_result.actual_normal_out), 1),
          actual_emergency_outbreathing: round(toFlow(actual_venting_result.actual_emergency_out), 1),
          actual_inbreathing:            round(toFlow(actual_venting_result.actual_in), 1),
          adequacy: {
            normal_out:    actual_venting_result.actual_normal_out    >= totals.total_out,
            emergency_out: actual_venting_result.actual_emergency_out >= governing.governing_out,
            inbreathing:   actual_venting_result.actual_in            >= governing.governing_in,
          },
          devices: actual_venting_result.evaluated_devices.map(d => ({
            id:        d.id,
            type:      d.type,
            direction: d.direction,
            flow_out:  round(toFlow(d.calculated_flow_out), 1),
            flow_in:   round(toFlow(d.calculated_flow_in),  1),
            arrestor:  d.arrestor_result ? {
              class_key:            d.arrestor_result.arrestor_class_key,
              K:                    round(d.arrestor_result.K, 2),
              diameter_mm:          round(d.arrestor_result.diameter_m * 1000, 1),
              deltaP_mbar:          round(d.arrestor_result.deltaP_mbar, 2),
              deltaP_inH2O:         round(d.arrestor_result.deltaP_inH2O, 2),
              deltaP_kPa:           round(d.arrestor_result.deltaP_kPa, 3),
              budget_pct:           round(d.arrestor_result.budget_pct, 1),
              velocity_m_s:         round(d.arrestor_result.velocity_m_s, 2),
              density_kg_m3:        round(d.arrestor_result.density_kg_m3, 4),
              effective_flow:       round(toFlow(d.arrestor_result.effective_flow_Nm3hr), 1),
              badge:                d.arrestor_result.badge,
              flow_inadequate:      d.arrestor_result.flow_inadequate,
            } : null,
          })),
        } : null,
      };

      const intermediates = {
        volume_m3:                round(volume_m3, 3),
        mawp_kpa:                 round(mawp_kpag, 3),
        mawv_kpa:                 round(mawv_kpag, 3),
        fill_rate_m3hr:           round(fill_m3hr, 4),
        empty_rate_m3hr:          round(empty_m3hr, 4),
        vapor_pressure_kpa:       round(vp_kpa, 3),
        latent_heat_J_kg:         latent_J_kg != null ? round(latent_J_kg, 0) : null,
        relieving_pressure_kpa_a: round(relieving_P_kpaa, 3),
        relieving_temp_C:         round(relieving_temp_C, 1),
        thermal_bare_in_Nm3hr:    round(bare_thermal.thermal_in, 2),
        thermal_bare_out_Nm3hr:   round(bare_thermal.thermal_out, 2),
        insulation_factor:        round(thermal.insulation_factor, 4),
        wetted_area_m2:           wetted_result ? round(wetted_result.wetted_area_m2, 2) : null,
        heat_input_W:             heat_input_result ? round(heat_input_result.heat_input_W, 0) : null,
      };

      return { outputs, intermediates, warnings, errors };

    } catch (err) {
      return {
        errors: [err.message || String(err)],
        warnings: [],
      };
    }
  }

  window.API2000.runCalculation = runCalculation;
})();
