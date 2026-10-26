// Original inline SVG illustrations for the hatchery. One style throughout: flat pastel
// fills with soft warm-brown outlines. Colours come from CSS classes (see styles.css),
// so light/dark themes and egg stages restyle them without new artwork.

import { raw } from './dom.js';

export function eggArt({ stage = 'warming', variant = 0 } = {}) {
  return raw(`<svg class="egg-svg egg-v${variant} egg-${stage}" viewBox="0 0 80 100" aria-hidden="true" focusable="false">
    <ellipse class="egg-glow" cx="40" cy="62" rx="39" ry="36"/>
    <path class="egg-shell" d="M40 6C59 6 73 37 73 60c0 21-14 34-33 34S7 81 7 60C7 37 21 6 40 6z"/>
    <g class="egg-speckles"><ellipse cx="27" cy="45" rx="3" ry="2"/><ellipse cx="52" cy="38" rx="2" ry="1.5"/><ellipse cx="55" cy="66" rx="3.2" ry="2.2"/><ellipse cx="33" cy="74" rx="2.2" ry="1.6"/><ellipse cx="45" cy="54" rx="1.6" ry="1.2"/></g>
    <path class="egg-shine" d="M22 40c1.5-8 5-15 9-20"/>
    <polyline class="egg-crack" points="12,58 21,51 28,59 36,49 44,59 51,50 58,58 68,52"/>
    <g class="egg-zz"><text x="54" y="20">z</text><text x="63" y="11">z</text></g>
    <g class="egg-alarm"><circle cx="64" cy="18" r="11"/><path d="M64 11v8M64 23.5v.5"/></g>
  </svg>`);
}

export function nestArt() {
  return raw(`<svg class="nest-svg" viewBox="0 0 140 46" aria-hidden="true" focusable="false">
    <ellipse class="nest-shadow" cx="70" cy="40" rx="62" ry="6"/>
    <path class="nest-base" d="M8 16c4 18 30 26 62 26s58-8 62-26c-14 6-38 9-62 9S22 22 8 16z"/>
    <path class="nest-rim" d="M6 15c10-6 34-9 64-9s54 3 64 9c-2 6-30 11-64 11S8 21 6 15z"/>
    <g class="nest-straw"><path d="M16 18l18-6M40 22l22-9M66 23l20-10M92 22l20-8M24 28l16 4M58 31l18 2M96 29l16-3M112 20l14 2"/></g>
  </svg>`);
}

export function chickArt() {
  return raw(`<svg class="chick-svg" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
    <ellipse class="chick-body" cx="40" cy="40" rx="20" ry="19"/>
    <path class="chick-tuft" d="M37 22c-1-5 2-8 4-6 0-4 5-4 4 1"/>
    <circle class="ink-fill" cx="34" cy="37" r="2.4"/><circle class="ink-fill" cx="47" cy="37" r="2.4"/>
    <path class="chick-beak" d="M37 43l4 4 4-4z"/>
    <ellipse class="cheek" cx="30" cy="44" rx="3" ry="2"/><ellipse class="cheek" cx="51" cy="44" rx="3" ry="2"/>
    <path class="shell-half" d="M14 50c0 16 12 26 26 26s26-10 26-26l-6 5-6-6-7 6-7-6-7 6-7-6-6 6z"/>
  </svg>`);
}

export function henArt() {
  return raw(`<svg class="hen-svg" viewBox="0 0 150 140" aria-hidden="true" focusable="false">
    <ellipse class="ground-shadow" cx="76" cy="130" rx="46" ry="6"/>
    <g class="hen-legs"><path d="M64 112v14m-6 0h12M88 112v14m-6 0h12"/></g>
    <g class="hen-bob">
      <path class="hen-tail" d="M30 70C14 60 14 38 26 30c3 14 10 22 20 26z"/>
      <path class="hen-body" d="M30 74c0-26 20-42 46-40 4-14 20-22 34-12 14 10 12 30 4 40 0 30-20 52-46 52-22 0-38-16-38-40z"/>
      <path class="hen-comb" d="M96 24c-3-9 4-14 8-7 1-9 11-8 10 0 7-3 11 5 5 10z"/>
      <path class="hen-beak" d="M122 40l15 6-15 6z"/>
      <path class="hen-wattle" d="M118 53c6 3 5 12-1 11-3-3-2-7 1-11z"/>
      <g class="hen-eye"><circle class="ink-fill" cx="108" cy="38" r="4.2"/><circle class="eye-shine" cx="109.6" cy="36.4" r="1.4"/></g>
      <ellipse class="cheek" cx="104" cy="51" rx="6" ry="3.6"/>
      <path class="hen-wing" d="M48 78c6-16 30-18 40-4-4 18-24 24-38 16z"/>
      <path class="hen-wing-line" d="M56 82c6-4 14-5 22-3M58 88c6-2 12-2 18 0"/>
    </g>
    <g class="hen-alert"><path d="M126 6l-2 16"/><circle cx="123.4" cy="28" r="1.8"/></g>
    <g class="hen-heart"><path d="M128 14c0-5 7-6 8-1 1-5 8-4 8 1 0 5-8 9-8 9s-8-4-8-9z"/></g>
  </svg>`);
}

export function flowerArt(kind = 0) {
  return raw(`<svg class="flower-svg flower-${kind}" viewBox="0 0 24 36" aria-hidden="true" focusable="false">
    <path class="flower-stem" d="M12 16v20M12 28c-4-1-6-4-6-7 3 0 5 2 6 5"/>
    <g class="flower-petals"><circle cx="12" cy="6" r="4"/><circle cx="18" cy="11" r="4"/><circle cx="6" cy="11" r="4"/><circle cx="9" cy="17" r="4"/><circle cx="15" cy="17" r="4"/></g>
    <circle class="flower-center" cx="12" cy="12" r="3"/>
  </svg>`);
}

export function hillsArt() {
  return raw(`<svg class="hills-svg" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path class="hill-back" d="M0 90C140 40 300 40 420 70s260 40 420 0 300-50 360-20V160H0z"/>
    <path class="hill-front" d="M0 120c180-40 360-30 520 0s340 30 480-10 160-20 200-10V160H0z"/>
  </svg>`);
}
