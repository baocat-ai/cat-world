// The cat's 3D world: an open little island the cat lives on and walks around.
//
// Everything it shows comes from ONE file, ../api/v1/world.json (the cat's public "world" news,
// schema_version 1 or 2), or its twin ../api/v1/world.js ("window.CAT_WORLD = {...};") which also
// works when the page is opened straight from the disk. No cat data lives in this file. Text from
// the JSON is only shown with textContent or drawn on a canvas.
//
// The shapes come from two models made in Blender (tools/blender_models/): models/bao.glb (the cat,
// rigged, with its walk / idle / sit / nap / eat / paint / stretch / happy clips) and
// models/world_kit.glb (the island with its paths, the buildings and the props). Both are fetched
// from this folder only, with fixed names. If one is missing (or the page was opened from the disk,
// where fetch is not allowed) simple shapes made right here stand in for it, so the world always
// works.
//
// The only thing the page remembers (for this tab only) is where it last saw the cat, so the cat
// can walk over when its place has changed since the last visit.
//
// three.js (+ its glTF loader) comes from vendor/three-bundle.min.js, which sets the global
// THREEBUNDLE. Everything here is inside one function so none of our names clash with it.
(function () {
'use strict';
let THREE = null;
const SCHEMAS = [1, 2];
const PLACES = ['room', 'gallery', 'outside'];
const PLACE_STAGES = ['idea', 'planned', 'building', 'done'];
const WALLS = ['north', 'south', 'east', 'west', 'outside'];
const ID_RE = /^[a-z][a-z0-9_-]{0,40}$/;
const PARTS = ['dawn', 'day', 'dusk', 'night'];
const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'wind', 'hot', 'cold'];
const STAGES = ['seed', 'sprout', 'grown', 'flower'];
const LOOK_PARTS = ['body', 'belly', 'outline', 'ears', 'eyes', 'tail_tip'];
const IMAGE_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_.-]*)*\.(png|svg)$/i;

const $ = (id) => document.getElementById(id);
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let calm = motionQuery.matches;

// ---------------------------------------------------------------- data ----
const str = (v, max = 80) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#9a9a9a');

const words = (id) => id.replace(/^[a-z]+:/, '').replace(/[_-]+/g, ' ').trim();
const imagePath = (v) => {
  const image = str(v, 120);
  return IMAGE_RE.test(image) && !image.includes('..') ? '../' + image : null;
};

function cleanPlaces(raw) {
  const out = [], seen = new Set();
  for (const p of arr(raw, 16).map(obj)) {
    const id = str(p.id, 40).toLowerCase();
    if (!ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const stage = pick(p.stage, PLACE_STAGES, 'done');
    out.push({
      id, kind: str(p.kind, 30).toLowerCase() || 'place', name: str(p.name, 40) || words(id),
      stage, progress: num(p.progress, 0, 1, stage === 'done' ? 1 : 0), home: PLACES.includes(id),
    });
  }
  for (const id of PLACES) if (!seen.has(id)) out.push({ id, kind: id, name: id, stage: 'done', progress: 1, home: true });
  return out;
}

function clean(raw) {
  raw = obj(raw);
  const cat = obj(raw.cat);
  const look = obj(cat.look);
  const time = obj(raw.time);
  const weather = obj(raw.weather);
  const clock = obj(raw.clock);
  const lookOut = {};
  for (const part of LOOK_PARTS) lookOut[part] = hex(look[part]);
  const places = cleanPlaces(raw.places);
  const placeIds = places.map((p) => p.id);
  const known = (id) => placeIds.includes(id);
  const muralSeen = new Set();
  return {
    schema: raw.schema_version,
    cat: {
      name: str(cat.name, 40) || 'The cat',
      look: lookOut,
      mood: str(cat.mood, 40),
      energy: num(cat.energy, 0, 1, 0.5),
      moodValue: num(cat.mood_value, -1, 1, 0),
      doing: str(cat.doing, 80),
      place: known(cat.place) ? cat.place : 'room',
      asleep: cat.asleep === true,
      wearing: arr(cat.wearing, 4).map((w) => str(w, 40).toLowerCase()).filter(Boolean),
      spot: str(cat.activity_spot, 40).toLowerCase() || null,
    },
    time: {
      part: pick(time.part_of_day, PARTS, 'day'),
      season: str(time.season, 30),
      holiday: str(time.holiday, 50) || null,
      birthday: time.birthday_today === true,
    },
    clock: {
      day: typeof clock.cat_day === 'number' && Number.isFinite(clock.cat_day) ? Math.max(0, Math.floor(clock.cat_day)) : null,
      hour: typeof clock.cat_hour === 'number' && Number.isFinite(clock.cat_hour) ? Math.floor(num(clock.cat_hour, 0, 23, 0)) : null,
    },
    weather: {
      kind: pick(weather.kind, WEATHERS, 'clear'),
      temp: typeof weather.temp_c === 'number' && Number.isFinite(weather.temp_c) ? Math.round(weather.temp_c) : null,
    },
    decorations: arr(raw.decorations, 12).map((d) => str(d, 30).toLowerCase()).filter(Boolean),
    items: arr(obj(raw.room).items, 24).map(obj).map((it) => ({
      id: str(it.id, 40).toLowerCase(), kind: str(it.kind, 40).toLowerCase(), label: str(it.label, 60),
    })),
    hung: arr(obj(raw.gallery).hung, 12).map(obj).map((h) => ({
      title: str(h.title, 60) || 'Untitled', note: str(h.note, 140), image: imagePath(h.image),
    })),
    garden: arr(obj(raw.outside).garden, 12).map(obj).map((g) => ({
      plant: str(g.plant, 30) || 'plant', stage: pick(g.stage, STAGES, 'grown'),
    })),
    places,
    // One painting per wall (the newest wins, like paint).
    murals: arr(raw.murals, 24).map(obj).map((m) => ({ place: str(m.place, 40), wall: pick(m.wall, WALLS, 'north'), image: imagePath(m.image) }))
      .filter((m) => known(m.place)).reverse().filter((m) => !muralSeen.has(m.place + m.wall) && muralSeen.add(m.place + m.wall)).reverse(),
    spots: arr(raw.spots, 8).map(obj).map((sp) => ({ place: str(sp.place, 40), name: str(sp.name, 40) }))
      .filter((sp) => sp.name && known(sp.place)),
    // Wishes that came true with a model made for them: only models/wishes/<slug>.glb (wishModelUrl).
    wishItems: arr(raw.wish_items, 12).map(obj).map((w) => ({
      thing: str(w.thing, 60), model: str(w.model, 60), place: str(w.place, 40).toLowerCase() || 'island',
      near: str(w.near, 40).toLowerCase(), scale: num(w.scale, 0.2, 3, 1),
    })).filter((w) => w.thing && wishModelUrl(w.model)),
  };
}

// ---------------------------------------------------------------- page ----
function setList(id, lines) {
  const list = $(id);
  list.replaceChildren();
  for (const line of lines.length ? lines : ['Nothing yet.']) {
    const li = document.createElement('li');
    li.textContent = line;
    list.append(li);
  }
}

const PLACE_WORDS = { room: 'in its room', gallery: 'in its gallery', outside: 'outside in the garden' };
const STAGE_WORDS = { idea: 'just an idea so far', planned: 'planned, gathering things for it', done: 'built!' };
const placeOf = (d, id) => d.places.find((p) => p.id === id) || d.places[0];
const placeName = (d, id) => (PLACES.includes(id) ? { room: 'its room', gallery: 'its gallery', outside: 'the garden' }[id] : placeOf(d, id).name);
const stageWords = (p) => (p.stage === 'building' ? `being built (${Math.round(p.progress * 100)}% done)` : STAGE_WORDS[p.stage]);

function fillWords(d) {
  const c = d.cat;
  let where = PLACE_WORDS[c.place] || `at ${placeOf(d, c.place).name}`;
  if (c.place === 'outside' && /outside|garden/.test(c.doing || '')) where = '';
  where = where ? ` ${where}` : '';
  let line = c.asleep ? `${c.name} is fast asleep${where}.` : `${c.name} is ${c.doing || 'pottering about'}${where}.`;
  if (c.mood) line += ` Feeling ${c.mood}.`;
  $('status-line').textContent = line;
  const bits = [`It's ${d.time.part === 'day' ? 'daytime' : d.time.part === 'night' ? 'night-time' : d.time.part} in Sydney`];
  bits.push(`weather: ${d.weather.kind}${d.weather.temp !== null ? ` (${d.weather.temp}°C)` : ''}`);
  if (d.time.season) bits.push(d.time.season);
  if (d.time.holiday) bits.push(`it's ${d.time.holiday}!`);
  if (d.time.birthday) bits.push("it's the cat's birthday!");
  if (d.clock.day !== null) bits.push(`cat time: day ${d.clock.day}${d.clock.hour !== null ? `, hour ${d.clock.hour}` : ''}`);
  $('time-line').textContent = bits.join(' · ');
  setList('room-list', d.items.map((it) => it.label || it.id || 'a thing'));
  setList('gallery-list', d.hung.map((h) => (h.note ? `${h.title} — ${h.note}` : h.title)));
  setList('garden-list', d.garden.map((g) => `${g.plant} (${g.stage})`));
  const built = d.places.filter((p) => !p.home);
  setList('places-list', built.map((p) => `${p.name} (a ${words(p.kind)}): ${stageWords(p)}`)
    .concat(d.wishItems.map((w) => `${w.thing} (a wish that came true)`)));
  setList('spots-list', d.spots.map((sp) => `${sp.name}, ${placeName(d, sp.place)}`));
  setList('wearing-list', c.wearing.map(words));
  setList('mural-list', d.murals.map((m) => `A painting on ${m.wall === 'outside' ? 'an outside wall' : `the ${m.wall} wall`} of ${placeName(d, m.place)}`));
  // One button per place the cat has started (the first three are already in the page).
  const nav = document.querySelector('.places');
  for (const p of built) {
    if (nav.querySelector(`button[data-place="${p.id}"]`)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.place = p.id;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = p.name;
    b.title = `${p.name}: ${stageWords(p)}`;
    nav.append(b);
  }
}

function showMessage(text) {
  $('status-line').textContent = text;
  $('waiting').hidden = false;
  $('waiting').replaceChildren(Object.assign(document.createElement('p'), { textContent: text }));
  $('view').hidden = true;
  for (const b of document.querySelectorAll('.places button')) b.disabled = true;
}

// A flat drawing of the cat (for devices without 3D), from the look colours.
function portraitSvg(look, asleep) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const svg = el('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': 'A drawing of the cat' });
  const stroke = { stroke: look.outline, 'stroke-width': 5, 'stroke-linejoin': 'round' };
  svg.append(
    el('path', { d: 'M150 120 Q182 95 176 72', fill: 'none', stroke: look.body, 'stroke-width': 16, 'stroke-linecap': 'round' }),
    el('circle', { cx: 176, cy: 72, r: 8, fill: look.tail_tip }),
    el('rect', { x: 72, y: 150, width: 16, height: 32, rx: 8, fill: look.body, ...stroke }),
    el('rect', { x: 112, y: 150, width: 16, height: 32, rx: 8, fill: look.body, ...stroke }),
    el('path', { d: 'M52 72 L58 22 L92 52 Z', fill: look.body, ...stroke }),
    el('path', { d: 'M148 72 L142 22 L108 52 Z', fill: look.body, ...stroke }),
    el('path', { d: 'M62 60 L64 36 L82 52 Z', fill: look.ears }),
    el('path', { d: 'M138 60 L136 36 L118 52 Z', fill: look.ears }),
    el('ellipse', { cx: 100, cy: 108, rx: 62, ry: 58, fill: look.body, ...stroke }),
    el('ellipse', { cx: 100, cy: 128, rx: 34, ry: 28, fill: look.belly }),
  );
  if (asleep) {
    for (const x of [78, 122]) svg.append(el('path', { d: `M${x - 9} 98 Q${x} 106 ${x + 9} 98`, fill: 'none', stroke: look.outline, 'stroke-width': 4, 'stroke-linecap': 'round' }));
  } else {
    for (const x of [78, 122]) svg.append(el('circle', { cx: x, cy: 96, r: 9, fill: look.eyes }), el('circle', { cx: x, cy: 97, r: 4, fill: look.outline }));
  }
  svg.append(el('circle', { cx: 100, cy: 110, r: 4, fill: look.ears }));
  return svg;
}

function showFallback(d, why) {
  $('waiting').hidden = true;
  $('view').hidden = true;
  $('hint').hidden = true;
  document.querySelector('.places').hidden = true;
  $('fallback').hidden = false;
  $('portrait').replaceChildren(portraitSvg(d.cat.look, d.cat.asleep));
  $('fallback-text').textContent = `${why} ${$('status-line').textContent} The lists below say what is in its room, its gallery, its garden and the places it has built.`;
  for (const b of document.querySelectorAll('.places button')) b.disabled = true;
}

function webglWorks() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------- little helpers ----
function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
// A small seeded random number maker, so the island looks the same on every visit.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function shade(color, amount) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s, clamp(hsl.l + amount, 0, 1));
}
function angleTo(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Toon shading: three soft steps of light, like crayon on paper.
let RAMP = null;
function ramp() {
  if (!RAMP) {
    RAMP = new THREE.DataTexture(new Uint8Array([120, 196, 255]), 3, 1, THREE.RedFormat);
    RAMP.minFilter = RAMP.magFilter = THREE.NearestFilter;
    RAMP.needsUpdate = true;
  }
  return RAMP;
}
// The ground's own steps: smooth (linear) so the big grass triangles don't show as hard bands.
let GROUND_RAMP = null;
function groundRamp() {
  if (!GROUND_RAMP) {
    GROUND_RAMP = new THREE.DataTexture(new Uint8Array([150, 200, 236, 255]), 4, 1, THREE.RedFormat);
    GROUND_RAMP.minFilter = GROUND_RAMP.magFilter = THREE.LinearFilter;
    GROUND_RAMP.needsUpdate = true;
  }
  return GROUND_RAMP;
}
const toonCache = new Map();
function toon(color, opts = {}) {
  const key = String(color) + JSON.stringify(opts);
  if (!toonCache.has(key)) toonCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: ramp(), ...opts }));
  return toonCache.get(key);
}
// A model's material, redrawn with the toon steps (keeping its colour, picture and glow).
const toonOf = new Map();
function toToon(m) {
  if (!m || m.isMeshToonMaterial || m.isShaderMaterial) return m;
  if (toonOf.has(m.uuid)) return toonOf.get(m.uuid);
  const t = new THREE.MeshToonMaterial({
    name: m.name, color: m.color ? m.color.clone() : new THREE.Color(0xdddddd), gradientMap: ramp(),
    map: m.map || null, vertexColors: m.vertexColors, transparent: m.transparent, opacity: m.opacity,
    side: m.side, alphaTest: m.alphaTest || 0,
  });
  if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) {
    t.emissive.copy(m.emissive);
    t.emissiveIntensity = m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity;
    t.userData.glows = true;
  }
  toonOf.set(m.uuid, t);
  return t;
}

// Shared clock and wind for everything that sways (trees, bushes, flowers, grass).
const SWAY = { uTime: { value: 0 }, uWind: { value: 0.25 } };
const swayOf = new Map();
function swaying(m) {
  if (!m || !m.isMeshToonMaterial) return m;
  if (swayOf.has(m.uuid)) return swayOf.get(m.uuid);
  const s = m.clone();
  s.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SWAY.uTime;
    sh.uniforms.uWind = SWAY.uWind;
    // Plants right in front of the camera are cut away, so they never block the view of the cat.
    sh.fragmentShader = 'varying float vNearZ;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', [
      '#include <clipping_planes_fragment>',
      'if (vNearZ < 3.4) discard;',
    ].join('\n'));
    sh.vertexShader = 'varying float vNearZ;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvNearZ = -mvPosition.z;');
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
      '#include <begin_vertex>',
      'vec3 swayAt = modelMatrix[3].xyz;',
      '#ifdef USE_INSTANCING',
      '  swayAt += instanceMatrix[3].xyz;',
      '#endif',
      'float swayH = max(position.y, 0.0);',
      'float swayP = uTime * 1.7 + swayAt.x * 0.37 + swayAt.z * 0.23;',
      'transformed.x += sin(swayP) * uWind * swayH * swayH * 0.035;',
      'transformed.z += cos(swayP * 0.83) * uWind * swayH * swayH * 0.022;',
    ].join('\n'));
  };
  s.customProgramCacheKey = () => 'sway';
  swayOf.set(m.uuid, s);
  return s;
}

// The cat's soft outline: a slightly bigger copy drawn inside-out ("inverted hull"); it follows
// the cat's bones, so it bends with every step.
function hullMaterial(colour, width) {
  const m = new THREE.MeshBasicMaterial({ color: colour, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += normalize(normal) * ${width.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => 'hull' + width.toFixed(4);
  return m;
}

function mesh(geo, material, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const ball = (r, seg = 12) => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
function roundedRectShape(w, h, r, x0 = -w / 2, y0 = -h / 2) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r);
  s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h);
  s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
const boxCache = new Map();
function roundedBox(w, h, d, r = 0.08) {
  const key = [w, h, d, r].join(',');
  if (!boxCache.has(key)) {
    r = Math.min(r, w / 2.2, h / 2.2, d / 2.2);
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
      depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 2, curveSegments: 3,
    });
    geo.translate(0, 0, -(d - 2 * r) / 2);
    boxCache.set(key, geo);
  }
  return boxCache.get(key);
}
// A box sitting on the ground (its bottom at y).
const block = (w, h, d, colour, at = {}) => mesh(roundedBox(w, h, d, Math.min(0.12, h / 4)), toon(colour), { ...at, y: (at.y || 0) + h / 2 });
// A pitched roof: a triangle pushed back along z.
function roofGeo(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(-w / 2, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 });
  geo.translate(0, 0, -d / 2);
  return geo;
}
function empty(name, x, y, z, ry = 0, extras) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  o.rotation.y = ry;
  if (extras) o.userData = extras;
  return o;
}
function group(name, ...kids) {
  const g = new THREE.Group();
  g.name = name;
  for (const k of kids) g.add(k);
  return g;
}

