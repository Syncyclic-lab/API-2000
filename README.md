# API 2000 Venting Calculator

Static, in-browser calculator for venting atmospheric and low-pressure storage tanks per
**API Std 2000, 7th Edition (March 2014)**. Served by GitHub Pages from `main`:
https://syncyclic-lab.github.io/API-2000/

## Calculation basis

| Step | Method |
| --- | --- |
| Normal venting (selectable) | **Annex A**: Table A.3 thermal rates and Table A.1 liquid factors (0.94 / 1.01 / 2.02 Nm³/h per m³/h); volatile if flash point < 37.8 °C. Limited to uninsulated tanks < 30,000 m³ at ≤ 48.9 °C.<br>**§3.3.2 general method**: Eqs. 1–13 — `V_OT = Y·V^0.9·Rᵢ`, `V_IT = C·V^0.7·Rᵢ` (Tables 1–2), filling ×1 or ×2 (vapour pressure ≤ / > 5.0 kPa), emptying ×1, insulation `R_in = 1/(1 + h·l/λ)`, partial and double-wall factors. |
| Wetted area | Table 5 note a: vertical shell within 9.14 m of grade; sphere / horizontal = greater of 55 % / 75 % of total surface and the surface within 9.14 m of grade. Manual override available. |
| Fire heat input | Table 3 (piecewise by wetted area; 4,129,700 W cap for A ≥ 260 m² at ≤ 7 kPa(g)). |
| Environmental factor | Table 9 (bare, insulated from conductance, impoundment, earth-covered, underground, custom). |
| Emergency venting | Selectable basis: **Eq. 14** `q = 906.6·Q·F/L·√(T/M)` with the stored fluid's latent heat, molecular weight and relieving temperature (default), or the **hexane basis** of Tables 5/7 and Eq. 16 for hexane-like fluids (warns if the entered fluid differs from hexane by more than 10 %). The normal-venting method selection does not affect this. |
| Other circumstances (§3.2.5) | API 2000 gives no methods (§3.2.5.1), so these are engineering estimates: control-valve failure (excess liquid flow × Table A.1 / Eq. 1–5 factors), blanket-gas and pressure-transfer gas inflow and heat-exchanger tube rupture (Annex D nozzle flow), abnormal heat / exothermic reaction / mixing (vapour = Q/L or flashed mass), hot tank in rain (Annex A Eq. A.3), barometric change (V·dp/dt / p); all as air-equivalent flow (Eq. D.37). Each can be coincident with normal venting and routed to normal or emergency devices; the largest contingency on each path governs (§3.3.1, §3.6.1). Liquid overfill adds no load (§3.2.5.10). |
| Two-phase venting (optional) | API 2000 gives no method, so this is an engineering estimate for scenarios that generate vapor or gas within the liquid (fire, abnormal heat, exothermic reaction, mixing, heat-exchanger rupture, vapor breakthrough). **Onset:** DIERS drift-flux level swell with uniform vapor generation. Churn-turbulent (C0 = 1.5, U∞ = 1.53·(σgΔρ/ρl²)^¼) or bubbly (C0 = 1.2, coefficient 1.18); two-phase venting starts when the swollen liquid fills the tank. Foamy liquids are always two-phase. **Required flow:** homogeneous-vessel venting W = (volumetric vapor/gas generation) / v̄ (Leung). **Capacity:** omega method (Leung; API Std 520 Part I) at the tank allowable pressure. Calculated vents use Cd·A; air-rated devices are credited with the Cd·A implied by their air rating. |
| Installed devices | Rated capacity at MAWP / MAWV with linear partial lift; open vents from isentropic nozzle flow of air (Annex D). An optional flame arrestor (K-factor ΔP, ISO 16852) sits in both relief paths: each path is solved for the self-consistent flow `Q = capacity(allowable − ΔP(Q))`, with the ΔP evaluated for air at that direction's capacity temperature and upstream pressure. A manufacturer-rated open vent is taken as rated at the tank allowable and scaled as `Q ∝ √p`. |

US units are converted to SI at the input boundary; flows convert at
1 SCF (60 °F) = 0.026793 Nm³ (0 °C), Annex D Eq. (D.2).

## Files

- `constants.js` — tables and constants from the standard
- `unitConverter.js` — US ↔ SI conversion
- `api2000Engine.js` — calculation functions (SI)
- `flameArrestor.js` — flame-arrestor ΔP module
- `twoPhase.js` — two-phase venting check (DIERS level swell, homogeneous vessel, omega method)
- `index.js` — validation, orchestration and warnings (`window.API2000.runCalculation`)
- `app.js`, `index.html` — user interface
- `styles.css` — shared styles for every page (Ecolab brand colours, light/dark themes, print layout, installed fonts only)
- `legal.html`, `privacy.html`, `terms.html`, `accessibility.html` — legal notice, privacy notice, terms of use
  and accessibility statement

CSS, JS and icon links carry a `?v=` version so browsers don't pair a new page with a cached old script
(GitHub Pages caches for 10 minutes). Bump it in every HTML page whenever those files change.

The site loads nothing from third parties and sets no cookies or browser storage, so it needs no consent
banner. Keep it that way, or update `privacy.html` (and add consent) before adding analytics, web fonts or
embeds. The Content-Security-Policy in each page enforces this (`default-src 'none'`, no inline styles or scripts).

## Tests

```bash
npm install
npm test
```

`npm test` runs the Jest suites and then `test/acceptance.js`, a dependency-free script of
plain assertions (flame-arrestor derating, Table 9 range warning and hand-calculated
regression values). It also runs on its own with `node test/acceptance.js`, or in a browser:
serve the folder over HTTP and open `test/acceptance.html`.

Results are for information only and must be verified by a qualified engineer against the standard.
