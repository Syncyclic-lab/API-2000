// ============================================================
// index.js  (browser build — orchestrator)
// Accepts a validated input object, runs all API 2000
// calculations, and returns a structured result object.
// Depends on: constants.js, unitConverter.js, api2000Engine.js
// ============================================================

'use strict';

(function () {
  const uc     = window.API2000.uc;
  const engine = window.API2000.engine;

  // ─── HELPERS ─────────────────────────────────────────────────────────────────

  const round = (v, n = 2) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);
  const flowLabel = (unitSystem) => unitSystem === 'US' ? 'SCFH' : 'Nm³/hr';
  const areaLabel = (unitSystem) => unitSystem === 'US' ? 'ft²'  : 'm²';
  const heatLabel = (unitSystem) => unitSystem === 'US' ? 'BTU/hr' : 'W';

  // ─── MAIN ORCHESTRATOR ───────────────────────────────────────────────────────

  function runCalculation(inputs) {
    const errors = [];
    const us     = inputs.meta.unit_system;

    // ── Guard: disclaimer must be accepted ──────────────────────────────────
    if (!inputs.meta.disclaimer_accepted) {
      return {
        errors: ['Calculation cannot proceed until the engineering disclaimer is accepted.'],
        warnings: [],
      };
    }

    try {
      // ══════════════════════════════════════════════════════════════════════
      // STEP 1  Convert all inputs to SI
      // ══════════════════════════════════════════════════════════════════════

      const tank  = inputs.tank;
      const fluid = inputs.fluid;
      const env   = inputs.environment;
      const opts  = inputs.calculation_options ?? {};

      const volume_m3     = uc.toM3(tank.volume, us);
      const mawp_kpa      = uc.toKpa(tank.mawp, us);
      const mawv_kpa      = uc.toKpa(tank.mawv, us);
      const dims_si       = uc.convertDimsToSI(tank.dimensions, us);
      const elev_m        = uc.toMetres(tank.elevation_above_grade ?? 0, us);

      const fill_m3hr     = uc.liquidFlowToM3hr(fluid.max_fill_rate, us);
      const empty_m3hr    = uc.liquidFlowToM3hr(fluid.max_empty_rate, us);
      const vp_kpa        = uc.toKpa(fluid.vapor_pressure, us);
      const latent_J_kg   = fluid.latent_heat_of_vaporization
        ? uc.toJkg(fluid.latent_heat_of_vaporization, us)
        : null;
      const temp_contents_C = fluid.normal_operating_temp != null
        ? uc.toC(fluid.normal_operating_temp, us)
        : 20;
      const relieving_temp_C = fluid.relieving_vapor_temp != null
        ? uc.toC(fluid.relieving_vapor_temp, us)
        : temp_contents_C;

      // Relieving pressure absolute: MAWP × (1 + overpressure%) + atm
      const overpressure_pct = opts.allowable_overpressure_pct ?? 0;
      const mawp_relieving_kpa = mawp_kpa * (1 + overpressure_pct / 100);
      const relieving_P_kpa = uc.gaugeToAbsKpa(mawp_relieving_kpa);

      let env_si = { ...env };
      if (env.insulation && us === 'US') {
        env_si = {
          ...env,
          insulation: {
            ...env.insulation,
            insulation_thickness: env.insulation.thickness * 0.0254,
            insulation_surface_area: env.insulation.surface_area
              ? uc.ft2ToM2(env.insulation.surface_area)
              : undefined,
            thermal_conductivity: env.insulation.thermal_conductivity * 0.1442,
            internal_heat_transfer_coeff: env.insulation.internal_heat_transfer_coeff * 5.678,
          },
        };
      }

      const tank_si = {
        shape:                 tank.shape,
        dims:                  dims_si,
        elevation_above_grade: elev_m,
      };

      // ══════════════════════════════════════════════════════════════════════
      // STEP 2  Thermal Venting
      // ══════════════════════════════════════════════════════════════════════

      const bare_thermal = engine.calcThermalVentingBare(volume_m3, env.latitude_zone);
      const thermal      = engine.applyInsulationFactor(bare_thermal, env_si);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 3  Operational Venting
      // ══════════════════════════════════════════════════════════════════════

      const operational_in = engine.calcOperationalInbreathing(empty_m3hr);
      const { operational_out, vaporisation_component } =
        engine.calcOperationalOutbreathing(fill_m3hr, fluid.is_volatile);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 4  Total Normal Venting
      // ══════════════════════════════════════════════════════════════════════

      const totals = engine.calcTotalNormalVenting(
        thermal.thermal_in,
        operational_in,
        thermal.thermal_out,
        operational_out,
      );

      // ══════════════════════════════════════════════════════════════════════
      // STEP 5  Emergency Venting (Fire Case)
      // ══════════════════════════════════════════════════════════════════════

      let wetted_result     = null;
      let heat_input_result = null;
      let emergency_result  = null;

      if (opts.include_emergency_fire_case !== false) {
        const manualOverrideM2 = opts.manual_wetted_area_override
          ? uc.toM2(opts.manual_wetted_area_override, us)
          : null;

        if (manualOverrideM2) {
          wetted_result = {
            wetted_area_m2:      manualOverrideM2,
            raw_wetted_area_m2:  manualOverrideM2,
            was_capped:          false,
            exceeds_simplified_limit: false,
            method:              'Manual override provided by user',
          };
        } else {
          wetted_result = engine.calcWettedArea(tank_si);
        }

        heat_input_result = engine.calcFireHeatInput(
          env_si,
          wetted_result.wetted_area_m2,
          temp_contents_C,
          opts.credit_for_drainage        ?? false,
          opts.credit_for_fireproofing    ?? false,
        );

        if (latent_J_kg) {
          emergency_result = engine.calcEmergencyOutbreathing(
            heat_input_result.heat_input_W,
            latent_J_kg,
            fluid.molecular_weight,
            relieving_temp_C,
            relieving_P_kpa,
          );
        } else {
          errors.push(
            'Emergency outbreathing requires latent heat of vaporisation and molecular weight. ' +
            'Provide these values to complete the fire-case calculation.'
          );
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // STEP 6  Governing Requirements
      // ══════════════════════════════════════════════════════════════════════

      const governing = engine.calcGoverning(
        totals.total_out,
        emergency_result?.emergency_out_Nm3hr ?? null,
        totals.total_in,
      );

      // ══════════════════════════════════════════════════════════════════════
      // STEP 6.5 Actual Venting Devices (Phase 4)
      // ══════════════════════════════════════════════════════════════════════
      
      let actual_venting_result = null;
      
      if (inputs.devices && inputs.devices.length > 0) {
        // 1. Convert user inputs to SI units (kPa and Nm³/hr)
        // Note: 1 Nm³/hr ≈ 37.32 SCFH
        const flowToSI = (val) => {
          if (val == null) return null;
          return us === 'US' ? val / 37.32 : val;
        };

        const actual_devices_si = inputs.devices.map(d => ({
          ...d,
          set_pressure: d.set_pressure != null ? uc.toKpa(d.set_pressure, us) : null,
          set_vacuum:   d.set_vacuum   != null ? uc.toKpa(d.set_vacuum, us)   : null,
          rated_flow_outbreathing: flowToSI(d.rated_flow_outbreathing),
          rated_flow_inbreathing:  flowToSI(d.rated_flow_inbreathing),
        }));

        // 2. Determine relieving vacuum (typically evaluated at MAWV)
        const relieving_vacuum_kpa = mawv_kpa;

        // 3. Run the engine calculation
        actual_venting_result = engine.calcActualVenting(
          actual_devices_si, 
          relieving_P_kpa, 
          relieving_vacuum_kpa
        );
      }

      // ══════════════════════════════════════════════════════════════════════
      // STEP 7  Warnings
      // ══════════════════════════════════════════════════════════════════════

      const enriched_inputs = {
        ...inputs,
        tank:  { ...tank,  volume_m3, mawp_kpa, mawv_kpa },
        fluid: { ...fluid, latent_heat_J_kg: latent_J_kg, vapor_pressure_kpa: vp_kpa },
        devices: actual_venting_result
          ? actual_venting_result.evaluated_devices
          : (inputs.devices || []),
      };
      const warnings = engine.generateWarnings(enriched_inputs, { wetted: wetted_result });

      // ══════════════════════════════════════════════════════════════════════
      // STEP 8  Convert outputs to user's unit system
      // ══════════════════════════════════════════════════════════════════════

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
            inbreathing:         round(toFlow(thermal.thermal_in), 1),
            outbreathing:        round(toFlow(thermal.thermal_out), 1),
            insulation_factor:   round(thermal.insulation_factor, 4),
            latitude_zone:       env.latitude_zone,
          },
          operational: {
            inbreathing:         round(toFlow(operational_in), 1),
            outbreathing:        round(toFlow(operational_out), 1),
            vaporisation_component: round(toFlow(vaporisation_component), 1),
            is_volatile:         fluid.is_volatile,
          },
          totals: {
            total_inbreathing:   round(toFlow(totals.total_in), 1),
            total_outbreathing:  round(toFlow(totals.total_out), 1),
          },
        },

        emergency_venting: wetted_result ? {
          wetted_area:           round(toArea(wetted_result.wetted_area_m2), 1),
          raw_wetted_area:       round(toArea(wetted_result.raw_wetted_area_m2), 1),
          exceeds_simplified_limit: wetted_result.exceeds_simplified_limit ?? false,
          wetted_area_method:    wetted_result.method,
          heat_input:            heat_input_result ? round(toHeat(heat_input_result.heat_input_W), 0) : null,
          heat_input_method:     heat_input_result?.method ?? null,
          F_factor:              heat_input_result?.F_used != null ? round(heat_input_result.F_used, 4) : null,
          C_constant:            heat_input_result?.C_used ?? null,
          emergency_outbreathing: emergency_result ? round(toFlow(emergency_result.emergency_out_Nm3hr), 1) : null,
          emergency_outbreathing_Sm3hr: emergency_result ? round(emergency_result.emergency_out_Sm3hr, 1) : null,
          vapour_mass_flow:      emergency_result ? round(emergency_result.vapour_mass_flow_kg_hr, 2) : null,
          reference_conditions:  emergency_result?.reference_conditions ?? null,
        } : null,

        governing: {
          governing_outbreathing: round(toFlow(governing.governing_out), 1),
          governing_inbreathing:  round(toFlow(governing.governing_in), 1),
          emergency_governs:      governing.emergency_governs,
        },

        actual_venting: actual_venting_result ? {
          actual_normal_outbreathing: round(toFlow(actual_venting_result.actual_normal_out), 1),
          actual_emergency_outbreathing: round(toFlow(actual_venting_result.actual_emergency_out), 1),
          actual_inbreathing: round(toFlow(actual_venting_result.actual_in), 1),
          adequacy: {
            normal_out: actual_venting_result.actual_normal_out >= totals.total_out,
            emergency_out: actual_venting_result.actual_emergency_out >= governing.governing_out,
            inbreathing: actual_venting_result.actual_in >= governing.governing_in
          },
          devices: actual_venting_result.evaluated_devices.map(d => ({
            id: d.id,
            type: d.type,
            direction: d.direction,
            flow_out: round(toFlow(d.calculated_flow_out), 1),
            flow_in: round(toFlow(d.calculated_flow_in), 1)
          }))
        } : null
      };

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9  Intermediates (SI, for audit trail)
      // ══════════════════════════════════════════════════════════════════════

      const intermediates = {
        volume_m3:                round(volume_m3, 3),
        mawp_kpa:                 round(mawp_kpa, 3),
        mawv_kpa:                 round(mawv_kpa, 3),
        allowable_overpressure_pct: overpressure_pct,
        fill_rate_m3hr:           round(fill_m3hr, 4),
        empty_rate_m3hr:          round(empty_m3hr, 4),
        vapor_pressure_kpa:       round(vp_kpa, 4),
        relieving_pressure_kpa_a: round(relieving_P_kpa, 3),
        relieving_temp_C:         round(relieving_temp_C, 2),
        thermal_in_Nm3hr:         round(thermal.thermal_in, 2),
        thermal_out_Nm3hr:        round(thermal.thermal_out, 2),
        operational_in_Nm3hr:     round(operational_in, 2),
        operational_out_Nm3hr:    round(operational_out, 2),
        total_in_Nm3hr:           round(totals.total_in, 2),
        total_out_Nm3hr:          round(totals.total_out, 2),
        wetted_area_m2:           wetted_result ? round(wetted_result.wetted_area_m2, 2) : null,
        heat_input_W:             heat_input_result ? round(heat_input_result.heat_input_W, 0) : null,
        emergency_out_Nm3hr:      emergency_result ? round(emergency_result.emergency_out_Nm3hr, 2) : null,
        governing_out_Nm3hr:      round(governing.governing_out, 2),
        governing_in_Nm3hr:       round(governing.governing_in, 2),
        actual_normal_out_Nm3hr: actual_venting_result ? round(actual_venting_result.actual_normal_out, 2) : null,
        actual_emergency_out_Nm3hr: actual_venting_result ? round(actual_venting_result.actual_emergency_out, 2) : null,
        actual_in_Nm3hr: actual_venting_result ? round(actual_venting_result.actual_in, 2) : null,
      };

      return {
        outputs,
        intermediates,
        warnings,
        errors,
        engine_version: '1.1.0',
        calculated_at:  new Date().toISOString(),
      };

    } catch (err) {
      errors.push(`Calculation engine error: ${err.message}`);
      return { outputs: null, intermediates: null, warnings: [], errors, engine_version: '1.1.0' };
    }
  }

  // ─── EXPORT ─────────────────────────────────────────────────────────────────
  window.API2000.runCalculation = runCalculation;
})();