// Words drawn on a little canvas (place names on signs, the sketch of an idea).
function textTexture(text, { w = 512, h = 160, bg = '#fff6e6', fg = '#4a2b5a', size = 64, sketch = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(90, 60, 100, 0.35)';
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  if (sketch) {
    // A wobbly pencil drawing of a little building (each idea gets its own wobble).
    const rnd = seeded(hashOf(sketch));
    const j = (v) => v + (rnd() - 0.5) * 8;
    g.strokeStyle = '#6b5a7a';
    g.lineWidth = 5;
    g.lineCap = g.lineJoin = 'round';
    const bx = w / 2, by = h * 0.9, bw = w * 0.42, bh = h * 0.32;
    g.beginPath();
    g.moveTo(j(bx - bw / 2), j(by));
    g.lineTo(j(bx - bw / 2), j(by - bh));
    g.lineTo(j(bx), j(by - bh * 1.9));
    g.lineTo(j(bx + bw / 2), j(by - bh));
    g.lineTo(j(bx + bw / 2), j(by));
    g.closePath();
    g.moveTo(j(bx - bw * 0.1), j(by));
    g.lineTo(j(bx - bw * 0.1), j(by - bh * 0.6));
    g.lineTo(j(bx + bw * 0.1), j(by - bh * 0.6));
    g.lineTo(j(bx + bw * 0.1), j(by));
    g.stroke();
    g.font = 'bold 40px "Comic Sans MS", "Chalkboard SE", sans-serif';
    g.fillStyle = '#6b5a7a';
    g.fillText('?', j(bx + bw * 0.62), j(by - bh * 1.5));
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let s = size;
  do {
    g.font = `bold ${s}px "Comic Sans MS", "Chalkboard SE", sans-serif`;
    s -= 2;
  } while (g.measureText(text).width > w - 40 && s > 16);
  g.fillText(text, w / 2, sketch ? h * 0.2 : h / 2, w - 40);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function board(text, w, h, opts) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshToonMaterial({ map: textTexture(text, opts), gradientMap: ramp() }));
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------- the stand-in kit ----
// Simple shapes with the same names as the Blender kit (models/world_kit.glb). They are used for
// anything the kit doesn't have, and for everything when the page is opened from the disk.
const C = {
  grass: '#a3cf7d', grass2: '#8cbf6e', sand: '#f2dca6', path: '#dcb98c', water: '#93d3e2', rock: '#b9adbd',
  wood: '#c38d5c', woodDark: '#8f6343', cream: '#fff3df', pink: '#f4bcc4', roof: '#d97b6c', roofPlum: '#9474b0',
  sky: '#a8d4ee', leaf: '#7fbe6c', leaf2: '#a9d47f', blossom: '#f6c4d6', pine: '#5f9e70', gold: '#f6cf6a',
  white: '#fbf8f2', red: '#e46a5e', teal: '#6cc4b8', lilac: '#c9b2e6', glass: '#cfeaf5',
};

const STANDIN_ISLAND = {
  R: 30,
  pond: { x: 18.5, z: -7.5, r: 4 },
  ring: 11,
  pads: [],
};
function siRaw(x, z) {
  const r = Math.hypot(x, z);
  let h = 0.55 + 0.55 * Math.sin(x * 0.16 + 0.6) * Math.cos(z * 0.13 - 0.4) + 0.4 * Math.sin((x - z) * 0.09 + 1.3);
  h = Math.max(0.12, h);
  const e = smooth(24, 30.5, r);
  h = h * (1 - e) + (-1.1) * e;
  const p = STANDIN_ISLAND.pond, dp = Math.hypot(x - p.x, z - p.z);
  h = h * (1 - smooth(p.r + 1.6, p.r - 0.4, dp)) + (-0.45) * smooth(p.r + 1.6, p.r - 0.4, dp);
  return h;
}
function siHeight(x, z) {
  let h = siRaw(x, z);
  for (const pad of STANDIN_ISLAND.pads) {
    const w = smooth(pad.r + 2.5, pad.r, Math.hypot(x - pad.x, z - pad.z));
    if (w > 0) h = h * (1 - w) + pad.y * w;
  }
  return h;
}
function standinIsland() {
  const S = STANDIN_ISLAND, isl = group('island');
  const wps = [[0, 0]];
  for (let k = 0; k < 8; k++) wps.push([Math.sin(k * Math.PI / 4) * S.ring, Math.cos(k * Math.PI / 4) * S.ring]);
  wps.push([0, 21.5], [-20, -6], [11, -19], [21, 4]);
  const paths = [[1, 2], [1, 4], [1, 6], [1, 8]];
  for (let k = 0; k < 8; k++) paths.push([2 + k, 2 + ((k + 1) % 8)]);
  paths.push([2, 10], [8, 11], [5, 12], [4, 13]);
  // Building sites: just outside the ring, a few inside it and out on the spurs.
  const slots = [];
  const ringSlot = (name, k, r = 16.2) => slots.push({ name, x: Math.sin(k * Math.PI / 4) * r, z: Math.cos(k * Math.PI / 4) * r, door: 2 + k });
  ringSlot('slot_room', 0);
  ringSlot('slot_gallery', 1);
  ringSlot('slot_outside', 7);
  [2, 3, 4, 5, 6].forEach((k, i) => ringSlot(`slot_${i + 1}`, k));
  [1, 3, 5, 7].forEach((k, i) => {
    const a = k * Math.PI / 4;
    slots.push({ name: `slot_${i + 6}`, x: Math.sin(a) * 5.6, z: Math.cos(a) * 5.6, door: 1 });
  });
  slots.push({ name: 'slot_10', x: -5, z: 22, door: 10 }, { name: 'slot_11', x: -23, z: -12, door: 11 }, { name: 'slot_12', x: 4, z: -23, door: 12 });
  S.pads = slots.map((s) => ({ x: s.x, z: s.z, r: 3.2, y: Math.max(0.2, siRaw(s.x, s.z)) }));
  // The ground: a round grid lifted into soft hills, grass on top and sand at the edge.
  const geo = new THREE.CircleGeometry(S.R + 1.5, 72, 0, Math.PI * 2);
  const ringGeo = new THREE.PlaneGeometry(2 * S.R + 4, 2 * S.R + 4, 64, 64);
  ringGeo.rotateX(-Math.PI / 2);
  geo.dispose();
  const pos = ringGeo.attributes.position, colours = [];
  const grass = new THREE.Color(C.grass), grass2 = new THREE.Color(C.grass2), sand = new THREE.Color(C.sand);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z);
    const k = r > S.R + 1 ? (S.R + 1) / r : 1;
    pos.setXYZ(i, x * k, siHeight(x * k, z * k) - (k < 1 ? 1.2 : 0), z * k);
    const c = grass.clone().lerp(grass2, 0.5 + 0.5 * Math.sin(x * 0.4) * Math.cos(z * 0.33)).lerp(sand, smooth(24, 26.5, r));
    colours.push(c.r, c.g, c.b);
  }
  ringGeo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  ringGeo.computeVertexNormals();
  const ground = mesh(ringGeo, new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true, gradientMap: ramp(), name: 'grass' }), { shadow: false });
  isl.add(ground);
  const pond = mesh(new THREE.CircleGeometry(S.pond.r + 0.6, 32), toon(C.water, { name: 'water' }), { x: S.pond.x, y: -0.12, z: S.pond.z, rx: -Math.PI / 2, shadow: false });
  isl.add(pond);
  // The paths: soft dirt ribbons that follow the ground.
  const verts = [], index = [];
  const W = 0.8;
  for (const [a, b] of paths) {
    const [ax, az] = wps[a - 1], [bx, bz] = wps[b - 1];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.ceil(len / 0.7));
    const nx = -(bz - az) / len, nz = (bx - ax) / len, base = verts.length / 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      for (const s of [-1, 1]) verts.push(x + nx * W * s, siHeight(x + nx * W * s, z + nz * W * s) + 0.05, z + nz * W * s);
      if (i) index.push(base + 2 * i - 2, base + 2 * i - 1, base + 2 * i, base + 2 * i - 1, base + 2 * i + 1, base + 2 * i);
    }
  }
  for (const [x, z] of wps) {
    const base = verts.length / 3;
    verts.push(x, siHeight(x, z) + 0.06, z);
    for (let i = 0; i <= 12; i++) {
      const a = i / 12 * Math.PI * 2;
      verts.push(x + Math.cos(a) * W * 1.25, siHeight(x + Math.cos(a) * W, z + Math.sin(a) * W) + 0.06, z + Math.sin(a) * W * 1.25);
      if (i) index.push(base, base + i + 1, base + i);
    }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  pg.setIndex(index);
  pg.computeVertexNormals();
  isl.add(mesh(pg, toon(C.path, { name: 'path', side: THREE.DoubleSide }), { shadow: false }));
  wps.forEach(([x, z], i) => isl.add(empty(`wp_${i + 1}`, x, siHeight(x, z), z)));
  for (const s of slots) isl.add(empty(s.name, s.x, siHeight(s.x, s.z), s.z, 0, { door: `wp_${s.door}` }));
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * Math.PI / 4, x = Math.sin(a) * (S.ring + 2.3), z = Math.cos(a) * (S.ring + 2.3);
    isl.add(empty(`spot_${k + 1}`, x, siHeight(x, z), z));
  }
  isl.userData = { paths: paths.map(([a, b]) => [`wp_${a}`, `wp_${b}`]), standin: true };
  return isl;
}

