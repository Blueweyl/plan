// Generates tests/fixtures/sample-18.estimate.json: an 18-element, 2-storey
// sample project covering all 12 element types and all 5 ceiling systems.
// The file is produced by the real app (defaultState + normInputs), so its shape
// matches what "Save project file" writes. IDs and dates are fixed for determinism.
// Dimensions are a synthetic test case, not taken from a real drawing.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../tests/lib/engine.mjs';
import {launch, openApp} from '../tests/lib/browser.mjs';

const L1 = 'lvl-ground', L2 = 'lvl-second';
const ELEMENTS = [
  ['F1', 'footing', L1, 9, {L: 1.5, W: 1.5, T: 0.4, dL: 16, sL: 150, dW: 16, sW: 150}],
  ['WF1', 'wallfooting', L1, 1, {L: 30, B: 0.6, T: 0.25}],
  ['C1', 'column', L1, 9, {b: 0.4, h: 0.4, H: 3.0, nM: 8, dM: 16, Lo: 0.5, sLo: 100}],
  ['B1', 'beam', L1, 12, {b: 0.25, h: 0.4, L: 4.0, nTop: 2, nBot: 2}],
  ['ST1', 'stairs', L1, 1, {}],
  ['CHB1', 'chbwall', L1, 1, {L: 30, H: 3, open: '0.9x2.1x2, 1.2x1.2x4', size: '6'}],
  ['P1', 'chbpart', L1, 1, {L: 12, H: 3, open: '0.8x2.1x3'}],
  ['DW1', 'drywall', L1, 1, {L: 6, H: 3, open: '0.8x2.1x1'}],
  ['TC1', 'cubicle', L1, 2, {}],
  ['CL1', 'ceiling', L1, 2, {L: 5, W: 4, sys: 'gyp', board: 'GYP9'}],
  ['CL2', 'ceiling', L1, 1, {L: 6, W: 5, sys: 'acoustic'}],
  ['C2', 'column', L2, 9, {b: 0.3, h: 0.3, H: 3.0, nM: 4, dM: 16, sT: 200}],
  ['B2', 'beam', L2, 10, {L: 5.0, nXT: 2, lXT: 1.5}],
  ['S1', 'slab', L2, 4, {Lx: 4, Ly: 5, t: 0.125}],
  ['W1', 'rcwall', L2, 1, {L: 3, H: 3, t: 0.15, layers: 2}],
  ['CL3', 'ceiling', L2, 2, {L: 2.5, W: 2, sys: 'pvc', fsp: 0.6}],
  ['CL4', 'ceiling', L2, 1, {L: 4, W: 3, sys: 'wood', board: 'PLY6', fsp: 0.6}],
  ['CL5', 'ceiling', L2, 1, {L: 3, W: 3, sys: 'fc', board: 'FC6'}],
];

const browser = await launch();
const app = await openApp(browser);
const json = await app.page.evaluate(({ELEMENTS, L1, L2}) => {
  const st = defaultState();
  st.project = {name: 'Sample Residence – 2 Storey', location: 'Quezon City, Metro Manila', owner: 'Baseline fixture', date: '2026-10-23', notes: 'Synthetic golden-master project. Dimensions are test inputs, not from a real drawing.'};
  st.levels = [{id: L1, name: 'Ground floor', h: 3.0}, {id: L2, name: 'Second floor', h: 3.0}];
  st.elements = ELEMENTS.map(([mark, type, level, qty, inp], i) => ({id: 'el-' + String(i + 1).padStart(2, '0'), type, mark, level, qty, inp: normInputs(type, inp)}));
  return JSON.stringify(st, null, 1);
}, {ELEMENTS, L1, L2});
await app.close(); await browser.close();

const out = path.join(ROOT, 'tests/fixtures/sample-18.estimate.json');
fs.writeFileSync(out, json + '\n');
console.log('Wrote', path.relative(ROOT, out), `(${ELEMENTS.length} elements)`);
