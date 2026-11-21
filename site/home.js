// The home page's 3D story. Every word on the page was written by the server; this script only
// moves things: the cat (the 3D world's own three.js bundle and bao.glb), his giant name, the
// captions, the need labels and the thought bubbles. Its numbers come from data-* attributes.
// No WebGL -> the calm page (the "calm" class). Reduce motion -> nothing moves at all.
(function () {
  'use strict';
  var root = document.documentElement;
  var story = document.getElementById('story');
  if (!story || !window.requestAnimationFrame || !window.Promise) { return; }
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var byId = function (id) { return document.getElementById(id); };
  var all = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var clamp = function (x, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return Math.min(b, Math.max(a, x)); };
  var smooth = function (a, b, x) { var t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  // ---------- below the story: words slide in, numbers count up (never with reduce motion) ----------
  var canWatch = 'IntersectionObserver' in window;
  if (canWatch && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); } });
    }, { threshold: 0.2 });
    all('.reveal').forEach(function (el) {
      if (el.getBoundingClientRect().top > window.innerHeight) { el.classList.add('pre'); io.observe(el); }
    });
    var once = function (el, fn) {
      if (!el || el.getBoundingClientRect().top < window.innerHeight) { return; }
      var o = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { o.disconnect(); fn(); } }, { threshold: 0.3 });
      o.observe(el);
    };
    var pulls = byId('pulls');
    once(pulls, function () {
      if (!pulls.children[0] || !pulls.children[0].animate) { return; }
      Array.prototype.slice.call(pulls.children).forEach(function (s, i) {
        s.animate([{ opacity: 0, transform: 'translateY(30px)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
          { duration: 900, delay: i * 90, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
      });
    });
    all('[data-count]').forEach(function (b) {
      once(b, function () {
        var end = parseInt(b.getAttribute('data-count'), 10) || 0, t0 = performance.now();
        var step = function (t) {
          var k = clamp((t - t0) / 1200);
          b.textContent = String(Math.round(end * (1 - Math.pow(1 - k, 3))));
          if (k < 1) { requestAnimationFrame(step); }
        };
        requestAnimationFrame(step);
      });
    });
  }
  if (reduce) { return; }

  // ---------- no WebGL: the calm page (his drawing, everything in the normal flow) ----------
  var probe = document.createElement('canvas');
  var hasGL = false;
  try {
    var gl = window.WebGLRenderingContext && (probe.getContext('webgl2') || probe.getContext('webgl'));
    hasGL = !!gl;
    // give the test context straight back (Chromebooks only have a few)
    var lose = gl && gl.getExtension('WEBGL_lose_context');
    if (lose) { lose.loseContext(); }
  } catch (e) { hasGL = false; }
  if (!hasGL) { root.classList.add('calm'); return; }

  // ---------- his needs (one brain region each) and his thought bubbles, from the page ----------
  var ANCHORS = { learning: [0.0, 0.42, 0.72], comfort: [0.0, 0.62, -0.1], food: [0.0, -0.45, -0.62],
    energy: [0.0, 0.2, -0.78], fun: [0.95, 0.05, 0.1], social: [-0.95, -0.12, 0.15] };
  var SPARE = [[0.6, 0.5, 0.4], [-0.6, 0.5, 0.4], [0.6, -0.3, -0.3], [-0.6, -0.3, -0.3]];
  var needEls = all('#needs .need');
  var NEEDS = needEls.map(function (el, i) {
    var key = el.getAttribute('data-need') || '';
    var colour = el.getAttribute('data-colour') || '';
    return { v: clamp(parseFloat(el.getAttribute('data-level')) || 0),
      c: /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#f28c28',
      at: ANCHORS.hasOwnProperty(key) ? ANCHORS[key] : SPARE[i % SPARE.length] };
  });
  var bubbles = all('#bubbles .bubble');
  bubbles.forEach(function (b) {
    [10, 16].forEach(function (s) {
      var t = document.createElement('span');
      t.className = 'tail'; t.style.width = s + 'px'; t.style.height = s + 'px';
      b.appendChild(t);
    });
  });

  var hero = byId('hero'), mind = byId('mind'), stage = byId('stage');
  var els = { giant: byId('giant'), heroTop: byId('heroTop'), c1: byId('c1'), c2: byId('c2'), c3: byId('c3'), aura: byId('aura') };
  var letters = els.giant ? Array.prototype.slice.call(els.giant.children) : [];
  var prog = function (el) { var r = el.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height - window.innerHeight)); };
  var S = { h: prog(hero), m: prog(mind) };
  var three = null;        // filled in once three.js and the model are ready
  var visible = true, running = false, last = 0, t = 0;

  // Where things go on the screen when there is no 3D head to follow yet (or the model failed).
  var restingHead = function (W, H) { return [W / 2, H * 0.56]; };
  var restingNeed = function (i, W, H) {
    var n = Math.max(1, NEEDS.length), a = -Math.PI / 2 + (i + 0.5) * (2 * Math.PI / n), r = Math.min(W, H) * 0.16;
    return [W / 2 + Math.cos(a) * r * 1.6, H * 0.68 + Math.sin(a) * r];
  };

  function frame(now) {
    if (!visible) { running = false; return; }
    var dt = Math.min(last ? (now - last) / 1000 : 0.016, 0.05);
    last = now; t += dt;
    var k = 1 - Math.pow(0.0009, dt);
    S.h += (prog(hero) - S.h) * k; S.m += (prog(mind) - S.m) * k;
    var h = S.h, m = S.m, W = window.innerWidth, H = stage.clientHeight, narrow = W <= 760;
    var xray = smooth(0.22, 0.38, m), map = smooth(0.38, 0.5, m);
    if (three) { three.draw(dt, h, m); }

    // hero: the letters part and fade as he steps forward
    letters.forEach(function (l, i) {
      var d = (i - (letters.length - 1) / 2) * smooth(0.1, 0.8, h) * 60 * Math.min(1, window.innerWidth / 900);
      l.style.transform = 'translateX(' + d + 'px) translateY(' + (smooth(0.1, 0.8, h) * (i === 1 ? 30 : -10)) + 'px)';
    });
    if (els.giant) { els.giant.style.opacity = String(1 - smooth(0.4, 0.85, h)); }
    if (els.heroTop) { els.heroTop.style.opacity = String(1 - smooth(0.12, 0.45, h)); }
    if (els.c1) { els.c1.style.opacity = String(m < 0.005 ? smooth(0.7, 1, h) : smooth(0, 0.04, m) * (1 - smooth(0.17, 0.23, m))); }
    if (els.c2) { els.c2.style.opacity = String(smooth(0.27, 0.32, m) * (1 - smooth(0.6, 0.65, m))); }
    if (els.c3) { els.c3.style.opacity = String(smooth(0.68, 0.73, m)); }
    if (els.aura) { els.aura.style.opacity = String((three ? xray : 0) * (0.85 + 0.15 * Math.sin(t * 1.3))); }

    // need labels: in with the colour map, out when the bubbles come
    var tagA = map * (1 - smooth(0.64, 0.7, m));
    needEls.forEach(function (d, i) {
      if (tagA < 0.01) { d.style.opacity = '0'; return; }
      var p = three ? three.needAt(i, W, H) : restingNeed(i, W, H);
      var left = p[0] < W / 2, off = narrow ? 8 : 14;
      d.style.opacity = String(tagA * clamp(smooth(0.4 + i * 0.015, 0.46 + i * 0.015, m) * 1.2));
      d.style.transform = 'translate(' + (left ? p[0] - d.offsetWidth - off : p[0] + off) + 'px, ' + (p[1] - 8) + 'px)';
    });

    // thought bubbles rise from the top of his head, two little tail dots pointing back at him
    var head = three ? three.headAt(W, H) : restingHead(W, H);
    var hx = head[0], hy = head[1], stack = H * 0.25, placed = [];
    bubbles.forEach(function (b, i) {
      var a = smooth(0.72 + i * 0.07, 0.78 + i * 0.07, m);
      if (a < 0.01) { b.style.opacity = '0'; return; }
      var bw = b.offsetWidth, bh = b.offsetHeight, bx, by;
      if (narrow) { bx = [12, W - bw - 12, 12][i % 3]; by = stack; }
      else { bx = [hx - W * 0.17 - bw, hx + W * 0.17, hx + W * 0.2][i % 3]; by = hy + [-0.2, -0.27, 0.0][i % 3] * H; }
      bx = clamp(bx, 12, Math.max(12, W - bw - 12)); by = clamp(by, H * 0.3, Math.max(H * 0.3, H - bh - 12));
      if (narrow) { by = stack; stack += bh + 12; } else {
        // never on top of a bubble already placed: slide down below it
        placed.forEach(function (q) {
          if (bx < q[0] + q[2] && bx + bw > q[0] && by < q[1] + q[3] + 12 && by + bh + 12 > q[1]) { by = q[1] + q[3] + 12; }
        });
        placed.push([bx, by, bw, bh]);
      }
      var rise = (1 - a) * 40 + Math.sin(t * 0.9 + i * 2) * 4;
      b.style.opacity = String(a);
      b.style.transform = 'translate(' + bx + 'px, ' + (by + rise) + 'px) scale(' + (0.85 + 0.15 * a) + ')';
      var side = narrow ? 0 : (bx > hx ? -1 : 1);
      var cx = side < 0 ? bx : side > 0 ? bx + bw : bx + bw / 2, cy = (side ? by + bh * 0.8 : by + bh) + rise;
      Array.prototype.slice.call(b.querySelectorAll('.tail')).forEach(function (d, j) {
        var f = j === 0 ? 0.55 : 0.28, s = parseFloat(d.style.width);
        d.style.left = (lerp(cx, hx, f) - bx - s / 2) + 'px';
        d.style.top = (lerp(cy, hy, f) - by - rise - s / 2) + 'px';
      });
    });
    requestAnimationFrame(frame);
  }
  function start() { if (!running && visible) { running = true; last = 0; requestAnimationFrame(frame); } }

  // Only draw while the story is on the screen (school Chromebooks say thank you).
  var loading = false;
  if (canWatch) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) { start(); }
    }, { rootMargin: '100px 0px' }).observe(story);
    // three.js is big: only fetch it once the story is close to the screen.
    var near = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !loading) { loading = true; near.disconnect(); boot(); }
    }, { rootMargin: '600px 0px' });
    near.observe(story);
  } else {
    loading = true; boot();
  }
  start();

  function boot() {
    loadThree().then(function (T) {
      if (!T || !T.WebGLRenderer || !T.GLTFLoader) { throw new Error('three'); }
      return fetch('world/models/bao.glb').then(function (res) {
        if (!res.ok) { throw new Error('model'); }
        return res.arrayBuffer();
      }).then(function (buf) {
        return new Promise(function (resolve, reject) { new T.GLTFLoader().parse(buf, '', resolve, reject); });
      }).then(function (gltf) { three = makeThree(T, gltf); });
    }).catch(function () { /* no 3D after all: his drawing stays on the stage */ });
  }

  // ---------- the 3D cat and the brain inside his head ----------
  function makeThree(T, gltf) {
    var renderer = new T.WebGLRenderer({ canvas: byId('gl'), antialias: true, alpha: true, powerPreference: 'default' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    // If the graphics chip takes the 3D away, his drawing comes back (labels to resting places).
    byId('gl').addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); three = null; story.classList.remove('ready');
    });
    if (T.ACESFilmicToneMapping) { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(28, 1, 0.01, 50);
    scene.add(new T.HemisphereLight(0xfff1dc, 0x2a1433, 1.15));
    var key = new T.DirectionalLight(0xfff4e8, 2.4); key.position.set(1.4, 2.2, 2.0); scene.add(key);
    var rimL = new T.DirectionalLight(0xff9a4a, 2.4); rimL.position.set(-2, 1.2, -1.6); scene.add(rimL);
    var rimR = new T.DirectionalLight(0x29c4b4, 1.4); rimR.position.set(2, 0.6, -1.8); scene.add(rimR);

    var glowTexture = function (stops) {
      var c = document.createElement('canvas'); c.width = 256; c.height = 256;
      var g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      return new T.CanvasTexture(c);
    };
    var floor = new T.Mesh(new T.PlaneGeometry(0.8, 0.8), new T.MeshBasicMaterial({
      map: glowTexture([[0, 'rgba(0,0,0,0.55)'], [0.55, 'rgba(0,0,0,0.18)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.088; scene.add(floor);

    var U = { sil: { value: 0 }, xray: { value: 0 }, rim: { value: new T.Color(0xf28c28) } };
    var pivot = new T.Group(); scene.add(pivot);
    var headBone = null, needAnchors = [];

    function shellify(m) {
      m.transparent = true;
      m.onBeforeCompile = function (sh) {
        sh.uniforms.uSil = U.sil; sh.uniforms.uXray = U.xray; sh.uniforms.uRim = U.rim;
        sh.fragmentShader = 'uniform float uSil;\nuniform float uXray;\nuniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
          '#include <dithering_fragment>\n' +
          '  vec3 vdir = normalize(vViewPosition);\n' +
          '  float fr = 1.0 - clamp(abs(dot(normalize(normal), vdir)), 0.0, 1.0);\n' +
          '  vec3 sil = uRim * pow(fr, 2.4) * (1.3 + uXray * 0.5) + vec3(0.06, 0.03, 0.07) * (1.0 - fr);\n' +
          '  gl_FragColor.rgb = mix(gl_FragColor.rgb, sil, uSil);\n' +
          '  gl_FragColor.a *= mix(1.0, clamp(pow(fr, 1.9) * 1.1 + 0.03, 0.0, 1.0), uXray);');
      };
      m.needsUpdate = true;
    }

    // The brain: two folded halves and a little cerebellum; each point glows in the colour of
    // the nearest need region, as bright as that need is full.
    function makeBrain() {
      var N = window.innerWidth < 600 ? 2200 : 3000;
      var pos = new Float32Array(N * 3), rnd = new Float32Array(N), col = new Float32Array(N * 3), lvl = new Float32Array(N);
      var v = new T.Vector3(), cols = NEEDS.map(function (n) { return new T.Color(n.c); });
      for (var i = 0; i < N; i++) {
        var side = i % 2 ? 1 : -1, x, y, z;
        v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        if (i < N * 0.1) {
          x = v.x * 0.44; y = v.y * 0.24 - 0.42; z = v.z * 0.3 - 0.6;
          var f = 1 + 0.06 * Math.sin(v.y * 40); x *= f; y *= f;
        } else {
          if (v.x * side < -0.2) { v.x = -v.x; }
          var th = Math.atan2(v.y, v.z), ph = Math.acos(clamp(v.x, -1, 1));
          var fold = 1 + 0.07 * Math.sin(16 * th + 5 * Math.sin(7 * ph)) + 0.03 * Math.sin(31 * ph + 3 * th);
          var inner = Math.random() < 0.16 ? 0.55 + Math.random() * 0.4 : 1;
          x = side * 0.5 + v.x * 0.48 * fold * inner; y = v.y * 0.6 * fold * inner; z = v.z * 0.82 * fold * inner;
          if (y < -0.3) { y = -0.3 + (y + 0.3) * 0.35; }
          if (Math.abs(x) < 0.04) { x = side * 0.04; }
        }
        var best = 0, bd = 1e9;
        NEEDS.forEach(function (n, k) {
          var d = (x - n.at[0]) * (x - n.at[0]) + (y - n.at[1]) * (y - n.at[1]) + (z - n.at[2]) * (z - n.at[2]);
          if (d < bd) { bd = d; best = k; }
        });
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; rnd[i] = Math.random();
        var c = cols[best] || new T.Color(0xf28c28);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; lvl[i] = NEEDS[best] ? NEEDS[best].v : 0.5;
      }
      var g = new T.BufferGeometry();
      g.attributes.position = new T.BufferAttribute(pos, 3);
      g.attributes.aRand = new T.BufferAttribute(rnd, 1);
      g.attributes.aCol = new T.BufferAttribute(col, 3);
      g.attributes.aLvl = new T.BufferAttribute(lvl, 1);
      var pu = { uTime: { value: 0 }, uOp: { value: 0 }, uFire: { value: 0 }, uMap: { value: 0 }, uScale: { value: 1 }, uWarm: { value: new T.Color(0xf28c28) } };
      var pts = new T.Points(g, new T.ShaderMaterial({
        uniforms: pu, transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending,
        vertexShader: 'attribute float aRand; attribute vec3 aCol; attribute float aLvl; uniform float uTime; uniform float uFire; uniform float uMap; uniform float uScale; uniform vec3 uWarm;\n' +
          'varying vec3 vC; varying float vB;\n' +
          'void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);\n' +
          '  float wave = sin(uTime*1.5 + position.z*7.0 + position.y*3.0 + aRand*6.283);\n' +
          '  float rate = mix(0.6, 3.4, aLvl);\n' +
          '  float spark = smoothstep(0.94, 1.0, sin(uTime*(rate+aRand*2.0) + aRand*40.0));\n' +
          '  float lv = mix(0.55, mix(0.08, 1.0, aLvl), uMap);\n' +
          '  vB = lv * (0.6 + 0.3*wave*uFire) + spark*1.5*uFire*mix(0.15,1.0,aLvl);\n' +
          '  vC = mix(uWarm, aCol, uMap);\n' +
          '  gl_PointSize = (1.6 + spark*2.6*uFire + aRand*0.8) * uScale / -mv.z;\n' +
          '  gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform float uOp; varying vec3 vC; varying float vB;\n' +
          'void main(){ float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(vC * vB, a * uOp); }'
      }));
      var L = [], T0 = [], SD = [], LC = [];
      for (var q = 0; q < 1000; q++) {
        var a = Math.floor(Math.random() * N), bi = -1, bdist = 1e9;
        for (var tr = 0; tr < 40; tr++) {
          var b = Math.floor(Math.random() * N); if (b === a) { continue; }
          var dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
          var dd = dx * dx + dy * dy + dz * dz;
          if (dd < bdist && dd > 0.004) { bdist = dd; bi = b; }
        }
        if (bi < 0 || bdist > 0.06) { continue; }
        L.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[bi * 3], pos[bi * 3 + 1], pos[bi * 3 + 2]);
        T0.push(0, 1); var sd = Math.random(); SD.push(sd, sd);
        LC.push(col[a * 3], col[a * 3 + 1], col[a * 3 + 2], col[a * 3], col[a * 3 + 1], col[a * 3 + 2]);
      }
      var lg = new T.BufferGeometry();
      lg.attributes.position = new T.Float32BufferAttribute(L, 3);
      lg.attributes.aT = new T.Float32BufferAttribute(T0, 1);
      lg.attributes.aSeed = new T.Float32BufferAttribute(SD, 1);
      lg.attributes.aCol = new T.Float32BufferAttribute(LC, 3);
      var lines = new T.LineSegments(lg, new T.ShaderMaterial({
        uniforms: pu, transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending,
        vertexShader: 'attribute float aT; attribute float aSeed; attribute vec3 aCol; uniform float uMap; uniform vec3 uWarm; varying float vT; varying float vS; varying vec3 vC;\n' +
          'void main(){ vT=aT; vS=aSeed; vC = mix(uWarm, aCol, uMap); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'uniform float uTime; uniform float uOp; uniform float uFire; varying float vT; varying float vS; varying vec3 vC;\n' +
          'void main(){ float head = fract(uTime*(0.35+vS*0.5) + vS*13.0); float g = smoothstep(0.18, 0.0, abs(vT-head));\n' +
          '  gl_FragColor = vec4(vC * (0.6+g), (0.05 + g*0.85*uFire) * uOp);}'
      }));
      var glow = new T.Sprite(new T.SpriteMaterial({
        map: glowTexture([[0, 'rgba(255,170,90,0.5)'], [0.45, 'rgba(160,70,140,0.16)'], [1, 'rgba(0,0,0,0)']]),
        transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }));
      glow.scale.set(3.4, 3.0, 1);
      var grp = new T.Group(); grp.add(glow, lines, pts);
      pts.renderOrder = 10; lines.renderOrder = 10; glow.renderOrder = 10;
      NEEDS.forEach(function (n) {
        var o = new T.Object3D(); o.position.set(n.at[0] * 1.05, n.at[1] * 1.05, n.at[2] * 1.05); grp.add(o); needAnchors.push(o);
      });
      grp.userData = { pu: pu, glow: glow };
      return grp;
    }

    var cat = gltf.scene;
    cat.traverse(function (o) {
      if (o.isMesh) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(shellify); o.frustumCulled = false; }
      if (o.name === 'head') { headBone = o; }
    });
    pivot.add(cat);
    var mixer = new T.AnimationMixer(cat);
    var idle = (gltf.animations || []).filter(function (a) { return a.name === 'idle'; })[0];
    if (idle) { mixer.clipAction(idle).play(); }
    var brain = makeBrain(); brain.scale.setScalar(0.105); brain.position.set(0, 0.03, -0.01);
    (headBone || pivot).add(brain);

    function resize() {
      var w = window.innerWidth, h = stage.clientHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      var down = (w / h < 0.85 ? 0.08 : 0.15) * h; camera.setViewOffset(w, h, 0, -down, w, h); camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize); resize();
    var tmp = new T.Vector3();
    var toScreen = function (o, W, H) { o.getWorldPosition(tmp); tmp.project(camera); return [(tmp.x * 0.5 + 0.5) * W, (-tmp.y * 0.5 + 0.5) * H]; };
    var first = true;

    return {
      draw: function (dt, h, m) {
        var sil = smooth(0.05, 0.2, m), xray = smooth(0.22, 0.38, m), bOp = smooth(0.26, 0.42, m);
        var map = smooth(0.38, 0.5, m), fire = smooth(0.34, 0.52, m);
        var zoom = smooth(0.2, 0.46, m) * (1 - 0.3 * smooth(0.66, 0.8, m));
        U.sil.value = sil; U.xray.value = xray;
        var portrait = camera.aspect < 0.85;
        var dist = lerp(2.5, 2.0, smooth(0, 1, h)); dist = lerp(dist, 1.2, zoom);
        if (portrait) { dist *= 1.7; }
        var ty = lerp(0.31, 0.36, zoom) + (portrait ? lerp(-0.02, -0.06, zoom) : 0);
        var orbit = lerp(-0.5, 0.2, smooth(0, 1, h)) + lerp(0, 0.4, smooth(0.08, 0.45, m)) - smooth(0.66, 1, m) * 0.6 + Math.sin(t * 0.25) * 0.04;
        camera.position.set(Math.sin(orbit) * dist, ty + lerp(0.12, 0.2, zoom) * dist * 0.35, Math.cos(orbit) * dist);
        camera.lookAt(0, ty, 0);
        floor.material.opacity = 1 - sil;
        var pu = brain.userData.pu, H = stage.clientHeight;
        pu.uTime.value = t; pu.uOp.value = bOp; pu.uFire.value = fire; pu.uMap.value = map;
        pu.uScale.value = renderer.getPixelRatio() * H * 0.0032;
        brain.userData.glow.material.opacity = bOp * (0.5 + 0.2 * Math.sin(t * 1.3) * fire);
        brain.scale.setScalar(0.105 * (1 + 0.025 * Math.sin(t * 1.3) * fire));
        mixer.update(dt * (1 - 0.6 * xray));
        renderer.render(scene, camera);
        if (first) { first = false; story.classList.add('ready'); }
      },
      needAt: function (i, W, H) { return needAnchors[i] ? toScreen(needAnchors[i], W, H) : restingNeed(i, W, H); },
      headAt: function (W, H) { return toScreen(brain, W, H); }
    };
  }
}());

function loadThree() {
  return new Promise(function (resolve, reject) {
    if (window.THREEBUNDLE) { resolve(window.THREEBUNDLE); return; }
    var tag = document.createElement('script');
    tag.setAttribute('src', 'world/vendor/three-bundle.min.js');
    tag.onload = function () { if (window.THREEBUNDLE) { resolve(window.THREEBUNDLE); } else { reject(new Error('three')); } };
    tag.onerror = function () { reject(new Error('three')); };
    document.head.appendChild(tag);
  });
}