function blobTree(name, leaf, trunkH, crown) {
  const g = group(name);
  g.add(mesh(cyl(0.14, 0.22, trunkH, 7), toon(C.woodDark), { y: trunkH / 2 }));
  for (const [x, y, z, r] of crown) g.add(mesh(ball(r, 10), swaying(toon(leaf)), { x, y: trunkH + y, z }));
  return g;
}
function cottage(name, { w = 3.2, d = 3, h = 2.2, wall = C.cream, roof = C.roof, roofH = 1.3, door = C.woodDark } = {}) {
  const g = group(name);
  g.add(block(w, h, d, wall));
  const r = mesh(roofGeo(w + 0.5, roofH, d + 0.5), toon(roof), { y: h });
  g.add(r);
  g.add(block(0.8, 1.35, 0.12, door, { z: d / 2 + 0.02 }));
  for (const s of [-1, 1]) {
    g.add(mesh(cyl(0.3, 0.3, 0.1, 14), toon(C.glass), { x: s * w * 0.3, y: h * 0.62, z: d / 2 + 0.03, rx: Math.PI / 2 }));
    g.add(mesh(new THREE.TorusGeometry(0.31, 0.05, 6, 16), toon(C.wood), { x: s * w * 0.3, y: h * 0.62, z: d / 2 + 0.06 }));
  }
  g.add(empty('door', 0, 0, d / 2 + 0.4));
  return g;
}
const STANDIN = {
  island: standinIsland,
  house_room() {
    const g = group('house_room');
    g.add(block(4.8, 0.16, 4.8, C.wood));
    const wall = C.cream;
    g.add(block(4.8, 2.5, 0.25, wall, { z: -2.3 }));
    g.add(block(0.25, 2.5, 4.8, wall, { x: -2.3 }));
    g.add(block(0.25, 2.5, 4.8, wall, { x: 2.3 }));
    const cut = group('cutaway');
    cut.add(block(1.7, 2.5, 0.25, wall, { x: -1.55, z: 2.3 }));
    cut.add(block(1.7, 2.5, 0.25, wall, { x: 1.55, z: 2.3 }));
    cut.add(block(1.4, 0.7, 0.25, wall, { y: 1.8, z: 2.3 }));
    cut.add(mesh(roofGeo(5.6, 1.8, 5.6), toon(C.roof), { y: 2.5 }));
    cut.add(block(0.5, 1.1, 0.5, C.rock, { x: 1.4, y: 3.2, z: -1 }));
    g.add(cut);
    g.add(mesh(cyl(0.45, 0.45, 0.06, 18), toon(C.glass), { x: -1.2, y: 1.5, z: -2.15, rx: Math.PI / 2 }));
    g.add(empty('door', 0, 0, 2.9));
    return g;
  },
  gallery_building() {
    const g = group('gallery_building');
    g.add(block(6.4, 0.2, 4.6, C.wood));
    g.add(block(6.4, 2.8, 0.22, C.pink, { z: -2.2 }));
    for (const s of [-1, 1]) g.add(block(0.22, 2.8, 3, C.pink, { x: s * 3.1, z: -0.7 }));
    for (const [x, z] of [[-3.05, 2.1], [3.05, 2.1]]) g.add(mesh(cyl(0.12, 0.14, 2.8, 8), toon(C.wood), { x, y: 1.4, z }));
    g.add(mesh(roofGeo(7.2, 1.4, 5.4), toon(C.roofPlum), { y: 2.8 }));
    let n = 1;
    for (const y of [1.95, 0.95]) for (const x of [-2, 0, 2]) g.add(empty(`frame_${n++}`, x, y, -2.07));
    for (const s of [-1, 1]) for (const y of [1.95, 0.95]) for (const z of [-1.3, 0.1]) {
      if (n <= 12) g.add(empty(`frame_${n++}`, s * 2.97, y, z, -s * Math.PI / 2));
    }
    while (n <= 12) g.add(empty(`frame_${n++}`, -2 + (n % 3) * 2, 2.6, -2.07));
    g.add(empty('door', 0, 0, 2.6));
    return g;
  },
  tree_round_a: () => blobTree('tree_round_a', C.leaf, 1.4, [[0, 0.7, 0, 1.0], [0.5, 1.3, 0.1, 0.7], [-0.4, 1.2, -0.2, 0.75]]),
  tree_round_b: () => blobTree('tree_round_b', C.leaf2, 1.1, [[0, 0.8, 0, 1.15], [0.1, 1.6, 0, 0.7]]),
  tree_blossom: () => blobTree('tree_blossom', C.blossom, 1.3, [[0, 0.7, 0, 0.95], [0.6, 1.0, 0.2, 0.6], [-0.5, 1.1, 0, 0.65]]),
  tree_pine() {
    const g = group('tree_pine');
    g.add(mesh(cyl(0.12, 0.18, 0.8, 7), toon(C.woodDark), { y: 0.4 }));
    [[1.2, 1.4, 0.6], [0.95, 1.2, 1.4], [0.65, 1.0, 2.1]].forEach(([r, h, y]) => g.add(mesh(cone(r, h, 9), swaying(toon(C.pine)), { y: y + h / 2 })));
    return g;
  },
  bush_a: () => group('bush_a', mesh(ball(0.55, 10), swaying(toon(C.leaf)), { y: 0.35, sy: 0.75 }), mesh(ball(0.4, 10), swaying(toon(C.leaf2)), { x: 0.4, y: 0.3, sy: 0.75 })),
  bush_b: () => group('bush_b', mesh(ball(0.5, 10), swaying(toon(C.leaf2)), { y: 0.35, sy: 0.8 }), mesh(ball(0.12, 6), toon(C.pink), { x: 0.2, y: 0.7, z: 0.3 }), mesh(ball(0.12, 6), toon(C.pink), { x: -0.25, y: 0.6, z: 0.35 })),
  rock_a: () => group('rock_a', mesh(new THREE.DodecahedronGeometry(0.5, 0), toon(C.rock), { y: 0.22, sy: 0.6 })),
  rock_b: () => group('rock_b', mesh(new THREE.DodecahedronGeometry(0.35, 0), toon(shade(C.rock, -0.06)), { y: 0.15, sy: 0.55 }), mesh(new THREE.DodecahedronGeometry(0.22, 0), toon(C.rock), { x: 0.35, y: 0.1, sy: 0.6 })),
  flowers_a() {
    const g = group('flowers_a');
    [[0, 0, C.pink], [0.2, 0.15, C.gold], [-0.18, 0.1, C.white], [0.05, -0.2, C.lilac]].forEach(([x, z, c]) => {
      g.add(mesh(cyl(0.015, 0.015, 0.3, 4), swaying(toon(C.leaf)), { x, y: 0.15, z, shadow: false }));
      g.add(mesh(ball(0.07, 6), swaying(toon(c)), { x, y: 0.32, z, shadow: false }));
    });
    return g;
  },
  flowers_b() {
    const g = group('flowers_b');
    [[0, 0], [0.15, -0.12], [-0.15, 0.08]].forEach(([x, z]) => {
      g.add(mesh(cyl(0.015, 0.015, 0.4, 4), swaying(toon(C.leaf)), { x, y: 0.2, z, shadow: false }));
      g.add(mesh(ball(0.09, 6), swaying(toon(C.gold)), { x, y: 0.42, z, sy: 0.5, shadow: false }));
    });
    return g;
  },
  grass_tuft() {
    const g = group('grass_tuft');
    for (let i = 0; i < 4; i++) g.add(mesh(cone(0.05, 0.35, 4), swaying(toon(C.grass2)), { x: Math.cos(i * 1.6) * 0.08, y: 0.17, z: Math.sin(i * 1.6) * 0.08, rz: Math.cos(i * 2.1) * 0.3, shadow: false }));
    return g;
  },
  mushroom: () => group('mushroom', mesh(cyl(0.06, 0.08, 0.2, 7), toon(C.cream), { y: 0.1 }), mesh(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(C.red), { y: 0.18 })),
  fence_segment() {
    const g = group('fence_segment');
    for (const x of [-0.9, 0.9]) g.add(block(0.12, 0.75, 0.12, C.wood, { x }));
    for (const y of [0.3, 0.58]) g.add(mesh(roundedBox(1.9, 0.09, 0.06, 0.02), toon(C.wood), { y }));
    return g;
  },
  lamp_post() {
    const g = group('lamp_post');
    g.add(mesh(cyl(0.05, 0.08, 2.2, 7), toon(C.woodDark), { y: 1.1 }));
    g.add(mesh(ball(0.18, 10), toon(C.gold, { emissive: '#ffcf70', emissiveIntensity: 0.4 }), { y: 2.3 }));
    g.add(mesh(cone(0.24, 0.22, 8), toon(C.roofPlum), { y: 2.55 }));
    g.add(empty('light', 0, 2.3, 0));
    return g;
  },
  bench() {
    const g = group('bench');
    g.add(mesh(roundedBox(1.4, 0.08, 0.42, 0.03), toon(C.wood), { y: 0.42 }));
    g.add(mesh(roundedBox(1.4, 0.3, 0.06, 0.03), toon(C.wood), { y: 0.7, z: -0.2, rx: -0.15 }));
    for (const x of [-0.6, 0.6]) g.add(block(0.08, 0.42, 0.36, C.woodDark, { x }));
    return g;
  },
  signpost: () => group('signpost', mesh(cyl(0.05, 0.06, 1.3, 6), toon(C.woodDark), { y: 0.65 }), block(0.9, 0.42, 0.06, C.wood, { y: 0.85, z: 0.05 })),
  stepping_stone: () => group('stepping_stone', mesh(cyl(0.3, 0.33, 0.08, 9), toon(C.rock), { y: 0.03 })),
  scaffold() {
    const g = group('scaffold');
    const m = toon(C.wood);
    for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) g.add(mesh(cyl(0.05, 0.05, 3, 5), m, { x, y: 1.5, z }));
    for (const y of [1, 2, 2.95]) for (const [x, z, ry] of [[0, 1.6, 0], [0, -1.6, 0], [1.6, 0, Math.PI / 2], [-1.6, 0, Math.PI / 2]]) {
      g.add(mesh(roundedBox(3.3, 0.08, 0.12, 0.02), m, { x, y, z, ry }));
    }
    return g;
  },
  crate: () => group('crate', block(0.6, 0.6, 0.6, C.wood), mesh(roundedBox(0.62, 0.08, 0.62, 0.02), toon(C.woodDark), { y: 0.3 })),
  barrel: () => group('barrel', mesh(cyl(0.28, 0.25, 0.7, 10), toon(C.wood), { y: 0.35 }), mesh(new THREE.TorusGeometry(0.29, 0.03, 4, 14), toon(C.woodDark), { y: 0.5, rx: Math.PI / 2 })),
  cloud_a: () => group('cloud_a', ...[[0, 0, 0, 1.6], [1.5, -0.3, 0.2, 1.1], [-1.4, -0.35, 0, 1.15], [0.4, 0.6, -0.2, 1.0]].map(([x, y, z, r]) => mesh(ball(r, 10), toon(C.white), { x, y, z, sy: 0.75, shadow: false }))),
  cloud_b: () => group('cloud_b', ...[[0, 0, 0, 1.2], [1.1, -0.2, 0, 0.9], [-1, -0.25, 0.1, 0.8]].map(([x, y, z, r]) => mesh(ball(r, 10), toon(C.white), { x, y, z, sy: 0.7, shadow: false }))),
  boat() {
    const g = group('boat');
    g.add(mesh(new THREE.SphereGeometry(0.9, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(C.red), { y: 0.45, sx: 0.6, sz: 1.2, sy: 0.6 }));
    g.add(mesh(cyl(0.03, 0.03, 1.4, 5), toon(C.woodDark), { y: 1.0 }));
    g.add(mesh(new THREE.ConeGeometry(0.5, 1.0, 3), toon(C.white), { y: 1.1, z: 0.05, sz: 0.1 }));
    return g;
  },
  bird() {
    const g = group('bird');
    g.add(mesh(ball(0.12, 8), toon(C.white), { sz: 1.5 }));
    for (const s of [-1, 1]) g.add(mesh(roundedBox(0.3, 0.02, 0.12, 0.01), toon(C.white), { x: s * 0.18, rz: s * 0.3 }));
    g.add(mesh(cone(0.03, 0.08, 4), toon(C.gold), { z: 0.2, rx: Math.PI / 2 }));
    return g;
  },
  place_generic: () => cottage('place_generic', { wall: C.cream, roof: C.teal }),
  place_cafe() {
    const g = cottage('place_cafe', { wall: C.pink, roof: C.roof });
    for (let i = 0; i < 6; i++) g.add(mesh(roundedBox(0.55, 0.06, 0.8, 0.02), toon(i % 2 ? C.white : C.red), { x: -1.4 + i * 0.56, y: 1.9, z: 1.85, rx: 0.4 }));
    g.add(mesh(cyl(0.3, 0.22, 0.4, 10), toon(C.white), { y: 3.85 }));
    return g;
  },
  place_observatory() {
    const g = group('place_observatory');
    g.add(mesh(cyl(1.6, 1.7, 2.6, 16), toon(C.cream), { y: 1.3 }));
    g.add(mesh(new THREE.SphereGeometry(1.65, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(C.roofPlum), { y: 2.6 }));
    g.add(mesh(cyl(0.18, 0.25, 1.6, 8), toon(C.rock), { y: 3.6, z: 0.4, rx: 0.7 }));
    g.add(block(0.8, 1.35, 0.12, C.woodDark, { z: 1.65 }));
    g.add(empty('door', 0, 0, 2.1));
    return g;
  },
  place_train_station() {
    const g = cottage('place_train_station', { w: 4.4, d: 2.4, wall: C.sky, roof: C.roof });
    g.add(block(5.4, 0.25, 1.4, C.rock, { z: 2.0 }));
    g.add(mesh(cyl(0.35, 0.35, 0.1, 16), toon(C.white), { y: 3.0, z: 0.5, rx: Math.PI / 2 }));
    return g;
  },
  place_pottery() {
    const g = group('place_pottery');
    g.add(mesh(cyl(1.6, 1.8, 2.2, 14), toon('#e9b48f'), { y: 1.1 }));
    g.add(mesh(cone(2.1, 1.4, 14), toon(C.roof), { y: 2.9 }));
    g.add(mesh(cyl(0.25, 0.3, 1.4, 8), toon(C.rock), { x: 1, y: 3.1, z: -0.6 }));
    for (const x of [-1.2, -0.7]) g.add(mesh(ball(0.25, 8), toon('#d98b5f'), { x, y: 0.22, z: 1.8, sy: 0.9 }));
    g.add(block(0.8, 1.35, 0.12, C.woodDark, { z: 1.68 }));
    g.add(empty('door', 0, 0, 2.2));
    return g;
  },
  place_library() {
    const g = cottage('place_library', { w: 3.2, h: 3.4, wall: '#d7c6a3', roof: C.roofPlum });
    ['#e46a5e', '#6cc4b8', '#f6cf6a', '#9474b0'].forEach((c, i) => g.add(block(0.25, 0.8, 0.5, c, { x: 1.95 + i * 0.27, z: 1.2 })));
    return g;
  },
  place_music() {
    const g = cottage('place_music', { wall: C.lilac, roof: C.gold });
    g.add(mesh(cone(0.5, 0.9, 12, true), toon(C.gold), { x: 1.5, y: 3.6, rz: -0.8 }));
    return g;
  },
  place_aquarium() {
    const g = cottage('place_aquarium', { wall: C.sky, roof: C.teal });
    g.add(mesh(new THREE.SphereGeometry(1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(C.glass, { transparent: true, opacity: 0.75 }), { x: 2.3, y: 0.05 }));
    return g;
  },
  place_workshop() {
    const g = cottage('place_workshop', { w: 3.6, wall: C.wood, roof: C.red });
    g.add(mesh(new THREE.TorusGeometry(0.35, 0.12, 6, 8), toon(C.rock), { y: 2.9, z: 1.65 }));
    return g;
  },
  place_lighthouse() {
    const g = group('place_lighthouse');
    for (let i = 0; i < 4; i++) g.add(mesh(cyl(1.0 - i * 0.12, 1.12 - i * 0.12, 1.2, 14), toon(i % 2 ? C.red : C.white), { y: 0.6 + i * 1.2 }));
    g.add(mesh(cyl(0.55, 0.55, 0.7, 10), toon(C.gold, { emissive: '#ffd27a', emissiveIntensity: 0.5 }), { y: 5.15 }));
    g.add(mesh(cone(0.75, 0.7, 10), toon(C.red), { y: 5.85 }));
    g.add(block(0.6, 1.2, 0.12, C.woodDark, { z: 1.08 }));
    g.add(empty('door', 0, 0, 1.6));
    return g;
  },
  place_bakery() {
    const g = cottage('place_bakery', { wall: C.cream, roof: '#e7a15c' });
    g.add(mesh(cyl(0.22, 0.26, 1.2, 8), toon(C.rock), { x: 1, y: 3.3, z: -0.5 }));
    g.add(mesh(new THREE.CapsuleGeometry(0.25, 0.6, 4, 8), toon('#e3a35f'), { y: 2.0, z: 1.7, rz: Math.PI / 2 }));
    return g;
  },
  place_cinema() {
    const g = cottage('place_cinema', { w: 3.8, h: 2.8, wall: C.roofPlum, roof: '#5d4a78', door: C.red });
    g.add(block(3.4, 0.6, 0.3, C.gold, { y: 2.2, z: 1.65 }));
    return g;
  },
  place_museum() {
    const g = group('place_museum');
    g.add(block(4.2, 0.3, 3.4, C.rock));
    g.add(block(3.6, 2.4, 2.4, C.cream, { y: 0.3, z: -0.3 }));
    for (const x of [-1.6, -0.55, 0.55, 1.6]) g.add(mesh(cyl(0.16, 0.18, 2.4, 10), toon(C.white), { x, y: 1.5, z: 1.3 }));
    g.add(mesh(roofGeo(4.4, 0.9, 3.6), toon(C.white), { y: 2.7 }));
    g.add(empty('door', 0, 0, 2.0));
    return g;
  },
  place_treehouse() {
    const g = group('place_treehouse');
    g.add(mesh(cyl(0.45, 0.65, 3.2, 9), toon(C.woodDark), { y: 1.6 }));
    const h = cottage('house', { w: 2.4, d: 2.2, h: 1.6, roofH: 1, wall: C.wood, roof: C.leaf });
    h.position.y = 2.6;
    g.add(h);
    for (const [x, y, z, r] of [[1.4, 4.6, -0.4, 1.0], [-1.3, 4.4, 0, 0.9]]) g.add(mesh(ball(r, 10), swaying(toon(C.leaf)), { x, y, z }));
    for (let i = 0; i < 6; i++) g.add(block(0.5, 0.05, 0.12, C.wood, { x: 0.55, y: 0.4 + i * 0.4, z: 0.55 }));
    g.add(empty('door', 0, 0, 1.4));
    return g;
  },
  place_weather_station() {
    const g = cottage('place_weather_station', { w: 2.4, d: 2.4, wall: C.white, roof: C.sky });
    g.add(mesh(cyl(0.04, 0.04, 2.4, 5), toon(C.rock), { x: 1.5, y: 1.2 }));
    for (let i = 0; i < 3; i++) g.add(mesh(ball(0.12, 6), toon(C.red), { x: 1.5 + Math.cos(i * 2.1) * 0.3, y: 2.45, z: Math.sin(i * 2.1) * 0.3 }));
    return g;
  },
  deco_pumpkin: () => group('deco_pumpkin', mesh(ball(0.28, 12), toon('#f0904a'), { y: 0.22, sy: 0.75 }), mesh(cyl(0.03, 0.04, 0.12, 5), toon(C.leaf), { y: 0.46 })),
  deco_fairy_lights() {
    const g = group('deco_fairy_lights');
    for (let i = 0; i < 14; i++) {
      const t = i / 13, x = -2 + t * 4, y = 2.3 - Math.sin(t * Math.PI) * 0.35;
      g.add(mesh(ball(0.06, 6), toon([C.gold, C.pink, C.teal][i % 3], { emissive: [C.gold, C.pink, C.teal][i % 3], emissiveIntensity: 0.6 }), { x, y, shadow: false }));
    }
    return g;
  },
  deco_christmas_tree() {
    const g = group('deco_christmas_tree');
    [[0.8, 0.9, 0.3], [0.6, 0.8, 0.85], [0.4, 0.7, 1.35]].forEach(([r, h, y]) => g.add(mesh(cone(r, h, 9), toon(C.pine), { y: y + h / 2 })));
    g.add(mesh(new THREE.OctahedronGeometry(0.15), toon(C.gold, { emissive: C.gold, emissiveIntensity: 0.5 }), { y: 2.15 }));
    return g;
  },
  deco_bunting() {
    const g = group('deco_bunting');
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      g.add(mesh(cone(0.12, 0.25, 3), toon([C.red, C.gold, C.teal, C.pink][i % 4], { side: THREE.DoubleSide }), { x: -2 + t * 4, y: 2.2 - Math.sin(t * Math.PI) * 0.3, rx: Math.PI, sz: 0.2, shadow: false }));
    }
    return g;
  },
  deco_birthday_balloons() {
    const g = group('deco_birthday_balloons');
    [[0, 1.6, C.red], [0.3, 1.8, C.gold], [-0.3, 1.75, C.teal]].forEach(([x, y, c]) => {
      g.add(mesh(ball(0.22, 10), toon(c), { x, y, sy: 1.2 }));
      g.add(mesh(cyl(0.005, 0.005, y, 3), toon(C.white), { x: x / 2, y: y / 2, rz: -x * 0.3, shadow: false }));
    });
    return g;
  },
  hat_witch: () => group('hat_witch', mesh(cyl(0.16, 0.16, 0.02, 14), toon('#4b3463'), { y: 0.01 }), mesh(cone(0.08, 0.22, 10), toon('#4b3463'), { y: 0.12, rz: 0.2 })),
  hat_party: () => group('hat_party', mesh(cone(0.07, 0.2, 10), toon(C.teal), { y: 0.1 }), mesh(ball(0.03, 6), toon(C.gold), { y: 0.21 })),
  hat_flower_crown() {
    const g = group('hat_flower_crown', mesh(new THREE.TorusGeometry(0.1, 0.015, 5, 16), toon(C.leaf), { y: 0.02, rx: Math.PI / 2 }));
    for (let i = 0; i < 6; i++) g.add(mesh(ball(0.03, 6), toon([C.pink, C.gold, C.white][i % 3]), { x: Math.cos(i) * 0.1, y: 0.035, z: Math.sin(i) * 0.1 }));
    return g;
  },
  hat_beanie: () => group('hat_beanie', mesh(new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(C.teal), { sy: 0.9 }), mesh(ball(0.04, 6), toon(C.white), { y: 0.11 })),
  hat_bow: () => group('hat_bow', mesh(cone(0.06, 0.1, 4), toon(C.red), { x: -0.05, y: 0.04, rz: Math.PI / 2 }), mesh(cone(0.06, 0.1, 4), toon(C.red), { x: 0.05, y: 0.04, rz: -Math.PI / 2 })),
  hat_santa: () => group('hat_santa', mesh(cone(0.11, 0.22, 10), toon(C.red), { y: 0.12, rz: 0.25 }), mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 14), toon(C.white), { y: 0.02, rx: Math.PI / 2 }), mesh(ball(0.035, 6), toon(C.white), { x: -0.06, y: 0.22 })),
  hat_generic: () => group('hat_generic', mesh(cyl(0.15, 0.15, 0.02, 14), toon(C.gold), { y: 0.01 }), mesh(cyl(0.08, 0.09, 0.1, 12), toon(C.gold), { y: 0.06 }), mesh(cyl(0.092, 0.092, 0.025, 12), toon(C.red), { y: 0.03 })),
};

// ------------------------------------------------- the kit, as a library ----
const SWAYERS = /^(tree_|bush_|flowers_|grass_tuft)/;
const NO_SHADOW = /^(flowers_|grass_tuft|mushroom|stepping_stone|rock_a|cloud_|bird|hat_)/;
function prepare(root) {
  const small = NO_SHADOW.test(root.name);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(toToon) : toToon(o.material);
    o.castShadow = !small;
    o.receiveShadow = true;
  });
  // The ground (grass, sand, paths, shore) gets smooth light steps.
  if (root.name === 'island') {
    root.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material) || !o.material.isMeshToonMaterial) return;
      const g = o.material.clone();
      g.gradientMap = groundRamp();
      o.material = g;
    });
  }
}
function makeLibrary(kitRoot) {
  const kit = new Map(), made = new Map();
  if (kitRoot) {
    for (const c of kitRoot.children) {
      prepare(c);
      if (SWAYERS.test(c.name)) c.traverse((o) => { if (o.isMesh && !Array.isArray(o.material)) o.material = swaying(o.material); });
      kit.set(c.name, c);
    }
  }
  return {
    real: (name) => kit.has(name),
    proto(name) {
      if (kit.has(name)) return kit.get(name);
      if (!made.has(name)) made.set(name, (STANDIN[name] || STANDIN.place_generic)());
      return made.get(name);
    },
    // A copy standing at the origin (keeping the model's own turn and size).
    clone(name) {
      const c = this.proto(name).clone(true);
      c.position.set(0, 0, 0);
      return c;
    },
  };
}
// The first child whose name is `base` or base_N (the glTF loader makes repeated names unique).
function child(obj, base) {
  const re = new RegExp(`^${base}(_\\d+)?$`);
  let found = null;
  obj.traverse((o) => { if (!found && o !== obj && re.test(o.name)) found = o; });
  return found;
}

