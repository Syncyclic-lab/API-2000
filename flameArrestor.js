// ============================================================
// flameArrestor.js  (browser build)
// Flame-arrestor pressure-drop module (K-factor resistance formula).
// Depends on: constants.js, api2000Engine.js (must be loaded first)
//
// References:
//   - API Std 2000 (7th Ed., March 2014) — vent adequacy framework.
//   - ISO 16852 — flame-arrester performance & ΔP capacity curves.
// ============================================================

'use strict';

(function () {
  const PHYSICAL = window.API2000.PHYSICAL;
  const FA       = window.API2000.FLAME_ARRESTOR;
  const C        = window.API2000.CONVERSIONS;
  const engine   = window.API2000.engine;

  /**
   * Gas density from the ideal-gas law with compressibility factor Zi.
   * ρ = P · M / (Zi · R · T)
   *
   * @param {number} P_kPa_abs  Absolute pressure, kPa
   * @param {number} T_K        Absolute temperature, K
   * @param {number} M          Molecular weight, kg/kmol
   * @param {number} Zi         Compressibility factor (1.0 for ideal gas)
   * @returns {number}          Density, kg/m³
   */
  function gasDensityKgM3(P_kPa_abs, T_K, M, Zi) {
    if (!P_kPa_abs || !T_K || !M) return 0;
    const Zeff = Zi && Zi > 0 ? Zi : 1.0;
    return (P_kPa_abs * 1000 * M) / (Zeff * PHYSICAL.R * T_K);
  }

  /**
   * Convert Nm³/hr (0 °C, 101.325 kPa) to actual volumetric flow at (T, P), m³/s.
   */
  function nm3hrToActualM3s(Q_Nm3hr, T_actual_K, P_actual_kPa_abs) {
    if (!Q_Nm3hr || !T_actual_K || !P_actual_kPa_abs) return 0;
    return Q_Nm3hr
      * (T_actual_K / PHYSICAL.T_NORMAL_K)
      * (PHYSICAL.P_ATM_KPA / P_actual_kPa_abs)
      / PHYSICAL.SECONDS_PER_HOUR;
  }

  /**
   * ΔP across a flame arrestor, K-factor method: ΔP = K · (ρ / 2) · v², v = Q / (π D² / 4).
   */
  function calcFlameArrestorDeltaP(K, diameter_m, Q_actual_m3s, density_kg_m3) {
    if (!K || K <= 0 || !diameter_m || diameter_m <= 0) {
      return { deltaP_Pa: 0, velocity_m_s: 0, area_m2: 0 };
    }
    const area_m2      = Math.PI * diameter_m * diameter_m / 4;
    const velocity_m_s = (Q_actual_m3s && Q_actual_m3s > 0) ? Q_actual_m3s / area_m2 : 0;
    const deltaP_Pa    = K * (density_kg_m3 / 2) * velocity_m_s * velocity_m_s;
    return { deltaP_Pa, velocity_m_s, area_m2 };
  }

  /**
   * ΔP evaluator: density, flow conversion and the K-factor formula in one call.
   *
   * @param {object}  params
   * @param {number}  params.K
   * @param {number}  params.diameter_m
   * @param {number}  params.flow_Nm3hr
   * @param {number}  params.molecular_weight
   * @param {number} [params.compressibility_factor=1.0]
   * @param {number} [params.relieving_temperature_C=20]
   * @param {number} [params.relieving_pressure_kPa_abs=101.325]
   */
  function evaluateFlameArrestor({
    K,
    diameter_m,
    flow_Nm3hr,
    molecular_weight,
    compressibility_factor = 1.0,
    relieving_temperature_C,
    relieving_pressure_kPa_abs,
  }) {
    const T_actual_K   = (relieving_temperature_C ?? 20) + PHYSICAL.C_TO_K;
    const P_kPa_abs    = relieving_pressure_kPa_abs ?? PHYSICAL.P_ATM_KPA;
    const density      = gasDensityKgM3(P_kPa_abs, T_actual_K, molecular_weight, compressibility_factor);
    const Q_actual_m3s = nm3hrToActualM3s(flow_Nm3hr, T_actual_K, P_kPa_abs);
    const core         = calcFlameArrestorDeltaP(K, diameter_m, Q_actual_m3s, density);

    return {
      deltaP_Pa:     core.deltaP_Pa,
      deltaP_kPa:    core.deltaP_Pa / 1000,
      deltaP_mbar:   core.deltaP_Pa * C.PA_TO_MBAR,
      deltaP_inH2O:  core.deltaP_Pa * C.PA_TO_INH2O,
      velocity_m_s:  core.velocity_m_s,
      density_kg_m3: density,
      area_m2:       core.area_m2,
      Q_actual_m3s,
      T_actual_K,
    };
  }

  /**
   * Out-breathing capacity of a device fitted with a flame arrestor, used by
   * engine.calcActualVenting.
   *
   * For PVRV/EPRV the arrestor ΔP lowers the pressure reaching the valve, which
   * lowers the valve flow. valveFlow(P − ΔP(Q)) − Q decreases monotonically in Q,
   * so bisection finds the unique self-consistent flow. Free-vent capacity is
   * not reduced; the ΔP at that flow is reported only.
   *
   * @param {object} dev                      Device in SI (flows Nm³/h, pressures kPa g)
   * @param {number} relievingPressureKpag    Tank allowable pressure, kPa g
   * @param {object} ctx                      { molecular_weight, compressibility_factor,
   *                                            temperature_C, pressure_kPa_abs } of the flowing gas
   * @returns {{ flow_out:number, arrestor:object }}
   */
  function calcArrestedOutflow(dev, relievingPressureKpag, ctx = {}) {
    const fa    = dev.flame_arrestor;
    const rated = dev.rated_flow_outbreathing || 0;
    const evalAt = (flow) => evaluateFlameArrestor({
      K:                          fa.K,
      diameter_m:                 fa.diameter_m,
      flow_Nm3hr:                 flow,
      molecular_weight:           ctx.molecular_weight,
      compressibility_factor:     ctx.compressibility_factor,
      relieving_temperature_C:    ctx.temperature_C,
      relieving_pressure_kPa_abs: ctx.pressure_kPa_abs,
    });

    let flow_out = rated;
    if (dev.type !== 'FREE_VENT') {
      const valveFlow = (q) => engine.calcDeviceFlow(
        dev.set_pressure, rated, dev.rated_overpressure_pct,
        relievingPressureKpag - evalAt(q).deltaP_kPa,
      );
      let lo = 0;
      let hi = valveFlow(0);
      for (let i = 0; i < 60 && hi - lo > 1e-6 * Math.max(hi, 1); i++) {
        const mid = (lo + hi) / 2;
        if (valveFlow(mid) > mid) lo = mid;
        else hi = mid;
      }
      flow_out = lo;
    }

    const atFlow  = evalAt(flow_out);
    const atRated = evalAt(rated);
    const budget_fraction = relievingPressureKpag > 0 ? atRated.deltaP_kPa / relievingPressureKpag : null;
    let badge = 'N/A';
    if (budget_fraction != null) {
      if (budget_fraction >= FA.BUDGET_FAILURE_FRACTION)      badge = 'FAIL';
      else if (budget_fraction >= FA.BUDGET_WARNING_FRACTION) badge = 'WARN';
      else                                                    badge = 'PASS';
    }

    return {
      flow_out,
      arrestor: {
        K:                    fa.K,
        diameter_m:           fa.diameter_m,
        arrestor_class_key:   fa.arrestor_class_key ?? null,
        deltaP_kPa:           atFlow.deltaP_kPa,
        deltaP_mbar:          atFlow.deltaP_mbar,
        deltaP_inH2O:         atFlow.deltaP_inH2O,
        velocity_m_s:         atFlow.velocity_m_s,
        density_kg_m3:        atFlow.density_kg_m3,
        deltaP_at_rated_kPa:  atRated.deltaP_kPa,
        budget_fraction,
        budget_pct:           budget_fraction == null ? null : budget_fraction * 100,
        badge,
        effective_flow_Nm3hr: flow_out,
      },
    };
  }

  /**
   * Flame-arrestor warnings for the devices returned by engine.calcActualVenting.
   * @returns {Array<{severity:string, message:string}>}
   */
  function generateArrestorWarnings(devices) {
    const out = [];
    if (!devices || !devices.some(d => d.arrestor)) return out;

    out.push({
      severity: 'NOTICE',
      message:
        'Flame arrestor ΔP uses a generic K-value with air-equivalent flow. Verify against the ' +
        'manufacturer\'s certified ΔP-vs-Q capacity curve per ISO 16852 for regulatory-grade sizing.',
    });

    devices.forEach((d, i) => {
      const ar = d.arrestor;
      if (!ar) return;
      const label = `Device #${i + 1}`;

      if (ar.budget_fraction != null && ar.budget_fraction >= FA.BUDGET_FAILURE_FRACTION) {
        out.push({
          severity: 'WARNING',
          message:
            `${label}: Flame arrestor ΔP at rated flow (${ar.deltaP_at_rated_kPa.toFixed(2)} kPa) is ` +
            `${ar.budget_pct.toFixed(0)} % of the MAWP. Installed vent capacity is likely inadequate; ` +
            'increase the arrestor size or reduce the required flow.',
        });
      } else if (ar.budget_fraction != null && ar.budget_fraction >= FA.BUDGET_WARNING_FRACTION) {
        out.push({
          severity: 'WARNING',
          message:
            `${label}: Flame arrestor ΔP at rated flow consumes ${ar.budget_pct.toFixed(0)} % of the MAWP. ` +
            'Vent adequacy margin is thin; verify with manufacturer capacity data.',
        });
      }

      if (d.type === 'FREE_VENT') {
        out.push({
          severity: 'NOTICE',
          message:
            `${label}: Open-vent capacity is not reduced for the flame arrestor ΔP ` +
            `(${ar.deltaP_kPa.toFixed(3)} kPa at the vent flow). Verify the combined vent + arrestor capacity.`,
        });
      }

      if (ar.diameter_m > 0 && ar.diameter_m < C.IN_TO_M) {
        out.push({
          severity: 'WARNING',
          message:
            `${label}: Flame arrestor nominal diameter is very small ` +
            `(${(ar.diameter_m * 1000).toFixed(1)} mm / < 1 inch); verify input.`,
        });
      }
    });

    return out;
  }

  Object.assign(engine, {
    gasDensityKgM3,
    nm3hrToActualM3s,
    calcFlameArrestorDeltaP,
    evaluateFlameArrestor,
    calcArrestedOutflow,
    generateArrestorWarnings,
  });
})();
