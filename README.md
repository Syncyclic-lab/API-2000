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
| Emergency venting | Eq. 14 `q = 906.6·Q·F/L·√(T/M)`; without fluid data uses the hexane basis of Tables 5/7 and Eq. 16. |
| Other circumstances (§3.2.5) | API 2000 gives no methods (§3.2.5.1), so these are engineering estimates: control-valve failure (excess liquid flow × Table A.1 / Eq. 1–5 factors), blanket-gas and pressure-transfer gas inflow and heat-exchanger tube rupture (Annex D nozzle flow), abnormal heat / exothermic reaction / mixing (vapour = Q/L or flashed mass), hot tank in rain (Annex A Eq. A.3), barometric change (V·dp/dt / p); all as air-equivalent flow (Eq. D.37). Each can be coincident with normal venting and routed to normal or emergency devices; the largest contingency on each path governs (§3.3.1, §3.6.1). Liquid overfill adds no load (§3.2.5.10). |
| Installed devices | Rated capacity at MAWP / MAWV with linear partial lift; open vents from isentropic nozzle flow of air (Annex D); optional flame-arrestor ΔP (K-factor, ISO 16852) solved for a self-consistent valve flow. |

US units are converted to SI at the input boundary; flows convert at
1 SCF (60 °F) = 0.026793 Nm³ (0 °C), Annex D Eq. (D.2).

## Files

- `constants.js` — tables and constants from the standard
- `unitConverter.js` — US ↔ SI conversion
- `api2000Engine.js` — calculation functions (SI)
- `flameArrestor.js` — flame-arrestor ΔP module
- `index.js` — validation, orchestration and warnings (`window.API2000.runCalculation`)
- `app.js`, `index.html` — user interface

## Tests

```bash
npm install
npm test
```

Results are for information only and must be verified by a qualified engineer against the standard.