// --------------------------------------------------------- the ground ----
// The island's height (and what it is made of) on a grid, worked out once from its triangles, so
// the cat can follow every little hill without any ray casting.
const GROUND_KINDS = [[/water|pond|lake|sea|shallow/i, 4], [/sand|beach/i, 2], [/path|dirt|road|track|plaza/i, 3]];
const isSea = (o) => /^sea/i.test(o.name) || /^sea$/i.test((o.material && o.material.name) || '');
function groundFrom(island) {
  island.updateMatrixWorld(true);
  const box = new THREE.Box3();
  island.traverse((o) => { if (o.isMesh && !isSea(o)) box.expandByObject(o); });
  const N = 192;
  const x0 = box.min.x, z0 = box.min.z;
  const step = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / (N - 1) || 1;
  const H = new Float32Array(N * N).fill(-1e9);
  const K = new Uint8Array(N * N);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  island.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position || isSea(o)) return;
    const name = (o.material && o.material.name) || o.name || '';
    let kind = 1;
    for (const [re, k] of GROUND_KINDS) if (re.test(name) || re.test(o.name)) { kind = k; break; }
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-9) continue;
      const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - x0) / step)), i1 = Math.min(N - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / step));
      const j0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - z0) / step)), j1 = Math.min(N - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / step));
      for (let j = j0; j <= j1; j++) {
        const z = z0 + j * step;
        for (let i = i0; i <= i1; i++) {
          const x = x0 + i * step;
          const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
          const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
          const y = l1 * a.y + l2 * b.y + l3 * c.y;
          const at = j * N + i;
          if (y > H[at] + (kind === 4 ? -0.02 : 0.005)) { H[at] = y; K[at] = kind; }
        }
      }
    }
  });
  const low = box.min.y;
  const cell = (i, j) => {
    const v = H[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
    return v > -1e8 ? v : null;
  };
  const centre = new THREE.Vector3((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2);
  return {
    box, centre, low,
    radius: Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
    height(x, z) {
      const fx = (x - x0) / step, fz = (z - z0) / step;
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const h = [cell(i, j), cell(i + 1, j), cell(i, j + 1), cell(i + 1, j + 1)];
      const ok = h.filter((q) => q !== null);
      if (!ok.length) return low;
      const fill = Math.max(...ok);
      const [h00, h10, h01, h11] = h.map((q) => (q === null ? fill : q));
      return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
    },
    kind(x, z) {
      const i = Math.round((x - x0) / step), j = Math.round((z - z0) / step);
      return i < 0 || j < 0 || i >= N || j >= N ? 0 : K[j * N + i];
    },
  };
}

// ---------------------------------------------------------- the paths ----
// The path network: waypoints (wp_N) and which ones join (the island's "paths" extras). The cat
// finds its way along it with A*.
function graphFrom(island) {
  island.updateMatrixWorld(true);
  const nodes = new Map();
  island.traverse((o) => { if (/^wp_\d+$/.test(o.name)) nodes.set(o.name, o.getWorldPosition(new THREE.Vector3())); });
  const links = new Map([...nodes.keys()].map((k) => [k, new Set()]));
  const join = (p, q) => {
    if (p !== q && nodes.has(p) && nodes.has(q)) { links.get(p).add(q); links.get(q).add(p); }
  };
  const paths = Array.isArray(island.userData.paths) ? island.userData.paths : [];
  for (const chain of paths) if (Array.isArray(chain)) for (let i = 1; i < chain.length; i++) join(String(chain[i - 1]), String(chain[i]));
  if (!paths.length) {
    for (const [k, v] of nodes) {
      [...nodes].filter(([q]) => q !== k).sort((p, q) => p[1].distanceTo(v) - q[1].distanceTo(v)).slice(0, 2).forEach(([q]) => join(k, q));
    }
  }
  const edges = [];
  for (const [p, qs] of links) for (const q of qs) if (p < q) edges.push([p, q]);
  const flat = (v) => new THREE.Vector2(v.x, v.z);
  function astar(from, to) {
    if (from === to) return [from];
    const open = new Set([from]), came = new Map(), g = new Map([[from, 0]]);
    const f = new Map([[from, nodes.get(from).distanceTo(nodes.get(to))]]);
    while (open.size) {
      let cur = null;
      for (const k of open) if (cur === null || f.get(k) < f.get(cur)) cur = k;
      if (cur === to) {
        const out = [cur];
        while (came.has(out[0])) out.unshift(came.get(out[0]));
        return out;
      }
      open.delete(cur);
      for (const nb of links.get(cur)) {
        const t = g.get(cur) + nodes.get(cur).distanceTo(nodes.get(nb));
        if (!g.has(nb) || t < g.get(nb)) {
          came.set(nb, cur);
          g.set(nb, t);
          f.set(nb, t + nodes.get(nb).distanceTo(nodes.get(to)));
          open.add(nb);
        }
      }
    }
    return null;
  }
  // The closest point on the path network to (x, z): which edge, and where on it.
  function onPath(v) {
    let best = null;
    const p = flat(v);
    for (const [ka, kb] of edges) {
      const a = flat(nodes.get(ka)), b = flat(nodes.get(kb)), ab = b.clone().sub(a);
      const t = clamp(p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
      const q = a.clone().addScaledVector(ab, t), dist = q.distanceTo(p);
      if (!best || dist < best.dist) best = { ka, kb, t, dist, at: new THREE.Vector3(q.x, 0, q.y) };
    }
    return best;
  }
  const length = (pts) => pts.slice(1).reduce((s, v, i) => s + v.distanceTo(pts[i]), 0);
  return {
    nodes, edges,
    distance(v) {
      const e = onPath(v);
      return e ? e.dist : 1e9;
    },
    nearest(v) {
      let best = null, bd = 1e9;
      for (const [k, p] of nodes) { const dd = Math.hypot(p.x - v.x, p.z - v.z); if (dd < bd) { bd = dd; best = k; } }
      return best;
    },
    // The way from a to b (flat points): onto the nearest path, along it, and off again.
    route(a, b) {
      const s = onPath(a), e = onPath(b);
      if (!s || !e) return [a.clone(), b.clone()];
      if ((s.ka === e.ka && s.kb === e.kb) || a.distanceTo(b) < 3) return [a.clone(), s.at, e.at, b.clone()];
      let best = null;
      for (const p of [s.ka, s.kb]) for (const q of [e.ka, e.kb]) {
        const mid = astar(p, q);
        if (!mid) continue;
        const pts = [a.clone(), s.at, ...mid.map((k) => nodes.get(k).clone()), e.at, b.clone()];
        const len = length(pts);
        if (!best || len < best.len) best = { pts, len };
      }
      return best ? best.pts : [a.clone(), b.clone()];
    },
    // A walk of a few hops from the waypoint nearest v (for a little stroll).
    stroll(v, hops, rnd) {
      let k = this.nearest(v);
      const out = [k];
      for (let i = 0; i < hops && k; i++) {
        const next = [...links.get(k)].filter((q) => !out.includes(q));
        if (!next.length) break;
        k = next[Math.floor(rnd() * next.length)];
        out.push(k);
      }
      return out.map((q) => nodes.get(q).clone());
    },
  };
}

// --------------------------------------------------- places on the slots ----
const KINDS = [
  [/cafe|coffee|tea/, 'cafe'], [/observ|star|telescope|planet/, 'observatory'], [/train|station|rail/, 'train_station'],
  [/potter|clay|ceramic/, 'pottery'], [/librar|book/, 'library'], [/music|band|piano|concert|song/, 'music'],
  [/aquarium|fish|reef/, 'aquarium'], [/workshop|tool|maker|invent|lab/, 'workshop'], [/lighthouse|harbour|harbor/, 'lighthouse'],
  [/bake|bread|cake|pie/, 'bakery'], [/cinema|film|movie|theatre|theater/, 'cinema'], [/museum|history/, 'museum'],
  [/tree ?house|tree_house/, 'treehouse'], [/weather|wind|rain/, 'weather_station'],
];
const modelFor = (kind) => {
  for (const [re, name] of KINDS) if (re.test(kind)) return `place_${name}`;
  return 'place_generic';
};

function slotsFrom(island, graph) {
  const slots = new Map();
  island.updateMatrixWorld(true);
  island.traverse((o) => {
    if (!/^slot_(room|gallery|outside|\d+)$/.test(o.name)) return;
    const door = typeof o.userData.door === 'string' && graph.nodes.has(o.userData.door) ? o.userData.door : null;
    slots.set(o.name, { name: o.name, pos: o.getWorldPosition(new THREE.Vector3()), door });
  });
  return slots;
}

// Which slot each place gets: home places have their own; the cat's own places pick a numbered
// slot from their id (the same place always lands on the same slot).
function assignSlots(places, slots, graph, ground) {
  const out = new Map();
  const numbered = [...slots.values()].filter((s) => /^slot_\d+$/.test(s.name)).sort((p, q) => Number(p.name.slice(5)) - Number(q.name.slice(5)));
  const taken = new Set();
  const extra = (id) => {
    // More places than slots: a new site on a quiet bit of the island, by the nearest path.
    const rnd = seeded(hashOf(id));
    for (let tries = 0; tries < 60; tries++) {
      const a = rnd() * Math.PI * 2, r = ground.radius * (0.45 + rnd() * 0.3);
      const pos = new THREE.Vector3(ground.centre.x + Math.sin(a) * r, 0, ground.centre.z + Math.cos(a) * r);
      const near = [...slots.values(), ...out.values()].some((s) => s.pos.distanceTo(pos) < 7.5);
      if (!near && ground.kind(pos.x, pos.z) !== 4 || tries === 59) {
        pos.y = ground.height(pos.x, pos.z);
        return { name: `extra_${id}`, pos, door: graph.nearest(pos) };
      }
    }
    return null;
  };
  for (const id of PLACES) {
    const s = slots.get(`slot_${id}`);
    if (s) out.set(id, s);
  }
  for (const p of places.filter((q) => !q.home).slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let slot = null;
    if (numbered.length) {
      const start = hashOf(p.id) % numbered.length;
      for (let i = 0; i < numbered.length && !slot; i++) {
        const s = numbered[(start + i) % numbered.length];
        if (!taken.has(s.name)) { slot = s; taken.add(s.name); }
      }
    }
    out.set(p.id, slot || extra(p.id));
  }
  for (const id of PLACES) if (!out.has(id)) out.set(id, extra(id));
  return out;
}

// ------------------------------------------------- scattering the props ----
// One InstancedMesh per part of a prop, so hundreds of trees and flowers cost a few draw calls.
function instanced(proto, mats) {
  proto.updateMatrixWorld(true);
  const inv = proto.matrixWorld.clone().invert();
  const out = new THREE.Group();
  proto.traverse((o) => {
    if (!o.isMesh || !mats.length) return;
    const local = inv.clone().multiply(o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
    const m = new THREE.Matrix4();
    mats.forEach((w, i) => im.setMatrixAt(i, m.multiplyMatrices(w, local)));
    im.castShadow = o.castShadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    out.add(im);
  });
  return out;
}
const SCATTER = [
  // name, how many, nearest a path may be, likes the path edge?, may sit on sand?, size range
  ['tree_round_a', 30, 2.6, false, false, [0.85, 1.25]],
  ['tree_round_b', 24, 2.6, false, false, [0.85, 1.2]],
  ['tree_pine', 20, 2.6, false, false, [0.8, 1.3]],
  ['tree_blossom', 14, 2.4, true, false, [0.8, 1.15]],
  ['bush_a', 34, 1.4, true, false, [0.7, 1.2]],
  ['bush_b', 26, 1.4, true, false, [0.7, 1.15]],
  ['rock_a', 16, 1.4, false, true, [0.6, 1.4]],
  ['rock_b', 16, 1.2, false, true, [0.6, 1.3]],
  ['flowers_a', 70, 1.0, true, false, [0.8, 1.3]],
  ['flowers_b', 56, 1.0, true, false, [0.8, 1.3]],
  ['grass_tuft', 300, 0.95, true, true, [0.7, 1.4]],
  ['mushroom', 22, 1.2, false, false, [0.7, 1.3]],
];
function scatter(scene, lib, ground, graph, keepOut) {
  const rnd = seeded(20261113);
  const placed = [];
  const free = (x, z, gap, big) => !keepOut.some((k) => (big || !k.view) && Math.hypot(k.x - x, k.z - z) < k.r + gap);
  for (const [name, count, pathGap, edge, sandOk, [s0, s1]] of SCATTER) {
    const mats = [];
    const big = /^tree_/.test(name);
    for (let tries = 0; mats.length < count && tries < count * 40; tries++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * ground.radius * 0.97;
      const x = ground.centre.x + Math.sin(a) * r, z = ground.centre.z + Math.cos(a) * r;
      const kind = ground.kind(x, z);
      if (kind === 0 || kind === 4 || kind === 3 || (kind === 2 && !sandOk) || (r > ground.radius * 0.85 && !sandOk)) continue;
      const dp = graph.distance(new THREE.Vector3(x, 0, z));
      if (dp < pathGap) continue;
      // More little things near the paths, so walking around is the prettiest part.
      const want = edge ? 0.25 + 0.75 * Math.exp(-(dp - pathGap) / 3) : 0.55 + 0.45 * smooth(2, 9, dp);
      if (rnd() > want) continue;
      if (!free(x, z, big ? 1.4 : 0.4, big)) continue;
      if (big && placed.some((p) => Math.hypot(p.x - x, p.z - z) < 2.6)) continue;
      const s = s0 + rnd() * (s1 - s0);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, ground.height(x, z) - 0.03, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2), new THREE.Vector3(s, s, s));
      mats.push(m);
      if (big) placed.push({ x, z });
      if (big || /^(bush|rock)/.test(name)) keepOut.push({ x, z, r: big ? 0.9 : 0.5 });
    }
    scene.add(instanced(lib.proto(name), mats));
  }
}

// A place's model, standing on its slot with its door toward the path.
function standOn(obj, slot, graph, ground) {
  const holder = new THREE.Group();
  const pos = slot.pos.clone();
  pos.y = Number.isFinite(pos.y) ? pos.y : ground.height(pos.x, pos.z);
  holder.position.copy(pos);
  const door = slot.door ? graph.nodes.get(slot.door) : null;
  if (door && Math.hypot(door.x - pos.x, door.z - pos.z) > 0.3) holder.rotation.y = Math.atan2(door.x - pos.x, door.z - pos.z);
  holder.add(obj);
  holder.updateMatrixWorld(true);
  return holder;
}
// Size of a model on the ground (in its own frame, before it is turned).
function footprint(obj, skip) {
  const box = new THREE.Box3();
  obj.updateMatrixWorld(true);
  const inv = obj.parent ? obj.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const m = new THREE.Matrix4();
  obj.traverse((o) => {
    if (!o.isMesh || (skip && skip(o))) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-1.5, 0, -1.5), new THREE.Vector3(1.5, 3, 1.5));
  return box;
}
function frontOf(holder, box) {
  const door = child(holder, 'door');
  const v = door ? door.getWorldPosition(new THREE.Vector3()) : holder.localToWorld(new THREE.Vector3(0, 0, box.max.z + 0.5));
  const out = holder.localToWorld(new THREE.Vector3(0, 0, 1)).sub(holder.position).setY(0).normalize();
  return { door: v, out };
}

// A sign with words on it (a place's name, or the sketch of an idea).
function signWith(lib, text, sketch) {
  const g = new THREE.Group();
  g.add(lib.clone('signpost'));
  const top = footprint(g).max.y;
  const b = board(text, 1.1, sketch ? 0.85 : 0.36, sketch ? { w: 512, h: 400, size: 54, sketch } : { size: 70 });
  b.position.set(0, Math.max(0.9, top - (sketch ? 0.45 : 0.2)), 0.09);
  g.add(b);
  return g;
}

function washTexture(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const rnd = seeded(hashOf(seed));
  g.fillStyle = '#fff4e2';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = ['#f6b48a', '#9fd0c7', '#f3d27a', '#c9b2e6', '#f4a3b5', '#a8cf86'][i % 6];
    g.globalAlpha = 0.55;
    g.beginPath();
    g.ellipse(rnd() * 128, rnd() * 128, 14 + rnd() * 30, 10 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// A picture from the site (only ../art/... style paths, and only over http(s): pictures opened
// from the disk can't be used by WebGL).
function pictureInto(material, path, fit, redraw) {
  if (!path || !window.location.protocol.startsWith('http')) return;
  new THREE.TextureLoader().load(path, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    material.map = tex;
    material.color.set('#ffffff');
    material.needsUpdate = true;
    if (fit && tex.image && tex.image.width) fit(tex.image.width / tex.image.height, tex);
    redraw();
  }, undefined, () => redraw());
}

// Wish models: toon-shaded like the rest of the island (the outline comes from the same final
// pass), at a free spot near the place asked for - never on a path, a building or another thing.
function placeWishes(scene, models, info, ground, graph, keepOut) {
  const ring = seeded(4242);
  for (const { w, gltf } of models) {
    const obj = gltf.scene;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(toToon) : toToon(o.material);
      o.castShadow = true;
      o.receiveShadow = true;
    });
    const holder = new THREE.Group();
    holder.add(obj);
    const box = footprint(obj);
    const tall = Math.max(0.01, box.max.y - box.min.y);
    const s = Math.min(w.scale, 8 / tall);                      // nothing taller than a building
    holder.scale.setScalar(s);
    const r = Math.max(0.5, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2 * s);
    const at = info.get(w.near) || info.get(w.place);
    const centre = at ? at.holder.position : ground.centre;
    const start = at ? at.radius + r + 1.2 : r + 2;
    let spot = null;
    for (let dist = start; !spot && dist < start + 16; dist += 1) {
      const a0 = ring() * Math.PI * 2;
      for (let i = 0; i < 12 && !spot; i++) {
        const a = a0 + i / 12 * Math.PI * 2, x = centre.x + Math.sin(a) * dist, z = centre.z + Math.cos(a) * dist;
        const kind = ground.kind(x, z);
        if (kind === 0 || kind === 3 || kind === 4) continue;          // not in the sea or on a path
        if (Math.hypot(x - ground.centre.x, z - ground.centre.z) > ground.radius * 0.88) continue;
        if (graph.distance(new THREE.Vector3(x, 0, z)) < r + 1.2) continue;
        if (keepOut.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + r)) continue;
        spot = { x, z };
      }
    }
    if (!spot) continue;
    holder.position.set(spot.x, ground.height(spot.x, spot.z) - box.min.y * s, spot.z);
    holder.rotation.y = Math.atan2(centre.x - spot.x, centre.z - spot.z) + Math.PI;   // facing away from the place
    holder.name = 'wish';
    scene.add(holder);
    keepOut.push({ x: spot.x, z: spot.z, r: r + 0.4 });
  }
}

