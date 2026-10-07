// ============================================================
// twoPhase.js  (browser build)
// Two-phase (vapor–liquid) venting estimates. API Std 2000 gives no
// two-phase method (§3.2.5.9 points to DIERS), so these are engineering
// estimates built on:
//   - DIERS drift-flux level swell (churn-turbulent / bubbly) to decide
//     whether two-phase venting starts (CCPS, Guidelines for Pressure
//     Relief and Effluent Handling Systems; Fisher et al., DIERS 1992);
//   - the homogeneous-vessel venting rate (Leung), conservative once
//     two-phase venting starts;
//   - the omega method for two-phase vent capacity (Leung 1986;
//     API Std 520 Part I, two-phase sizing annex).
// All inputs and outputs are SI. Depends on: constants.js, api2000Engine.js
// ============================================================

'use strict';

(function () {
  const { PHYSICAL, TWO_PHASE: TP } = window.API2000;
  const engine = window.API2000.engine;

  // Ideal-gas specific volume, m³/kg (P in Pa).
  const gasSpecificVolume = (P_Pa, T_K, M) => PHYSICAL.R * T_K / (P_Pa * M);

  // Bisection for the root of a function that changes sign on [lo, hi].
  function bisect(f, lo, hi, iterations = 200) {
    let flo = f(lo);
    for (let i = 0; i < iterations; i++) {
      const mid = (lo + hi) / 2;
      const fmid = f(mid);
      if ((fmid > 0) === (flo > 0)) { lo = mid; flo = fmid; } else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // --- Omega method -------------------------------------------------------

  // ω = x0·v_v0 / (k·v0) + (Cp·T0·P0 / v0)·(v_vl0 / h_vl0)². The second
  // (flashing) term applies when the stored liquid vaporizes on expansion.
  function omegaParameter({ x0, v_v0, v0, k = 1, flashing, Cp, T0_K, P0_Pa, v_vl0, h_vl0 }) {
    let omega = x0 * v_v0 / (k * v0);
    if (flashing) omega += (Cp * T0_K * P0_Pa / v0) * Math.pow(v_vl0 / h_vl0, 2);
    return omega;
  }

  // Critical pressure ratio η_c for a saturated two-phase inlet:
  // η² + (ω² − 2ω)(1 − η)² + 2ω²·ln η + 2ω²(1 − η) = 0  (η = e^−½ for ω = 1).
  function omegaCriticalRatio(omega) {
    const f = (eta) => eta * eta + (omega * omega - 2 * omega) * Math.pow(1 - eta, 2)
      + 2 * omega * omega * Math.log(eta) + 2 * omega * omega * (1 - eta);
    return bisect(f, 1e-9, 1 - 1e-12);
  }

  // Two-phase mass flux G (kg/(m²·s)) per unit discharge area at inlet
  // pressure P0 and back pressure Pa (Pa), inlet specific volume v0.
  function omegaMassFlux(omega, P0_Pa, Pa_Pa, v0) {
    const eta_c = omegaCriticalRatio(omega);
    const eta_a = Pa_Pa / P0_Pa;
    if (!(eta_a < 1)) return { G: 0, eta_c, eta_a, choked: false };
    if (eta_a <= eta_c) {
      return { G: eta_c * Math.sqrt(P0_Pa / (v0 * omega)), eta_c, eta_a, choked: true };
    }
    const G = Math.sqrt(-2 * (omega * Math.log(eta_a) + (omega - 1) * (1 - eta_a)))
      * Math.sqrt(P0_Pa / v0) / (omega * (1 / eta_a - 1) + 1);
    return { G, eta_c, eta_a, choked: false };
  }

  // --- DIERS level swell (drift flux) -------------------------------------

  // Bubble rise velocity U∞ = coeff · (σ·g·(ρl − ρv) / ρl²)^¼.
  function bubbleRiseVelocity(regime, sigma, rhoL, rhoV) {
    const coeff = regime === 'BUBBLY' ? TP.BUBBLY.U_COEFF : TP.CHURN.U_COEFF;
    return coeff * Math.pow(sigma * TP.G * (rhoL - rhoV) / (rhoL * rhoL), 0.25);
  }

  // Vessel-average void fraction for a dimensionless superficial vapor
  // velocity ψ = j∞ / U∞ with uniform vapor generation.
  //   churn-turbulent: ψ = 2α / (1 − C0·α)
  //   bubbly:          ψ = α(1 − α)² / ((1 − α³)(1 − C0·α))
  function averageVoidFraction(regime, psi) {
    if (!(psi > 0)) return 0;
    if (regime === 'BUBBLY') {
      const C0 = TP.BUBBLY.C0;
      const f = (a) => a * Math.pow(1 - a, 2) / ((1 - a ** 3) * (1 - C0 * a)) - psi;
      return bisect(f, 0, Math.min(1, 1 / C0) - 1e-9);
    }
    const C0 = TP.CHURN.C0;
    return psi / (2 + C0 * psi);
  }

  // Liquid surface area (m²) at a liquid volume fraction φ of the tank.
  function liquidSurfaceArea(shape, diameterM, lengthM, fillFraction) {
    const R = diameterM / 2;
    switch (shape) {
      case 'VERTICAL_CYLINDER':
        return Math.PI * R * R;
      case 'HORIZONTAL_CYLINDER': {
        const segment = (h) => R * R * Math.acos((R - h) / R) - (R - h) * Math.sqrt(2 * R * h - h * h);
        const h = bisect((x) => segment(x) - fillFraction * Math.PI * R * R, 0, 2 * R);
        return 2 * Math.sqrt(Math.max(2 * R * h - h * h, 0)) * lengthM;
      }
      case 'SPHERE': {
        const cap = (h) => Math.PI * h * h * (3 * R - h) / 3;
        const h = bisect((x) => cap(x) - fillFraction * 4 / 3 * Math.PI * R ** 3, 0, 2 * R);
        return Math.PI * Math.max(2 * R * h - h * h, 0);
      }
      default:
        return NaN;
    }
  }

  // --- Vent discharge area -------------------------------------------------

  // Effective discharge area × coefficient (m²) of an air-rated device,
  // backed out of its rated air flow at the rating pressure: (Cd·A) =
  // rated mass flow / ideal-nozzle air mass flux at that pressure.
  function effectiveAreaFromAirRating(ratedNm3h, ratingPressureKpag) {
    if (!(ratedNm3h > 0 && ratingPressureKpag > 0)) return 0;
    const unitAreaD = Math.sqrt(4 / Math.PI);   // diameter of a 1 m² nozzle
    const AIR = window.API2000.AIR_PROPERTIES;
    const nm3hPerM2 = engine.calculateOpenVentCapacity(
      unitAreaD, PHYSICAL.P_ATM_KPA + ratingPressureKpag, PHYSICAL.P_ATM_KPA,
      AIR.k, TP.AIR_RATING_TEMP_K, AIR.M, AIR.Zi, 1);
    return nm3hPerM2 > 0 ? ratedNm3h / nm3hPerM2 : 0;
  }

  // --- Scenario evaluation -------------------------------------------------

  /**
   * Two-phase check for one scenario.
   * @param {object} p
   *   sources: [{ kind: 'vapor'|'gas', kgS, M }] generated within the liquid
   *   regime: 'HOMOGENEOUS' | 'CHURN' | 'BUBBLY'
   *   fillFraction, rhoL, Cp, sigma (N/m), latent (J/kg), fluidM
   *   T0_K, P0_kPa (relieving, abs), Pa_kPa (back pressure, abs)
   *   tank: { volume_m3, shape, diameter_m, length_m }
   *   ventArea: installed Cd·A on this relief path (m²), or null
   */
  function evaluateTwoPhase(p) {
    const P0 = p.P0_kPa * 1000;
    const Pa = p.Pa_kPa * 1000;
    const vL = 1 / p.rhoL;
    const vFluid = gasSpecificVolume(P0, p.T0_K, p.fluidM);

    // Net volumetric vapor/gas generation at relieving conditions (m³/s).
    const flashing = p.sources.some(s => s.kind === 'vapor');
    const massGen = p.sources.reduce((a, s) => a + s.kgS, 0);
    const volGen = p.sources.reduce((a, s) =>
      a + s.kgS * (gasSpecificVolume(P0, p.T0_K, s.M) - (s.kind === 'vapor' ? vL : 0)), 0);
    const gasM = massGen > 0 ? massGen / p.sources.reduce((a, s) => a + s.kgS / s.M, 0) : p.fluidM;
    const vV = gasSpecificVolume(P0, p.T0_K, gasM);
    const rhoV = 1 / vV;

    // Level swell: does the swollen liquid reach the vent?
    const area = liquidSurfaceArea(p.tank.shape, p.tank.diameter_m, p.tank.length_m, p.fillFraction);
    const j = volGen / area;
    let U = null;
    let psi = null;
    let alpha = null;
    const alphaToVent = 1 - p.fillFraction;
    let twoPhase;
    if (p.regime === 'HOMOGENEOUS') {
      twoPhase = volGen > 0;
    } else {
      U = bubbleRiseVelocity(p.regime, p.sigma, p.rhoL, rhoV);
      psi = j / U;
      alpha = averageVoidFraction(p.regime, psi);
      twoPhase = volGen > 0 && alpha >= alphaToVent;
    }

    const result = {
      twoPhase, regime: p.regime, volGen_m3s: volGen, massGen_kgS: massGen,
      surfaceArea_m2: area, j_ms: j, U_ms: U, psi, alpha, alphaToVent,
      swollenFraction: alpha == null ? null : p.fillFraction / (1 - alpha),
    };
    if (!twoPhase) return result;

    // Homogeneous vessel: the vented mixture has the vessel-average state.
    const mass = p.tank.volume_m3 * (p.fillFraction * p.rhoL + (1 - p.fillFraction) / vFluid);
    const vAvg = p.tank.volume_m3 / mass;
    const W = volGen / vAvg;                                   // kg/s
    const x0 = Math.max((vAvg - vL) / (vV - vL), 0);
    const omega = omegaParameter({
      x0, v_v0: vV, v0: vAvg, k: 1, flashing,
      Cp: p.Cp, T0_K: p.T0_K, P0_Pa: P0, v_vl0: vFluid - vL, h_vl0: p.latent,
    });
    const flux = omegaMassFlux(omega, P0, Pa, vAvg);
    const requiredArea = flux.G > 0 ? W / flux.G : Infinity;
    const capacity = p.ventArea == null ? null : p.ventArea * flux.G;
    return {
      ...result,
      vAvg, x0, omega, ...flux,
      required_kgS: W,
      requiredArea_m2: requiredArea,
      ventArea_m2: p.ventArea,
      capacity_kgS: capacity,
      adequate: capacity == null ? null : capacity >= W,
    };
  }

  Object.assign(engine, {
    gasSpecificVolume,
    omegaParameter,
    omegaCriticalRatio,
    omegaMassFlux,
    bubbleRiseVelocity,
    averageVoidFraction,
    liquidSurfaceArea,
    effectiveAreaFromAirRating,
    evaluateTwoPhase,
  });
})();
