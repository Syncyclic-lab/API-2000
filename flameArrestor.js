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

  // Budget fraction → badge. Thresholds: FLAME_ARRESTOR.BUDGET_*_FRACTION.
  function budgetBadge(fraction) {
    if (fraction == null) return 'N/A';
    if (fraction >= FA.BUDGET_FAILURE_FRACTION) return 'FAIL';
    if (fraction >= FA.BUDGET_WARNING_FRACTION) return 'WARN';
    return 'PASS';
  }

  // Worst badge of a device's relief paths (null entries are skipped).
  function worstArrestorBadge(results) {
    const order = ['N/A', 'PASS', 'WARN', 'FAIL'];
    return results.filter(Boolean).map(r => r.badge)
      .reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), 'N/A');
  }

  /**
   * Flow through one relief path (out-breathing or inbreathing) of a device
   * fitted with a flame arrestor, used by engine.calcActualVenting.
   *
   * The arrestor and the device are in series: the arrestor ΔP at flow Q leaves
   * allowable − ΔP(Q) for the device, so the flow is the root of
   * Q = capacity(allowable − ΔP(Q)). capacity is non-decreasing in p and ΔP
   * increases with Q, so capacity(allowable − ΔP(Q)) − Q decreases monotonically
   * and bisection on [0, capacity(allowable)] finds the unique root. Where the
   * arrestor takes the whole allowable (p ≤ 0) the device passes nothing. ΔP,
   * velocity and the pressure budget are reported at the converged flow.
   *
   * The budget is the share of the pressure that drives flow through the device
   * taken by the arrestor: ΔP / allowable for open vents, ΔP / (allowable − set
   * point) for valves, so a valve throttled down to its set point reads 100 %.
   *
   * @param {object} fa     { K, diameter_m }
   * @param {object} path   { capacity(p) → Nm³/h, allowable, opening } from
   *                        engine.reliefPath, pressures in gauge kPa (pressure or vacuum)
   * @param {object} basis  Density basis of the flowing gas: { molecular_weight,
   *                        compressibility_factor, temperature_C, pressure_kPa_abs }
   * @returns {{ flow:number, arrestor:object }}
   */
  function calcArrestedFlow(fa, path, basis = {}) {
    const { capacity, allowable, opening = 0 } = path;
    const evalAt = (flow) => evaluateFlameArrestor({
      K:                          fa.K,
      diameter_m:                 fa.diameter_m,
      flow_Nm3hr:                 flow,
      molecular_weight:           basis.molecular_weight,
      compressibility_factor:     basis.compressibility_factor,
      relieving_temperature_C:    basis.temperature_C,
      relieving_pressure_kPa_abs: basis.pressure_kPa_abs,
    });
    const flowAt = (q) => {
      const available = allowable - evalAt(q).deltaP_kPa;
      return available > 0 ? capacity(available) : 0;
    };

    const unarrested = capacity(allowable) || 0;
    // No pressure drop at all (K or diameter of 0): the unarrested flow stands.
    let lo = evalAt(unarrested).deltaP_kPa > 0 ? 0 : unarrested;
    let hi = unarrested;
    // Relative tolerance on the current bracket; the iteration cap only binds
    // for absurd K (1100 halvings span the whole double range).
    for (let i = 0; i < 1100 && hi - lo > 1e-9 * hi; i++) {
      const mid = (lo + hi) / 2;
      if (flowAt(mid) > mid) lo = mid;
      else hi = mid;
    }
    const flow = lo;

    const at = evalAt(flow);
    const budget_kPa = allowable - opening;
    const budget_fraction = unarrested > 0 && budget_kPa > 0 ? at.deltaP_kPa / budget_kPa : null;
    return {
      flow,
      arrestor: {
        allowable_kPa:   allowable,
        opening_kPa:     opening,
        budget_kPa,
        unarrested_flow: unarrested,
        effective_flow:  flow,
        deltaP_kPa:      at.deltaP_kPa,
        deltaP_mbar:     at.deltaP_mbar,
        deltaP_inH2O:    at.deltaP_inH2O,
        velocity_m_s:    at.velocity_m_s,
        density_kg_m3:   at.density_kg_m3,
        // Density basis actually used (audit trail).
        molecular_weight: basis.molecular_weight,
        temperature_K:    at.T_actual_K,
        pressure_kPa_abs: basis.pressure_kPa_abs ?? PHYSICAL.P_ATM_KPA,
        budget_fraction,
        budget_pct:      budget_fraction == null ? null : budget_fraction * 100,
        badge:           budgetBadge(budget_fraction),
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
        'Installed capacities of devices fitted with a flame arrestor include the arrestor pressure drop ' +
        '(K-factor method, solved for a self-consistent flow). The K-value is generic and the flow is ' +
        'air-equivalent; verify against the manufacturer\'s certified ΔP-vs-Q capacity curve per ISO 16852 ' +
        'for regulatory-grade sizing.',
    });

    devices.forEach((d, i) => {
      const ar = d.arrestor;
      if (!ar) return;
      const label = `Device #${i + 1}`;

      for (const [dir, name] of [['out', 'pressure'], ['in', 'vacuum']]) {
        const r = ar[dir];
        if (!r || r.budget_fraction == null) continue;
        const where = `${label} (${dir === 'out' ? 'out-breathing' : 'inbreathing'})`;
        const share = `${r.budget_pct.toFixed(0)} % of the ` + (r.opening_kPa > 0
          ? `${r.budget_kPa.toFixed(2)} kPa between the set ${name} and the allowable ${name}`
          : `${r.allowable_kPa.toFixed(2)} kPa allowable ${name}`);
        if (r.budget_fraction >= FA.BUDGET_FAILURE_FRACTION) {
          out.push({
            severity: 'WARNING',
            message:
              `${where}: Flame arrestor ΔP at the effective flow (${r.deltaP_kPa.toFixed(2)} kPa) is ${share}. ` +
              'The arrestor throttles the vent; increase the arrestor size or reduce the required flow.',
          });
        } else if (r.budget_fraction >= FA.BUDGET_WARNING_FRACTION) {
          out.push({
            severity: 'WARNING',
            message:
              `${where}: Flame arrestor ΔP at the effective flow consumes ${share}. ` +
              'Vent adequacy margin is thin; verify with manufacturer capacity data.',
          });
        }
      }

      if (d.type === 'FREE_VENT' && d.capacity_source !== 'calculated') {
        out.push({
          severity: 'NOTICE',
          message:
            `${label}: The manufacturer-rated free-vent flow is taken as quoted at the tank's allowable ` +
            'pressure/vacuum and scaled as Q ∝ √p for the pressure left after the flame arrestor ΔP.',
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
    calcArrestedFlow,
    worstArrestorBadge,
    generateArrestorWarnings,
  });
})();