// ------------------------------------------------------ the whole world ----
function buildWorld(scene, d, lib, redraw, wishModels = []) {
  const island = lib.proto('island');
  scene.add(island);
  const ground = groundFrom(island);
  const graph = graphFrom(island);
  const slots = slotsFrom(island, graph);
  const bySlot = assignSlots(d.places, slots, graph, ground);
  const night = d.time.part === 'night' || d.time.part === 'dusk';
  const info = new Map();
  const keepOut = [];
  const lights = [];          // where lamps glow at night
  const floors = [];          // buildings the cat can walk inside
  const clouds = new THREE.Group(), birds = [], bobbers = [];
  const place = (name, at, ry = 0, s = 1) => {
    const o = lib.clone(name);
    const h = new THREE.Group();
    h.position.copy(at);
    h.rotation.y = ry;
    h.scale.setScalar(s);
    h.add(o);
    scene.add(h);
    return h;
  };
  const onGround = (x, z) => new THREE.Vector3(x, ground.height(x, z), z);

  for (const p of d.places) {
    const slot = bySlot.get(p.id);
    if (!slot) continue;
    let obj, inside = false, kind = p.kind;
    if (p.id === 'room') { obj = lib.clone('house_room'); inside = true; }
    else if (p.id === 'gallery') { obj = lib.clone('gallery_building'); inside = true; }
    else if (p.id === 'outside') obj = new THREE.Group();
    else obj = lib.clone(modelFor(kind));
    const holder = standOn(obj, slot, graph, ground);
    scene.add(holder);
    const box = p.id === 'outside' ? new THREE.Box3(new THREE.Vector3(-3.4, 0, -3.4), new THREE.Vector3(3.4, 1, 3.4))
      : footprint(obj, (o) => /cutaway/.test(o.parent && o.parent.name) || /cutaway/.test(o.name));
    const front = frontOf(holder, box);
    const radius = Math.max(1.5, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2);
    const known = modelFor(kind) !== 'place_generic' || p.home;
    // Keep trees out of the view in front of each place (where the camera looks from).
    for (const s of [-0.35, 0, 0.35]) {
      for (const dist of [4, 7, 10, 13]) {
        const a = Math.atan2(front.out.x, front.out.z) + s;
        keepOut.push({ x: holder.position.x + Math.sin(a) * (radius + dist), z: holder.position.z + Math.cos(a) * (radius + dist), r: 2.2, view: true });
      }
    }
    const pi = { id: p.id, p, holder, box, radius, front, inside, height: box.max.y, stand: null, cutaway: child(holder, 'cutaway') };
    info.set(p.id, pi);
    keepOut.push({ x: holder.position.x, z: holder.position.z, r: radius + 1.2 });
    // How far along it is: an idea is a sign with a sketch; a plan is string pegged out on the
    // ground; a building site has scaffolding round the part already built.
    if (!p.home && p.stage !== 'done') {
      obj.visible = p.stage === 'building';
      const w = box.max.x - box.min.x, dp = box.max.z - box.min.z;
      if (p.stage === 'building') {
        const level = new THREE.Plane(new THREE.Vector3(0, -1, 0), holder.position.y + 0.25 + box.max.y * Math.max(0.12, p.progress));
        obj.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          o.material.clippingPlanes = [level];
          o.material.clipShadows = true;
          o.material.side = THREE.DoubleSide;
        });
        const sc = lib.clone('scaffold');
        const sb = footprint(sc);
        sc.scale.set((w + 0.6) / Math.max(0.5, sb.max.x - sb.min.x), Math.max(0.6, box.max.y * (p.progress + 0.25)) / Math.max(0.5, sb.max.y),
          (dp + 0.6) / Math.max(0.5, sb.max.z - sb.min.z));
        holder.add(sc);
        const crate = lib.clone('crate');
        crate.position.set(box.max.x + 0.6, 0, box.max.z - 0.4);
        holder.add(crate);
        const barrel = lib.clone('barrel');
        barrel.position.set(box.min.x - 0.5, 0, box.max.z - 0.2);
        holder.add(barrel);
      } else {
        const sign = signWith(lib, p.name, p.stage === 'idea' ? p.kind + p.id : null);
        sign.position.set(p.stage === 'idea' ? 0 : box.max.x * 0.6, 0, box.max.z * 0.6);
        holder.add(sign);
        if (p.stage === 'planned') {
          const pts = [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.max.x, box.max.z], [box.min.x, box.max.z], [box.min.x, box.min.z]];
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.32, z))),
            new THREE.LineBasicMaterial({ color: d.cat.look.outline }));
          holder.add(line);
          for (const [x, z] of pts.slice(0, 4)) holder.add(mesh(cyl(0.035, 0.035, 0.42, 5), toon(C.wood), { x, y: 0.2, z }));
        }
      }
    } else if (!known) {
      const sign = signWith(lib, p.name, null);
      sign.position.set(box.max.x * 0.55 + 0.5, 0, box.max.z + 0.6);
      sign.rotation.y = 0.35;
      holder.add(sign);
    }
    if (inside) {
      const meshes = [];
      obj.traverse((o) => { if (o.isMesh && !(pi.cutaway && pi.cutaway !== o && isUnder(o, pi.cutaway))) meshes.push(o); });
      floors.push({ meshes, holder, box });
    }
  }

  // The garden (outside): a fence round flower beds and whatever the cat has planted.
  const garden = info.get('outside');
  if (garden) {
    const g = garden.holder;
    for (let i = 0; i < 8; i++) {
      if (i === 0) continue;                                     // the gap is the gate, toward the path
      const a = i / 8 * Math.PI * 2;
      const f = lib.clone('fence_segment');
      const fb = footprint(f);
      f.scale.x = 2.6 / Math.max(0.5, fb.max.x - fb.min.x);
      f.position.set(Math.sin(a) * 3.4, 0, Math.cos(a) * 3.4);
      f.rotation.y = a;                                         // along the circle, not across it
      g.add(f);
    }
    const plants = d.garden.length ? d.garden : [{ stage: 'flower' }, { stage: 'flower' }, { stage: 'grown' }, { stage: 'sprout' }];
    plants.slice(0, 12).forEach((pl, i) => {
      const a = (i + 0.5) / Math.min(12, plants.length) * Math.PI * 2, r = 1.2 + (i % 2) * 0.9;
      const name = { seed: 'grass_tuft', sprout: 'grass_tuft', grown: 'bush_b', flower: i % 2 ? 'flowers_a' : 'flowers_b' }[pl.stage];
      const o = lib.clone(name);
      o.position.set(Math.sin(a) * r, 0, Math.cos(a) * r - 0.3);
      o.scale.setScalar(pl.stage === 'seed' ? 0.5 : pl.stage === 'sprout' ? 0.8 : 1);
      g.add(o);
    });
    const b = lib.clone('bench');
    b.position.set(0, 0, -2.3);
    g.add(b);
    garden.radius = 3.6;
  }

  // Inside the cottage: a round bed for naps, a rug, and some of the things in the room.
  const room = info.get('room');
  if (room) {
    const h = room.holder, inner = innerOf(room);
    const bed = new THREE.Group();
    bed.add(mesh(new THREE.TorusGeometry(0.42, 0.14, 8, 20), toon('#b18cc9'), { y: 0.14, rx: Math.PI / 2 }));
    bed.add(mesh(cyl(0.42, 0.42, 0.08, 18), toon('#efdcf5'), { y: 0.06 }));
    bed.position.set(inner.x1 - 0.6, inner.y, inner.z0 + 0.6);
    h.add(bed);
    room.bed = h.localToWorld(bed.position.clone());
    if (!lib.real('house_room')) h.add(mesh(cyl(1.0, 1.0, 0.02, 24), toon('#f5c9a8'), { x: 0.2, y: inner.y + 0.01, z: 0.4, shadow: false }));
    // Its things (hats and clothes are worn, food is eaten: only furniture and toys stand about).
    const things = d.items.filter((it) => !/^(hat|accessory|food|treat|supply|clothes|wear)/.test(it.kind)
      && !(it.id === 'rug' && lib.real('house_room')));                 // the cottage has its own rug
    things.slice(0, 6).forEach((it, i) => {
      const [name, s] = roomProp(lib, it);
      const o = lib.clone(name);
      o.scale.setScalar(s);
      // Along the left wall, then the right wall by the bed (the stove nook is at the back left).
      const spots = [[inner.x0 + 0.3, 0.0], [inner.x0 + 0.3, 0.6], [inner.x0 + 0.3, 1.2], [inner.x1 - 0.3, 0.95], [inner.x1 - 0.3, 0.45], [inner.x0 + 0.3, 1.7]];
      const [x, zf] = spots[i];
      o.position.set(x, inner.y, inner.z0 + 0.4 + zf * (inner.z1 - inner.z0 - 0.4) / 1.7);
      o.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;            // backs to the wall, facing the room
      h.add(o);
    });
  }

  // The gallery: the cat's chosen pictures in the frames. They are drawn unlit (like a lit
  // gallery wall), so the awning's shade and the night don't hide the cat's own art.
  const gal = info.get('gallery');
  if (gal) {
    d.hung.forEach((hung, i) => {
      const at = child(gal.holder, `frame_${i + 1}`);
      if (!at) return;
      // The kit's frames say their size; the stand-in ones get a wooden edge of their own.
      const given = Array.isArray(at.userData.size) ? Number(at.userData.size[0]) : 0;
      const size = given > 0.1 && given < 3 ? given : 0.72;
      const paper = new THREE.MeshBasicMaterial({ color: '#fff6e8' });
      const pic = mesh(new THREE.PlaneGeometry(size, size), paper, { z: 0.02, shadow: false });
      at.add(pic);
      if (!given) at.add(mesh(roundedBox(size + 0.14, size + 0.14, 0.05, 0.03), toon(['#c38d5c', '#9474b0', '#e7a15c', '#6cc4b8'][i % 4]), { z: -0.005 }));
      pictureInto(paper, hung.image, (aspect) => pic.scale.set(aspect >= 1 ? 1 : aspect, aspect >= 1 ? 1 / aspect : 1, 1), redraw);
    });
  }

  // Painted walls.
  for (const m of d.murals) {
    const pi = info.get(m.place);
    if (!pi) continue;
    const b = pi.box, g = new THREE.Group();
    let w = Math.min(1.5, (b.max.x - b.min.x) * 0.45), hgt = w * 0.7, y = Math.min(1.4, Math.max(0.8, b.max.y * 0.42));
    const indoor = m.place === 'room' && m.wall !== 'south';
    if (indoor) {
      // In the cottage: on the inside of the wall (you see it with the roof lifted off), below
      // the windows and clear of the stove and the bed.
      const I = innerOf(pi);
      w = 1.05;
      hgt = w * 0.7;
      y = I.y + 0.95;
      if (m.wall === 'north') g.position.set(0.05, 0, I.z0 - 0.07);
      else if (m.wall === 'east') g.position.set(I.x1 + 0.07, 0, 0.85), g.rotation.y = -Math.PI / 2;
      else g.position.set(I.x0 - 0.07, 0, 0.85), g.rotation.y = Math.PI / 2;
    } else if (m.place === 'outside') { g.position.set(2.2, 0, 1.4); g.add(mesh(cyl(0.04, 0.04, 1.6, 5), toon(C.wood), { y: 0.8, z: -0.05 })); }
    else if (m.wall === 'north') g.position.set(0, 0, b.min.z - 0.04), g.rotation.y = Math.PI;
    else if (m.wall === 'east') g.position.set(b.max.x + 0.04, 0, 0), g.rotation.y = Math.PI / 2;
    else if (m.wall === 'west') g.position.set(b.min.x - 0.04, 0, 0), g.rotation.y = -Math.PI / 2;
    else g.position.set((b.max.x - w / 2) * 0.8, 0, b.max.z + 0.04);
    const paint = new THREE.MeshToonMaterial({ map: washTexture(m.image || m.place + m.wall), gradientMap: ramp() });
    const plane = mesh(new THREE.PlaneGeometry(w, hgt), paint, { y: m.place === 'outside' ? 1.1 : y, shadow: false });
    g.add(plane);
    pictureInto(paint, m.image, (aspect, tex) => {
      const want = w / hgt;
      if (aspect > want) { tex.repeat.set(want / aspect, 1); tex.offset.set((1 - want / aspect) / 2, 0); }
      else { tex.repeat.set(1, aspect / want); tex.offset.set(0, (1 - aspect / want) / 2); }
    }, redraw);
    pi.holder.add(g);
  }

  // Where the cat stands at each place: inside the cottage and the gallery, in the middle of the
  // garden, at the front door of everything else (or by the sign of an idea).
  for (const pi of info.values()) {
    if (pi.id === 'room') {
      const inner = innerOf(pi);
      pi.stand = pi.holder.localToWorld(new THREE.Vector3((inner.x0 + inner.x1) / 2 + 0.3, inner.y, (inner.z0 + inner.z1) / 2 + 0.3));
    } else if (pi.id === 'gallery') {
      pi.stand = pi.holder.localToWorld(new THREE.Vector3(0, 0, (pi.box.min.z + pi.box.max.z) / 2 + 0.2));
    } else if (pi.id === 'outside') {
      pi.stand = pi.holder.localToWorld(new THREE.Vector3(0.4, 0, 0.6));
    } else {
      pi.stand = pi.front.door.clone().addScaledVector(pi.front.out, 0.7);
    }
    pi.stand.y = ground.height(pi.stand.x, pi.stand.z);
    // A path of stepping stones from the door to the main path.
    if (pi.id !== 'outside') {
      const to = graph.distance(pi.front.door) > 1.6 ? graph.route(pi.front.door, pi.front.door)[1] : null;
      if (to) {
        const n = Math.floor(pi.front.door.distanceTo(new THREE.Vector3(to.x, pi.front.door.y, to.z)) / 0.75);
        for (let i = 1; i < n; i++) {
          const t = i / n, x = pi.front.door.x + (to.x - pi.front.door.x) * t, z = pi.front.door.z + (to.z - pi.front.door.z) * t;
          place('stepping_stone', onGround(x, z), i * 1.3, 0.9);
        }
      }
    }
  }

  // Lamp posts along the paths, benches by some of the sitting spots.
  const rnd = seeded(77);
  const lamps = [];
  for (const [ka, kb] of graph.edges) {
    const a = graph.nodes.get(ka), b = graph.nodes.get(kb), len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.floor(len / 9);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1), side = (lamps.length % 2) ? 1 : -1;
      const nx = -(b.z - a.z) / len * side, nz = (b.x - a.x) / len * side;
      const x = a.x + (b.x - a.x) * t + nx * 1.45, z = a.z + (b.z - a.z) * t + nz * 1.45;
      if (keepOut.some((k) => Math.hypot(k.x - x, k.z - z) < k.r) || lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 5)) continue;
      lamps.push({ x, z });
      const h = place('lamp_post', onGround(x, z), rnd() * 6);
      keepOut.push({ x, z, r: 0.6 });
      h.updateMatrixWorld(true);
      const l = child(h, 'light');
      lights.push(l ? l.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(x, h.position.y + 2.2, z));
    }
  }
  const spots = [], benches = [];
  island.traverse((o) => { if (/^spot_\d+$/.test(o.name)) spots.push(o.getWorldPosition(new THREE.Vector3())); });
  spots.sort((p, q) => p.x - q.x || p.z - q.z);
  spots.forEach((v, i) => {
    v.y = ground.height(v.x, v.z);
    keepOut.push({ x: v.x, z: v.z, r: 0.8 });
    if (i % 2) return;
    // A bench just behind the spot, facing the path: the cat sits in front of it, not in it.
    const near = graph.route(v, v)[1];
    const ry = near ? Math.atan2(near.x - v.x, near.z - v.z) : 0;
    const bx = v.x - Math.sin(ry) * 0.95, bz = v.z - Math.cos(ry) * 0.95;
    place('bench', onGround(bx, bz), ry, BENCH_SCALE);
    // Where Bao sits: on the seat, a little forward of the backrest, facing the path.
    const sx = bx + Math.sin(ry) * 0.08, sz = bz + Math.cos(ry) * 0.08;
    benches.push({ spot: v, seat: new THREE.Vector3(sx, ground.height(sx, sz) + BENCH_SEAT * BENCH_SCALE, sz), ry });
    keepOut.push({ x: bx, z: bz, r: 1 });
  });

  // Decorations for the season, around the cottage and the paths.
  const decoAt = (k) => {
    const base = room || info.values().next().value;
    const a = (k % 2 ? 1 : -1) * (0.9 + 0.35 * Math.floor(k / 2));
    const v = base.front.door.clone().addScaledVector(base.front.out, 0.9);
    const side = new THREE.Vector3(base.front.out.z, 0, -base.front.out.x);
    v.addScaledVector(side, a * 1.4);
    return onGround(v.x, v.z);
  };
  let k = 0;
  const decos = d.decorations.concat(d.time.birthday ? ['birthday_balloons'] : []);
  for (const deco of decos) {
    const name = /pumpkin|halloween/.test(deco) ? 'deco_pumpkin' : /fairy|light/.test(deco) ? 'deco_fairy_lights'
      : /christmas|xmas|tree/.test(deco) ? 'deco_christmas_tree' : /balloon|birthday/.test(deco) ? 'deco_birthday_balloons' : 'deco_bunting';
    if (name === 'deco_fairy_lights' && room) {
      const f = lib.clone(name);
      f.position.set(0, Math.max(0, room.box.max.y - 2.6) * 0.4, room.box.max.z + 0.12);
      room.holder.add(f);
      continue;
    }
    if (name === 'deco_bunting') {
      // An arch over the cottage's path, just out from the door (never in front of the
      // gallery's pictures).
      const base = room || info.values().next().value;
      const v = base.front.door.clone().addScaledVector(base.front.out, 1.9);
      place(name, onGround(v.x, v.z), Math.atan2(base.front.out.x, base.front.out.z));
      keepOut.push({ x: v.x, z: v.z, r: 2 });
      continue;
    }
    for (let i = 0; i < (name === 'deco_pumpkin' ? 3 : 1); i++) {
      const v = decoAt(k++);
      place(name, v, rnd() * 6, name === 'deco_pumpkin' ? 0.8 + rnd() * 0.5 : 1);
      keepOut.push({ x: v.x, z: v.z, r: 0.6 });
    }
  }

  placeWishes(scene, wishModels, info, ground, graph, keepOut);
  scatter(scene, lib, ground, graph, keepOut);

  // The sea all round, a boat, clouds and birds.
  const seaLevel = typeof island.userData.sea_level === 'number' ? island.userData.sea_level : Math.max(ground.low + 0.05, -0.6);
  const sea = mesh(new THREE.CircleGeometry(ground.radius * 9, 64), new THREE.MeshToonMaterial({ color: '#8cc9de', gradientMap: ramp(), name: 'sea' }),
    { x: ground.centre.x, y: seaLevel - 0.03, z: ground.centre.z, rx: -Math.PI / 2, shadow: false });
  sea.receiveShadow = false;
  scene.add(sea);
  const boatAt = new THREE.Vector3(ground.centre.x + ground.radius * 0.72, sea.position.y, ground.centre.z + ground.radius * 0.95);
  const boat = place('boat', boatAt, 0.6);
  bobbers.push({ obj: boat, y: boatAt.y, phase: 0 });
  const cloudy = ['cloudy', 'rain', 'storm'].includes(d.weather.kind);
  const crnd = seeded(9);
  for (let i = 0; i < (cloudy ? 14 : 7); i++) {
    const a = i / (cloudy ? 14 : 7) * Math.PI * 2 + crnd(), r = ground.radius * (0.6 + crnd() * 0.9);
    const c = lib.clone(i % 2 ? 'cloud_a' : 'cloud_b');
    c.position.set(Math.sin(a) * r, 16 + crnd() * 7, Math.cos(a) * r);
    c.scale.setScalar(1.3 + crnd() * 1.6);
    c.rotation.y = crnd() * 6;
    c.traverse((o) => { if (o.isMesh) { o.castShadow = false; if (cloudy) o.material = toon(d.weather.kind === 'storm' ? '#a9a6b8' : '#dcdbe4'); } });
    clouds.add(c);
  }
  clouds.position.copy(ground.centre);
  scene.add(clouds);
  if (!['rain', 'storm'].includes(d.weather.kind) && d.time.part !== 'night') {
    for (let i = 0; i < 2; i++) {
      const b = lib.clone('bird');
      scene.add(b);
      birds.push({ obj: b, r: 9 + i * 6, h: 9 + i * 3, speed: 0.22 + i * 0.07, phase: i * 2.2 });
    }
  }
  return { ground, graph, info, lights, floors, clouds, birds, bobbers, sea, spots, benches };
}
// A room item -> [kit model, size]: furniture and toys get cosy props, anything unknown a gift box.
const ROOM_PROPS = [
  [/pumpkin/, 'deco_pumpkin', 0.7], [/cushion|beanbag|bean_bag|bed|blanket|pillow|sofa|nest/, 'prop_cushion', 1],
  [/fairy/, 'deco_fairy_lights', 1], [/lamp|light|candle|lantern/, 'prop_lamp', 0.9],
  [/book|shelf|nook|library|desk|globe/, 'prop_bookshelf', 0.9], [/scratch|cat_tree|tower/, 'prop_scratching_post', 1],
  [/plant|flower|cactus|fern|tree/, 'prop_plant_pot', 1], [/fish|aquarium|tank|bowl/, 'prop_fish_bowl', 1],
  [/toy|yarn|ball|mouse|wand|feather|dice|block|puzzle|train|rocket|plush|tunnel|bubble/, 'prop_toy_basket', 1],
];
function roomProp(lib, it) {
  const k = `${it.kind} ${it.id}`;
  for (const [re, name, s] of ROOM_PROPS) if (re.test(k) && lib.real(name)) return [name, s];
  return lib.real('prop_gift') ? ['prop_gift', 1] : ['crate', 0.45];
}
function isUnder(o, top) {
  for (let p = o.parent; p; p = p.parent) if (p === top) return true;
  return false;
}
// The cottage's floor space (in its own frame): inside the walls, with a margin.
function innerOf(pi) {
  if (pi.inner) return pi.inner;
  const b = pi.box, m = 0.55;
  const mark = child(pi.holder, 'interior');
  const floorY = mark ? pi.holder.worldToLocal(mark.getWorldPosition(new THREE.Vector3())).y : (() => {
    const ray = new THREE.Raycaster(pi.holder.localToWorld(new THREE.Vector3((b.min.x + b.max.x) / 2, 1.2, (b.min.z + b.max.z) / 2)), new THREE.Vector3(0, -1, 0), 0, 3);
    const hits = ray.intersectObject(pi.holder, true).filter((h) => !(pi.cutaway && isUnder(h.object, pi.cutaway)));
    return hits.length ? pi.holder.worldToLocal(hits[0].point.clone()).y : 0.1;
  })();
  pi.inner = { x0: b.min.x + m, x1: b.max.x - m, z0: b.min.z + m, z1: b.max.z - m, y: floorY };
  return pi.inner;
}

