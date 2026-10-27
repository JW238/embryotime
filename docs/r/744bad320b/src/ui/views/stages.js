// HH stage reference: browse with a wheel, plus the full table (accessible alternative).

import { html, mount } from '../dom.js';
import { attachWheels, getWheelValue, stageReference, stageWheel } from '../wheel.js';
import { HH_REFERENCE, HH_STAGES, formatReferenceAge } from '../../hh-stages.js';

let lastStage = 10;

export function renderStages(container) {
  const root = mount(
    container,
    html`<div class="page-head">
      <div>
        <h1>HH stage reference</h1>
        <p class="subtitle">Hamburger–Hamilton stages with their listed reference ages and identifying features.</p>
      </div>
    </div>
    <section class="card stage-browser">
      <div class="stage-browser-wheel">
        <div class="label" id="stage-wheel-label">Browse stages</div>
        ${stageWheel({ id: 'stage-browse', value: lastStage, describedBy: 'stage-wheel-label' })}
      </div>
      <div class="stage-browser-ref" id="stage-browse-ref" aria-live="polite">${stageReference(lastStage)}</div>
    </section>
    <p class="hint source">Source: ${HH_REFERENCE.citation}. <a href="${HH_REFERENCE.url}" target="_blank" rel="noopener noreferrer">Reference table</a>.
      Reference ages are approximate and individual embryos vary. EmbryoTime's estimates use only these listed ages; observed stages are recorded separately.</p>
    <details class="card stage-table-wrap">
      <summary><h2>Full reference table</h2></summary>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Stage</th><th scope="col">Reference age</th><th scope="col">Identifying features</th></tr></thead>
        <tbody>${HH_STAGES.map(
          (s) => html`<tr><td data-label="Stage"><strong>HH${s.stage}</strong></td><td data-label="Age">${formatReferenceAge(s)}</td><td data-label="Features">${s.features}</td></tr>`
        )}</tbody>
      </table></div>
    </details>`
  );
  attachWheels(root);
  const w = root.querySelector('#stage-browse');
  w.addEventListener('wheelchange', () => {
    lastStage = getWheelValue(w);
    root.querySelector('#stage-browse-ref').innerHTML = String(stageReference(lastStage));
  });
  return null;
}
