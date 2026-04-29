const { expect } = require('chai');
const { JSDOM } = require('jsdom');
const fs = require('fs');

const constantsCode = fs.readFileSync('./constants.js', 'utf-8');
const engineCode = fs.readFileSync('./api2000Engine.js', 'utf-8');

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
global.window = dom.window;

// Simulate browser environment
global.window.eval(constantsCode);
global.window.eval(engineCode);

const engine = global.window.API2000.engine;

describe('API 2000 Engine Tests', () => {
    describe('Thermal Breathing', () => {
        it('should correctly implement the V^0.7 relationship for tank volume limits', () => {
            // Check logic of logLogInterp effectively yielding a V^0.7 curve for large tanks.
            const V1 = 200000;
            const V2 = 300000;
            const in1 = engine.tableInterp(global.window.API2000.TABLE1_SI, V1, 1);
            const in2 = engine.tableInterp(global.window.API2000.TABLE1_SI, V2, 1);

            // Expected ratio according to V^0.7 is (V2/V1)^0.7
            const expectedRatio = Math.pow(V2/V1, 0.7);
            const actualRatio = in2 / in1;
            // The logic table logLogInterp between largest two entries ensures exponent is constant
            // Let's assert they match
            expect(actualRatio).to.be.closeTo(expectedRatio, 0.05);
        });

        it('should apply appropriate environmental insulation factors', () => {
            const environmentInsulated = {
                insulation_type: 'FULLY_INSULATED',
                insulation: {
                    thermal_conductivity: 0.04,
                    insulation_thickness: 0.05,
                    internal_heat_transfer_coeff: 100
                }
            };
            const bareRates = { thermal_in: 100, thermal_out: 100 };

            const resultInsulated = engine.applyInsulationFactor(bareRates, environmentInsulated);
            expect(resultInsulated.insulation_factor).to.be.lessThan(1.0);
            expect(resultInsulated.thermal_in).to.be.lessThan(bareRates.thermal_in);

            const environmentBare = { insulation_type: 'UNINSULATED' };
            const resultBare = engine.applyInsulationFactor(bareRates, environmentBare);
            expect(resultBare.insulation_factor).to.equal(1.0);
            expect(resultBare.thermal_in).to.equal(bareRates.thermal_in);
        });
    });

    describe('Liquid Movement', () => {
        it('Pump-in and pump-out flow rate calculations correctly branch based on fluid volatility', () => {
             // In the new architecture, the index.js / app.js passes the is_volatile boolean to calcOperationalOutbreathing
             // Volatile flag is computed using flash point < 38C in app.js
             // Here we test the engine functions themselves handling the is_volatile branching
             const isVol1 = false;
             const isVol2 = true;

             const resultNonVolatile = engine.calcOperationalOutbreathing(100, isVol1);
             expect(resultNonVolatile.operational_out).to.equal(100 * global.window.API2000.OPERATIONAL.NON_VOLATILE_OUTBREATHING_FACTOR);

             const resultVolatile = engine.calcOperationalOutbreathing(100, isVol2);
             expect(resultVolatile.operational_out).to.equal(100 * global.window.API2000.OPERATIONAL.VOLATILE_OUTBREATHING_FACTOR);
        });
    });

    describe('Emergency Venting', () => {
        it('Vapor generation for hexane or unknown fluids correctly evaluates the formula q = 906.6 * (Q * F / L) * (T / M)^0.5', () => {
            const Q_W = 100000; // W
            const L = 330000; // J/kg
            const M = 86.18; // Hexane
            const T_C = 20; // C
            const T_K = T_C + 273.15;
            const P = 101.325; // kPa

            // Q_W implicitly contains F inside of the engine function call because F is applied when calculating heatInputW.
            const result = engine.calcEmergencyOutbreathing(Q_W, L, M, T_C, P);
            // Expected q_a = 906.6 * (Q_W / L) * sqrt(T_K / M)
            const expectedNm3hr = 906.6 * (Q_W / L) * Math.sqrt(T_K / M);

            expect(result.emergency_out_Nm3hr).to.be.closeTo(expectedNm3hr, 0.1);
        });
    });
});