// ------------------------------------------------------------- the cat ----
// The cat is drawn a little bigger than life next to the buildings, so it is easy to spot.
const BAO_SCALE = 1.6;
// Benches are a little bigger than the kit's, so round Bao fits on the seat (seat top 0.47 m in the kit).
const BENCH_SCALE = 1.25, BENCH_SEAT = 0.47;
const STRIDE = 0.35;                        // metres per walk cycle, at the model's own size
const ONCE = new Set(['stretch', 'happy']);

// From models/bao.glb: recoloured from world.json's look, toon-shaded, with a plum outline.
function baoFromModel(gltf, look) {
  const root = gltf.scene;
  const colours = {
    body: look.body, belly: look.belly, plum: look.outline, ear: look.ears, eye: look.eyes, nose: look.ears,
    shade: shade(look.body, -0.09), shine: '#ffffff',
  };
  const flat = new Set(['eye', 'shine', 'plum']);
  const hull = hullMaterial(look.outline, 0.0075);
  const outlined = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material && o.material.name) || '';
    const colour = colours[name] || (o.material && o.material.color) || '#cccccc';
    o.material = flat.has(name) ? new THREE.MeshBasicMaterial({ color: colour, name })
      : new THREE.MeshToonMaterial({ color: colour, gradientMap: ramp(), name });
    o.castShadow = !flat.has(name);
    o.receiveShadow = false;
    o.frustumCulled = false;
    if (o.isSkinnedMesh && ['body', 'belly', 'shade'].includes(name)) outlined.push(o);
  });
  for (const o of outlined) {
    const h = new THREE.SkinnedMesh(o.geometry, hull);
    h.bind(o.skeleton, o.bindMatrix);
    h.bindMode = o.bindMode;
    h.position.copy(o.position);
    h.quaternion.copy(o.quaternion);
    h.scale.copy(o.scale);
    h.frustumCulled = false;
    o.parent.add(h);
  }
  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(BAO_SCALE);
  const mixer = new THREE.AnimationMixer(root);
  const clips = {};
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    if (ONCE.has(clip.name)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    clips[clip.name] = a;
  }
  let current = null, currentName = '';
  // Now and then (not every second) one ear gives a small flick while resting.
  const earL = root.getObjectByName('ear_L'), earR = root.getObjectByName('ear_R');
  const flickAxis = new THREE.Vector3(0, 1, 0), flickQ = new THREE.Quaternion();
  let flickIn = 6 + Math.random() * 10, flickT = -1, flickEar = earL, flickSide = -1;
  const rig = {
    object: holder,
    socket: root.getObjectByName('hat_socket') || root.getObjectByName('head') || root,
    head: root.getObjectByName('head') || root,
    clip: () => currentName,
    onDone: null,
    play(name, fade = 0.3) {
      const next = clips[name] || clips.idle;
      if (!next) return;
      if (next === current && !ONCE.has(name)) return;
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      if (current && current !== next) current.crossFadeTo(next, fade, false);
      current = next;
      currentName = clips[name] ? name : 'idle';
    },
    rate(r) { if (current) current.setEffectiveTimeScale(r); },
    update(dt) {
      mixer.update(dt);
      if (!earL) return;
      if (flickT < 0) {
        if ((flickIn -= dt) <= 0) {
          if (currentName === 'idle' || currentName === 'sit') {
            flickSide = Math.random() < 0.5 ? -1 : 1;
            flickEar = flickSide < 0 ? earL : (earR || earL);
            flickT = 0;
          } else flickIn = 3;
        }
      } else {
        flickT += dt;
        const k = Math.sin(Math.min(1, flickT / 0.3) * Math.PI);
        flickQ.setFromAxisAngle(flickAxis, flickSide * 0.28 * k);
        flickEar.quaternion.multiply(flickQ);
        if (flickT >= 0.3) { flickT = -1; flickIn = 9 + Math.random() * 16; }
      }
    },
  };
  mixer.addEventListener('finished', () => { if (rig.onDone) rig.onDone(); });
  return rig;
}

// A cat made of simple shapes, for when the model can't be loaded (e.g. opened from the disk).
function baoFromShapes(look) {
  const r = 0.42 * 0.55 / 0.97;
  const cat = new THREE.Group();
  const hull = new THREE.MeshBasicMaterial({ color: look.outline, side: THREE.BackSide });
  const body = toon(look.body), legsC = toon(shade(look.body, -0.1));
  const line = (m, grow = 1.06) => {
    const h = new THREE.Mesh(m.geometry, hull);
    h.scale.setScalar(grow);
    m.add(h);
    return m;
  };
  const legLen = 0.38 * r, centreY = legLen + 0.88 * r;
  const blob = new THREE.Group();
  blob.position.y = centreY;
  cat.add(blob);
  blob.add(line(mesh(ball(r, 24), body, { sy: 0.94, sz: 0.92 }), 1.045));
  blob.add(mesh(ball(r * 0.55, 16), toon(look.belly), { y: -r * 0.22, z: r * 0.62, sz: 0.55 }));
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.48 * r, 0.78 * r, 0);
    ear.rotation.z = -s * 0.25;
    ear.add(line(mesh(cone(0.24 * r, 0.62 * r, 10), body, { y: 0.26 * r }), 1.1));
    ear.add(mesh(cone(0.14 * r, 0.42 * r, 8), toon(look.ears), { y: 0.22 * r, z: 0.1 * r, sz: 0.5, shadow: false }));
    blob.add(ear);
    const eye = mesh(ball(0.17 * r, 12), new THREE.MeshBasicMaterial({ color: look.eyes }), { x: s * 0.33 * r, y: 0.16 * r, z: 0.84 * r, sz: 0.5, shadow: false });
    eye.add(mesh(ball(0.5, 8), new THREE.MeshBasicMaterial({ color: look.outline }), { z: 0.3, sx: 0.55, sy: 0.55, shadow: false }));
    blob.add(eye);
  }
  const legs = [-1, 1].map((s) => {
    const leg = new THREE.Group();
    leg.position.set(s * 0.32 * r, legLen + 0.25 * r, 0);
    leg.add(line(mesh(new THREE.CapsuleGeometry(0.12 * r, legLen + 0.1 * r, 4, 8), legsC, { y: -(legLen + 0.1 * r) / 2 }), 1.12));
    cat.add(leg);
    return leg;
  });
  const tail = new THREE.Group();
  tail.position.set(0, -0.05 * r, -0.82 * r);
  tail.rotation.x = -0.6;
  tail.add(line(mesh(new THREE.CapsuleGeometry(0.11 * r, 0.42 * r, 4, 8), body, { y: 0.26 * r }), 1.12));
  tail.add(mesh(ball(0.12 * r, 8), toon(look.tail_tip), { y: 0.52 * r }));
  blob.add(tail);
  const socket = new THREE.Object3D();
  socket.position.y = 0.9 * r;
  blob.add(socket);
  const holder = new THREE.Group();
  holder.add(cat);
  holder.scale.setScalar(BAO_SCALE);
  let name = 'idle', t = 0, rate = 1, left = 0;
  const rig = {
    object: holder, socket, head: blob, onDone: null,
    clip: () => name,
    play(n) { if (n !== name || ONCE.has(n)) { name = n; t = 0; left = ONCE.has(n) ? 1.2 : 0; } },
    rate(v) { rate = v; },
    update(dt) {
      t += dt * (name === 'walk' ? rate : 1);
      const w = Math.sin(t * Math.PI * 2);
      blob.position.y = centreY;
      blob.rotation.set(0, 0, 0);
      blob.scale.set(1, 1, 1);
      legs.forEach((l, i) => { l.rotation.x = 0; l.visible = true; });
      tail.rotation.z = Math.sin(t * 2.2) * 0.35;
      if (name === 'walk') {
        blob.position.y += Math.abs(w) * 0.04;
        blob.rotation.z = w * 0.07;
        legs[0].rotation.x = w * 0.6;
        legs[1].rotation.x = -w * 0.6;
      } else if (name === 'nap') {
        blob.position.y = centreY * 0.62;
        blob.scale.set(1.08, 0.78 + Math.sin(t * 1.4) * 0.02, 1.05);
        legs.forEach((l) => { l.visible = false; });
      } else if (name === 'sit') {
        blob.position.y = centreY * 0.85;
        blob.rotation.x = -0.12;
        legs.forEach((l) => { l.rotation.x = -1.2; });
      } else if (name === 'happy') {
        blob.position.y += Math.max(0, Math.sin(Math.min(1, t / 0.8) * Math.PI)) * 0.25;
      } else {
        blob.scale.y = 1 + Math.sin(t * 2.5) * 0.015;
        if (name === 'eat' || name === 'paint') blob.rotation.x = 0.1 + Math.sin(t * 6) * 0.06;
        if (name === 'stretch') blob.scale.set(1.08, 0.92, 1.1);
      }
      if (left > 0 && (left -= dt) <= 0 && rig.onDone) rig.onDone();
    },
  };
  return rig;
}

// Which clip shows what the cat is doing.
function activityClip(c) {
  if (c.asleep) return 'nap';
  const w = `${c.doing} ${c.spot || ''}`.toLowerCase();
  if (/paint|draw|sketch|doodl|colour|color|brew|stir|mix|craft|build|potter|sculpt|write/.test(w)) return 'paint';
  if (/eat|snack|munch|lunch|dinner|breakfast|nibbl|tea\b|drink|feast|treat/.test(w)) return 'eat';
  if (/stretch|yoga|wak/.test(w)) return 'stretch';
  if (/sit|watch|read|think|admir|look|listen|rest|gaz|wait|dream|ponder/.test(w)) return 'sit';
  return 'idle';
}
const isCheerful = (c) => !c.asleep && (c.moodValue > 0.45 || /happy|excited|joy|proud|delight|cheer|playful/.test(c.mood.toLowerCase()));

// A hat from what it's wearing (the first thing it wears; anything unknown gets the plain hat).
const HATS = [[/witch/, 'hat_witch'], [/party/, 'hat_party'], [/flower|crown|daisy|wreath/, 'hat_flower_crown'],
  [/beanie|woolly|wooly|knit/, 'hat_beanie'], [/bow|ribbon/, 'hat_bow'], [/santa|christmas/, 'hat_santa']];
function hatFor(wearing) {
  if (!wearing.length) return null;
  const w = wearing.find((x) => /hat|cap|crown|bow|beanie|wreath|helmet|bonnet|beret/.test(x)) || wearing[0];
  for (const [re, name] of HATS) if (re.test(w)) return name;
  return 'hat_generic';
}

// Where the cat's feet are: the island's ground, or the floor of the building it is inside.
let downRay = null, tmpV = null;
function groundAt(world, x, z) {
  if (!downRay) { downRay = new THREE.Raycaster(); tmpV = new THREE.Vector3(); }
  let y = world.ground.height(x, z);
  for (const f of world.floors) {
    tmpV.set(x, 0, z);
    f.holder.worldToLocal(tmpV);
    const b = f.box;
    if (tmpV.x < b.min.x || tmpV.x > b.max.x || tmpV.z < b.min.z || tmpV.z > b.max.z) continue;
    downRay.set(new THREE.Vector3(x, f.holder.position.y + 1.2, z), new THREE.Vector3(0, -1, 0));
    downRay.far = 3;
    const hit = downRay.intersectObjects(f.meshes, false)[0];
    if (hit) y = Math.max(y, hit.point.y);
  }
  return y;
}

