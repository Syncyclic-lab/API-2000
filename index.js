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
    GENERAL_METHOD: GEN, ANNEX_A, FIRE, MAX_SCOPE_PRESSURE_KPA, CONVERSIONS, SCENARIOS: SC,
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

  // --- Other circumstances (§3.2.5) -------------------------------------------
  // API 2000 provides no calculation methods for these (§3.2.5.1). Each `calc`
  // returns { out, in } in Nm³/h of air-equivalent flow; `x.need` records
  // missing inputs. `replacesThermal` scenarios combine only with liquid
  // movement when marked coincident with normal venting.

  // Unit converter (uc.*) for each scenario input, by field name.
  const SCENARIO_FIELD_UNITS = {
    failed_inflow: 'toM3', failed_outflow: 'toM3', volatile_flow: 'toM3',
    supply_pressure: 'toKpa', rate: 'toKpa',
    diameter: 'smallLengthToM',
    known_flow: 'toNm3hr', vacuum_flow: 'toNm3hr',
    heat_input: 'toW', gas_generation: 'toKgH', density: 'toKgM3',
    gas_temp: 'toC', vapor_temp: 'toC', wall_temp: 'toC',
    exposed_area: 'toM2', htc: 'insulHTCToSI',
  };

  const SCENARIO_DEFS = {
    control_valve_failure: {
      label: 'Control valve failure', ref: '§3.2.5.12',
      // Increase over the normal maximum fill / empty rate.
      calc: (d, x) => {
        x.need(d.failed_inflow != null || d.failed_outflow != null, 'enter the liquid inflow and/or outflow with the valve failed open');
        return {
          out: Math.max(0, (d.failed_inflow ?? 0) - x.fluid.fill_m3hr) * x.fillFactor,
          in:  Math.max(0, (d.failed_outflow ?? 0) - x.fluid.empty_m3hr) * x.emptyFactor,
        };
      },
    },
    blanket_gas_equipment_failure: {
      label: 'Blanket gas equipment failure', ref: '§3.2.5.3',
      // Supply regulator failed open; back-pressure regulator failed open to vapor recovery.
      calc: (d, x) => ({ out: x.gasInflow(d), in: d.vacuum_flow ?? 0 }),
    },
    abnormal_heat_transfer: {
      label: 'Abnormal heat transfer', ref: '§3.2.5.4',
      calc: (d, x) => {
        x.need(d.heat_input > 0, 'enter the uncontrolled heat input');
        return { out: x.vaporFromHeat(d.heat_input), in: 0 };
      },
    },
    internal_heat_exchanger_failure: {
      label: 'Internal heat exchanger failure', ref: '§3.2.5.5',
      // Double-ended rupture of one tube releasing the medium as gas.
      calc: (d, x) => {
        x.need(d.gas_temp != null, 'enter the heating/cooling medium temperature');
        return { out: x.gasInflow(d, { k: d.k ?? SC.STEAM_K, ends: 2 }), in: 0 };
      },
    },
    uninsulated_hot_tank_in_rain: {
      label: 'Uninsulated hot tank in rain', ref: '§3.2.5.14', replacesThermal: true,
      calc: (d, x) => {
        const { tank } = x;
        const area = d.exposed_area ?? engine.calcExposedArea(tank.shape, tank.diameter_m, tank.length_m);
        x.need(area > 0, 'enter the exposed shell and roof area (or the tank dimensions)');
        x.need(d.vapor_temp != null, 'enter the vapor-space temperature');
        if (!(area > 0) || d.vapor_temp == null) return { out: 0, in: 0 };
        const deltaT = d.vapor_temp - (d.wall_temp ?? SC.RAIN_WALL_TEMP_C);
        return {
          out: 0,
          in: engine.calcHotTankInbreathing(area, d.htc ?? GEN.H_INSIDE_DEFAULT, deltaT, d.vapor_temp + PHYSICAL.C_TO_K),
        };
      },
    },
    exothermic_reaction: {
      label: 'Exothermic reaction', ref: '§3.2.5.9',
      calc: (d, x) => {
        x.need(d.heat_input > 0 || d.gas_generation > 0, 'enter the reaction heat release and/or gas generation rate');
        let out = d.heat_input > 0 ? x.vaporFromHeat(d.heat_input) : 0;
        if (d.gas_generation > 0) {
          x.need(d.gas_mw > 0, 'enter the molecular weight of the generated gas');
          if (d.gas_mw > 0) out += engine.airEquivalentFlow(d.gas_generation, d.gas_mw, x.ventTempK);
        }
        return { out, in: 0 };
      },
    },
    mixing_of_products: {
      label: 'Mixing of products', ref: '§3.2.5.16',
      // Vapour flashed from a more-volatile material entering the tank.
      calc: (d, x) => {
        const ok = d.volatile_flow > 0 && d.density > 0 && d.flash_percent > 0 && d.flash_percent <= 100 && d.gas_mw > 0;
        x.need(ok, 'enter the volatile inflow, liquid density, fraction vaporized (0–100 %) and vapor molecular weight');
        if (!ok) return { out: 0, in: 0 };
        const vapourKgH = d.volatile_flow * d.density * d.flash_percent / 100;
        return { out: engine.airEquivalentFlow(vapourKgH, d.gas_mw, x.ventTempK), in: 0 };
      },
    },
    liquid_overfill: {
      label: 'Liquid overfill', ref: '§3.2.5.10',
      // Vents are not overfill protection; this scenario only checks that protection exists.
      calc: () => ({ out: 0, in: 0 }),
    },
    pressure_transfer_vapor_breakthrough: {
      label: 'Pressure transfer / vapor breakthrough', ref: '§3.2.5.2',
      calc: (d, x) => ({ out: x.gasInflow(d), in: 0 }),
    },
    atmospheric_pressure_change: {
      label: 'Atmospheric pressure change', ref: '§3.2.5.11',
      calc: (d, x) => {
        x.need(d.rate > 0, 'enter the barometric pressure change rate');
        const q = d.rate > 0 ? engine.calcBarometricBreathing(x.tank.volume_m3, d.rate, x.ventTempK) : 0;
        return { out: q, in: q };
      },
    },
  };

  function scenariosToSI(scenarios = {}, us) {
    const out = {};
    for (const [key, raw] of Object.entries(scenarios)) {
      if (!raw || !raw.enabled) continue;
      const d = { ...raw };
      for (const [field, fn] of Object.entries(SCENARIO_FIELD_UNITS)) {
        if (d[field] != null) d[field] = uc[fn](d[field], us);
      }
      out[key] = d;
    }
    return out;
  }

  function calcScenarios(s, normal) {
    const errors = [];
    const P_ATM = PHYSICAL.P_ATM_KPA;
    const perUnit = engine.calcLiquidMovement(s.method, 1, 1, normal.is_volatile);
    const ventTempK = (s.fluid.relieving_temp_C ?? s.fluid.operating_temp_C ?? AMBIENT_C) + PHYSICAL.C_TO_K;

    const items = Object.entries(s.scenarios).filter(([key]) => SCENARIO_DEFS[key]).map(([key, d]) => {
      const def = SCENARIO_DEFS[key];
      const need = (ok, message) => { if (!ok) errors.push(`${def.label}: ${message}.`); };

      // Gas entering the vapour space (Nm³/h of gas from a known flow or Annex D
      // nozzle flow into the tank at MAWP), as air-equivalent vent flow.
      const gasInflow = (g, { k = SC.GAS_K, ends = 1 } = {}) => {
        need(g.gas_mw > 0, 'enter the gas molecular weight');
        let gasNm3h = g.known_flow;
        if (gasNm3h == null) {
          need(g.supply_pressure > 0 && g.diameter > 0, 'enter the supply pressure and flow diameter, or a known gas flow');
          gasNm3h = ends * engine.calculateOpenVentCapacity(
            g.diameter, P_ATM + g.supply_pressure, P_ATM + s.tank.mawp_kpag, k,
            (g.gas_temp ?? AMBIENT_C) + PHYSICAL.C_TO_K, g.gas_mw, 1, g.cd ?? SC.DEFAULT_CD);
        }
        return g.gas_mw > 0 ? engine.airEquivalentFlow(gasNm3h * g.gas_mw / PHYSICAL.MOLAR_VOL_NM3, g.gas_mw, ventTempK) : 0;
      };
      // Vapour generated by a heat input Q (W): W = Q / L.
      const vaporFromHeat = (heatW) => {
        const { latent_J_kg: L, molecular_weight: M } = s.fluid;
        need(L > 0 && M > 0, 'enter the fluid latent heat and molecular weight (Fluid section)');
        return L > 0 && M > 0 ? engine.airEquivalentFlow(heatW / L * PHYSICAL.SECONDS_PER_HOUR, M, ventTempK) : 0;
      };

      const load = def.calc(d, {
        need, gasInflow, vaporFromHeat, ventTempK,
        tank: s.tank, fluid: s.fluid, fillFactor: perUnit.liquid_out, emptyFactor: perUnit.liquid_in,
      });
      const base = def.replacesThermal
        ? { out: normal.liquid_out, in: normal.liquid_in }
        : { out: normal.total_out, in: normal.total_in };
      const withNormal = (value, normalPart) => (value > 0 ? value + (d.coincident ? normalPart : 0) : 0);
      return {
        key,
        label:       def.label,
        ref:         def.ref,
        relieved_by: d.relieved_by === 'EMERGENCY' ? 'EMERGENCY' : 'NORMAL',
        coincident:  !!d.coincident,
        out:         load.out,
        in:          load.in,
        total_out:   withNormal(load.out, base.out),
        total_in:    withNormal(load.in, base.in),
        input:       d,
      };
    });
    return { items, errors };
  }

  // Largest single contingency per relief path (§3.3.1, §3.6.1).
  function designBasis(normal, fireCase, items) {
    const largest = (candidates) => candidates.reduce((a, b) => (b.value > a.value ? b : a));
    const scenarioLoads = (filter, field) => items.filter(i => filter(i) && i[field] > 0)
      .map(i => ({ value: i[field], basis: i.label }));

    const normalOut = largest([
      { value: normal.total_out, basis: 'Normal venting' },
      ...scenarioLoads(i => i.relieved_by === 'NORMAL', 'total_out'),
    ]);
    const emergencyCandidates = [
      ...(fireCase ? [{ value: fireCase.emergency_out, basis: 'Fire exposure' }] : []),
      ...scenarioLoads(i => i.relieved_by === 'EMERGENCY', 'total_out'),
    ];
    const emergencyOut = emergencyCandidates.length > 0 ? largest(emergencyCandidates) : null;
    const inbreathing = largest([
      { value: normal.total_in, basis: 'Normal venting' },
      ...scenarioLoads(() => true, 'total_in'),
    ]);
    const governingOut = emergencyOut && emergencyOut.value > normalOut.value ? emergencyOut : normalOut;
    return { normalOut, emergencyOut, inbreathing, governingOut };
  }

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
        basis:                fire.basis === 'HEXANE' ? 'HEXANE' : 'FLUID',
        environmental_factor: fire.environmental_factor || 'BARE',
        custom_factor:        fire.custom_factor ?? null,
        manual_wetted_m2:     c(uc.toM2, fire.manual_wetted_area),
      },
      scenarios: scenariosToSI(p.scenarios, us),
      devices:   p.devices || [],
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
      if (fire.basis === 'FLUID') {
        const missing = [
          !(fluid.latent_J_kg > 0) && 'latent heat of vaporization',
          !(fluid.molecular_weight > 0) && 'molecular weight',
          fluid.relieving_temp_C == null && 'relieving vapor temperature',
        ].filter(Boolean);
        need(missing.length === 0, `Fire case by Eq. (14) needs the ${missing.join(', ')} (Fluid & Process Conditions). ` +
          'Select the hexane basis only for hexane-like fluids.');
      }
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

    // Eq. (14) with the stored fluid's properties, or the hexane basis of Tables 5/7 (§3.3.3.3.3).
    const basis = fire.basis === 'FLUID'
      ? { L: fluid.latent_J_kg, M: fluid.molecular_weight, T_K: fluid.relieving_temp_C + PHYSICAL.C_TO_K }
      : FIRE.HEXANE;
    return {
      ...wetted,
      heat_input_W,
      F,
      basis: fire.basis,
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

  function collectWarnings(s, fireCase, actual, atmDefaultUsed, scenarios) {
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

    // Other circumstances (§3.2.5)
    if (scenarios.length > 0) {
      notice('API 2000 gives no calculation methods for the §3.2.5 circumstances (§3.2.5.1). Their loads are ' +
        'engineering estimates — gas inflow by isentropic nozzle flow (Annex D), vapour by Q/L — expressed as ' +
        'air-equivalent flow (Eq. D.37). Verify them against the actual equipment.');
    }
    for (const item of scenarios) {
      switch (item.key) {
        case 'exothermic_reaction':
          warn('Exothermic reaction: runaway kinetics and two-phase (foaming) relief are not modelled; ' +
            'evaluate with DIERS methods (§3.2.5.9).');
          break;
        case 'internal_heat_exchanger_failure':
          notice('Internal heat exchanger failure: the medium is treated as gas released from a double-ended tube ' +
            'rupture. Condensation in the tank contents (lower load) and flashing of liquid media are not modelled (§3.2.5.5).');
          break;
        case 'uninsulated_hot_tank_in_rain':
          notice('Uninsulated hot tank: condensation of condensable vapours (e.g. steam) is not included and can ' +
            'increase the inbreathing load (§3.2.5.13, §3.2.5.14).');
          break;
        case 'liquid_overfill':
          if (item.input.protection_provided) {
            notice('Liquid overfill: tank vents are not overfill protection (§3.2.5.10); the independent overfill protection indicated is relied on.');
          } else {
            warn('Liquid overfill: tank vents must not be used for overfill protection (§3.2.5.10). ' +
              'Provide overfill protection per API 2350, API 2510 or EN 13616.');
          }
          break;
        case 'atmospheric_pressure_change':
          notice('Atmospheric pressure change is usually insignificant for nonrefrigerated tanks (§3.2.5.11).');
          break;
        default:
          break;
      }
    }

    // Emergency venting
    if (!fire.include) {
      notice('Emergency (fire-case) venting is excluded. This is only appropriate where justified, e.g. a tank ' +
        'with a weak roof-to-shell attachment (§3.3.3.2).');
    } else {
      if (fireCase.basis === 'HEXANE') {
        notice('The hexane basis (Tables 5 and 7, Eq. 16) applies only where the stored fluid is similar to hexane ' +
          '(§3.3.3.3.3). Use Eq. (14) for other fluids.');
        // Compare with Eq. (14) when the fluid's properties are known.
        if (fluid.latent_J_kg > 0 && fluid.molecular_weight > 0) {
          const T_K = (fluid.relieving_temp_C ?? AMBIENT_C) + PHYSICAL.C_TO_K;
          const eq14 = engine.calcEmergencyVenting(fireCase.heat_input_W, fireCase.F, fluid.latent_J_kg, fluid.molecular_weight, T_K).emergency_out;
          const diff = eq14 / fireCase.emergency_out - 1;
          if (Math.abs(diff) > 0.1) {
            warn(`The entered fluid properties give ${Math.round(eq14).toLocaleString('en-US')} Nm³/h by Eq. (14), ` +
              `${Math.abs(diff * 100).toFixed(0)} % ${diff > 0 ? 'more' : 'less'} than the hexane basis. ` +
              'This fluid is not hexane-like; select the Eq. (14) fire venting basis.');
          }
        }
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
      const scenarios = calcScenarios(s, normal);
      if (scenarios.errors.length > 0) return { errors: scenarios.errors, warnings: [] };
      const design = designBasis(normal, fireCase, scenarios.items);

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

      const warnings = collectWarnings(s, fireCase, actual, atmDefaultUsed, scenarios.items);

      // --- Output in display units ---
      const flow = (nm3hr) => round(uc.flowToOutput(nm3hr, us), 1);
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

        scenarios: scenarios.items.map(i => ({
          label:       i.label,
          ref:         i.ref,
          relieved_by: i.relieved_by,
          coincident:  i.coincident,
          out:         flow(i.out),
          in:          flow(i.in),
          total_out:   flow(i.total_out),
          total_in:    flow(i.total_in),
        })),

        // Design requirement for each relief path, with the contingency that sets it.
        design: {
          normal_out:          flow(design.normalOut.value),
          normal_out_basis:    design.normalOut.basis,
          emergency_out:       design.emergencyOut ? flow(design.emergencyOut.value) : null,
          emergency_out_basis: design.emergencyOut ? design.emergencyOut.basis : null,
          inbreathing:         flow(design.inbreathing.value),
          inbreathing_basis:   design.inbreathing.basis,
        },

        governing: {
          outbreathing:       flow(design.governingOut.value),
          outbreathing_basis: design.governingOut.basis,
          inbreathing:        flow(design.inbreathing.value),
          inbreathing_basis:  design.inbreathing.basis,
        },

        actual_venting: actual ? {
          normal_out:    flow(actual.normal_out),
          emergency_out: flow(actual.emergency_out),
          inbreathing:   flow(actual.inbreathing),
          adequacy: {
            normal_out:    actual.normal_out >= design.normalOut.value,
            emergency_out: design.emergencyOut ? actual.emergency_out >= design.emergencyOut.value : null,
            inbreathing:   actual.inbreathing >= design.inbreathing.value,
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
      for (const i of scenarios.items) {
        if (i.out > 0) intermediates.push([`${i.label} — out-breathing load`, round(i.out, 2), 'Nm³/h']);
        if (i.in > 0)  intermediates.push([`${i.label} — inbreathing load`, round(i.in, 2), 'Nm³/h']);
      }

      return { outputs, intermediates, warnings, errors: [] };
    } catch (err) {
      return { errors: [err.message || String(err)], warnings: [] };
    }
  }

  window.API2000.runCalculation = runCalculation;
})();