// Favourite spots: a cushion with a little star at each, near its place.
function spotMarkers(scene, d, world, look) {
  const markers = [];
  const used = new Map();
  for (const sp of d.spots) {
    const pi = world.info.get(sp.place);
    if (!pi) continue;
    const n = used.get(sp.place) || 0;
    used.set(sp.place, n + 1);
    let v;
    if (pi.inner) {
      const I = pi.inner, cx = (I.x0 + I.x1) / 2, cz = (I.z0 + I.z1) / 2;
      const c = [[0.55, 0.5], [-0.45, 0.6], [0.6, -0.1]][n % 3];
      v = pi.holder.localToWorld(new THREE.Vector3(cx + c[0] * (I.x1 - I.x0) / 2, I.y, cz + c[1] * (I.z1 - I.z0) / 2));
    } else {
      const a = Math.atan2(pi.front.out.x, pi.front.out.z) + [0.75, -0.75, 1.3, -1.3][n % 4];
      const r = pi.id === 'gallery' ? pi.radius * 0.55 : pi.radius + 1.1;
      v = pi.holder.position.clone().add(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
      v.y = groundAt(world, v.x, v.z);
    }
    const colour = ['#f7b2c4', '#bde0fe', '#cdeac0', '#ffe5a5', '#d9c2f0'][hashOf(sp.name) % 5];
    const g = new THREE.Group();
    g.position.copy(v);
    g.add(mesh(ball(0.36, 16), toon(colour), { y: 0.08, sy: 0.32 }));
    g.add(mesh(ball(0.07, 8), toon(shade(colour, -0.15)), { y: 0.19, shadow: false }));
    const star = mesh(new THREE.OctahedronGeometry(0.1), toon('#ffd166', { emissive: '#ffb300', emissiveIntensity: 0.4 }), { y: 1.4, shadow: false });   // above the cat when it sits there
    g.add(star);
    g.userData = { name: sp.name, place: sp.place, star };
    scene.add(g);
    markers.push(g);
  }
  return markers;
}

// Where the cat is at home in a place: in bed if it's asleep in its room, on its favourite
// cushion if its activity happens there, or by the place's door (moved a little by the spot word).
function homeSpot(d, world, markers, placeId, spotWord, asleep) {
  const pi = world.info.get(placeId) || world.info.get('room') || world.info.values().next().value;
  if (pi.id === 'room' && asleep && pi.bed) return { pos: pi.bed.clone(), pi };
  if (spotWord) {
    const w = spotWord.toLowerCase();
    const m = markers.find((k) => k.userData.place === pi.id && (k.userData.name.toLowerCase().includes(w) || w.includes(k.userData.name.toLowerCase())));
    if (m) return { pos: m.position.clone().add(new THREE.Vector3(0, 0.12, 0)), pi };
  }
  const pos = pi.stand.clone();
  if (spotWord) {
    const h = hashOf(spotWord), a = (h % 628) / 100, r = 0.3 + (h % 7) / 10;
    pos.x += Math.sin(a) * r;
    pos.z += Math.cos(a) * r;
    if (pi.inner) {
      const l = pi.holder.worldToLocal(pos.clone());
      l.x = clamp(l.x, pi.inner.x0 + 0.3, pi.inner.x1 - 0.3);
      l.z = clamp(l.z, pi.inner.z0 + 0.3, pi.inner.z1 - 0.3);
      pos.copy(pi.holder.localToWorld(l));
    }
  }
  pos.y = groundAt(world, pos.x, pos.z);
  return { pos, pi };
}

// The way from one spot to another: out of the door, along the paths, in at the other door.
function routeBetween(world, from, fromPi, to, toPi) {
  const pts = [from.clone()];
  if (fromPi && fromPi.inside) pts.push(fromPi.front.door.clone());
  const a = pts[pts.length - 1], b = toPi && toPi.inside ? toPi.front.door.clone() : to.clone();
  const mid = a.distanceTo(b) < 2.5 ? [a, b] : world.graph.route(a, b);
  pts.push(...mid.slice(1));
  if (toPi && toPi.inside) pts.push(to.clone());
  // Drop points that double back on themselves.
  return pts.filter((v, i) => i === 0 || v.distanceTo(pts[i - 1]) > 0.05);
}

// The cat's little mind on the page: walks where world.json says it is, then does its activity,
// and now and then wanders off to a sitting spot or along a path and comes back.
function makeCatLife(d, world, rig, markers, status) {
  const rnd = seeded(hashOf(d.cat.name + d.cat.place) ^ Date.now());
  const base = activityClip(d.cat);
  const cheerful = isCheerful(d.cat);
  const homeAt = homeSpot(d, world, markers, d.cat.place, d.cat.spot, d.cat.asleep);
  const life = {
    pos: homeAt.pos.clone(), heading: 0, path: null, i: 0, speed: 1, arrive: null,
    at: homeAt.pi, home: homeAt, wanders: 0, next: 6 + rnd() * 6, wait: 0, away: false, moving: false,
  };
  const face = (pi) => (pi ? Math.atan2(pi.front.out.x, pi.front.out.z) + (pi.inside ? 0 : 0.3) : 0);
  life.heading = face(homeAt.pi);
  const restClip = () => (base === 'stretch' || base === 'happy' ? 'idle' : base);
  const settle = () => {
    life.away = false;
    life.at = homeAt.pi;
    rig.play(base === 'stretch' ? 'stretch' : restClip());
    life.next = 40 + rnd() * 50;
    status.at(homeAt.pi.id);
  };
  rig.onDone = () => { if (!life.moving) rig.play(life.away ? 'sit' : restClip(), 0.4); };
  function walk(points, speed, arrive) {
    life.hopping = null;              // a visitor's button can call him mid-hop or off a bench
    life.bench = null;
    life.path = points;
    life.i = 1;
    life.speed = speed;
    life.arrive = arrive;
    life.moving = true;
    status.at('');
    rig.play('walk', 0.2);
  }
  life.walk = walk;
  // A short trip: a nearby sitting spot, a lap of the paths, or a few steps about.
  function wander() {
    life.wanders += 1;
    const from = life.pos.clone();
    const out = isInside(homeAt.pi, from) ? homeAt.pi : null;
    let target = null, pts = null;
    const near = world.spots.filter((s) => s.distanceTo(homeAt.pos) < 16 && s.distanceTo(homeAt.pos) > 2);
    if (life.wanders % 3 === 0) {
      const lap = world.graph.stroll(homeAt.pi.front.door, 3 + Math.floor(rnd() * 3), rnd);
      if (lap.length > 1) {
        pts = routeBetween(world, from, out, lap[0], null).concat(lap.slice(1));
        target = pts[pts.length - 1];
      }
    }
    let bench = null;
    if (!pts && near.length && rnd() < 0.7) {
      const spot = near[Math.floor(rnd() * near.length)];
      bench = world.benches.find((b) => b.spot === spot) || null;
      target = spot.clone();
      pts = routeBetween(world, from, out, target, null);
    }
    if (!pts) {
      const a = rnd() * Math.PI * 2, r = 1 + rnd() * 1.4;
      target = homeAt.pos.clone().add(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
      if (homeAt.pi.inner) {
        const l = homeAt.pi.holder.worldToLocal(target.clone());
        l.x = clamp(l.x, homeAt.pi.inner.x0 + 0.3, homeAt.pi.inner.x1 - 0.3);
        l.z = clamp(l.z, homeAt.pi.inner.z0 + 0.3, homeAt.pi.inner.z1 - 0.3);
        target = homeAt.pi.holder.localToWorld(l);
      }
      pts = [from, target];
    }
    walk(pts, 0.8, () => {
      life.away = true;
      life.wait = 25 + rnd() * 30;
      if (bench) {
        hop(bench.seat, bench.ry, () => { life.bench = bench; rig.play('sit'); });
        return;
      }
      rig.play(cheerful && rnd() < 0.4 ? 'happy' : 'sit');
    });
  }
  // A little hop between the ground and a bench seat (Bao leans into it, lands, settles).
  function hop(to, heading, done) {
    life.hopping = { from: life.pos.clone(), to: to.clone(), t: 0, dur: 0.5, heading, done };
    rig.play('happy', 0.15);
  }
  function goHome() {
    if (life.bench) {
      const b = life.bench;
      life.bench = null;
      hop(b.spot, b.ry, goHome);
      return;
    }
    const pts = isInside(homeAt.pi, life.pos) ? [life.pos.clone(), homeAt.pos.clone()]
      : routeBetween(world, life.pos.clone(), null, homeAt.pos, homeAt.pi);
    walk(pts, 0.9, settle);
  }
  life.update = (dt) => {
    rig.update(dt);
    if (life.hopping) {
      const h = life.hopping;
      h.t += dt;
      const k = Math.min(1, h.t / h.dur), e = k * k * (3 - 2 * k);
      life.pos.x = h.from.x + (h.to.x - h.from.x) * e;
      life.pos.z = h.from.z + (h.to.z - h.from.z) * e;
      life.pos.y = h.from.y + (h.to.y - h.from.y) * e + Math.sin(k * Math.PI) * 0.22;
      life.heading += clamp(angleTo(life.heading, h.heading), -6 * dt, 6 * dt);
      if (k >= 1) {
        life.hopping = null;
        if (h.done) h.done();
      }
      rig.object.position.copy(life.pos);
      rig.object.rotation.y = life.heading;
      return;
    }
    if (life.moving && life.path) {
      const target = life.path[life.i];
      const dx = target.x - life.pos.x, dz = target.z - life.pos.z, dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz), turn = angleTo(life.heading, want);
      life.heading += clamp(turn, -4 * dt, 4 * dt);
      const go = life.speed * dt * clamp(Math.cos(turn) * 1.3, 0.2, 1);
      if (dist <= go || dist < 1e-3) {
        life.pos.x = target.x;
        life.pos.z = target.z;
        life.i += 1;
        if (life.i >= life.path.length) {
          life.moving = false;
          life.path = null;
          const done = life.arrive;
          life.arrive = null;
          if (done) done();
        }
      } else {
        life.pos.x += dx / dist * go;
        life.pos.z += dz / dist * go;
      }
      rig.rate(clamp(life.speed / (STRIDE * BAO_SCALE), 0.8, 2.4));
    } else if (!d.cat.asleep) {
      if (life.away) {
        if ((life.wait -= dt) <= 0) goHome();
      } else if ((life.next -= dt) <= 0) {
        if (rnd() < 0.3 && base !== 'nap') {
          rig.play(cheerful ? 'happy' : 'stretch');
          life.next = 30 + rnd() * 30;
        } else wander();
      } else {
        const want = face(homeAt.pi);
        life.heading += clamp(angleTo(life.heading, want), -2 * dt, 2 * dt);
      }
    }
    const gy = life.bench ? life.bench.seat.y : groundAt(world, life.pos.x, life.pos.z);
    life.pos.y += (gy - life.pos.y) * Math.min(1, dt * 14);
    rig.object.position.copy(life.pos);
    rig.object.rotation.y = life.heading;
  };
  life.settle = settle;
  life.home = homeAt;
  return life;
}
function isInside(pi, v) {
  if (!pi.inner) return false;
  const l = pi.holder.worldToLocal(v.clone());
  return l.x > pi.box.min.x && l.x < pi.box.max.x && l.z > pi.box.min.z && l.z < pi.box.max.z;
}

// ------------------------------------------------- sky, light and weather ----
const SKY = {
  dawn: { top: '#9db7ea', mid: '#ffd6bd', low: '#ffe9d2', sun: '#ffd9a0', light: '#ffd8b4', li: 2.3, hemi: 1.15, ground: '#c99f84' },
  day: { top: '#79bce8', mid: '#cdeafb', low: '#eef8ff', sun: '#fff4c4', light: '#fff3df', li: 2.9, hemi: 1.3, ground: '#c8a57e' },
  dusk: { top: '#5d4f9c', mid: '#f4a07c', low: '#ffd1a3', sun: '#ffb070', light: '#ffb88e', li: 2.0, hemi: 1.0, ground: '#a77d8a' },
  night: { top: '#10133a', mid: '#2a2c66', low: '#463a78', sun: '#f4f1d0', light: '#9fb4ff', li: 0.9, hemi: 0.62, ground: '#2c2648' },
};
function skyColours(d) {
  const s = { ...SKY[d.time.part] };
  const k = d.weather.kind;
  if (['cloudy', 'rain', 'storm'].includes(k)) {
    const grey = k === 'storm' ? 0.6 : k === 'rain' ? 0.45 : 0.3;
    const night = d.time.part === 'night';
    const to = new THREE.Color(night ? (k === 'storm' ? '#23243a' : '#2f3250') : k === 'storm' ? '#6f7186' : '#9aa0ae');
    for (const key of ['top', 'mid', 'low']) s[key] = '#' + new THREE.Color(s[key]).lerp(to, grey).getHexString();
    s.li *= k === 'storm' ? 0.5 : 0.7;
  }
  if (k === 'hot') { s.light = '#ffe2a0'; s.li *= 1.08; }
  if (k === 'cold') { s.light = '#dce8ff'; s.top = '#' + new THREE.Color(s.top).lerp(new THREE.Color('#cfdcef'), 0.25).getHexString(); }
  return s;
}
const SUN_DIR = { dawn: [-0.8, 0.35, 0.45], day: [-0.45, 0.85, 0.35], dusk: [0.8, 0.32, 0.4], night: [0.35, 0.8, 0.45] };

function makeSky(scene, d, colours) {
  const sunDir = new THREE.Vector3(...SUN_DIR[d.time.part]).normalize();
  const night = d.time.part === 'night';
  const clear = !['cloudy', 'rain', 'storm'].includes(d.weather.kind);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(colours.top) }, mid: { value: new THREE.Color(colours.mid) }, low: { value: new THREE.Color(colours.low) },
      sunCol: { value: new THREE.Color(colours.sun) }, sunDir: { value: sunDir }, sunShow: { value: night || !clear ? 0 : 1 },
    },
    vertexShader: 'varying vec3 vDir;\nvoid main() {\n  vDir = normalize(position);\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunCol; uniform vec3 sunDir; uniform float sunShow;',
      'varying vec3 vDir;',
      'void main() {',
      '  float h = normalize(vDir).y;',
      '  vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.75)) : mix(mid, low, clamp(-h * 4.0, 0.0, 1.0));',
      '  float s = max(dot(normalize(vDir), sunDir), 0.0);',
      '  c += sunCol * (smoothstep(0.9985, 0.9992, s) * 1.2 + pow(s, 10.0) * 0.35) * sunShow;',
      '  gl_FragColor = vec4(c, 1.0);',
      '}',
    ].join('\n'),
  });
  const sky = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  sky.add(dome);
  if (night || d.time.part === 'dawn' || d.time.part === 'dusk') {
    const rnd = seeded(5), pts = [];
    for (let i = 0; i < 700; i++) {
      const a = rnd() * Math.PI * 2, y = 0.08 + rnd() * 0.92, r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(a) * r * 450, y * 450, Math.sin(a) * r * 450);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: '#fff6d8', size: night ? 2.2 : 1.4, sizeAttenuation: false, fog: false, transparent: true,
      opacity: night ? (clear ? 0.95 : 0.35) : 0.35, depthWrite: false,
    }));
    stars.frustumCulled = false;
    sky.add(stars);
  }
  if (night) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    const glow = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    glow.addColorStop(0, 'rgba(255,248,220,0.9)');
    glow.addColorStop(0.35, 'rgba(255,248,220,0.25)');
    glow.addColorStop(1, 'rgba(255,248,220,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#fff8dc';
    g.beginPath();
    g.arc(64, 64, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(214, 200, 170, 0.6)';
    for (const [x, y, r] of [[58, 58, 4], [70, 70, 3], [68, 54, 2]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
    moon.position.copy(sunDir).multiplyScalar(420);
    moon.scale.setScalar(90);
    sky.add(moon);
  }
  scene.add(sky);
  return { sky, sunDir };
}

// A soft round glow (lamps at night).
let GLOW = null;
function glowTexture() {
  if (!GLOW) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,236,180,1)');
    r.addColorStop(0.4, 'rgba(255,210,130,0.45)');
    r.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    GLOW = new THREE.CanvasTexture(canvas);
    GLOW.colorSpace = THREE.SRGBColorSpace;
  }
  return GLOW;
}

// Rain (short streaks) or snow (soft dots), falling in a box that follows the view.
function makeWeather(scene, d) {
  const k = d.weather.kind;
  const snowy = k === 'cold' && (d.weather.temp === null || d.weather.temp <= 4);
  if (!['rain', 'storm'].includes(k) && !snowy) return null;
  const n = k === 'storm' ? 1800 : k === 'rain' ? 1000 : 900;
  const rnd = seeded(31);
  const off = [], ends = [];
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * 44, y = rnd() * 22, z = (rnd() - 0.5) * 44;
    if (snowy) { off.push(x, y, z); ends.push(0); }
    else { off.push(x, y, z, x, y, z); ends.push(0, 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(off, 3));
  g.setAttribute('tip', new THREE.Float32BufferAttribute(ends, 1));
  // uHole: (x, z, radius, top) of a dry spot (the cottage while its roof is lifted off); radius 0 = none.
  const uniforms = { uTime: { value: 0 }, uCentre: { value: new THREE.Vector3() }, uWind: { value: k === 'storm' ? 1.4 : 0.35 },
    uHole: { value: new THREE.Vector4(0, 0, 0, 0) } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    vertexShader: [
      'uniform float uTime; uniform vec3 uCentre; uniform float uWind; uniform vec4 uHole; attribute float tip; varying float vTip;',
      'void main() {',
      `  float speed = ${snowy ? '1.2' : '14.0'};`,
      '  vec3 p = position;',
      '  p.y = mod(p.y - uTime * speed, 22.0);',
      `  p.x += ${snowy ? 'sin(uTime * 0.8 + position.z) * 0.6' : '0.0'};`,
      '  p.xz = mod(p.xz - uCentre.xz + 22.0, 44.0) - 22.0 + uCentre.xz;',
      '  p.y += uCentre.y - 4.0;',
      '  bool dry = uHole.z > 0.0 && p.y < uHole.w && distance(p.xz, uHole.xy) < uHole.z;',
      '  p += tip * vec3(-uWind * 0.12, 0.55, 0.0);',
      '  vTip = tip;',
      '  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);',
      '  if (dry) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);',   // both ends off screen: the whole streak goes
      `  gl_PointSize = ${snowy ? '3.0' : '1.0'};`,
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying float vTip;',
      'void main() {',
      `  gl_FragColor = vec4(${snowy ? '1.0, 1.0, 1.0, 0.85' : '0.74, 0.8, 0.96, 0.08 + vTip * 0.22'});`,
      '}',
    ].join('\n'),
  });
  const obj = snowy ? new THREE.Points(g, mat) : new THREE.LineSegments(g, mat);
  obj.frustumCulled = false;
  scene.add(obj);
  return uniforms;
}

// ------------------------------------------------- paper, crayon, grain ----
// The finished picture goes through one full-screen pass: soft plum lines where the depth jumps
// (the outlines of everything), warm paper with fibres and crayon tooth, a little moving film
// grain, and a warm vignette. Cheap enough for phones: one extra draw.
function makePost(renderer, ink) {
  const gl2 = renderer.capabilities.isWebGL2;
  const floatOk = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const depth = new THREE.DepthTexture(4, 4);
  const rt = new THREE.WebGLRenderTarget(4, 4, {
    type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: gl2 ? 4 : 0, depthTexture: depth, depthBuffer: true,
  });
  const inkSRGB = new THREE.Color(ink).convertLinearToSRGB();
  const uniforms = {
    tColor: { value: rt.texture }, tDepth: { value: depth }, uRes: { value: new THREE.Vector2(4, 4) }, uTime: { value: 0 },
    uNear: { value: 0.3 }, uFar: { value: 900 }, uGrain: { value: 0.012 }, uShimmer: { value: 0 }, uLine: { value: 1 },
    uInk: { value: new THREE.Vector3(inkSRGB.r, inkSRGB.g, inkSRGB.b) }, uFlash: { value: 0 }, uNight: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4(position.xy, 0.0, 1.0);\n}',
    fragmentShader: [
      'uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uTime; uniform float uNear;',
      'uniform float uFar; uniform float uGrain; uniform float uShimmer; uniform float uLine; uniform vec3 uInk; uniform float uFlash;',
      'uniform float uNight;',
      'varying vec2 vUv;',
      'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
      'float noise(vec2 p) {',
      '  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
      '}',
      'float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }',
      'float depthAt(vec2 uv) {',
      '  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;',
      '  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));',
      '}',
      'void main() {',
      '  vec2 uv = vUv;',
      '  uv.x += sin(uv.y * 80.0 + uTime * 4.0) * 0.0008 * uShimmer * smoothstep(0.75, 0.1, uv.y);',
      '  vec3 col = linearToOutputTexel(vec4(texture2D(tColor, uv).rgb, 1.0)).rgb;',
      '  vec2 fc = gl_FragCoord.xy;',
      '  vec2 px = uLine / uRes;',
      '  float d0 = depthAt(uv);',
      '  float dl = depthAt(uv - vec2(px.x, 0.0)), dr = depthAt(uv + vec2(px.x, 0.0));',
      '  float du = depthAt(uv + vec2(0.0, px.y)), dd = depthAt(uv - vec2(0.0, px.y));',
      '  float lap = abs(dl + dr + du + dd - 4.0 * d0) / max(d0, 0.5);',
      '  float near = min(min(dl, dr), min(du, dd));',
      '  float edge = smoothstep(0.06, 0.16, lap) * (1.0 - smoothstep(60.0, 160.0, near));',
      '  edge *= 0.55 + 0.45 * noise(fc * 0.3 + 17.0);',
      '  col = mix(col, uInk, edge * 0.85);',
      '  float paper = fbm(fc * 0.011) * 0.6 + fbm(fc * 0.085 + 3.0) * 0.4;',
      '  float fibre = noise(vec2(fc.x * 0.018, fc.y * 0.5));',
      '  col *= 0.955 + 0.08 * paper + 0.015 * fibre;',
      // Crayon: soft diagonal strokes, stronger in the darker colours (static, like the paper).
      '  vec2 r = mat2(0.82, -0.57, 0.57, 0.82) * fc;',
      '  float stroke = noise(vec2(r.x * 0.7, r.y * 0.045)) * 0.7 + noise(vec2(r.x * 1.9, r.y * 0.11)) * 0.3;',
      '  float lum = dot(col, vec3(0.3, 0.59, 0.11));',
      '  col *= 1.0 - (stroke - 0.5) * 0.08 * (1.25 - lum);',
      '  float tooth = hash(floor(fc * 0.7));',
      '  col = mix(col, col * 0.88 + 0.1 - 0.06 * uNight, step(0.95, tooth) * 0.15);',
      // Night: a cool blue-plum grade, so lit windows and lamps glow against it.
      '  col = mix(col, col * vec3(0.76, 0.8, 1.06), uNight * 0.7);',
      '  col += (hash(fc + fract(uTime * 7.31) * 137.0) - 0.5) * uGrain;',
      '  vec2 q = vUv - 0.5;',
      '  float v = smoothstep(0.82, 0.28, length(q * vec2(1.0, 1.2)));',
      '  col = mix(col * mix(vec3(0.86, 0.74, 0.7), vec3(0.6, 0.55, 0.78), uNight), col, v);',
      '  col += uFlash * vec3(0.5, 0.5, 0.6);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    uniforms,
    setSize(w, h, ratio) {
      const W = Math.max(4, Math.round(w * ratio)), H = Math.max(4, Math.round(h * ratio));
      rt.setSize(W, H);
      uniforms.uRes.value.set(W, H);
      uniforms.uLine.value = Math.max(1, ratio * 0.9);
    },
    render(world, camera) {
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(rt);
      renderer.render(world, camera);
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
    },
  };
}

// --------------------------------------------------------- the camera ----
// Orbit, zoom and pan with mouse, touch or keys, kept over the island. Moves ease in gently
// (or jump straight there when the visitor prefers less motion).
function cameraRig(camera, canvas, world, onUser) {
  const g = world.ground;
  const now = { target: new THREE.Vector3(), theta: 0.4, phi: 1.0, radius: 12 };
  const goal = { target: new THREE.Vector3(), theta: 0.4, phi: 1.0, radius: 12 };
  const limit = () => {
    goal.phi = clamp(goal.phi, 0.25, 1.42);
    goal.radius = clamp(goal.radius, 2.6, Math.max(30, g.radius * 2.1));
    const dx = goal.target.x - g.centre.x, dz = goal.target.z - g.centre.z, r = Math.hypot(dx, dz), max = g.radius * 1.05;
    if (r > max) { goal.target.x = g.centre.x + dx / r * max; goal.target.z = g.centre.z + dz / r * max; }
  };
  const rig = {
    now, goal, follow: false,
    jump() { now.target.copy(goal.target); now.theta = goal.theta; now.phi = goal.phi; now.radius = goal.radius; },
    look(target, radius, theta, phi = 1.0) {
      goal.target.copy(target);
      goal.radius = radius;
      if (theta !== undefined) goal.theta = now.theta + angleTo(now.theta, theta);
      goal.phi = phi;
      limit();
      if (calm) rig.jump();
    },
    update(dt) {
      const k = calm ? 1 : 1 - Math.exp(-dt * 4.5);
      now.target.lerp(goal.target, k);
      now.theta += (goal.theta - now.theta) * k;
      now.phi += (goal.phi - now.phi) * k;
      now.radius += (goal.radius - now.radius) * k;
      const sp = Math.sin(now.phi);
      camera.position.set(now.target.x + Math.sin(now.theta) * sp * now.radius, now.target.y + Math.cos(now.phi) * now.radius,
        now.target.z + Math.cos(now.theta) * sp * now.radius);
      const floor = g.height(camera.position.x, camera.position.z) + 0.5;
      if (camera.position.y < floor) camera.position.y = floor;
      camera.lookAt(now.target);
    },
  };
  const pan = (dx, dy) => {
    const s = now.radius * 0.0016;
    const right = new THREE.Vector3(Math.cos(now.theta), 0, -Math.sin(now.theta));
    const fwd = new THREE.Vector3(-Math.sin(now.theta), 0, -Math.cos(now.theta));
    goal.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s);
    goal.target.y = g.height(goal.target.x, goal.target.z) + 0.6;
    rig.follow = false;
    onUser('pan');
  };
  const turn = (dx, dy) => {
    goal.theta -= dx * 0.006;
    goal.phi -= dy * 0.005;
    onUser('turn');
  };
  const zoom = (f) => {
    goal.radius *= f;
    onUser('zoom');
  };
  const pointers = new Map();
  let pinch = 0, mid = null, panning = false;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panning = e.button === 2 || e.shiftKey || e.ctrlKey;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1) (panning ? pan : turn)(dx, dy);
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch > 0 && dist > 0) zoom(pinch / dist);
      if (mid) pan(m.x - mid.x, m.y - mid.y);
      pinch = dist;
      mid = m;
    }
    limit();
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    mid = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(Math.exp(clamp(e.deltaY, -200, 200) * 0.0012));
    limit();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = 18;
    const keys = {
      ArrowLeft: () => (e.shiftKey ? pan(step, 0) : turn(-step * 1.5, 0)), ArrowRight: () => (e.shiftKey ? pan(-step, 0) : turn(step * 1.5, 0)),
      ArrowUp: () => (e.shiftKey ? pan(0, step) : turn(0, -step)), ArrowDown: () => (e.shiftKey ? pan(0, -step) : turn(0, step)),
      a: () => pan(step, 0), d: () => pan(-step, 0), w: () => pan(0, step), s: () => pan(0, -step),
      '+': () => zoom(0.85), '=': () => zoom(0.85), '-': () => zoom(1.18), _: () => zoom(1.18),
    };
    const f = keys[e.key] || keys[e.key.toLowerCase()];
    if (!f) return;
    e.preventDefault();
    f();
    limit();
  });
  return rig;
}

// ------------------------------------------------------- loading models ----
// Our own two models, from this folder only. The loader just reads the bytes we hand it: a model
// can't fetch anything else (the publish gate also refuses any .glb that points outside itself).
function parseModel(buffer) {
  return new Promise((resolve, reject) => new THREE.GLTFLoader().parse(buffer, '', resolve, reject));
}
async function loadCatModel() {
  const res = await fetch('models/bao.glb');
  if (!res.ok) throw new Error('no cat model');
  return parseModel(await res.arrayBuffer());
}
async function loadKitModel() {
  const res = await fetch('models/world_kit.glb');
  if (!res.ok) throw new Error('no kit model');
  return parseModel(await res.arrayBuffer());
}
// Models made for the cat's wishes (docs/MAKING_WISHES.md): ONLY "models/wishes/<slug>.glb" from
// this folder, each pinned by the publish gate. Anything else in world.json is ignored.
function wishModelUrl(model) {
  const m = /^wishes\/([a-z0-9][a-z0-9-]{1,40})\.glb$/.exec(String(model || ''));
  return m ? 'models/wishes/' + m[1] + '.glb' : null;
}
async function loadWishModel(w) {
  if (!wishModelUrl(w.model)) return null;
  const res = await fetch(wishModelUrl(w.model));
  if (!res.ok) return null;
  return { w, gltf: await parseModel(await res.arrayBuffer()) };
}

// ------------------------------------------------------------ start ----
// The page remembers ONE thing, for this tab only: where it last saw the cat.
function recallPlace() {
  try {
    const v = window.sessionStorage.getItem('catworld-last-place');
    return typeof v === 'string' && ID_RE.test(v) ? v : null;
  } catch (e) {
    return null;
  }
}
function rememberPlace(id) {
  try {
    window.sessionStorage.setItem('catworld-last-place', id);
  } catch (e) {
    // Private browsing or storage switched off: the cat just appears where it is.
  }
}

async function startWorld(d) {
  const holder = $('view');
  const fromDisk = !window.location.protocol.startsWith('http');
  let kit = null, cat = null;
  if (!fromDisk) {
    [kit, cat] = await Promise.all([loadKitModel().catch(() => null), loadCatModel().catch(() => null)]);
  }
  const wishModels = fromDisk ? [] : (await Promise.all(d.wishItems.map((w) => loadWishModel(w).catch(() => null)))).filter(Boolean);
  holder.hidden = false;
  $('waiting').hidden = true;
  const phone = Math.min(window.screen.width || 999, window.screen.height || 999) < 700 || window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: phone ? 'low-power' : 'default' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `A 3D picture of ${d.cat.name}'s island. ${$('status-line').textContent} Drag, or use the arrow keys, to look around. The lists below the picture say everything that is in it.`);
  holder.append(canvas);

  const colours = skyColours(d);
  const scene = new THREE.Scene();
  const lib = makeLibrary(kit ? kit.scene : null);
  const redraw = () => {};
  const world = buildWorld(scene, d, lib, redraw, wishModels);
  const R = world.ground.radius;
  scene.fog = new THREE.Fog(new THREE.Color(colours.mid), R * 1.6, R * 5);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 900);
  const { sky, sunDir } = makeSky(scene, d, colours);
  const night = d.time.part === 'night';
  const hemi = new THREE.HemisphereLight(colours.top, colours.ground, colours.hemi);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(night ? '#c9c4ff' : '#fff1e0', night ? 0.2 : 0.35));
  // The sea follows the light: deep blue at night, a little dimmer at dusk and in the rain.
  const seaTint = night ? '#2f4a7c' : d.time.part === 'dusk' ? '#7d9cc6' : ['rain', 'storm'].includes(d.weather.kind) ? '#79a7bf' : null;
  if (seaTint) {
    scene.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material) || !/^(sea|shallows)$/.test(o.material.name)) return;
      o.material = o.material.clone();
      o.material.color.lerp(new THREE.Color(seaTint), o.material.name === 'shallows' ? 0.6 : 0.75);
    });
  }
  const sun = new THREE.DirectionalLight(colours.light, colours.li);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 140 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Lamps glow at night (and dusk): a soft halo on every lamp, real light from the few nearest the view.
  const lit = night || d.time.part === 'dusk';
  const lampLights = [];
  if (lit) {
    for (const v of world.lights) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.position.copy(v);
      s.scale.setScalar(night ? 2.4 : 1.6);
      scene.add(s);
    }
    for (let i = 0; i < Math.min(4, world.lights.length); i++) {
      const l = new THREE.PointLight('#ffc77a', night ? 9 : 4, 9, 1.6);
      scene.add(l);
      lampLights.push(l);
    }
    scene.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.isMeshToonMaterial) return;
      if (/window|glass|lamp|bulb|lantern|glow/i.test(o.material.name) || o.material.userData.glows) {
        o.material.emissive.set('#ffc46b');
        o.material.emissiveIntensity = night ? 0.9 : 0.5;
      }
    });
  }
  const weather = makeWeather(scene, d);
  SWAY.uWind.value = { wind: 1.6, storm: 2.2, rain: 0.6, cloudy: 0.45 }[d.weather.kind] || 0.25;

  // The cat.
  const rig = cat ? baoFromModel(cat, d.cat.look) : baoFromShapes(d.cat.look);
  scene.add(rig.object);
  const hat = hatFor(d.cat.wearing);
  if (hat) rig.socket.add(lib.clone(hat));
  const markers = spotMarkers(scene, d, world, d.cat.look);
  const body = document.body;
  let lastPos = '';
  const status = {
    at(id) { body.dataset.baoAt = id; },
  };
  const life = makeCatLife(d, world, rig, markers, status);
  let zzz = null;
  if (d.cat.asleep) {
    zzz = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('z z z', { w: 256, h: 128, bg: 'rgba(0,0,0,0)', fg: '#ffffff', size: 70 }), transparent: true, depthWrite: false }));
    zzz.scale.set(0.8, 0.4, 1);
    scene.add(zzz);
  }

  // Did the cat move since this tab last saw it? Then it walks over, along the paths.
  const last = recallPlace();
  rememberPlace(d.cat.place);
  body.dataset.walk = 'none';
  if (last && last !== d.cat.place && world.info.has(last)) {
    $('status-line').textContent += ` Since you last looked, it has moved here from ${placeName(d, last)}.`;
    const from = homeSpot(d, world, markers, last, null, false);
    const route = routeBetween(world, from.pos, from.pi, life.home.pos, life.home.pi);
    const total = route.slice(1).reduce((s, v, i) => s + v.distanceTo(route[i]), 0);
    life.pos.copy(route[0]);
    // An unhurried waddle (about 2 steps a second per foot); a bit quicker on a long way round.
    life.walk(route, clamp(total / 22, 0.95, 1.2), () => {
      body.dataset.walk = 'done';
      life.settle();
    });
    body.dataset.walk = 'walking';
  } else {
    life.settle();
  }

  // The camera starts looking at the cat's place (or follows it on its walk).
  let userTurned = false;              // the visitor turned the view: the follow camera stops turning it
  const controls = cameraRig(camera, canvas, world, (why) => {
    if (why === 'pan') setFollow(false);
    if (why === 'turn') userTurned = true;
  });
  const placeView = (id) => {
    const pi = world.info.get(id);
    const target = pi.holder.position.clone();
    target.y += Math.min(1.6, pi.height * 0.35);
    if (pi.id === d.cat.place && !life.moving) target.lerp(life.pos, 0.35);
    const theta = Math.atan2(pi.front.out.x, pi.front.out.z) + 0.35;
    if (pi.id === 'gallery') {
      // Under the awning, level with the pictures.
      const t = pi.holder.position.clone().addScaledVector(pi.front.out, -0.6);
      t.y += 1.3;
      return { target: t, radius: 6.4, theta: theta - 0.25, phi: 1.42 };
    }
    if (pi.id === 'room') return { target, radius: clamp(pi.radius * 2.6, 7, 12), theta, phi: 0.92 };
    return { target, radius: clamp(pi.radius * 3, 8, 15), theta, phi: 1.04 };
  };
  const buttons = [...document.querySelectorAll('.places button')];
  const press = (id) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.place === id));
    body.dataset.place = id;
  };
  const followButton = $('follow');
  function setFollow(on) {
    controls.follow = on;
    userTurned = false;
    followButton.setAttribute('aria-pressed', String(on));
    if (on) press('');
  }
  const showPlace = (id, instant) => {
    if (!world.info.has(id)) return;
    const v = placeView(id);
    setFollow(false);
    controls.look(v.target, v.radius, v.theta, v.phi);
    if (instant) controls.jump();
    press(id);
  };
  for (const b of buttons) {
    b.disabled = !world.info.has(b.dataset.place);
    b.addEventListener('click', () => showPlace(b.dataset.place));
  }
  followButton.hidden = false;
  $('ask').hidden = false;
  followButton.addEventListener('click', () => setFollow(!controls.follow));
  showPlace(d.cat.place, true);
  if (body.dataset.walk === 'walking') {
    const v = placeView(last);
    controls.look(v.target, v.radius, v.theta, v.phi);
    controls.jump();
    if (!calm) setFollow(true);
    press(d.cat.place);
  }

  // Tap (or click) the cat to hear what it's up to; point at a cushion to see a spot's name.
  const bubble = $('bubble'), tip = $('tip');
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshBasicMaterial());
  proxy.visible = false;
  proxy.position.y = 0.3;
  rig.object.add(proxy);
  let bubbleFor = 0;
  const say = () => {
    const c = d.cat;
    bubble.textContent = c.asleep ? `${c.name} is fast asleep. Shh!` : `${c.doing || 'Pottering about'}${c.mood ? ` and feeling ${c.mood}` : ''}.`;
    bubble.hidden = false;
    bubbleFor = 6;
    if (!c.asleep && !life.moving) rig.play('happy');
  };
  $('ask').addEventListener('click', say);
  const aim = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return r;
  };
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8 || performance.now() - downAt.t > 600) return;
    aim(e);
    if (ray.intersectObject(proxy, false).length) say();
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = aim(e);
    const hit = ray.intersectObjects(markers, true)[0];
    let m = hit ? hit.object : null;
    while (m && !m.userData.name) m = m.parent;
    if (m) {
      tip.textContent = m.userData.name;
      tip.style.left = `${e.clientX - r.left}px`;
      tip.style.top = `${e.clientY - r.top}px`;
      tip.hidden = false;
    } else tip.hidden = true;
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });

  // Size and sharpness: at most 2 device pixels per CSS pixel (1.5 on phones), lowered by itself
  // if frames come too slowly.
  const post = makePost(renderer, d.cat.look.outline);
  let ratio = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2);
  const resize = () => {
    const w = holder.clientWidth || 300, h = holder.clientHeight || 300;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    post.setSize(w, h, ratio);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(holder);
  let onScreen = true;
  new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; }).observe(holder);
  post.uniforms.uShimmer.value = d.weather.kind === 'hot' && !calm ? 1 : 0;
  post.uniforms.uNight.value = night ? 1 : d.time.part === 'dusk' ? 0.3 : 0;

  const clock = new THREE.Clock();
  let t = 0, slow = 0, fast = 0, flash = 0, nextFlash = 6, posTimer = 0, lampTimer = 0;
  const head = new THREE.Vector3();
  const lampOrder = () => {
    const c = controls.now.target;
    const near = world.lights.slice().sort((p, q) => p.distanceToSquared(c) - q.distanceToSquared(c));
    lampLights.forEach((l, i) => { if (near[i]) l.position.copy(near[i]); });
  };
  const frame = () => {
    window.requestAnimationFrame(frame);
    const raw = clock.getDelta(), dt = Math.min(0.1, raw);
    if (!onScreen || document.hidden) return;
    t += dt;
    life.update(Math.min(0.25, raw));                // a slow device still sees the cat get there
    if (controls.follow) {
      const want = life.pos.clone();
      want.y += 0.7;
      controls.goal.target.copy(want);
      // From a 3/4 side while it walks (you see the waddle), from the front-ish when it stops.
      if (!calm && !userTurned) controls.goal.theta += angleTo(controls.goal.theta, life.heading + (life.moving ? 0.85 : 0.35)) * Math.min(1, dt * 0.8);
      if (controls.goal.radius > 7) controls.goal.radius += (5.5 - controls.goal.radius) * Math.min(1, dt * 2);
      if (!calm && !userTurned) controls.goal.phi += (1.12 - controls.goal.phi) * Math.min(1, dt * 0.8);
    }
    controls.update(dt);
    sky.position.copy(camera.position);
    // The sun's shadow box follows the view, snapped to its pixels so shadows don't shimmer.
    const c = controls.now.target;
    const snap = 48 / 1024;
    sun.target.position.set(Math.round(c.x / snap) * snap, 0, Math.round(c.z / snap) * snap);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 70);
    if (lampLights.length && (lampTimer -= dt) <= 0) { lampTimer = 0.5; lampOrder(); }
    // Peek inside: the cottage's roof and front wall lift away when you look at it up close.
    const room = world.info.get('room');
    if (room && room.cutaway) {
      const close = Math.hypot(c.x - room.holder.position.x, c.z - room.holder.position.z) < room.radius + 3 && controls.now.radius < 20;
      room.cutaway.visible = !close;
      // No rain falling into the room while its roof is off.
      if (weather) weather.uHole.value.set(room.holder.position.x, room.holder.position.z, close ? room.radius * 0.95 : 0, 60);
    }
    SWAY.uTime.value = t;
    if (weather) {
      weather.uTime.value = t;
      weather.uCentre.value.copy(c);
    }
    world.clouds.rotation.y = t * 0.004;
    for (const b of world.birds) {
      const a = t * b.speed + b.phase;
      b.obj.position.set(world.ground.centre.x + Math.sin(a) * b.r, b.h + Math.sin(t * 0.7 + b.phase) * 0.6, world.ground.centre.z + Math.cos(a) * b.r);
      b.obj.rotation.set(0, a + Math.PI / 2, Math.sin(t * 9 + b.phase) * 0.12);
    }
    for (const b of world.bobbers) {
      b.obj.position.y = b.y + Math.sin(t * 1.3) * 0.06;
      b.obj.rotation.z = Math.sin(t * 0.9) * 0.05;
    }
    for (const m of markers) m.userData.star.rotation.y = t * 1.5;
    if (zzz) {
      rig.head.getWorldPosition(head);
      zzz.position.set(head.x + 0.3, head.y + 0.55 + Math.sin(t) * 0.05, head.z);
    }
    if (d.weather.kind === 'storm' && !calm) {
      if ((nextFlash -= dt) <= 0) { flash = 0.35; nextFlash = 7 + Math.random() * 8; }
      flash = Math.max(0, flash - dt * 1.6);
      post.uniforms.uFlash.value = flash > 0.2 ? flash * 0.6 : 0;
    }
    post.uniforms.uTime.value = calm ? 0 : t;
    if (bubbleFor > 0) {
      bubbleFor -= dt;
      rig.head.getWorldPosition(head);
      head.y += 0.75;
      head.project(camera);
      bubble.style.left = `${((head.x + 1) / 2) * 100}%`;
      bubble.style.top = `${((1 - head.y) / 2) * 100}%`;
      if (bubbleFor <= 0) bubble.hidden = true;
    }
    if ((posTimer -= dt) <= 0) {
      posTimer = 0.25;
      const p = `${life.pos.x.toFixed(1)},${life.pos.z.toFixed(1)}`;
      if (p !== lastPos) body.dataset.baoPos = lastPos = p;
      body.dataset.bao = rig.clip();
    }
    post.render(scene, camera);
    // Too slow? Draw fewer pixels (down to 1 per CSS pixel).
    if (dt > 0.045) slow += dt; else fast += dt;
    if (slow > 2 && ratio > 1) { ratio = Math.max(1, ratio - 0.25); slow = fast = 0; resize(); }
    if (fast > 4) slow = fast = 0;
  };
  body.dataset.models = `${kit ? 'kit' : 'stand-in kit'}, ${cat ? 'cat model' : 'stand-in cat'}`;
  frame();
  body.dataset.world = 'ready';
}

async function loadWorld() {
  const inline = window.CAT_WORLD;
  if (inline && typeof inline === 'object') return inline;
  const res = await fetch('../api/v1/world.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('not found');
  return res.json();
}

async function boot() {
  let raw;
  try {
    raw = await loadWorld();
  } catch (e) {
    showMessage("The cat's world couldn't be loaded just now. Please try again a bit later.");
    document.body.dataset.world = 'no-data';
    return;
  }
  const d = clean(raw);
  if (!SCHEMAS.includes(d.schema)) {
    showMessage("The cat's world has a newer format than this page understands. Try reloading the page.");
    document.body.dataset.world = 'no-data';
    return;
  }
  fillWords(d);
  THREE = window.THREEBUNDLE && window.THREEBUNDLE.WebGLRenderer ? window.THREEBUNDLE : null;
  if (!THREE || !webglWorks()) {
    showFallback(d, "This device can't draw the 3D world, so here is a drawing of the cat instead.");
    document.body.dataset.world = 'fallback';
    return;
  }
  try {
    await startWorld(d);
  } catch (e) {
    $('view').replaceChildren();
    showFallback(d, "The 3D world couldn't start on this device, so here is a drawing of the cat instead.");
    document.body.dataset.world = 'fallback';
    document.body.dataset.error = String(e && e.message).slice(0, 200);
  }
}

// Deferred scripts all run before DOMContentLoaded, so three.js is ready by then.
// (A deferred script runs while readyState is already 'interactive', so don't test for 'loading'.)
if (document.readyState === 'complete') boot();
else document.addEventListener('DOMContentLoaded', boot);
})();
