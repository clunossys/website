/* Clunossys weboldal: futtató a komponensekhez.
   A komponensek sablonja és kódja a design canvasból jön, változtatás nélkül. Ez a fájl adja alájuk azt,
   amit a canvason a szerkesztő ad: kitölti a sablon {{...}} helyeit, kezeli a feltételes részeket (sc-if),
   a beágyazott komponenseket (dc-import), az eseményeket és az állapotot (setState). */
(function () {
  'use strict';
  var REG = window.__CNS_COMPONENTS = window.__CNS_COMPONENTS || {};
  var SSR = !!window.__CNS_SSR;
  var EVENTS = { change: 'input' };

  function DCLogic() { this.props = {}; }
  DCLogic.prototype.setState = function (part) {
    var next = {}, k, cur = this.state || {};
    for (k in cur) { next[k] = cur[k]; }
    for (k in part) { next[k] = part[k]; }
    this.state = next;
    if (this.__inst) { this.__inst.update(); }
  };
  window.DCLogic = DCLogic;

  // Egy {{...}} hely értéke: szó szerinti érték (true, false, null, szám, 'szöveg') vagy útvonal a renderVals eredményében
  function ev(expr, vals) {
    expr = expr.trim();
    if (expr === 'true') { return true; }
    if (expr === 'false') { return false; }
    if (expr === 'null' || expr === 'undefined') { return null; }
    if (/^-?\d+(\.\d+)?$/.test(expr)) { return parseFloat(expr); }
    var q = expr.charAt(0);
    if ((q === '"' || q === "'") && expr.charAt(expr.length - 1) === q) { return expr.slice(1, -1); }
    var parts = expr.split('.'), v = vals;
    for (var i = 0; i < parts.length; i++) {
      if (v === null || v === undefined) { return null; }
      v = v[parts[i]];
    }
    return v === undefined ? null : v;
  }
  // "szöveg {{a}} szöveg" darabokra: [szöveg, {expr}, szöveg]
  function split(str) {
    var out = [], re = /\{\{([^}]*)\}\}/g, last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) { out.push(str.slice(last, m.index)); }
      out.push({ expr: m[1] });
      last = re.lastIndex;
    }
    if (last < str.length) { out.push(str.slice(last)); }
    return out;
  }
  function whole(parts) { return parts.length === 1 && typeof parts[0] !== 'string'; }
  function join(parts, vals) {
    var s = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (typeof p === 'string') { s += p; } else { var v = ev(p.expr, vals); s += (v === null || v === false) ? '' : String(v); }
    }
    return s;
  }
  function parse(html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    return t.content;
  }

  // Egy hatókör: a sablon egy darabjának kötései. Az sc-if tartalma saját hatókört kap, ami a feltétellel együtt él.
  function Scope(inst) { this.inst = inst; this.ups = []; this.kids = []; this.blocks = []; }
  Scope.prototype.run = function (vals) { for (var i = 0; i < this.ups.length; i++) { this.ups[i](vals); } };
  Scope.prototype.each = function (fn) {
    this.kids.forEach(function (k) { k.each(fn); });
    this.blocks.forEach(function (b) { if (b.scope) { b.scope.each(fn); } });
  };

  function walk(parent, scope) {
    var inst = scope.inst;
    Array.prototype.slice.call(parent.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        if (n.nodeValue.indexOf('{{') < 0) { return; }
        var tp = split(n.nodeValue), lastT = null;
        scope.ups.push(function (vals) { var s = join(tp, vals); if (s !== lastT) { lastT = s; n.nodeValue = s; } });
        return;
      }
      if (n.nodeType !== 1) { return; }
      var tag = n.localName;
      if (tag === 'sc-if') {
        var cond = split(n.getAttribute('value') || '')[0];
        var anchor = document.createComment('');
        var tpl = document.createDocumentFragment();
        while (n.firstChild) { tpl.appendChild(n.firstChild); }
        parent.replaceChild(anchor, n);
        var block = { nodes: [], scope: null };
        scope.blocks.push(block);
        scope.ups.push(function (vals) {
          var on = !!(cond && ev(cond.expr, vals));
          if (on && !block.scope) {
            var frag = tpl.cloneNode(true);
            block.scope = new Scope(inst);
            walk(frag, block.scope);
            block.scope.run(vals);
            block.nodes = Array.prototype.slice.call(frag.childNodes);
            anchor.parentNode.insertBefore(frag, anchor);
            if (inst.mounted) { block.scope.each(function (c) { c.didMount(); }); }
          } else if (!on && block.scope) {
            block.scope.each(function (c) { c.willUnmount(); });
            block.nodes.forEach(function (x) { if (x.parentNode) { x.parentNode.removeChild(x); } });
            block.nodes = []; block.scope = null;
          } else if (on) {
            block.scope.run(vals);
          }
        });
        return;
      }
      if (tag === 'dc-import') {
        var name = n.getAttribute('name');
        var spec = [];
        Array.prototype.slice.call(n.attributes).forEach(function (a) {
          if (a.name === 'name' || a.name.indexOf('hint-') === 0) { return; }
          spec.push({ name: a.name, parts: split(a.value) });
        });
        var props = function (vals) {
          var p = {};
          spec.forEach(function (s) { p[s.name] = whole(s.parts) ? ev(s.parts[0].expr, vals) : join(s.parts, vals); });
          return p;
        };
        var child = new Inst(name, props(inst.vals));
        parent.replaceChild(child.build(), n);
        scope.kids.push(child);
        scope.ups.push(function (vals) {
          if (!child.built) { return; }
          var np = props(vals), ch = false, k;
          for (k in np) { if (np[k] !== child.comp.props[k]) { ch = true; } }
          if (ch) { child.comp.props = np; child.update(); }
        });
        return;
      }
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        var an = a.name, av = a.value;
        if (an.indexOf('hint-') === 0) { n.removeAttribute(an); return; }
        if (av.indexOf('{{') < 0) { return; }
        var parts = split(av);
        if (/^on[a-z]+$/.test(an) && whole(parts)) {
          n.removeAttribute(an);
          var type = an.slice(2); type = EVENTS[type] || type;
          n.addEventListener(type, function (e) { var f = ev(parts[0].expr, inst.vals); if (typeof f === 'function') { f(e); } });
          return;
        }
        var lastA;
        n.removeAttribute(an);
        scope.ups.push(function (vals) {
          var v = whole(parts) ? ev(parts[0].expr, vals) : join(parts, vals);
          if (v === true) { v = ''; }
          if (v === false || v === undefined) { v = null; }
          if (v !== null) { v = String(v); }
          if (v === lastA) { return; }
          lastA = v;
          if (v === null) { n.removeAttribute(an); } else { n.setAttribute(an, v); }
        });
      });
      walk(n, scope);
    });
  }

  function Inst(name, props) {
    var def = REG[name];
    if (!def) { throw new Error('Nincs ilyen komponens: ' + name); }
    this.name = name; this.def = def;
    this.comp = new def.cls();
    this.comp.props = props || {};
    this.comp.__inst = this;
    this.built = false; this.mounted = false;
  }
  Inst.prototype.build = function () {
    this.vals = this.comp.renderVals() || {};
    var frag = parse(this.def.tpl);
    this.scope = new Scope(this);
    walk(frag, this.scope);
    this.scope.run(this.vals);
    this.built = true;
    return frag;
  };
  Inst.prototype.update = function () {
    if (!this.built) { return; }
    this.vals = this.comp.renderVals() || {};
    this.scope.run(this.vals);
    if (this.mounted && !SSR && this.comp.componentDidUpdate) { this.comp.componentDidUpdate(); }
    if (window.__CNS_AFTER) { window.__CNS_AFTER(); }
  };
  Inst.prototype.each = function (fn) { this.scope.each(fn); fn(this); };
  Inst.prototype.didMount = function () {
    if (this.mounted) { return; }
    this.mounted = true;
    if (!SSR && this.comp.componentDidMount) { this.comp.componentDidMount(); }
  };
  Inst.prototype.willUnmount = function () {
    if (!this.mounted) { return; }
    this.mounted = false;
    if (!SSR && this.comp.componentWillUnmount) { this.comp.componentWillUnmount(); }
  };
  Inst.prototype.setProps = function (part) {
    var np = {}, k;
    for (k in this.comp.props) { np[k] = this.comp.props[k]; }
    for (k in part) { np[k] = part[k]; }
    this.comp.props = np;
    this.update();
  };

  // Egy oldal felépítése a megadott elembe: az előre renderelt tartalom helyére a működő komponensek kerülnek
  window.__CNS_MOUNT = function (el, name, props) {
    var root = new Inst(name, props);
    var frag = root.build();
    while (el.firstChild) { el.removeChild(el.firstChild); }
    el.appendChild(frag);
    root.each(function (c) { c.didMount(); });
    if (window.__CNS_AFTER) { window.__CNS_AFTER(); }
    return root;
  };
})();


/* ---- Fejlec (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  // Logó-animáció görgetésre ("Clunossys logó: görgetős átalakulás"), csak élő módban (live).
  // Időzítés változatlan: 260 ms út, 260 ms összehúzódás, 440 ms átadás, 140 ms után 320 ms C-ből c, összesen 720 ms.
  componentDidMount() {
    if (!this.props.live) { return; }
    this.onScroll = this.onScroll.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.measure = this.measure.bind(this);
    this.step = this.step.bind(this);
    var T = { travel: 260, collapse: 260, handover: 440, caseDelay: 140, caseMs: 320 };
    var dur = T.travel + Math.max(T.collapse, T.caseDelay + T.caseMs, T.handover);
    this.K = {
      DURATION: dur,
      TRAVEL_END: T.travel / dur,
      HANDOVER_END: (T.travel + T.handover) / dur,
      COLLAPSE_END: (T.travel + T.collapse) / dur,
      CASE_START: (T.travel + T.caseDelay) / dur,
      CASE_END: (T.travel + T.caseDelay + T.caseMs) / dur,
      CNS_LIFT: 0.09, C_BEARING: 0.045, HALF: 5, SWIPE_MIN: 12
    };
    this.progress = 0; this.target = 0; this.lastTime = null; this.frame = null; this.touchY = null;
    this.caseRatio = 0.75; this.points = []; this.lengths = []; this.total = 0; this.exitX = 0; this.underDist = 20;
    this.attach(0);
  }
  attach(tries) {
    var self = this;
    var root = document.getElementById(this.uid);
    if (!root || !root.querySelector('.lw')) {
      if (tries < 60) { requestAnimationFrame(function () { self.attach(tries + 1); }); }
      return;
    }
    this.rootEl = root;
    this.logoEl = root.querySelector('.logo');
    this.markEl = root.querySelector('.logo-mark');
    this.clewEl = root.querySelector('.logo-run');
    this.homeEl = root.querySelector('.logo-home');
    this.wordEl = root.querySelector('.lw');
    this.reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('resize', this.measure);
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(this.measure); }
    if (!this.atTop()) { this.target = 1; this.progress = 1; }
    this.measure();
  }
  componentWillUnmount() {
    clearTimeout(this.closeT);
    if (!this.rootEl) { return; }
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('resize', this.measure);
    if (this.frame !== null) { cancelAnimationFrame(this.frame); }
  }
  clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  smooth(v) { return v * v * (3 - 2 * v); }
  atTop() {
    var sc = document.scrollingElement || document.documentElement;
    return sc.scrollTop <= 0 && (window.scrollY || 0) <= 0;
  }
  measure() {
    var logo = this.logoEl, mark = this.markEl, word = this.wordEl;
    if (!logo || !mark || !word || !word.isConnected) { return; }
    logo.style.transform = 'none';
    var groups = Array.prototype.slice.call(word.querySelectorAll('.x'));
    var caps = Array.prototype.slice.call(word.querySelectorAll('.sw')).map(function (el) {
      return { el: el, lo: el.querySelector('.a'), up: el.querySelector('.b') };
    });
    groups.forEach(function (el) { el.style.width = ''; el.style.opacity = ''; });
    caps.forEach(function (c) { c.el.style.width = ''; c.lo.style.transform = ''; c.up.style.transform = ''; });
    this.groups = groups;
    this.caps = caps;
    this.widths = groups.map(function (el) { return el.getBoundingClientRect().width; });
    this.capWidths = caps.map(function (c) { return [c.lo.getBoundingClientRect().width, c.up.getBoundingClientRect().width]; });
    var ws = getComputedStyle(word);
    var fsize = parseFloat(ws.fontSize);
    var lineH = parseFloat(ws.lineHeight) || fsize * 1.3;
    this.ctx = this.ctx || document.createElement('canvas').getContext('2d');
    this.ctx.font = ws.fontWeight + ' ' + ws.fontSize + ' ' + ws.fontFamily;
    var big = this.ctx.measureText('C');
    var small = this.ctx.measureText('c');
    var ratio = small.actualBoundingBoxAscent / big.actualBoundingBoxAscent;
    this.caseRatio = isFinite(ratio) && ratio > 0.4 && ratio < 1 ? ratio : 0.75;
    var asc = big.fontBoundingBoxAscent, desc = big.fontBoundingBoxDescent;
    var baseline = asc && desc ? (lineH - (asc + desc)) / 2 + asc : lineH * 0.76;
    caps.forEach(function (c) {
      c.lo.style.transformOrigin = '0 ' + baseline.toFixed(2) + 'px';
      c.up.style.transformOrigin = '0 ' + baseline.toFixed(2) + 'px';
    });
    var m = mark.getBoundingClientRect();
    var first = caps.length ? caps[0].el.getBoundingClientRect() : word.getBoundingClientRect();
    var scale = m.width / 96;
    var hitX = (first.left - m.left + fsize * this.K.C_BEARING) / scale;
    this.exitX = hitX - this.K.HALF;
    this.underDist = (first.width / scale) * 0.5;
    this.points = [[48, 48], [23.5, 48], [23.5, 72.5], [72.5, 72.5], [72.5, 48], [hitX - this.K.HALF, 48]];
    this.lengths = [];
    this.total = 0;
    for (var i = 1; i < this.points.length; i++) {
      var d = Math.abs(this.points[i][0] - this.points[i - 1][0]) + Math.abs(this.points[i][1] - this.points[i - 1][1]);
      this.lengths.push(d);
      this.total += d;
    }
    logo.style.transform = '';
    this.paint(this.progress);
  }
  pointAt(t) {
    var dist = t * this.total;
    for (var i = 0; i < this.lengths.length; i++) {
      if (dist <= this.lengths[i] || i === this.lengths.length - 1) {
        var f = this.lengths[i] ? this.clamp(dist / this.lengths[i]) : 1;
        return [this.points[i][0] + (this.points[i + 1][0] - this.points[i][0]) * f, this.points[i][1] + (this.points[i + 1][1] - this.points[i][1]) * f];
      }
      dist -= this.lengths[i];
    }
    return this.points[this.points.length - 1];
  }
  paint(p) {
    var K = this.K, self = this;
    if (!this.rootEl || !this.groups) { return; }
    var t = this.clamp(p / K.TRAVEL_END);
    var q = this.clamp((p - K.TRAVEL_END) / (K.COLLAPSE_END - K.TRAVEL_END));
    var u = this.smooth(this.clamp((p - K.CASE_START) / (K.CASE_END - K.CASE_START)));
    this.rootEl.style.setProperty('--p', p.toFixed(4));
    var h = this.clamp((p - K.TRAVEL_END) / (K.HANDOVER_END - K.TRAVEL_END));
    var fade = this.smooth(h);
    var pos = h > 0 ? [this.exitX + this.underDist * (1 - Math.pow(1 - h, 3)), 48] : this.pointAt(t);
    this.clewEl.setAttribute('transform', 'translate(' + (pos[0] - 48).toFixed(2) + ' ' + (pos[1] - 48).toFixed(2) + ')');
    this.clewEl.style.opacity = (1 - fade).toFixed(3);
    var homeX = 23.5 + (48 - 23.5) * this.smooth(h);
    this.homeEl.setAttribute('transform', 'translate(' + (homeX - 48).toFixed(2) + ' 0)');
    this.homeEl.style.opacity = fade.toFixed(3);
    this.caps.forEach(function (c, i) {
      var w = self.capWidths[i];
      c.el.style.width = (w[0] + (w[1] - w[0]) * u).toFixed(2) + 'px';
      var bigScale = 1 + (self.caseRatio - 1) * u;
      var smallScale = 1 / self.caseRatio + (1 - 1 / self.caseRatio) * u;
      var mix = self.clamp((u - 0.2) / 0.6);
      c.lo.style.transform = u > 0 ? 'scale(' + bigScale.toFixed(4) + ')' : '';
      c.up.style.transform = u < 1 ? 'scale(' + smallScale.toFixed(4) + ')' : '';
      c.lo.style.opacity = (1 - mix).toFixed(3);
      c.up.style.opacity = mix.toFixed(3);
    });
    var lift = K.CNS_LIFT * u;
    this.wordEl.style.transform = lift ? 'translateY(' + (-lift).toFixed(4) + 'em)' : '';
    var stagger = 0.16, n = this.groups.length;
    this.groups.forEach(function (el, i) {
      var e = self.smooth(self.clamp((q - i * stagger) / (1 - (n - 1) * stagger)));
      el.style.width = (self.widths[i] * (1 - e)).toFixed(2) + 'px';
      el.style.opacity = self.clamp(1 - e * 1.35).toFixed(3);
    });
  }
  step(now) {
    if (this.lastTime === null) { this.lastTime = now; }
    var delta = (now - this.lastTime) / this.K.DURATION;
    this.lastTime = now;
    this.progress = this.progress < this.target ? Math.min(this.target, this.progress + delta) : Math.max(this.target, this.progress - delta);
    this.paint(this.progress);
    if (this.progress !== this.target) { this.frame = requestAnimationFrame(this.step); }
    else { this.frame = null; this.lastTime = null; }
  }
  setTarget(v) {
    if (v === this.target) { return; }
    this.target = v;
    if (this.reduce && this.reduce.matches) { this.progress = v; this.paint(v); return; }
    if (this.frame === null) { this.lastTime = null; this.frame = requestAnimationFrame(this.step); }
  }
  onScroll() { if (this.atTop()) { this.setTarget(0); } else { this.setTarget(1); } }
  onWheel(e) { if (e.deltaY > 0) { this.setTarget(1); } else if (e.deltaY < 0 && this.atTop()) { this.setTarget(0); } }
  onTouchStart(e) { this.touchY = e.touches.length ? e.touches[0].clientY : null; }
  onTouchMove(e) {
    if (this.touchY === null || !e.touches.length) { return; }
    var dy = this.touchY - e.touches[0].clientY;
    if (dy > this.K.SWIPE_MIN) { this.setTarget(1); this.touchY = null; }
    else if (dy < -this.K.SWIPE_MIN) { if (this.atTop()) { this.setTarget(0); } this.touchY = null; }
  }
  // Szolgáltatások és Referenciák közti váltás: a panel ablaka helyben marad, a magassága
  // finoman igazodik, a tartalom oldalról úszik be (a CSS végzi, itt csak a magasságot mérjük).
  switchTo(next, cur) {
    this.prevH = null;
    if (cur && next) {
      var root = document.getElementById(this.uid);
      var st = root ? root.querySelector('.panel-stage') : null;
      if (st) { this.prevH = st.getBoundingClientRect().height; }
    }
    this.setState({ open: next });
  }
  currentOpen() {
    var s = this.state || {};
    var p = this.props;
    return s.open !== undefined ? s.open : (p.open || (p.panel ? 'szolg' : ''));
  }
  openPanel(k) {
    clearTimeout(this.closeT);
    var cur = this.currentOpen();
    if (cur !== k) { this.switchTo(k, cur); }
  }
  closePanel(delay) {
    var self = this;
    clearTimeout(this.closeT);
    var run = function () { var cur = self.currentOpen(); if (cur) { self.switchTo('', cur); } };
    if (delay) { this.closeT = setTimeout(run, delay); } else { run(); }
  }
  componentDidUpdate() {
    if (this.prevH === null || this.prevH === undefined) { return; }
    var prev = this.prevH;
    this.prevH = null;
    var root = document.getElementById(this.uid);
    var st = root ? root.querySelector('.panel-stage') : null;
    if (!st) { return; }
    var next = st.getBoundingClientRect().height;
    if (Math.abs(next - prev) < 1) { return; }
    st.style.height = prev + 'px';
    void st.offsetHeight;
    st.style.height = next + 'px';
    var done = function () { st.style.height = ''; st.removeEventListener('transitionend', done); };
    st.addEventListener('transitionend', done);
  }
  renderVals() {
    const p = this.props;
    const s = this.state || {};
    if (!this.uid) { this.uid = 'fejlec-' + Math.random().toString(36).slice(2, 9); }
    const live = !!p.live;
    const home = p.home ?? true;
    const cur = p.current ?? '';
    const scrolled = !live && (p.state ?? 'full') === 'scrolled';
    const open = s.open ?? (p.open || (p.panel ? 'szolg' : ''));
    const menu = s.menu ?? (p.menu ?? false);
    const mark = (k) => (cur === k ? 'page' : null);
    const pre = home ? '' : '/';
    return {
      uid: this.uid,
      theme: p.theme ?? 'dark',
      live: live,
      liveClass: live ? 'hdr-live' : '',
      hstate: scrolled ? 'scrolled' : 'full',
      staticFull: !live && !scrolled,
      staticCns: !live && scrolled,
      anyOpen: open === 'szolg' || open === 'ref',
      paneSzolg: open === 'ref' ? 'is-left' : 'is-on',
      paneRef: open === 'ref' ? 'is-on' : 'is-right',
      hideSzolg: open === 'ref' ? 'true' : null,
      hideRef: open === 'ref' ? null : 'true',
      szolgExp: open === 'szolg' ? 'true' : 'false',
      refExp: open === 'ref' ? 'true' : 'false',
      menu: menu,
      menuClosed: !menu,
      menuExp: menu ? 'true' : 'false',
      menuLabel: menu ? 'Menü bezárása' : 'Menü',
      logoHref: home ? '#top' : '/',
      logoLabel: home ? 'Clunossys, ugrás az oldal tetejére' : 'Clunossys, főoldal',
      h: {
        minden: home ? '#megoldasok' : '/#megoldasok',
        rolunk: home ? '#rolunk' : '/#rolunk',
        hogyan: pre + '#hogyan-dolgozunk',
        adat: pre + '#adatbiztonsag',
        gyik: pre + '#gyik',
        refKiv: pre + '#referenciak',
        refKli: pre + '#referenciak',
        refSaj: pre + '#referenciak',
        cta: home ? '#kapcsolat' : (cur === 'kapcsolat' ? '#urlap' : '/contact')
      },
      c: {
        asszisztens: mark('asszisztens'),
        ugyfelszolgalat: mark('ugyfelszolgalat'),
        integracio: mark('integracio'),
        egyedi: mark('egyedi'),
        web: mark('web'),
        optimalizalas: mark('optimalizalas'),
        uzemeltetes: mark('uzemeltetes'),
        tanacsadas: mark('tanacsadas'),
        kinek: mark('kinek'),
        rolunk: mark('rolunk')
      },
      // Rámutatásra nyílik (kattintásra is, érintőképernyőn és billentyűzettel), a fejlécből kilépve 150 ms után zárul.
      openSzolg: () => this.openPanel('szolg'),
      openRef: () => this.openPanel('ref'),
      closeNow: () => this.closePanel(0),
      enterBar: () => { clearTimeout(this.closeT); },
      leaveBar: () => this.closePanel(150),
      onKey: (e) => {
        var cur = this.currentOpen();
        if (e.key === 'Escape' && cur) {
          this.closePanel(0);
          var root = document.getElementById(this.uid);
          var btn = root ? root.querySelector('[aria-controls="' + (cur === 'ref' ? 'referenciak-panel' : 'szolgaltatasok-panel') + '"]') : null;
          if (btn) { btn.focus(); }
        }
      },
      toggleMenu: () => this.setState({ menu: !menu })
    };
  }
}
window.__CNS_COMPONENTS["Fejlec"] = { tpl: "<header class=\"site hdr {{liveClass}}\" id=\"{{uid}}\" data-theme=\"{{theme}}\" data-state=\"{{hstate}}\" onKeyDown=\"{{onKey}}\">\n<a class=\"skip\" href=\"#tartalom\">Ugrás a tartalomra</a>\n<div class=\"hdr-bar\" onMouseEnter=\"{{enterBar}}\" onMouseLeave=\"{{leaveBar}}\">\n<a class=\"logo\" href=\"{{logoHref}}\" aria-label=\"{{logoLabel}}\" onMouseEnter=\"{{closeNow}}\">\n<svg class=\"logo-mark\" viewBox=\"0 0 96 96\" aria-hidden=\"true\"><path class=\"logo-wall\" d=\"M82 38V14H14V82H82V58\"></path><path class=\"logo-wall\" d=\"M33 41V33H63V63H33V55\"></path><rect class=\"logo-clew logo-home\" x=\"43\" y=\"43\" width=\"10\" height=\"10\"></rect><rect class=\"logo-clew logo-run\" x=\"43\" y=\"43\" width=\"10\" height=\"10\"></rect></svg>\n<sc-if value=\"{{staticFull}}\" hint-placeholder-val=\"{{true}}\"><span class=\"logo-word\" aria-hidden=\"true\">Clunossys</span></sc-if>\n<sc-if value=\"{{staticCns}}\" hint-placeholder-val=\"{{false}}\"><span class=\"logo-word logo-cns\" aria-hidden=\"true\">cns</span></sc-if>\n<sc-if value=\"{{live}}\" hint-placeholder-val=\"{{false}}\"><span class=\"logo-word lw\" aria-hidden=\"true\"><span class=\"k sw\"><span class=\"a\">C</span><span class=\"b\">c</span></span><span class=\"x\">lu</span><span class=\"k\">n</span><span class=\"x\">os</span><span class=\"k\">s</span><span class=\"x\">ys</span></span></sc-if>\n</a>\n<nav class=\"hdr-nav\" aria-label=\"Fő menü\">\n<button class=\"nav-item\" type=\"button\" aria-expanded=\"{{szolgExp}}\" aria-controls=\"szolgaltatasok-panel\" onMouseEnter=\"{{openSzolg}}\" onClick=\"{{openSzolg}}\">Szolgáltatások</button>\n<button class=\"nav-item\" type=\"button\" aria-expanded=\"{{refExp}}\" aria-controls=\"referenciak-panel\" onMouseEnter=\"{{openRef}}\" onClick=\"{{openRef}}\">Referenciák</button>\n<a class=\"nav-item\" href=\"/who-its-for\" aria-current=\"{{c.kinek}}\" onMouseEnter=\"{{closeNow}}\">Kinek?</a>\n<a class=\"nav-item\" href=\"{{h.rolunk}}\" aria-current=\"{{c.rolunk}}\" onMouseEnter=\"{{closeNow}}\">Rólunk</a>\n<span class=\"nav-sep\" aria-hidden=\"true\"></span>\n<a class=\"btn btn-sm btn-pill hdr-cta\" href=\"{{h.cta}}\" onMouseEnter=\"{{closeNow}}\">Konzultáció</a>\n</nav>\n<button class=\"hdr-menu-btn\" type=\"button\" aria-expanded=\"{{menuExp}}\" aria-controls=\"mobil-menu\" aria-label=\"{{menuLabel}}\" onClick=\"{{toggleMenu}}\">\n<sc-if value=\"{{menuClosed}}\" hint-placeholder-val=\"{{true}}\"><svg width=\"20\" height=\"20\" viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M3 7h14M3 13h14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></sc-if>\n<sc-if value=\"{{menu}}\" hint-placeholder-val=\"{{false}}\"><svg width=\"20\" height=\"20\" viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M5 5l10 10M15 5L5 15\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></sc-if>\n</button>\n\n<sc-if value=\"{{anyOpen}}\" hint-placeholder-val=\"{{false}}\">\n<div class=\"panel\">\n<div class=\"panel-stage\">\n<div class=\"pane {{paneSzolg}}\" id=\"szolgaltatasok-panel\" aria-hidden=\"{{hideSzolg}}\">\n<div class=\"panel-main\">\n<ul class=\"panel-col\">\n<li><a class=\"pi\" href=\"/services/ai-assistant\" aria-current=\"{{c.asszisztens}}\"><span class=\"pi-t\">AI asszisztens</span><span class=\"pi-d\">Átveszi a napi adminisztrációt: levelet ír, naptárat kezel.</span></a></li>\n<li><a class=\"pi\" href=\"/services/ai-customer-service\" aria-current=\"{{c.ugyfelszolgalat}}\"><span class=\"pi-t\">AI ügyfélszolgálat</span><span class=\"pi-d\">7/24 válaszol az ügyfeleknek a weboldalon, chaten, e-mailben.</span></a></li>\n</ul>\n<ul class=\"panel-col\">\n<li><a class=\"pi\" href=\"/services/integration\" aria-current=\"{{c.integracio}}\"><span class=\"pi-t\">Integráció</span><span class=\"pi-d\">Foglalás, számlázó és fizetés egy rendszerként, másolgatás nélkül.</span></a></li>\n<li><a class=\"pi\" href=\"/services/custom-development\" aria-current=\"{{c.egyedi}}\"><span class=\"pi-t\">Egyedi fejlesztés</span><span class=\"pi-d\">A cég folyamataira szabott szoftver, portál vagy app, ha a dobozos kevés.</span></a></li>\n</ul>\n<ul class=\"panel-col panel-side\">\n<li><a class=\"ps\" href=\"/services/web-development\" aria-current=\"{{c.web}}\">Webfejlesztés</a></li>\n<li><a class=\"ps\" href=\"/services/optimization\" aria-current=\"{{c.optimalizalas}}\">Optimalizálás</a></li>\n<li><a class=\"ps\" href=\"/services/operations\" aria-current=\"{{c.uzemeltetes}}\">Üzemeltetés</a></li>\n<li><a class=\"ps\" href=\"/services/consulting\" aria-current=\"{{c.tanacsadas}}\">Tanácsadás</a></li>\n</ul>\n</div>\n<a class=\"panel-strip\" href=\"{{h.minden}}\"><span><strong>Megoldásainkról</strong> <span class=\"panel-strip-sub\">bővebben</span></span><span class=\"panel-more\">Tovább <svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></a>\n</div>\n<div class=\"pane {{paneRef}}\" id=\"referenciak-panel\" aria-hidden=\"{{hideRef}}\">\n<div class=\"panel-main\">\n<ul class=\"panel-col\">\n<li><a class=\"pi\" href=\"{{h.refKiv}}\"><span class=\"pi-t\">Építőipar</span><span class=\"pi-d\">Saját tudásbázis a cég dokumentumaiból, és egy belső</span></a></li>\n<li><a class=\"pi\" href=\"{{h.refKli}}\"><span class=\"pi-t\">Magánklinika</span><span class=\"pi-d\">Beérkező megkeresések kezelése és ismétlődő adminisztráció.</span></a></li>\n</ul>\n<ul class=\"panel-col\">\n<li><a class=\"pi\" href=\"{{h.refSaj}}\"><span class=\"pi-t\">A saját rendszereink</span><span class=\"pi-d\">A rendszert először magunkra építettük.</span></a></li>\n</ul>\n<ul class=\"panel-col panel-side\">\n<li><a class=\"ps\" href=\"{{h.hogyan}}\">Hogyan dolgozunk</a></li>\n<li><a class=\"ps\" href=\"{{h.adat}}\">Adatbiztonság</a></li>\n<li><a class=\"ps\" href=\"{{h.gyik}}\">Gyakori kérdések</a></li>\n</ul>\n</div>\n</div>\n</div>\n</div>\n</sc-if>\n</div>\n\n<sc-if value=\"{{menu}}\" hint-placeholder-val=\"{{false}}\">\n<div class=\"mm\" id=\"mobil-menu\">\n<div class=\"mm-group\">\n<p class=\"mm-group-title\">Szolgáltatások</p>\n<ul class=\"mm-sub\">\n<li><a href=\"/services/ai-assistant\" aria-current=\"{{c.asszisztens}}\">AI asszisztens</a></li>\n<li><a href=\"/services/ai-customer-service\" aria-current=\"{{c.ugyfelszolgalat}}\">AI ügyfélszolgálat</a></li>\n<li><a href=\"/services/integration\" aria-current=\"{{c.integracio}}\">Integráció</a></li>\n<li><a href=\"/services/custom-development\" aria-current=\"{{c.egyedi}}\">Egyedi fejlesztés</a></li>\n</ul>\n<ul class=\"mm-sub\">\n<li><a href=\"/services/web-development\" aria-current=\"{{c.web}}\">Webfejlesztés</a></li>\n<li><a href=\"/services/optimization\" aria-current=\"{{c.optimalizalas}}\">Optimalizálás</a></li>\n<li><a href=\"/services/operations\" aria-current=\"{{c.uzemeltetes}}\">Üzemeltetés</a></li>\n<li><a href=\"/services/consulting\" aria-current=\"{{c.tanacsadas}}\">Tanácsadás</a></li>\n</ul>\n<a class=\"link mm-all\" href=\"{{h.minden}}\">Megoldásainkról bővebben</a>\n</div>\n<div class=\"mm-group\">\n<p class=\"mm-group-title\">Referenciák</p>\n<ul class=\"mm-sub\">\n<li><a href=\"{{h.refKiv}}\">Építőipar</a></li>\n<li><a href=\"{{h.refKli}}\">Magánklinika</a></li>\n<li><a href=\"{{h.refSaj}}\">A saját rendszereink</a></li>\n</ul>\n<ul class=\"mm-sub\">\n<li><a href=\"{{h.hogyan}}\">Hogyan dolgozunk</a></li>\n<li><a href=\"{{h.adat}}\">Adatbiztonság</a></li>\n<li><a href=\"{{h.gyik}}\">Gyakori kérdések</a></li>\n</ul>\n</div>\n<ul class=\"mm-main\">\n<li><a href=\"/who-its-for\" aria-current=\"{{c.kinek}}\">Kinek?</a></li>\n<li><a href=\"{{h.rolunk}}\" aria-current=\"{{c.rolunk}}\">Rólunk</a></li>\n</ul>\n<div class=\"mm-foot\">\n<div>\n<p class=\"mm-foot-label\" id=\"mm-tema\">Téma</p>\n<div class=\"ts ts-full\" role=\"radiogroup\" aria-labelledby=\"mm-tema\">\n<button type=\"button\" role=\"radio\" aria-checked=\"true\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><circle cx=\"8\" cy=\"8\" r=\"6.25\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M8 4.5V8l2.5 1.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg>Automatikus</button>\n<button type=\"button\" role=\"radio\" aria-checked=\"false\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><circle cx=\"8\" cy=\"8\" r=\"3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg>Világos</button>\n<button type=\"button\" role=\"radio\" aria-checked=\"false\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linejoin=\"round\"></path></svg>Sötét</button>\n</div>\n</div>\n<a class=\"btn btn-pill btn-block\" href=\"{{h.cta}}\">Konzultáció</a>\n</div>\n</div>\n</sc-if>\n</header>", cls: Component };
})();

/* ---- Lablec (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  renderVals() {
    const theme = this.props.theme ?? 'dark';
    return {
      theme: theme,
      logo: theme === 'light' ? '/logo-cns-light.svg' : '/logo-cns-dark.svg'
    };
  }
}
window.__CNS_COMPONENTS["Lablec"] = { tpl: "<footer class=\"site ftr\" data-theme=\"{{theme}}\">\n<div class=\"wrap ftr-in\">\n<div class=\"ftr-grid\">\n<div class=\"ftr-logo\">\n<a href=\"/\" style=\"display: inline-block; border-radius: 4px\"><img src=\"{{logo}}\" alt=\"Clunossys, főoldal\" height=\"26\"></a>\n</div>\n<nav class=\"ftr-col\" aria-labelledby=\"ftr-szolg\">\n<h2 id=\"ftr-szolg\">Szolgáltatások</h2>\n<ul>\n<li><a href=\"/services/ai-assistant\">AI asszisztens</a></li>\n<li><a href=\"/services/ai-customer-service\">AI ügyfélszolgálat</a></li>\n<li><a href=\"/services/integration\">Integráció</a></li>\n<li><a href=\"/services/custom-development\">Egyedi fejlesztés</a></li>\n<li><a href=\"/services/web-development\">Webfejlesztés</a></li>\n<li><a href=\"/services/optimization\">Optimalizálás</a></li>\n<li><a href=\"/services/operations\">Üzemeltetés</a></li>\n<li><a href=\"/services/consulting\">Tanácsadás</a></li>\n</ul>\n</nav>\n<nav class=\"ftr-col\" aria-labelledby=\"ftr-ceg\">\n<h2 id=\"ftr-ceg\">Cég</h2>\n<ul>\n<li><a href=\"/who-its-for\">Kinek?</a></li>\n<li><a href=\"/#rolunk\">Rólunk</a></li>\n<li><a href=\"/#referenciak\">Referenciák</a></li>\n<li><a href=\"/contact\">Kapcsolat</a></li>\n</ul>\n</nav>\n<nav class=\"ftr-col\" aria-labelledby=\"ftr-jogi\">\n<h2 id=\"ftr-jogi\">Jogi</h2>\n<ul>\n<li><a href=\"/imprint\">Impresszum</a></li>\n<li><a href=\"/privacy\">Adatkezelési tájékoztató</a></li>\n<li><a href=\"/cookies\">Süti tájékoztató</a></li>\n</ul>\n</nav>\n<div class=\"ftr-col\">\n<h2>Elérhetőség</h2>\n<ul>\n<li><a href=\"mailto:info@clunossys.hu\">info@clunossys.hu</a></li>\n<li><a href=\"tel:+36300993897\">+36 30 099 3897</a></li>\n</ul>\n</div>\n</div>\n<div class=\"ftr-bottom\">\n<p>© 2026 Clunossys</p>\n<div class=\"ftr-theme\">\n<span id=\"ftr-tema\">Téma</span>\n<div class=\"ts\" role=\"radiogroup\" aria-labelledby=\"ftr-tema\">\n<button type=\"button\" role=\"radio\" aria-checked=\"true\" aria-label=\"Automatikus\" title=\"Automatikus\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><circle cx=\"8\" cy=\"8\" r=\"6.25\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M8 4.5V8l2.5 1.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></button>\n<button type=\"button\" role=\"radio\" aria-checked=\"false\" aria-label=\"Világos\" title=\"Világos\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><circle cx=\"8\" cy=\"8\" r=\"3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></button>\n<button type=\"button\" role=\"radio\" aria-checked=\"false\" aria-label=\"Sötét\" title=\"Sötét\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linejoin=\"round\"></path></svg></button>\n</div>\n</div>\n</div>\n</div>\n</footer>", cls: Component };
})();

/* ---- Hiba404 (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme ?? 'dark' };
  }
}
window.__CNS_COMPONENTS["Hiba404"] = { tpl: "<div class=\"site\" data-theme=\"{{theme}}\">\n<div class=\"hdr-slot\"><dc-import name=\"Fejlec\" theme=\"{{theme}}\" state=\"full\" home=\"{{false}}\" live=\"{{true}}\" hint-size=\"100%,64px\"></dc-import></div>\n<main id=\"tartalom\" class=\"wrap nf\">\n<div class=\"nf-text\">\n<h1 class=\"t-display\">Zsákutca</h1>\n<p class=\"t-lead\">Ez az oldal nem létezik, vagy máshová került. A fonal a főoldalra vezet vissza.</p>\n<a class=\"btn\" href=\"/\">Vissza a főoldalra</a>\n<nav class=\"nf-links\" aria-label=\"Szolgáltatások\">\n<ul>\n<li><a href=\"/services/ai-assistant\">AI asszisztens</a></li>\n<li><a href=\"/services/ai-customer-service\">AI ügyfélszolgálat</a></li>\n<li><a href=\"/services/integration\">Integráció</a></li>\n<li><a href=\"/services/custom-development\">Egyedi fejlesztés</a></li>\n</ul>\n</nav>\n</div>\n<div class=\"nf-maze\" aria-hidden=\"true\">\n<svg viewBox=\"0 0 172 172\"><path class=\"maze-wall\" d=\"M158 76V14H14V158H158V96\"></path><path class=\"maze-wall\" d=\"M33 76V33H139V139H33V96\"></path><path class=\"maze-wall\" d=\"M120 76V52H52V120H120V96\"></path><path class=\"maze-wall\" d=\"M71 79V71H101V101H71V93\"></path><rect class=\"maze-clew\" x=\"81\" y=\"81\" width=\"10\" height=\"10\"></rect></svg>\n</div>\n</main>\n<dc-import name=\"Lablec\" theme=\"{{theme}}\" hint-size=\"100%,560px\"></dc-import>\n</div>", cls: Component };
})();

/* ---- Urlap (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  renderVals() {
    const p = this.props;
    const st = p.state ?? 'alap';
    const f = p.pfx ?? 'urlap';
    const isErr = st === 'hiba';
    return {
      theme: p.theme ?? 'dark',
      pfx: f,
      isErr: isErr,
      done: st === 'kesz',
      notDone: st !== 'kesz',
      inv: isErr ? 'true' : null,
      id: {
        nev: f + '-nev',
        nevErr: isErr ? f + '-nev-hiba' : null,
        nevErrEl: f + '-nev-hiba',
        ceg: f + '-ceg',
        email: f + '-email',
        tel: f + '-tel',
        mivel: f + '-mivel',
        meret: f + '-meret',
        folyamat: f + '-folyamat',
        folyamatErr: isErr ? f + '-folyamat-hiba' : null,
        folyamatErrEl: f + '-folyamat-hiba',
        programok: f + '-programok',
        programokHint: f + '-programok-sugo',
        hp: f + '-weboldal'
      }
    };
  }
}
window.__CNS_COMPONENTS["Urlap"] = { tpl: "<div class=\"ui form-panel\" data-theme=\"{{theme}}\" id=\"{{pfx}}\">\n<sc-if value=\"{{notDone}}\" hint-placeholder-val=\"{{true}}\">\n<form class=\"form\" action=\"mailto:info@clunossys.hu\" method=\"post\" enctype=\"text/plain\" novalidate aria-label=\"Időpontkérés\">\n<div class=\"field\">\n<label class=\"lbl\" for=\"{{id.nev}}\">Név</label>\n<input class=\"input\" id=\"{{id.nev}}\" name=\"nev\" type=\"text\" autocomplete=\"name\" required aria-invalid=\"{{inv}}\" aria-describedby=\"{{id.nevErr}}\">\n<sc-if value=\"{{isErr}}\" hint-placeholder-val=\"{{false}}\"><p class=\"err\" id=\"{{id.nevErrEl}}\"><span class=\"err-ic\" aria-hidden=\"true\">!</span><span>A név megadása kötelező.</span></p></sc-if>\n</div>\n<div class=\"field\">\n<label class=\"lbl\" for=\"{{id.ceg}}\">Cég</label>\n<input class=\"input\" id=\"{{id.ceg}}\" name=\"ceg\" type=\"text\" autocomplete=\"organization\" required>\n</div>\n<div class=\"field\">\n<label class=\"lbl\" for=\"{{id.email}}\">Email</label>\n<input class=\"input\" id=\"{{id.email}}\" name=\"email\" type=\"email\" autocomplete=\"email\" required>\n</div>\n<div class=\"field\">\n<label class=\"lbl\" for=\"{{id.tel}}\">Telefon <span class=\"opt\">nem kötelező</span></label>\n<input class=\"input\" id=\"{{id.tel}}\" name=\"telefon\" type=\"tel\" autocomplete=\"tel\">\n</div>\n<div class=\"field field-wide\">\n<label class=\"lbl\" for=\"{{id.mivel}}\">Mivel foglalkozik a cég? <span class=\"opt\">nem kötelező</span></label>\n<input class=\"input\" id=\"{{id.mivel}}\" name=\"tevekenyseg\" type=\"text\">\n</div>\n<fieldset class=\"field field-wide\">\n<legend class=\"lbl\" style=\"margin-bottom: 8px\">Hányan dolgoznak ott? <span class=\"opt\">nem kötelező</span></legend>\n<div class=\"chips\">\n<label class=\"chip\"><input type=\"radio\" name=\"{{id.meret}}\" value=\"1-5\"><span>1–5</span></label>\n<label class=\"chip\"><input type=\"radio\" name=\"{{id.meret}}\" value=\"6-20\"><span>6–20</span></label>\n<label class=\"chip\"><input type=\"radio\" name=\"{{id.meret}}\" value=\"21-50\"><span>21–50</span></label>\n<label class=\"chip\"><input type=\"radio\" name=\"{{id.meret}}\" value=\"50+\"><span>50+</span></label>\n</div>\n</fieldset>\n<div class=\"field field-wide\">\n<label class=\"lbl\" for=\"{{id.folyamat}}\">Melyik folyamat viszi most a legtöbb időt?</label>\n<textarea class=\"input\" id=\"{{id.folyamat}}\" name=\"folyamat\" rows=\"4\" required aria-invalid=\"{{inv}}\" aria-describedby=\"{{id.folyamatErr}}\"></textarea>\n<sc-if value=\"{{isErr}}\" hint-placeholder-val=\"{{false}}\"><p class=\"err\" id=\"{{id.folyamatErrEl}}\"><span class=\"err-ic\" aria-hidden=\"true\">!</span><span>Ez a mező kötelező.</span></p></sc-if>\n</div>\n<div class=\"field field-wide\">\n<label class=\"lbl\" for=\"{{id.programok}}\">Milyen programokat használnak ma? <span class=\"opt\">nem kötelező</span></label>\n<textarea class=\"input\" id=\"{{id.programok}}\" name=\"programok\" rows=\"3\" aria-describedby=\"{{id.programokHint}}\"></textarea>\n<p class=\"hint\" id=\"{{id.programokHint}}\">levelezés, naptár, számlázó, tárhely, ágazati program</p>\n</div>\n<div class=\"hp\" aria-hidden=\"true\">\n<label for=\"{{id.hp}}\">Weboldal</label>\n<input id=\"{{id.hp}}\" name=\"weboldal\" type=\"text\" tabindex=\"-1\" autocomplete=\"off\">\n</div>\n<div class=\"form-foot\">\n<button class=\"btn\" type=\"submit\">Időpontot kérek</button>\n<p class=\"t-small muted\">Az első, bemutatkozó beszélgetés díjmentes, kb. egy óra.</p>\n</div>\n<p class=\"form-legal t-small muted\">A megadott adatokat kizárólag a megkeresés megválaszolására és az időpont egyeztetésére használjuk. <a class=\"link\" href=\"/privacy\">Adatkezelési tájékoztató</a></p>\n</form>\n</sc-if>\n<sc-if value=\"{{done}}\" hint-placeholder-val=\"{{false}}\">\n<div class=\"form-done\" role=\"status\">\n<span class=\"form-done-mark\" aria-hidden=\"true\"></span>\n<p class=\"t-lead\">Köszönjük, megkaptuk. Hamarosan jelentkezünk a megadott email-címen, és egyeztetjük az időpontot.</p>\n</div>\n</sc-if>\n</div>", cls: Component };
})();

/* ---- Kapcsolat (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme ?? 'dark' };
  }
}
window.__CNS_COMPONENTS["Kapcsolat"] = { tpl: "<div class=\"site\" data-theme=\"{{theme}}\">\n<div class=\"hdr-slot\"><dc-import name=\"Fejlec\" theme=\"{{theme}}\" state=\"full\" home=\"{{false}}\" current=\"kapcsolat\" live=\"{{true}}\" hint-size=\"100%,64px\"></dc-import></div>\n<main id=\"tartalom\" class=\"wrap contact\">\n<div class=\"contact-l\">\n<h1 class=\"t-display\">Beszéljünk</h1>\n<div class=\"prose t-lead\">\n<p>Az első beszélgetés díjmentes, kb. egy óra, és arról szól, van-e itt egyáltalán dolgunk. Nem prezentálunk: kérdezni fogunk arról, hogyan működik most a cég.</p>\n<p>Ha azt látjuk, hogy nem tudunk segíteni, megmondjuk. Az rövidebb beszélgetés lesz, de mindkettőnknek jobb így.</p>\n</div>\n<dl class=\"contact-list\">\n<div>\n<dt>Elérhetőség</dt>\n<dd><a href=\"mailto:info@clunossys.hu\">info@clunossys.hu</a><a href=\"tel:+36300993897\">+36 30 099 3897</a></dd>\n</div>\n</dl>\n</div>\n<div class=\"contact-r\">\n<dc-import name=\"Urlap\" theme=\"{{theme}}\" state=\"alap\" pfx=\"urlap\" hint-size=\"100%,1100px\"></dc-import>\n</div>\n</main>\n<dc-import name=\"Lablec\" theme=\"{{theme}}\" hint-size=\"100%,560px\"></dc-import>\n</div>", cls: Component };
})();

/* ---- Keszul (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme ?? 'dark', title: this.props.title ?? '', current: this.props.current ?? '' };
  }
}
window.__CNS_COMPONENTS["Keszul"] = { tpl: "<div class=\"site\" data-theme=\"{{theme}}\">\n<div class=\"hdr-slot\"><dc-import name=\"Fejlec\" theme=\"{{theme}}\" state=\"full\" home=\"{{false}}\" current=\"{{current}}\" live=\"{{true}}\"></dc-import></div>\n<main id=\"tartalom\" class=\"wrap nf\">\n<div class=\"nf-text\">\n<h1 class=\"t-display\">{{title}}</h1>\n<p class=\"t-lead\">Ez az oldal még készül.</p>\n<a class=\"btn\" href=\"/\">Vissza a főoldalra</a>\n</div>\n<div class=\"nf-maze\" aria-hidden=\"true\">\n<svg viewBox=\"0 0 172 172\"><path class=\"maze-wall\" d=\"M158 76V14H14V158H158V96\"></path><path class=\"maze-wall\" d=\"M33 76V33H139V139H33V96\"></path><path class=\"maze-wall\" d=\"M120 76V52H52V120H120V96\"></path><path class=\"maze-wall\" d=\"M71 79V71H101V101H71V93\"></path><rect class=\"maze-clew\" x=\"81\" y=\"81\" width=\"10\" height=\"10\"></rect></svg>\n</div>\n</main>\n<dc-import name=\"Lablec\" theme=\"{{theme}}\"></dc-import>\n</div>", cls: Component };
})();

/* ---- Hero (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  words() {
    return ['jövőjéért', 'növekedéséért', 'sikeréért'];
  }
  // A kocka útja egységben, a rajz közepétől: a labirintus járatai, a kapu, majd egy kockányira a faltól megáll
  pathPts() {
    return [[0, 0], [-24.5, 0], [-24.5, 24.5], [24.5, 24.5], [24.5, 0], [51.5, 0]];
  }
  componentDidMount() {
    this.step = this.step.bind(this);
    this.tick = this.tick.bind(this);
    var pts = this.pathPts();
    this.segs = []; this.total = 0;
    for (var i = 1; i < pts.length; i++) {
      var len = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
      this.segs.push(len); this.total += len;
    }
    this.pos = 0; this.goal = 0; this.frame = null; this.last = null;
    this.SPEED = 35; // egység/s: a régi animáció kapun kívüli tempója
    var rm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduce = !!(rm && rm.matches);
    if (this.reduce) { return; }
    this.setState({ wi: 0, n: this.words()[0].length, del: true });
    this.timer = setTimeout(this.step, 1800);
  }
  componentWillUnmount() {
    clearTimeout(this.timer);
    if (this.frame) { cancelAnimationFrame(this.frame); }
  }
  step() {
    var s = this.state || {};
    var wi = s.wi || 0;
    var n = s.n || 0;
    var del = !!s.del;
    var words = this.words();
    var word = words[wi];
    var delay;
    if (!del) {
      n = n + 1;
      if (n >= word.length) { n = word.length; del = true; delay = 1800; } else { delay = 85; }
    } else {
      n = n - 1;
      if (n <= 0) { n = 0; del = false; wi = (wi + 1) % words.length; delay = 400; } else { delay = 45; }
    }
    this.setState({ wi: wi, n: n, del: del });
    this.timer = setTimeout(this.step, delay);
  }
  setGoal(goal) {
    if (this.reduce || !this.segs) { return; }
    this.goal = goal;
    if (!this.frame) { this.last = null; this.frame = requestAnimationFrame(this.tick); }
  }
  tick(now) {
    var dt = this.last === null ? 0 : Math.min(64, now - this.last);
    this.last = now;
    var d = this.SPEED * dt / 1000;
    if (this.pos < this.goal) { this.pos = Math.min(this.goal, this.pos + d); } else { this.pos = Math.max(this.goal, this.pos - d); }
    this.paintCube();
    this.frame = this.pos === this.goal ? null : requestAnimationFrame(this.tick);
  }
  paintCube() {
    var el = document.querySelector('[data-hero="' + this.uid + '"] .hl-clew');
    if (!el) { return; }
    var pts = this.pathPts();
    var left = this.pos, x = pts[0][0], y = pts[0][1];
    for (var i = 0; i < this.segs.length; i++) {
      var t = this.segs[i] > 0 ? Math.min(1, left / this.segs[i]) : 1;
      x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      left -= this.segs[i];
      if (left <= 0) { break; }
    }
    el.style.setProperty('--cx', x.toFixed(3));
    el.style.setProperty('--cy', y.toFixed(3));
  }
  renderVals() {
    if (!this.uid) { this.uid = 'hero-' + Math.random().toString(36).slice(2, 9); }
    var s = this.state || {};
    var wi = s.wi || 0;
    var words = this.words();
    var n = (s.n === undefined) ? words[0].length : s.n;
    var self = this;
    return {
      uid: this.uid,
      theme: this.props.theme ?? 'dark',
      typed: words[wi].slice(0, n),
      enter: function () { self.setGoal(self.total || 0); },
      leave: function () { self.setGoal(0); }
    };
  }
}
window.__CNS_COMPONENTS["Hero"] = { tpl: "<section class=\"ui intro-band\" data-theme=\"{{theme}}\" aria-labelledby=\"intro-cim\">\n<div class=\"wrap g12 intro\">\n<div class=\"intro-text\">\n<svg class=\"intro-shade\" aria-hidden=\"true\" focusable=\"false\" width=\"1000\" height=\"840\" viewBox=\"-200 -210 1000 840\"><path d=\"M150 -190C167 -181 220 -151 250 -135C280 -119 308 -106 328 -96C348 -86 356 -82 370 -75C384 -68 403 -59 414 -51C425 -43 430 -35 436 -27C442 -19 446 -11 451 -3C456 5 461 13 464 21C467 29 469 35 470 45C471 55 471 69 470 81C469 93 468 107 466 117C464 127 461 133 456 141C451 149 442 157 434 165C426 173 417 181 411 189C405 197 397 205 398 213C399 221 409 229 418 237C427 245 445 253 454 261C463 269 470 275 474 285C478 295 478 309 478 321C478 333 477 347 474 357C471 367 464 373 458 381C452 389 444 397 439 405C434 413 428 421 430 429C432 437 437 445 448 453C459 461 474 469 494 477C514 485 548 494 570 501C592 508 591 507 626 518C661 529 754 558 780 566L780 620L150 620Z\"></path></svg>\n<h1 class=\"t-display intro-h\" id=\"intro-cim\"><span class=\"intro-l\">AI megoldások</span> <span class=\"intro-l\">és automatizálás</span> <span class=\"intro-l\">a vállalkozásod</span> <span class=\"tw\" aria-hidden=\"true\">{{typed}}<span class=\"tw-caret\"></span></span><span class=\"sr-only\">jövőjéért, növekedéséért, sikeréért</span></h1>\n<p class=\"t-lead intro-lead\">Segítünk csökkenteni az ismétlődő, időrabló tevékenységeket, gyorsítjuk a belső folyamatokat, hatékonyabbá tesszük a céged, kivezetünk az útvesztőből.</p>\n<div class=\"intro-cta\">\n<a class=\"btn btn-pill btn-thread\" href=\"#kapcsolat\">Időpontot kérek</a>\n<a class=\"btn btn-pill btn-line\" href=\"#megoldasok\">Szolgáltatásaink</a>\n</div>\n</div>\n<div class=\"intro-art\" onMouseEnter=\"{{enter}}\" onMouseLeave=\"{{leave}}\">\n<div class=\"hero-logo\" data-hero=\"{{uid}}\" aria-hidden=\"true\">\n<div class=\"hl-board\"><i class=\"hl-floor\"></i><svg class=\"hl-base\" viewBox=\"0 0 96 96\"><path class=\"hl-edge\" d=\"M84.5 38L84.5 11.5L11.5 11.5L11.5 84.5L84.5 84.5L84.5 58L79.5 58L79.5 79.5L16.5 79.5L16.5 16.5L79.5 16.5L79.5 38Z\"></path><path class=\"hl-edge\" d=\"M30.5 41L30.5 30.5L65.5 30.5L65.5 65.5L30.5 65.5L30.5 55L35.5 55L35.5 60.5L60.5 60.5L60.5 35.5L35.5 35.5L35.5 41Z\"></path></svg><i class=\"hl-side\" style=\"--x:84.5;--y:11.5;--l:26.5;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:11.5;--y:11.5;--l:73;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:11.5;--y:84.5;--l:73;--r:270deg\"></i><i class=\"hl-side\" style=\"--x:84.5;--y:84.5;--l:73;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:84.5;--y:58;--l:26.5;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:79.5;--y:58;--l:5;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:79.5;--y:79.5;--l:21.5;--r:270deg\"></i><i class=\"hl-side\" style=\"--x:16.5;--y:79.5;--l:63;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:16.5;--y:16.5;--l:63;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:79.5;--y:16.5;--l:63;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:79.5;--y:38;--l:21.5;--r:270deg\"></i><i class=\"hl-side\" style=\"--x:84.5;--y:38;--l:5;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:30.5;--y:41;--l:10.5;--r:270deg\"></i><i class=\"hl-side\" style=\"--x:30.5;--y:30.5;--l:35;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:65.5;--y:30.5;--l:35;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:65.5;--y:65.5;--l:35;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:30.5;--y:65.5;--l:10.5;--r:270deg\"></i><i class=\"hl-side\" style=\"--x:30.5;--y:55;--l:5;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:35.5;--y:55;--l:5.5;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:35.5;--y:60.5;--l:25;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:60.5;--y:60.5;--l:25;--r:270deg\"></i><i class=\"hl-side\" style=\"--x:60.5;--y:35.5;--l:25;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:35.5;--y:35.5;--l:5.5;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:35.5;--y:41;--l:5;--r:180deg\"></i><i class=\"hl-cap-fill\"></i><svg class=\"hl-cap\" viewBox=\"0 0 96 96\"><path class=\"hl-edge\" d=\"M84.5 38L84.5 11.5L11.5 11.5L11.5 84.5L84.5 84.5L84.5 58L79.5 58L79.5 79.5L16.5 79.5L16.5 16.5L79.5 16.5L79.5 38Z\"></path><path class=\"hl-edge\" d=\"M30.5 41L30.5 30.5L65.5 30.5L65.5 65.5L30.5 65.5L30.5 55L35.5 55L35.5 60.5L60.5 60.5L60.5 35.5L35.5 35.5L35.5 41Z\"></path></svg><div class=\"hl-cube hl-clew\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:10;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:0;--l:10;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:10;--l:10;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:10;--l:10;--r:270deg\"></i><i class=\"hl-top\"></i></div></div>\n<svg class=\"intro-shade-r\" aria-hidden=\"true\" focusable=\"false\" viewBox=\"0 0 460 386.4\"><path d=\"M200 -190C207 -181 229 -149 240 -135C251 -121 260 -114 268 -107C276 -100 281 -100 288 -96C295 -92 298 -87 308 -85C318 -83 335 -85 348 -85C361 -85 375 -85 388 -84C401 -83 415 -80 428 -77C441 -74 455 -72 468 -68C481 -64 495 -60 508 -56C521 -52 535 -47 548 -41C561 -35 575 -28 588 -21C601 -14 617 -6 628 0C639 6 650 10 654 12L648 25C646 28 641 37 638 43C635 49 634 56 632 63C630 70 628 76 626 83C624 90 624 96 622 103C620 110 615 116 612 123C609 130 605 136 602 143C599 150 598 156 596 163C594 170 593 175 592 183C591 191 592 203 592 213C592 223 591 231 590 243C589 255 588 270 586 283C584 296 581 310 578 323C575 336 570 350 566 363C562 376 559 390 554 403C549 416 545 430 538 443C531 456 520 473 514 483C508 493 506 492 500 502C494 512 490 522 478 545C466 568 438 624 430 640L3400 640L3400 -190Z\"></path></svg>\n</div>\n</div>\n</div>\n</section>", cls: Component };
})();

/* ---- Kijelentes (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
// Görgetésre kivilágosodó kijelentés, a structureengineering.com.au nyitó bekezdésének logikájával:
// 1. a szöveg alulról feljön, és a látható terület közepén megáll (sticky);
// 2. egy képernyőnyi görgetés alatt szavanként kivilágosodik (wall -> text);
// 3. utána még addig áll, amíg a következő szakasz alulról a szöveg aljáig ér, majd együtt mennek tovább.
class Component extends DCLogic {
  componentDidMount() {
    this.measure = this.measure.bind(this);
    this.onScroll = this.onScroll.bind(this);
    this.update = this.update.bind(this);
    this.frame = null; this.geo = null;
    this.attach(0);
  }
  attach(tries) {
    var self = this;
    var root = document.querySelector('[data-stmt="' + this.uid + '"]');
    if (!root || !root.querySelector('.w')) {
      if (tries < 60) { requestAnimationFrame(function () { self.attach(tries + 1); }); }
      return;
    }
    this.rootEl = root;
    this.pinEl = root.querySelector('.stmt-pin');
    this.count = root.querySelectorAll('.w').length;
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.measure);
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(this.measure); }
    this.measure();
    // a lap többi része (például egy másik kijelentés pályája) utólag is nyúlhat: kis késéssel újramérünk
    this.later = setTimeout(this.measure, 500);
  }
  componentWillUnmount() {
    clearTimeout(this.later);
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.measure);
    if (this.frame) { cancelAnimationFrame(this.frame); }
  }
  measure() {
    var root = this.rootEl;
    if (!root) { return; }
    var st = root.style;
    var sc = document.scrollingElement || document.documentElement;
    var vh = window.innerHeight;
    var site = root.closest ? root.closest('.site') : null;
    var slot = (site || document).querySelector('.hdr-slot');
    var hh = slot ? slot.offsetHeight : 0;
    var textH = this.pinEl.offsetHeight;
    var rm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var canScroll = vh < 2000 && (sc.scrollHeight - vh) > 200;
    var fits = textH <= vh - hh - 48;
    if (!canScroll || !fits || (rm && rm.matches)) {
      // álló keret (pl. a canvas áttekintője) vagy csökkentett mozgás: nincs rögzítés
      this.geo = null;
      st.removeProperty('--stmt-h'); st.removeProperty('--stmt-padb'); st.removeProperty('--stmt-top'); st.removeProperty('--stmt-extra');
      st.setProperty('--p', (rm && rm.matches) || canScroll ? '999' : String(Math.floor(this.count * 0.45)));
      return;
    }
    // görgethető lapon a szöveg lejjebb kezd: asztalon 100 px-rel (kb. 1 görgetés), mobilon 40 px-rel
    st.setProperty('--stmt-extra', root.offsetWidth < 1024 ? '40px' : '100px');
    var pad = parseFloat(getComputedStyle(root).paddingTop) || 0;
    // P: a szöveg alja és a pálya alja közti térköz nyugalomban (a pálya alatt 55 px-rel jön a következő cím vonala: együtt 160 px).
    // H: az utolsó szó kivilágosodása után ennyi görgetésig áll még a szöveg (250 px: a harmadik 100 px-es görgetés közben enged el).
    var P = 105, H = 250;
    var center = Math.round(hh + (vh - hh - textH) / 2);
    var top = Math.max(center - 60, Math.min(center + 60, vh - textH - P - H));
    top = Math.max(hh + 16, top);
    // lead: a rögzítés után ennyi görgetés múlva indul az első szó. Úgy igazítjuk, hogy az utolsó szó egész 100 px-es
    // görgetési helyzetben világosodjon ki, így a következő görgetések kiszámíthatóan lépnek (1.: feljön a cím, 3.: enged a szöveg).
    var lead = 120;
    var docTop = root.getBoundingClientRect().top + (window.pageYOffset || sc.scrollTop || 0);
    // span: ennyi görgetés alatt világosodik ki a teljes szöveg (alapból egy képernyőnyi; a rövid címnél 300 px)
    var span = this.spanPx ? Math.min(vh, this.spanPx) : vh;
    var sEnd = Math.round(docTop - top + pad + lead + span);
    lead += (100 - (sEnd % 100)) % 100;
    // a pálya akkora, hogy az utolsó szó akkor világosodjon ki, amikor a pálya alja a képernyő aljához ér
    var trackH = Math.round(vh + span - top + pad + lead);
    st.setProperty('--stmt-top', top + 'px');
    st.setProperty('--stmt-padb', P + 'px');
    st.setProperty('--stmt-h', trackH + 'px');
    this.geo = { span: span, start: top - pad - lead };
    this.update();
  }
  onScroll() {
    if (!this.geo || this.frame) { return; }
    this.frame = requestAnimationFrame(this.update);
  }
  update() {
    this.frame = null;
    var g = this.geo;
    if (!g || !this.rootEl) { return; }
    var T = this.rootEl.getBoundingClientRect().top;
    var p = (g.start - T) / g.span;
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    this.rootEl.style.setProperty('--p', (p * this.count).toFixed(3));
  }
  renderVals() {
    if (!this.uid) { this.uid = 'stmt-' + Math.random().toString(36).slice(2, 9); }
    // variant: melyik kijelentés. rolunk: a főoldal második blokkja; kivalthato: a négy probléma utáni összegzés;
    // ujceg: a referenciák előtt; lepesek: a „Három lépés” címe (rövid, ezért 300 px alatt világosodik ki).
    var v = this.props.variant ?? 'rolunk';
    var V = {
      rolunk: { sec: 'rolunk', head: 'rolunk-cim', cls: '' },
      kivalthato: { sec: 'kivalthato', head: 'kivalthato-cim', cls: 'stmt-join' },
      ujceg: { sec: 'ujceg', head: 'ujceg-cim', cls: 'stmt-join' },
      lepesek: { sec: 'hogyan-dolgozunk', head: 'lepes-cim', cls: 'stmt-join', span: 300 }
    };
    var o = V[v] || V.rolunk;
    this.spanPx = o.span || 0;
    return {
      uid: this.uid, theme: this.props.theme ?? 'dark',
      isRolunk: o === V.rolunk, isKivalthato: o === V.kivalthato, isUjceg: o === V.ujceg, isLepesek: o === V.lepesek,
      secId: o.sec, headId: o.head, cls: o.cls
    };
  }
}
window.__CNS_COMPONENTS["Kijelentes"] = { tpl: "<section class=\"ui stmt {{cls}}\" id=\"{{secId}}\" data-stmt=\"{{uid}}\" data-theme=\"{{theme}}\" aria-labelledby=\"{{headId}}\">\n<div class=\"stmt-pin\">\n<div class=\"wrap\">\n<sc-if value=\"{{isRolunk}}\"><h2 class=\"t-h1 stmt-text\" id=\"rolunk-cim\"><span class=\"w\" style=\"--i:0\">Az</span> <span class=\"w\" style=\"--i:1\">AI</span> <span class=\"w\" style=\"--i:2\">nem</span> <span class=\"w\" style=\"--i:3\">egy</span> <span class=\"w\" style=\"--i:4\">újabb</span> <span class=\"w\" style=\"--i:5\">informatikai</span> <span class=\"w\" style=\"--i:6\">projekt.</span> <span class=\"w\" style=\"--i:7\">Olyan,</span> <span class=\"w\" style=\"--i:8\">mint</span> <span class=\"w\" style=\"--i:9\">egy</span> <span class=\"w\" style=\"--i:10\">új</span> <span class=\"w\" style=\"--i:11\">munkatárs,</span> <span class=\"w\" style=\"--i:12\">aki</span> <span class=\"w\" style=\"--i:13\">átveszi</span> <span class=\"w\" style=\"--i:14\">az</span> <span class=\"w\" style=\"--i:15\">időrabló</span> <span class=\"w\" style=\"--i:16\">feladatokat,</span> <span class=\"w\" style=\"--i:17\">megválaszolja</span> <span class=\"w\" style=\"--i:18\">a</span> <span class=\"w\" style=\"--i:19\">gyakori</span> <span class=\"w\" style=\"--i:20\">kérdéseket,</span> <span class=\"w\" style=\"--i:21\">előkészíti</span> <span class=\"w\" style=\"--i:22\">a</span> <span class=\"w\" style=\"--i:23\">leveleket,</span> <span class=\"w\" style=\"--i:24\">jegyzetel.</span> <span class=\"w\" style=\"--i:25\">Nem</span> <span class=\"w\" style=\"--i:26\">fárad</span> <span class=\"w\" style=\"--i:27\">és</span> <span class=\"w\" style=\"--i:28\">nem</span> <span class=\"w\" style=\"--i:29\">feled</span> <span class=\"w\" style=\"--i:30\">semmit.</span> <span class=\"w\" style=\"--i:31\">A</span> <span class=\"w\" style=\"--i:32\">csapat</span> <span class=\"w\" style=\"--i:33\">pedig</span> <span class=\"w\" style=\"--i:34\">arra</span> <span class=\"w\" style=\"--i:35\">figyelhet,</span> <span class=\"w\" style=\"--i:36\">ami</span> <span class=\"w\" style=\"--i:37\">igazán</span> <span class=\"w\" style=\"--i:38\">számít.</span></h2></sc-if>\n<sc-if value=\"{{isKivalthato}}\"><h2 class=\"t-h1 stmt-text\" id=\"kivalthato-cim\"><span class=\"w\" style=\"--i:0\">Mind</span> <span class=\"w\" style=\"--i:1\">a</span> <span class=\"w\" style=\"--i:2\">négy</span> <span class=\"w\" style=\"--i:3\">problémánál</span> <span class=\"w\" style=\"--i:4\">ugyanaz</span> <span class=\"w\" style=\"--i:5\">történik.</span><br><span class=\"w\" style=\"--i:6\">A</span> <span class=\"w\" style=\"--i:7\">feladat</span> <span class=\"w\" style=\"--i:8\">egy</span> <span class=\"w\" style=\"--i:9\">emberre</span> <span class=\"w\" style=\"--i:10\">vár,</span> <span class=\"w\" style=\"--i:11\">hogy</span> <span class=\"w\" style=\"--i:12\">lökjön</span> <span class=\"w\" style=\"--i:13\">rajta</span> <span class=\"w\" style=\"--i:14\">egyet.</span><br><span class=\"w\" style=\"--i:15\">Új</span> <span class=\"w\" style=\"--i:16\">státusz,</span> <span class=\"w\" style=\"--i:17\">új</span> <span class=\"w\" style=\"--i:18\">állapot.</span><br><span class=\"w\" style=\"--i:19\">A</span> <span class=\"w\" style=\"--i:20\">lényeg:</span> <span class=\"w\" style=\"--i:21\">ez</span> <span class=\"w\" style=\"--i:22\">a</span> <span class=\"w\" style=\"--i:23\">tevékenység</span> <span class=\"w\" style=\"--i:24\">kiváltható.</span></h2></sc-if>\n<sc-if value=\"{{isUjceg}}\"><h2 class=\"t-h1 stmt-text\" id=\"ujceg-cim\"><span class=\"w\" style=\"--i:0\">Új</span> <span class=\"w\" style=\"--i:1\">cég</span> <span class=\"w\" style=\"--i:2\">vagyunk.</span><br><span class=\"w\" style=\"--i:3\">Mért,</span> <span class=\"w\" style=\"--i:4\">előtte-utána</span> <span class=\"w\" style=\"--i:5\">számokkal</span> <span class=\"w\" style=\"--i:6\">alátámasztott</span> <span class=\"w\" style=\"--i:7\">esettanulmányunk</span> <span class=\"w\" style=\"--i:8\">még</span> <span class=\"w\" style=\"--i:9\">nincs,</span> <span class=\"w\" style=\"--i:10\">ezért</span> <span class=\"w\" style=\"--i:11\">ilyet</span> <span class=\"w\" style=\"--i:12\">nem</span> <span class=\"w\" style=\"--i:13\">is</span> <span class=\"w\" style=\"--i:14\">írunk</span> <span class=\"w\" style=\"--i:15\">ide.</span><br><span class=\"w\" style=\"--i:16\">Azt</span> <span class=\"w\" style=\"--i:17\">viszont</span> <span class=\"w\" style=\"--i:18\">leírjuk,</span> <span class=\"w\" style=\"--i:19\">mi</span> <span class=\"w\" style=\"--i:20\">fut</span> <span class=\"w\" style=\"--i:21\">most</span> <span class=\"w\" style=\"--i:22\">élesben,</span> <span class=\"w\" style=\"--i:23\">és</span> <span class=\"w\" style=\"--i:24\">mit</span> <span class=\"w\" style=\"--i:25\">mondanak</span> <span class=\"w\" style=\"--i:26\">róla.</span></h2></sc-if>\n<sc-if value=\"{{isLepesek}}\"><h2 class=\"t-h1 stmt-text\" id=\"lepes-cim\"><span class=\"w\" style=\"--i:0\">Három</span> <span class=\"w\" style=\"--i:1\">lépés,</span> <span class=\"w\" style=\"--i:2\">nem</span> <span class=\"w\" style=\"--i:3\">egy</span> <span class=\"w\" style=\"--i:4\">nagy</span> <span class=\"w\" style=\"--i:5\">projekt</span></h2></sc-if>\n</div>\n</div>\n</section>", cls: Component };
})();

/* ---- Main (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  // Nézetbe érkezés figyelése: a [data-inview] elemek .is-in osztályt kapnak, amikor a tetejük a képernyő
  // magasságának 75%-a fölé ér, és elveszítik, amikor visszagörgetve alá kerül (a structureengineering.com.au logikája).
  componentDidMount() {
    this.check = this.check.bind(this);
    this.onScroll = this.onScroll.bind(this);
    this.frame = null;
    this.attach(0);
  }
  attach(tries) {
    var self = this;
    var root = document.querySelector('[data-page="' + this.uid + '"]');
    if (!root) {
      if (tries < 60) { requestAnimationFrame(function () { self.attach(tries + 1); }); }
      return;
    }
    this.rootEl = root;
    this.stepsMeasure = this.stepsMeasure.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.rest = this.rest.bind(this);
    // egy görgetés hossza (px) és a rögzítés utáni első megállás távolsága; mindkettőt a lap méri ki menet közben
    this.tick = 100;
    this.lead = 50;
    var sc0 = document.scrollingElement || document.documentElement;
    this.gest = { y: sc0.scrollTop, n: 0, d: 0, dir: 0, bad: false, t: 0, sc: false, tw: 0 };
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('resize', this.onScroll);
    window.addEventListener('resize', this.stepsMeasure);
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(this.stepsMeasure); }
    this.stepsMeasure();
    // a kijelentések pályája utólag nyúlik meg: kis késéssel újramérünk
    this.later = setTimeout(this.stepsMeasure, 700);
    this.check();
  }
  componentWillUnmount() {
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('resize', this.onScroll);
    window.removeEventListener('resize', this.stepsMeasure);
    clearTimeout(this.later);
    clearTimeout(this.restT);
    if (this.frame) { cancelAnimationFrame(this.frame); }
  }
  // Három lépés: amikor a blokk a fejléc alá ér, rögzül (.is-live), és onnantól még öt görgetésig a helyén marad.
  // A --sp görgetésenként eggyel nő: 1 = az 1-es kerete zöld, 2 = az 1-2 közti vonal, 3 = a 2-es kerete, 4 = a 2-3 közti vonal,
  // 5 = a 3-as kerete. A lépcső kockája az 1., a 3. és az 5. görgetésre lép (a site.css-ben a --sp-ből számol).
  // Álló keretben (a canvas áttekintője), keskeny vagy alacsony képernyőn és csökkentett mozgásnál nincs rögzítés, minden zöld (--sp: 5).
  stepsMeasure() {
    var root = this.rootEl;
    var pin = root ? root.querySelector('[data-steps]') : null;
    if (!pin) { return; }
    var sc = document.scrollingElement || document.documentElement;
    var vh = window.innerHeight;
    var slot = root.querySelector('.hdr-slot');
    var top = (slot ? slot.offsetHeight : 0) + 40;
    var rm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var live = vh < 2000 && (sc.scrollHeight - vh) > 200 && root.offsetWidth >= 1024 && pin.offsetHeight <= vh - top - 24 && !(rm && rm.matches);
    pin.classList.toggle('is-live', live);
    if (!live) { this.steps = null; pin.style.removeProperty('--sp'); return; }
    this.steps = { pin: pin, space: pin.nextElementSibling, top: top, pad: parseFloat(getComputedStyle(pin.parentElement).paddingTop) || 0, done: 0, sp: -1, run: '' };
    this.stepsRun();
    this.stepsUpdate();
  }
  // A rögzítés útja: öt görgetés, plusz az a darab, amennyivel az első megállás a rögzítés pontja után van (lead).
  // Így az ötödik görgetés végén a blokk még éppen áll, a hatodik viszi tovább.
  stepsRun() {
    var s = this.steps;
    if (!s || !s.space) { return; }
    var h = (5 * this.tick + this.lead + 1).toFixed(1) + 'px';
    if (h !== s.run) { s.run = h; s.space.style.setProperty('--steps-run', h); }
  }
  stepsUpdate() {
    var s = this.steps;
    if (!s) { return; }
    // ennyit görgettünk azóta, hogy a blokk a helyére ért; 4 px-en belül már a helyén lévőnek számít
    s.done = s.top - (s.pin.parentElement.getBoundingClientRect().top + s.pad);
    var sp = Math.floor((s.done + 4) / this.tick);
    sp = sp < 0 ? 0 : (sp > 5 ? 5 : sp);
    if (sp !== s.sp) { s.sp = sp; s.pin.style.setProperty('--sp', String(sp)); }
  }
  // Az egérgörgő kattanásait számoljuk: megálláskor a megtett út és a kattanások száma adja egy görgetés hosszát.
  // Érintőpadnál (sok apró lépés) nincs kattanás: ott marad a legutóbb mért érték, alapból 100 px.
  onWheel(e) {
    var g = this.gest;
    // ha a korábbi kattanásokra a lap nem mozdult (pl. a görgő egy nyitott panel fölött járt), azok nem számítanak
    if ((g.n > 0 || g.bad) && !g.sc && e.timeStamp - g.tw > 400) { g.n = 0; g.d = 0; g.dir = 0; g.bad = false; }
    g.tw = e.timeStamp;
    var d = Math.abs(e.deltaY);
    var dir = e.deltaY > 0 ? 1 : -1;
    var notch = !e.ctrlKey && (e.deltaMode !== 0 || d >= 40);
    if (!notch || (g.d && Math.abs(g.d - d) > 0.5) || (g.dir && g.dir !== dir)) { g.bad = true; return; }
    g.d = d; g.dir = dir; g.n++;
  }
  // Megállás (140 ms-ig nem volt görgetés)
  rest() {
    var sc = document.scrollingElement || document.documentElement;
    var y = sc.scrollTop;
    var g = this.gest;
    if (g.n > 0 && !g.bad && y > 1 && y < sc.scrollHeight - window.innerHeight - 1) {
      var t = Math.abs(y - g.y) / g.n;
      // csak akkor fogadjuk el, ha kétszer egymás után ugyanaz jön ki
      if (t >= 40 && t <= 400) {
        if (Math.abs(t - g.t) < 1.5) { this.tick = t; }
        g.t = t;
      }
    }
    g.y = y; g.n = 0; g.d = 0; g.dir = 0; g.bad = false; g.sc = false;
    var s = this.steps;
    if (!s) { return; }
    this.stepsUpdate();
    // A rögzítés hosszát csak addig igazítjuk, amíg a blokk a helyére nem ért, vagy épp most ért oda: ekkor a változás
    // még a képernyő alatt történik. Ha itt állt meg a görgetés, ehhez a megálláshoz mérjük az öt görgetést.
    if (s.done < this.tick - 4) {
      if (s.done >= -4) { this.lead = Math.max(0, s.done); }
      this.stepsRun();
    }
  }
  onScroll() {
    if (this.gest) { this.gest.sc = true; }
    clearTimeout(this.restT);
    this.restT = setTimeout(this.rest, 140);
    if (this.frame) { return; }
    this.frame = requestAnimationFrame(this.check);
  }
  check() {
    this.frame = null;
    if (!this.rootEl) { return; }
    this.stepsUpdate();
    var vh = window.innerHeight;
    var els = this.rootEl.querySelectorAll('[data-inview]');
    // A fejléc alsó vonalának helye (a fejlécsáv alja): ha egy cím fölötti vonal ide kerül (pl. a menüből a megoldásokhoz ugorva),
    // a cím .is-docked osztályt kap. Ilyenkor a fejléc alsó vonala átlátszó, és alatta a cím vonala látszik; a fejléc lenyíló
    // panelje a vonal fölött marad. Az érkezés tört képponttal eltérhet: ezt a --dock-dy viszi rá pontosan a fejléc vonalára.
    var bar = this.rootEl.querySelector('.hdr-bar');
    var edge = bar ? bar.getBoundingClientRect().bottom : -9999;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      // data-inview="195": az elem akkor lép be, amikor a teteje 195 px-rel a képernyő alja fölé ér; érték nélkül a magasság 75%-ánál
      var px = parseFloat(el.getAttribute('data-inview'));
      var limit = px > 0 ? vh - px : vh * 0.75;
      var top = el.getBoundingClientRect().top;
      var on = top < limit;
      var docked = Math.abs(top - edge) < 0.75;
      if (docked) { el.style.setProperty('--dock-dy', (edge - top).toFixed(3) + 'px'); }
      if (docked !== el.classList.contains('is-docked')) { el.classList.toggle('is-docked', docked); }
      if (!el.classList.contains('is-armed')) {
        // első mérés: az állapot átmenet nélkül áll be, az animáció csak ezután él
        if (on) { el.classList.add('is-in'); }
        el.classList.add('is-armed');
        void el.offsetWidth;
        el.classList.add('is-live');
      } else if (on !== el.classList.contains('is-in')) {
        el.classList.toggle('is-in', on);
      }
    }
  }
  renderVals() {
    if (!this.uid) { this.uid = 'page-' + Math.random().toString(36).slice(2, 9); }
    return { uid: this.uid, theme: this.props.theme ?? 'dark' };
  }
}
window.__CNS_COMPONENTS["Main"] = { tpl: "<div class=\"site\" data-theme=\"{{theme}}\" id=\"top\" data-page=\"{{uid}}\">\n<div class=\"hdr-slot\"><dc-import name=\"Fejlec\" theme=\"{{theme}}\" state=\"full\" home=\"{{true}}\" live=\"{{true}}\" hint-size=\"100%,64px\"></dc-import></div>\n<main id=\"tartalom\">\n\n\n<dc-import name=\"Hero\" theme=\"{{theme}}\" hint-size=\"100%,680px\"></dc-import>\n\n\n<dc-import name=\"Kijelentes\" theme=\"{{theme}}\" hint-size=\"100%,560px\"></dc-import>\n\n\n<section class=\"sec-figs\" aria-labelledby=\"ismeros-cim\">\n<div class=\"wrap\"><h2 class=\"spread-h sit-head\" id=\"ismeros-cim\" data-inview=\"195\"><span>Ismerős helyzetek</span> <span>Valós problémák</span></h2></div>\n<ol class=\"stk\">\n<li class=\"stk-item\" style=\"--n:0\"><div class=\"stk-grid\"><p class=\"stk-no\" aria-hidden=\"true\">01 <span>/</span></p><div class=\"stk-fig\"><div class=\"fig fig-snap\" style=\"--fig-mx:0.013;--hl-d:9;--hl-el:32deg;--fig-dy:0.1;--fl-x0:-280;--fl-x1:130;--fl-y0:-470;--fl-y1:170\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox is-thread to-alert\" style=\"--bx:28;--by:20;--bw:40;--bd:56;--bh:0\"><i class=\"hl-bot\"></i></div><div class=\"dbox\" style=\"--bx:28;--by:20;--bw:40;--bd:56;--bh:0;--bz:3;--hz:9;--delay:0.12s\"><i class=\"hl-bot\"></i></div><div class=\"dbox\" style=\"--bx:28;--by:20;--bw:40;--bd:56;--bh:0;--bz:6;--hz:18;--delay:0.06s\"><i class=\"hl-bot\"></i></div><div class=\"dbox\" style=\"--bx:28;--by:20;--bw:40;--bd:56;--bh:0;--bz:9;--hz:27\"><i class=\"hl-bot\"></i></div></div></div></div><div class=\"stk-body\"><p class=\"stk-tag\">Elakadás</p><h3 class=\"stk-title\">A megválaszolatlan megkeresés várakozik.</h3><p class=\"stk-desc\">A beérkezett ügyfélmegkeresés napokig válaszra vár. Nem idő, hanem információ hiány miatt, mert a válaszadás előtt össze kell szedni azokat.</p><a class=\"rbtn\" href=\"/services/ai-customer-service\" aria-label=\"Megoldás: AI ügyfélszolgálat\"><span class=\"rbtn-text\"><span class=\"rbtn-t1\">Megoldás</span><span class=\"rbtn-t2\" aria-hidden=\"true\">Megoldás</span></span><span class=\"rbtn-icon\" aria-hidden=\"true\"><span class=\"rbtn-i1\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span><span class=\"rbtn-i2\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></span></a></div></div></li>\n<li class=\"stk-item\" style=\"--n:1\"><div class=\"stk-grid\"><p class=\"stk-no\" aria-hidden=\"true\">02 <span>/</span></p><div class=\"stk-fig\"><div class=\"fig\" style=\"--fig-mx:0.022;--hl-d:10;--hl-az:112.5deg;--hl-el:32deg;--fl-x0:-380;--fl-x1:200;--fl-y0:-140;--fl-y1:280\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox\" style=\"--bx:5;--by:36;--bw:24;--bd:24;--bh:0\"><i class=\"hl-bot\"></i></div><div class=\"dbox\" style=\"--bx:36;--by:36;--bw:24;--bd:24;--bh:0\"><i class=\"hl-bot\"></i></div><div class=\"dbox\" style=\"--bx:67;--by:36;--bw:24;--bd:24;--bh:0\"><i class=\"hl-bot\"></i></div><div class=\"dbox is-alert cube-a\" style=\"--bx:12;--by:43;--bw:10;--bd:10;--bh:10\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:10;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:0;--l:10;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:10;--l:10;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:10;--l:10;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox is-alert cube-b\" style=\"--bx:43;--by:43;--bw:10;--bd:10;--bh:10\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:10;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:0;--l:10;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:10;--l:10;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:10;--l:10;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox is-alert cube-c\" style=\"--bx:74;--by:43;--bw:10;--bd:10;--bh:10\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:10;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:0;--l:10;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:10;--l:10;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:10;--l:10;--r:270deg\"></i><i class=\"hl-top\"></i></div></div></div></div><div class=\"stk-body\"><p class=\"stk-tag\">Redundancia</p><h3 class=\"stk-title\">Az adatok többszörösen kerülnek rögzítésre.</h3><p class=\"stk-desc\">Az ügyfél e-mailben érkező adatai manuálisan kerülnek rögzítésre egy táblázatba, aztán a számlázóba, majd a többi programba.</p><a class=\"rbtn\" href=\"/services/integration\" aria-label=\"Megoldás: Integráció\"><span class=\"rbtn-text\"><span class=\"rbtn-t1\">Megoldás</span><span class=\"rbtn-t2\" aria-hidden=\"true\">Megoldás</span></span><span class=\"rbtn-icon\" aria-hidden=\"true\"><span class=\"rbtn-i1\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span><span class=\"rbtn-i2\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></span></a></div></div></li>\n<li class=\"stk-item\" style=\"--n:2\"><div class=\"stk-grid\"><p class=\"stk-no\" aria-hidden=\"true\">03 <span>/</span></p><div class=\"stk-fig\"><div class=\"fig fig-snap\" style=\"--fig-mx:0.005;--hl-d:24;--hl-el:32deg;--fl-x0:-280;--fl-x1:130;--fl-y0:-380;--fl-y1:170\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox\" style=\"--bx:16;--by:44;--bw:8;--bd:8;--bh:24;--hx:-36\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:8;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:0;--l:8;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:8;--l:8;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:8;--l:8;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:72;--by:44;--bw:8;--bd:8;--bh:24;--hry:90deg;--to:100% 50% 0;--delay:0.95s\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:8;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:0;--l:8;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:8;--l:8;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:8;--l:8;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox is-thread to-alert f3-sheet\" style=\"--bx:16;--by:28;--bw:64;--bd:40;--bh:0;--bz:24;--cdelay:1.3s\"><i class=\"hl-bot\"></i></div></div></div></div><div class=\"stk-body\"><p class=\"stk-tag\">Emberi függőség</p><h3 class=\"stk-title\">A teljes adminisztrációs folyamat egy kézben van.</h3><p class=\"stk-desc\">A dokumentum bekérést, időpont egyeztetést és a napló megírást is egyetlen ember végzi. Az ő hiányában azonban a folyamat megáll.</p><a class=\"rbtn\" href=\"/services/ai-assistant\" aria-label=\"Megoldás: AI asszisztens\"><span class=\"rbtn-text\"><span class=\"rbtn-t1\">Megoldás</span><span class=\"rbtn-t2\" aria-hidden=\"true\">Megoldás</span></span><span class=\"rbtn-icon\" aria-hidden=\"true\"><span class=\"rbtn-i1\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span><span class=\"rbtn-i2\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></span></a></div></div></li>\n<li class=\"stk-item\" style=\"--n:3\"><div class=\"stk-grid\"><p class=\"stk-no\" aria-hidden=\"true\">04 <span>/</span></p><div class=\"stk-fig\"><div class=\"fig fig-snap\" style=\"--fig-mx:0.0441;--hl-d:18;--fig-zoom:0.85;--fig-dx:0.07\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><i class=\"f4-line\" style=\"--p1x:34;--p1y:21;--d1x:-4;--d1y:-4;--p2x:54;--p2y:16;--d2x:4;--d2y:-5\"></i><i class=\"f4-line\" style=\"--p1x:62;--p1y:24;--d1x:4;--d1y:-5;--p2x:74;--p2y:44;--d2x:5;--d2y:3\"></i><i class=\"f4-line\" style=\"--p1x:62;--p1y:54;--d1x:5;--d1y:3;--p2x:32;--p2y:71;--d2x:-5;--d2y:5\"></i><i class=\"f4-line\" style=\"--p1x:23;--p1y:58;--d1x:-5;--d1y:5;--p2x:23;--p2y:30;--d2x:-4;--d2y:-4\"></i><i class=\"f4-line\" style=\"--p1x:43;--p1y:40;--d1x:0;--d1y:0;--p2x:28.5;--p2y:30;--d2x:-4;--d2y:-4\"></i><i class=\"f4-line\" style=\"--p1x:49;--p1y:40;--d1x:0;--d1y:0;--p2x:58;--p2y:24;--d2x:4;--d2y:-5\"></i><i class=\"f4-line\" style=\"--p1x:52;--p1y:46;--d1x:0;--d1y:0;--p2x:62;--p2y:49;--d2x:5;--d2y:3\"></i><i class=\"f4-line\" style=\"--p1x:46;--p1y:52;--d1x:0;--d1y:0;--p2x:27.5;--p2y:58;--d2x:-5;--d2y:5\"></i><div class=\"dbox\" style=\"--bx:12;--by:12;--bw:22;--bd:18;--bh:14;--hx:-4;--hy:-4\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:22;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:0;--l:18;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:18;--l:22;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:18;--l:18;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:54;--by:8;--bw:16;--bd:16;--bh:8;--hx:4;--hy:-5\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:16;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:16;--y:0;--l:16;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:16;--y:16;--l:16;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:16;--l:16;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:62;--by:44;--bw:24;--bd:20;--bh:18;--hx:5;--hy:3\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:24;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:24;--y:0;--l:20;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:24;--y:20;--l:24;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:20;--l:20;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:14;--by:58;--bw:18;--bd:26;--bh:10;--hx:-5;--hy:5\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:18;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:18;--y:0;--l:26;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:18;--y:26;--l:18;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:26;--l:26;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:40;--by:40;--bw:12;--bd:12;--bh:6\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:12;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:0;--l:12;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:12;--l:12;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:12;--l:12;--r:270deg\"></i><i class=\"hl-top\"></i></div></div></div></div><div class=\"stk-body\"><p class=\"stk-tag\">Fragmentáltság</p><h3 class=\"stk-title\">Programok, melyek nem kommunikálnak egymással.</h3><p class=\"stk-desc\">A levelezés, a naptár, a táblázatkezelő, a számlázó és a tárhely külön-külön működik. A közöttük lévő kapcsolatot pedig egy kolléga pótolja.</p><a class=\"rbtn\" href=\"/services/custom-development\" aria-label=\"Megoldás: Egyedi fejlesztés\"><span class=\"rbtn-text\"><span class=\"rbtn-t1\">Megoldás</span><span class=\"rbtn-t2\" aria-hidden=\"true\">Megoldás</span></span><span class=\"rbtn-icon\" aria-hidden=\"true\"><span class=\"rbtn-i1\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span><span class=\"rbtn-i2\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></span></a></div></div></li>\n</ol>\n</section>\n\n\n<dc-import name=\"Kijelentes\" theme=\"{{theme}}\" variant=\"kivalthato\" hint-size=\"100%,520px\"></dc-import>\n\n\n<section class=\"sec-figs\" aria-labelledby=\"megoldas-cim\">\n<span class=\"jump\" id=\"megoldasok\" aria-hidden=\"true\"></span>\n<div class=\"wrap\"><h2 class=\"spread-h sit-head\" id=\"megoldas-cim\" data-inview=\"195\"><span>Minden problémára</span> <span>Van megoldás</span></h2></div>\n<ol class=\"stk stk-sol\">\n<li class=\"stk-item\" style=\"--n:0\"><div class=\"stk-grid\"><h3 class=\"stk-no\"><b class=\"stk-no-tag\">Elakadás</b></h3><div class=\"stk-fig\"><div class=\"fig sfig\" style=\"--fig-mx:0.013;--hl-d:9;--hl-el:32deg;--fig-dy:0.1;--fl-x0:-280;--fl-x1:130;--fl-y0:-470;--fl-y1:170\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox s1-d\" style=\"--bx:28;--by:20;--bw:40;--bd:56;--bh:0;--to:0% 50% 0\"><i class=\"hl-bot\"></i></div><div class=\"dbox s1-c\" style=\"--bx:28;--by:20;--bw:40;--bd:56;--bh:0;--bz:3\"><i class=\"hl-bot\"></i></div><div class=\"dbox s1-b\" style=\"--bx:28;--by:20;--bw:40;--bd:56;--bh:0;--bz:6\"><i class=\"hl-bot\"></i></div><div class=\"dbox s1-a\" style=\"--bx:28;--by:20;--bw:40;--bd:56;--bh:0;--bz:9\"><i class=\"hl-bot\"></i></div></div></div></div><div class=\"stk-body\"><h4 class=\"stk-tag\">AI ügyfélszolgálat</h4><p class=\"stk-title\">A megkeresés azonnal választ kap.</p><p class=\"stk-desc\">Éjjel-nappal válaszol a beérkező kérdésekre a weboldalon, chaten és e-mailben, a cég saját dokumentumai alapján. Amire nem tud felelni, azt összefoglalva továbbadja egy kollégának.</p><a class=\"rbtn\" href=\"/services#ai-customer-service\" aria-label=\"Bővebben: AI ügyfélszolgálat\"><span class=\"rbtn-text\"><span class=\"rbtn-t1\">Bővebben</span><span class=\"rbtn-t2\" aria-hidden=\"true\">Bővebben</span></span><span class=\"rbtn-icon\" aria-hidden=\"true\"><span class=\"rbtn-i1\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span><span class=\"rbtn-i2\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></span></a></div></div></li>\n<li class=\"stk-item\" style=\"--n:1\"><div class=\"stk-grid\"><h3 class=\"stk-no\"><b class=\"stk-no-tag\">Redundancia</b></h3><div class=\"stk-fig\"><div class=\"fig sfig\" style=\"--fig-mx:0.044;--hl-d:10;--hl-az:112.5deg;--hl-el:32deg;--fl-x0:-380;--fl-x1:200;--fl-y0:-140;--fl-y1:280\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox\" style=\"--bx:5;--by:36;--bw:24;--bd:24;--bh:0\"><i class=\"hl-bot\"></i></div><div class=\"dbox\" style=\"--bx:36;--by:36;--bw:24;--bd:24;--bh:0\"><i class=\"hl-bot\"></i></div><div class=\"dbox\" style=\"--bx:67;--by:36;--bw:24;--bd:24;--bh:0\"><i class=\"hl-bot\"></i></div><svg class=\"s2-icons\" viewBox=\"0 0 96 96\"><g transform=\"translate(17 48) rotate(45)\"><rect x=\"-6.6\" y=\"-2.3\" width=\"8\" height=\"4.6\" rx=\"2.3\"></rect><rect x=\"-1.4\" y=\"-2.3\" width=\"8\" height=\"4.6\" rx=\"2.3\"></rect></g><g transform=\"translate(48 48) rotate(45)\"><rect x=\"-6.6\" y=\"-2.3\" width=\"8\" height=\"4.6\" rx=\"2.3\"></rect><rect x=\"-1.4\" y=\"-2.3\" width=\"8\" height=\"4.6\" rx=\"2.3\"></rect></g><g transform=\"translate(79 48) rotate(45)\"><rect x=\"-6.6\" y=\"-2.3\" width=\"8\" height=\"4.6\" rx=\"2.3\"></rect><rect x=\"-1.4\" y=\"-2.3\" width=\"8\" height=\"4.6\" rx=\"2.3\"></rect></g></svg><i class=\"s2-l\" style=\"--p1x:43;--p1y:78;--d2x:-20.63;--d2y:-23.80\"></i><i class=\"s2-l\" style=\"--p1x:48;--p1y:73;--d2x:0.00;--d2y:-18.10\"></i><i class=\"s2-l\" style=\"--p1x:53;--p1y:78;--d2x:23.25;--d2y:-26.83\"></i><div class=\"dbox s2-x s2-a\" style=\"--bx:12;--by:43;--bw:10;--bd:10;--bh:10\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:10;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:0;--l:10;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:10;--l:10;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:10;--l:10;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox is-thread s2-b\" style=\"--bx:43;--by:43;--bw:10;--bd:10;--bh:10;--my:30;--hy:30\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:10;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:0;--l:10;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:10;--l:10;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:10;--l:10;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox s2-x s2-c\" style=\"--bx:74;--by:43;--bw:10;--bd:10;--bh:10\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:10;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:0;--l:10;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:10;--l:10;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:10;--l:10;--r:270deg\"></i><i class=\"hl-top\"></i></div></div></div></div><div class=\"stk-body\"><h4 class=\"stk-tag\">Optimalizálás</h4><p class=\"stk-title\">Az adatok egyszer kerülnek rögzítésre.</p><p class=\"stk-desc\">Végigkövetjük, hogyan halad egy ügy a cégen belül, és megkeressük a felesleges, ismétlődő lépéseket. Ezeket a meglévő programokban egyszerűsítjük vagy automatizáljuk, új rendszer bevezetése nélkül.</p><a class=\"rbtn\" href=\"/services#optimization\" aria-label=\"Bővebben: Optimalizálás\"><span class=\"rbtn-text\"><span class=\"rbtn-t1\">Bővebben</span><span class=\"rbtn-t2\" aria-hidden=\"true\">Bővebben</span></span><span class=\"rbtn-icon\" aria-hidden=\"true\"><span class=\"rbtn-i1\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span><span class=\"rbtn-i2\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></span></a></div></div></li>\n<li class=\"stk-item\" style=\"--n:2\"><div class=\"stk-grid\"><h3 class=\"stk-no\"><b class=\"stk-no-tag\">Emberi függőség</b></h3><div class=\"stk-fig\"><div class=\"fig sfig\" style=\"--fig-mx:0.006;--hl-d:24;--hl-el:32deg;--fl-x0:-280;--fl-x1:130;--fl-y0:-380;--fl-y1:170\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox s3-fl\" style=\"--bx:16;--by:60;--bw:8;--bd:8;--bh:24\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:8;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:0;--l:8;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:8;--l:8;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:8;--l:8;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox s3-fr\" style=\"--bx:72;--by:60;--bw:8;--bd:8;--bh:24\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:8;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:0;--l:8;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:8;--l:8;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:8;--l:8;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox s3-bl\" style=\"--bx:16;--by:28;--bw:8;--bd:8;--bh:24\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:8;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:0;--l:8;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:8;--l:8;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:8;--l:8;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox s3-br\" style=\"--bx:72;--by:28;--bw:8;--bd:8;--bh:24\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:8;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:0;--l:8;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:8;--y:8;--l:8;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:8;--l:8;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox is-thread s3-top\" style=\"--bx:16;--by:28;--bw:64;--bd:40;--bh:0;--bz:24\"><i class=\"hl-bot\"></i></div></div></div></div><div class=\"stk-body\"><h4 class=\"stk-tag\">AI asszisztens</h4><p class=\"stk-title\">Az adminisztráció több lábon áll.</p><p class=\"stk-desc\">Átveszi a napi adminisztrációt: előkészíti a leveleket, egyezteti az időpontokat, bekéri a hiányzó dokumentumokat és jegyzetel. Ami kimegy a cégből, azt előbb egy ember hagyja jóvá.</p><a class=\"rbtn\" href=\"/services#ai-assistant\" aria-label=\"Bővebben: AI asszisztens\"><span class=\"rbtn-text\"><span class=\"rbtn-t1\">Bővebben</span><span class=\"rbtn-t2\" aria-hidden=\"true\">Bővebben</span></span><span class=\"rbtn-icon\" aria-hidden=\"true\"><span class=\"rbtn-i1\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span><span class=\"rbtn-i2\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></span></a></div></div></li>\n<li class=\"stk-item\" style=\"--n:3\"><div class=\"stk-grid\"><h3 class=\"stk-no\"><b class=\"stk-no-tag\">Fragmentáltság</b></h3><div class=\"stk-fig\"><div class=\"fig fig-snap f4-ok\" style=\"--fig-mx:0.0441;--hl-d:18;--fig-zoom:0.85;--fig-dx:0.07\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><i class=\"f4-line\" style=\"--p1x:34;--p1y:21;--d1x:-4;--d1y:-4;--p2x:54;--p2y:16;--d2x:4;--d2y:-5\"></i><i class=\"f4-line\" style=\"--p1x:62;--p1y:24;--d1x:4;--d1y:-5;--p2x:74;--p2y:44;--d2x:5;--d2y:3\"></i><i class=\"f4-line\" style=\"--p1x:62;--p1y:54;--d1x:5;--d1y:3;--p2x:32;--p2y:71;--d2x:-5;--d2y:5\"></i><i class=\"f4-line\" style=\"--p1x:23;--p1y:58;--d1x:-5;--d1y:5;--p2x:23;--p2y:30;--d2x:-4;--d2y:-4\"></i><i class=\"f4-line\" style=\"--p1x:43;--p1y:40;--d1x:0;--d1y:0;--p2x:28.5;--p2y:30;--d2x:-4;--d2y:-4\"></i><i class=\"f4-line\" style=\"--p1x:49;--p1y:40;--d1x:0;--d1y:0;--p2x:58;--p2y:24;--d2x:4;--d2y:-5\"></i><i class=\"f4-line\" style=\"--p1x:52;--p1y:46;--d1x:0;--d1y:0;--p2x:62;--p2y:49;--d2x:5;--d2y:3\"></i><i class=\"f4-line\" style=\"--p1x:46;--p1y:52;--d1x:0;--d1y:0;--p2x:27.5;--p2y:58;--d2x:-5;--d2y:5\"></i><div class=\"dbox\" style=\"--bx:12;--by:12;--bw:22;--bd:18;--bh:14;--hx:-4;--hy:-4\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:22;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:0;--l:18;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:18;--l:22;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:18;--l:18;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:54;--by:8;--bw:16;--bd:16;--bh:8;--hx:4;--hy:-5\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:16;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:16;--y:0;--l:16;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:16;--y:16;--l:16;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:16;--l:16;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:62;--by:44;--bw:24;--bd:20;--bh:18;--hx:5;--hy:3\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:24;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:24;--y:0;--l:20;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:24;--y:20;--l:24;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:20;--l:20;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:14;--by:58;--bw:18;--bd:26;--bh:10;--hx:-5;--hy:5\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:18;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:18;--y:0;--l:26;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:18;--y:26;--l:18;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:26;--l:26;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:40;--by:40;--bw:12;--bd:12;--bh:6\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:12;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:0;--l:12;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:12;--l:12;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:12;--l:12;--r:270deg\"></i><i class=\"hl-top\"></i></div></div></div></div><div class=\"stk-body\"><h4 class=\"stk-tag\">Integráció</h4><p class=\"stk-title\">Programok, melyek egy rendszerként működnek.</p><p class=\"stk-desc\">Egy rendszerré köti össze a meglévő programokat: a levelezést, a naptárat, a foglalást, a számlázót és a fizetést. Az adatot elég egyszer rögzíteni, onnan magától jut el mindenhová, ahol kell.</p><a class=\"rbtn\" href=\"/services#integration\" aria-label=\"Bővebben: Integráció\"><span class=\"rbtn-text\"><span class=\"rbtn-t1\">Bővebben</span><span class=\"rbtn-t2\" aria-hidden=\"true\">Bővebben</span></span><span class=\"rbtn-icon\" aria-hidden=\"true\"><span class=\"rbtn-i1\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span><span class=\"rbtn-i2\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M2 7h10M8 3l4 4-4 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></span></a></div></div></li>\n</ol>\n<p class=\"stk-more\"><a class=\"link\" href=\"/services\">Minden szolgáltatásunk</a></p>\n</section>\n\n\n<dc-import name=\"Kijelentes\" theme=\"{{theme}}\" variant=\"ujceg\" hint-size=\"100%,520px\"></dc-import>\n\n<section class=\"sec-figs\" id=\"hol-tartunk-ma\" aria-labelledby=\"hol-cim\">\n<span class=\"jump\" id=\"referenciak\" aria-hidden=\"true\"></span>\n<div class=\"wrap\"><h2 class=\"spread-h sit-head\" id=\"hol-cim\" data-inview=\"195\"><span>Hol tartunk ma?</span> <span>Referenciák</span></h2></div>\n<ol class=\"stk stk-ref\">\n<li class=\"stk-item\" id=\"ref-kivitelezo\" style=\"--n:0\"><div class=\"stk-grid\"><p class=\"stk-no\" aria-hidden=\"true\">01 <span>/</span></p><div class=\"stk-fig\"><div class=\"fig sfig\" style=\"--hl-d:12;--hl-el:32deg;--fig-dy:0.1;--fl-x0:-280;--fl-x1:130;--fl-y0:-470;--fl-y1:170\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox r1-d\" style=\"--bx:36;--by:20;--bw:40;--bd:56;--bh:0\"><i class=\"hl-bot\"></i></div><div class=\"dbox r1-c\" style=\"--bx:36;--by:20;--bw:40;--bd:56;--bh:0;--bz:3\"><i class=\"hl-bot\"></i></div><div class=\"dbox r1-b\" style=\"--bx:36;--by:20;--bw:40;--bd:56;--bh:0;--bz:6\"><i class=\"hl-bot\"></i></div><div class=\"dbox r1-a\" style=\"--bx:36;--by:20;--bw:40;--bd:56;--bh:0;--bz:9\"><i class=\"hl-bot\"></i></div><div class=\"dbox is-thread\" style=\"--bx:12;--by:42;--bw:12;--bd:12;--bh:12\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:12;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:0;--l:12;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:12;--l:12;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:12;--l:12;--r:270deg\"></i><i class=\"hl-top\"></i></div></div></div></div><div class=\"stk-body\"><p class=\"stk-tag\">Építőipar</p><h3 class=\"stk-title\">Szigetelőipari kivitelező, családi cég</h3><p class=\"stk-desc\">Saját tudásbázis a cég dokumentumaiból, és egy belső rendszer, amit mi üzemeltetünk. A cégvezető szerint az a lényeg, hogy nem neki kell a régi munkák között keresgélnie, és minden válasznál látja, melyik dokumentumból jött.</p><p class=\"work-note\"><span class=\"sq-o\" aria-hidden=\"true\"></span><em class=\"note\">Eredményt akkor írunk ide, amikor mértük.</em></p></div></div></li>\n<li class=\"stk-item\" id=\"ref-klinika\" style=\"--n:1\"><div class=\"stk-grid\"><p class=\"stk-no\" aria-hidden=\"true\">02 <span>/</span></p><div class=\"stk-fig\"><div class=\"fig sfig\" style=\"--fig-mx:-0.004;--hl-d:28;--hl-el:32deg;--fl-x0:-280;--fl-x1:130;--fl-y0:-380;--fl-y1:170\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox\" style=\"--bx:16;--by:42;--bw:12;--bd:12;--bh:10\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:12;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:0;--l:12;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:12;--l:12;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:12;--l:12;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:33;--by:42;--bw:12;--bd:12;--bh:22\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:12;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:0;--l:12;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:12;--l:12;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:12;--l:12;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:50;--by:42;--bw:12;--bd:12;--bh:16\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:12;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:0;--l:12;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:12;--l:12;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:12;--l:12;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:67;--by:42;--bw:12;--bd:12;--bh:28\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:12;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:0;--l:12;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:12;--y:12;--l:12;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:12;--l:12;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox is-thread r2-m\" style=\"--bx:14;--by:40;--bw:16;--bd:16;--bh:0;--dl:0.3s;--bz:11.5\"><i class=\"hl-bot\"></i></div><div class=\"dbox is-thread r2-m\" style=\"--bx:31;--by:40;--bw:16;--bd:16;--bh:0;--dl:0.8s;--bz:23.5\"><i class=\"hl-bot\"></i></div><div class=\"dbox is-thread r2-m\" style=\"--bx:48;--by:40;--bw:16;--bd:16;--bh:0;--dl:1.3s;--bz:17.5\"><i class=\"hl-bot\"></i></div><div class=\"dbox is-thread r2-m\" style=\"--bx:65;--by:40;--bw:16;--bd:16;--bh:0;--dl:1.8s;--bz:29.5\"><i class=\"hl-bot\"></i></div></div></div></div><div class=\"stk-body\"><p class=\"stk-tag\">Magánklinika</p><h3 class=\"stk-title\">Egy budapesti magánklinika</h3><p class=\"stk-desc\">Beérkező megkeresések kezelése és ismétlődő adminisztráció. A munka most indul. A kiinduló számokat az első munkanap előtt rögzítjük, hogy a végén legyen mihez mérni.</p><p class=\"work-note\"><span class=\"sq-o\" aria-hidden=\"true\"></span><em class=\"note\">Eredményt akkor írunk ide, amikor mértük.</em></p></div></div></li>\n<li class=\"stk-item\" id=\"ref-sajat\" style=\"--n:2\"><div class=\"stk-grid\"><p class=\"stk-no\" aria-hidden=\"true\">03 <span>/</span></p><div class=\"stk-fig\"><div class=\"fig sfig\" style=\"--hl-d:42;--hl-el:32deg;--fig-dy:0.08;--fl-x0:-280;--fl-x1:130;--fl-y0:-380;--fl-y1:170\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox\" style=\"--bx:41;--by:41;--bw:14;--bd:14;--bh:14\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:14;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:14;--y:0;--l:14;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:14;--y:14;--l:14;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:14;--l:14;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox is-thread r3-m\" style=\"--bx:41;--by:41;--bw:14;--bd:14;--bh:14;--bz:14\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:14;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:14;--y:0;--l:14;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:14;--y:14;--l:14;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:14;--l:14;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox r3-t\" style=\"--bx:41;--by:41;--bw:14;--bd:14;--bh:14;--bz:28\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:14;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:14;--y:0;--l:14;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:14;--y:14;--l:14;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:14;--l:14;--r:270deg\"></i><i class=\"hl-top\"></i></div></div></div></div><div class=\"stk-body\"><p class=\"stk-tag\">A saját rendszereink</p><h3 class=\"stk-title\">A saját cégünk</h3><p class=\"stk-desc\">A rendszert először magunkra építettük. Az első hónap nem volt szép: több időt vitt el a javítása, mint amennyit megspórolt. Azért tudjuk, mi fog elromlani Önöknél, mert nálunk már elromlott.</p></div></div></li>\n</ol>\n</section>\n\n\n<dc-import name=\"Kijelentes\" theme=\"{{theme}}\" variant=\"lepesek\" hint-size=\"100%,400px\"></dc-import>\n\n<section class=\"steps-sec\" aria-labelledby=\"lepes-cim\">\n<div class=\"wrap g12 steps-pin\" data-steps=\"1\">\n<ol class=\"steps\">\n<li class=\"step\">\n<span class=\"step-num\" aria-hidden=\"true\">1</span>\n<div>\n<h3 class=\"t-h3 step-title\"><span class=\"sr-only\">1. </span>Felmérés: fix áron, lezárt eredménnyel</h3>\n<p>Felvett, végigvezetett beszélgetés a cég működéséről. Utána két dokumentumot kapnak: az egyik megmutatja, hol megy el az idő és a pénz, a másik azt a három dolgot, amivel érdemes kezdeni. Közben rögzítjük a mai állapot számait, hogy később legyen mihez mérni, és a saját adataikból készítünk egy valódi mintát.</p>\n</div>\n</li>\n<li class=\"step\">\n<span class=\"step-num\" aria-hidden=\"true\">2</span>\n<div>\n<h3 class=\"t-h3 step-title\"><span class=\"sr-only\">2. </span>Bevezetés: megnevezett hatókör, fix ár</h3>\n<p>Egy folyamattal kezdünk, nem az egész céggel. Az első működő verzió 14 napon belül elkészül, utána éles használat mellett finomítjuk. Előre leírjuk, mi van benne és mi nincs, és azt is, minek kell teljesülnie, hogy sikeresnek számítson.</p>\n</div>\n</li>\n<li class=\"step\">\n<span class=\"step-num\" aria-hidden=\"true\">3</span>\n<div>\n<h3 class=\"t-h3 step-title\"><span class=\"sr-only\">3. </span>Üzemeltetés: havidíjban</h3>\n<p>A bevezetés után felügyeljük a rendszert, frissítjük, és ha elromlik, megjavítjuk. Van egy megnevezett felelős, akit lehet hívni. Ide tartoznak az IT-alapok is: hozzáférések, levelezés, fájlok, weboldal.</p>\n</div>\n</li>\n</ol>\n<div class=\"steps-fig\"><div class=\"fig sfig stair\" style=\"--hl-d:28;--hl-el:32deg;--fig-dy:0.06\" aria-hidden=\"true\"><div class=\"hl-board\"><i class=\"hl-floor\"></i><div class=\"dbox\" style=\"--bx:15;--by:28;--bw:22;--bd:40;--bh:8\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:22;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:0;--l:40;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:40;--l:22;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:40;--l:40;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:37;--by:28;--bw:22;--bd:40;--bh:18\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:22;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:0;--l:40;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:40;--l:22;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:40;--l:40;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox\" style=\"--bx:59;--by:28;--bw:22;--bd:40;--bh:28\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:22;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:0;--l:40;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:22;--y:40;--l:22;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:40;--l:40;--r:270deg\"></i><i class=\"hl-top\"></i></div><div class=\"dbox is-thread stair-cube\" style=\"--bx:21;--by:43;--bw:10;--bd:10;--bh:10\"><i class=\"hl-bot\"></i><i class=\"hl-side\" style=\"--x:0;--y:0;--l:10;--r:0deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:0;--l:10;--r:90deg\"></i><i class=\"hl-side\" style=\"--x:10;--y:10;--l:10;--r:180deg\"></i><i class=\"hl-side\" style=\"--x:0;--y:10;--l:10;--r:270deg\"></i><i class=\"hl-top\"></i></div></div></div></div>\n<p class=\"t-lead steps-close muted\">A sorrend nem véletlen. Előbb látni kell, mi fáj. Aztán egy dolognak működnie kell. Havidíjról csak ezután van értelme beszélni.</p>\n</div>\n<div class=\"steps-space\" aria-hidden=\"true\"></div>\n</section>\n\n\n<section class=\"wrap sec-sm g12 why-wrap\" aria-labelledby=\"miert-cim\">\n<h2 class=\"t-h2\" id=\"miert-cim\">Miért velünk</h2>\n<ul class=\"why\">\n<li><strong>Futhat a saját szerverükön.</strong> Ahol az adat nem hagyhatja el a céget, ott nem is hagyja el. Ez lehetőség, nem kötelező. Sok helyen ezen múlik, hogy a projekt egyáltalán elindul-e.</li>\n<li><strong>Egy egész eljárást adunk.</strong> Szűkített hozzáférés, emberi jóváhagyás minden kimenő dolog előtt, naplózott döntések, visszakereshető források. Ez akkor is megmarad, ha alatta kicserélődik a technológia.</li>\n<li><strong>Mi is így dolgozunk.</strong> A saját cégünkön próbáltuk ki először, és az első hónap ott sem volt szép.</li>\n<li><strong>Ismerjük a programokat, amiket itt használnak.</strong> Számlázó, tételes ajánlatkészítő, Google Workspace. Nem egy külföldi mintapéldát húzunk rá a cégre.</li>\n<li><strong>KKV-méretben gondolkodunk.</strong> Nincs hónapokig tartó bevezetés, nincs tízfős projektcsapat. Egy folyamattal kezdünk, és annak működnie kell.</li>\n<li><strong>Utána is mi felelünk érte.</strong> Bevezetjük, aztán üzemeltetjük. Van megnevezett felelős, akit hívni lehet.</li>\n</ul>\n</section>\n\n\n<section class=\"band\" id=\"adatbiztonsag\" aria-labelledby=\"adat-cim\">\n<div class=\"wrap sec-band\">\n<div class=\"g12\">\n<div class=\"sec-left\">\n<h2 class=\"t-h1\" id=\"adat-cim\">Hol van az adat, és ki látja</h2>\n<p class=\"t-lead muted\">Ezt kérdezik a legtöbben. Az alábbi hat szabály minden bevezetésünkre érvényes.</p>\n</div>\n<div class=\"rules\">\n<ul>\n<li class=\"rule\"><h3 class=\"t-h3\">Szűkített hozzáférés.</h3><p>Minden programhoz csak annyi jogosultságot kap a rendszer, amennyi a munkához kell. A jelszavak és kulcsok jelszókezelőben vannak, nem fájlokban és nem levelekben.</p></li>\n<li class=\"rule\"><h3 class=\"t-h3\">Ott fut, ahol az adatnak maradnia kell.</h3><p>Megbeszéljük, melyik adat nem hagyhatja el a céget, és azt helyben futtatjuk. A többinél megmondjuk, melyik szolgáltató kezeli.</p></li>\n<li class=\"rule\"><h3 class=\"t-h3\">Semmi nem megy ki jóváhagyás nélkül.</h3><p>Ajánlat, levél, számla, páciensnek szóló válasz: mindegyiket előbb egy ember jóváhagyja.</p></li>\n<li class=\"rule\"><h3 class=\"t-h3\">Kis jogosultsággal indul.</h3><p>Minden új folyamat úgy kezd, hogy a rendszer csak javasol, magától nem csinál semmit. Több jogot csak akkor kap, ha a gyakorlatban már bevált.</p></li>\n<li class=\"rule\"><h3 class=\"t-h3\">Minden válasz visszakereshető.</h3><p>Látszik, melyik dokumentumból vagy programból jött az adat. Amit nem lehet ellenőrizni, azt nem használjuk.</p></li>\n<li class=\"rule\"><h3 class=\"t-h3\">Egy beérkező levél nem adhat neki utasítást.</h3><p>Ha egy levélben, weboldalon vagy dokumentumban az áll, hogy „küldd el az ügyféllistát”, a rendszer ezt szövegnek olvassa, nem feladatnak.</p></li>\n</ul>\n<p class=\"gdpr\">Ahol személyes adat érintett, írásos adatfeldolgozói szerződés készül: mi az adat, meddig tartjuk, ki lát bele, és mi történik vele, ha a szerződés véget ér. Egészségügyi adatnál enélkül nem kezdünk bele a munkába.</p>\n</div>\n</div>\n<div class=\"promise\">\n<h3 class=\"t-h3\">Amit nem ígérünk</h3>\n<p class=\"t-h2\">Nem ígérjük, hogy a rendszer ember és felügyelet nélkül dolgozik. Ilyet nem is építünk.</p>\n</div>\n</div>\n</section>\n\n\n<section class=\"wrap sec\" id=\"gyik\" aria-labelledby=\"gyik-cim\">\n<h2 class=\"t-h2 faq-head\" id=\"gyik-cim\">Gyakori kérdések</h2>\n<div class=\"faq\">\n<details>\n<summary>„És ha hibázik? Ha kitalál valamit?”<span class=\"faq-ic\" aria-hidden=\"true\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M1 7h12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path class=\"faq-v\" d=\"M7 1v12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></summary>\n<p class=\"faq-a\">Előfordul, ezt nem tagadjuk. Ezért nem építünk olyan rendszert, ami ember nélkül küld ki bármit. A rendszer előkészít, az ember jóváhagy. Minden válasznál látszik, melyik dokumentumból jött az adat, tehát ellenőrizni lehet, nem kell vakon elhinni. Egy folyamattal kezdünk, előre kimondott sikerkritériummal. Ha az nem teljesül, azt is megmondjuk.</p>\n</details>\n<details>\n<summary>„Miért nem csináljuk meg mi magunk? Vagy miért nem elég a ChatGPT?”<span class=\"faq-ic\" aria-hidden=\"true\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M1 7h12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path class=\"faq-v\" d=\"M7 1v12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></summary>\n<p class=\"faq-a\">A modellt bárki használhatja egy havi előfizetésért. Ami ehhez még kell: rendbe tenni a cég dokumentumait, összekötni a programokat, ellenőrizhetővé tenni a forrásokat, beépíteni a jóváhagyási lépést, és kell valaki, aki felel érte, ha nem működik. Ezt adjuk: hogy a cégnél, a cég adataival, a napi munkában is működjön.</p>\n</details>\n<details>\n<summary>„Ki tartja karban, ha elromlik vagy változik a modell?”<span class=\"faq-ic\" aria-hidden=\"true\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M1 7h12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path class=\"faq-v\" d=\"M7 1v12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></summary>\n<p class=\"faq-a\">Mi, havidíjért, megnevezett felelőssel. Ez nem választható extra. Ezek a modellek hónapok alatt változnak, és egy magára hagyott rendszer egy idő után csendben rosszabbul kezd válaszolni.</p>\n</details>\n<details>\n<summary>„Már próbáltunk egy AI-eszközt, nem lett belőle semmi.”<span class=\"faq-ic\" aria-hidden=\"true\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M1 7h12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path class=\"faq-v\" d=\"M7 1v12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></summary>\n<p class=\"faq-a\">Ez gyakori. Általában nem a technológiával volt baj: az eszközt nem állították rá egy konkrét, napi folyamatra. A felmérés pont ezt nézi meg: hol megy el ténylegesen az idő, és min lehet mérhetően javítani. Ha az jön ki, hogy semmin, azt is leírjuk.</p>\n</details>\n<details>\n<summary>„Drága.”<span class=\"faq-ic\" aria-hidden=\"true\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M1 7h12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path class=\"faq-v\" d=\"M7 1v12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></summary>\n<p class=\"faq-a\">Lehet. A kérdés az, mihez képest. A felmérés végén leírjuk, mennyi munkaidő megy el ma arra a folyamatra, és ezt az Önök saját óraköltségével számoljuk ki, nem piaci átlaggal. Ha ebből nem jön ki a megtérülés, azt is megmondjuk.</p>\n</details>\n<details>\n<summary>„Mennyi idő alatt lesz kész?”<span class=\"faq-ic\" aria-hidden=\"true\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\"><path d=\"M1 7h12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path class=\"faq-v\" d=\"M7 1v12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></span></summary>\n<p class=\"faq-a\">Az első működő verzió 14 napon belül elkészül, utána éles használat mellett finomítjuk. Ez nem hónapokig tartó projekt. Ha két hét alatt nincs semmi, amit használni lehet, az rossz jel.</p>\n</details>\n</div>\n</section>\n\n\n<section class=\"wrap sec-lg g12\" id=\"kapcsolat\" aria-labelledby=\"zaro-cim\">\n<div class=\"close-l\">\n<h2 class=\"t-h1\" id=\"zaro-cim\">Nézzük meg, hol megy el a legtöbb idő</h2>\n<p>Egy beszélgetéssel kezdünk. Ebből kiderül, van-e itt egyáltalán dolgunk. Ha van, jön a fix áras felmérés. A végén egy dokumentum lesz a kezükben: hol szivárog az idő és a pénz, mivel érdemes kezdeni, és hol tart ma a cég számokban. Ez a dokumentum akkor is az Önöké, ha nem velünk mennek tovább.</p>\n</div>\n<div class=\"close-r\">\n<dc-import name=\"Urlap\" theme=\"{{theme}}\" state=\"alap\" pfx=\"zaro\" hint-size=\"100%,1100px\"></dc-import>\n</div>\n</section>\n</main>\n<dc-import name=\"Lablec\" theme=\"{{theme}}\" hint-size=\"100%,560px\"></dc-import>\n</div>", cls: Component };
})();

/* ---- Szolgaltatasok (a canvasból) ---- */
(function () {
var DCLogic = window.DCLogic;
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme ?? 'dark' };
  }
}
window.__CNS_COMPONENTS["Szolgaltatasok"] = { tpl: "<div class=\"site\" data-theme=\"{{theme}}\">\n<div class=\"hdr-slot\"><dc-import name=\"Fejlec\" theme=\"{{theme}}\" state=\"full\" home=\"{{false}}\" current=\"szolgaltatasok\" live=\"{{true}}\" hint-size=\"100%,64px\"></dc-import></div>\n<main id=\"tartalom\">\n\n<div class=\"wrap sub-top\">\n<nav class=\"crumbs\" aria-label=\"Útvonal\">\n<ol>\n<li><a href=\"/\">Főoldal</a></li>\n</ol>\n</nav>\n<h1 class=\"t-display\">Minden szolgáltatásunk</h1>\n<p class=\"t-lead\">Felül a nyolc szolgáltatás listája, alatta mindegyik részletesen: milyen gondot old meg, és mit kapnak.</p>\n</div>\n\n<nav class=\"wrap\" aria-label=\"Szolgáltatások listája\">\n<ul class=\"svx-index\">\n<li><a href=\"#ai-assistant\"><span>AI asszisztens</span><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M7 2v10M3 8l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></a></li>\n<li><a href=\"#ai-customer-service\"><span>AI ügyfélszolgálat</span><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M7 2v10M3 8l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></a></li>\n<li><a href=\"#integration\"><span>Integráció</span><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M7 2v10M3 8l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></a></li>\n<li><a href=\"#custom-development\"><span>Egyedi fejlesztés</span><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M7 2v10M3 8l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></a></li>\n<li><a href=\"#web-development\"><span>Webfejlesztés</span><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M7 2v10M3 8l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></a></li>\n<li><a href=\"#optimization\"><span>Optimalizálás</span><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M7 2v10M3 8l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></a></li>\n<li><a href=\"#operations\"><span>Üzemeltetés</span><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M7 2v10M3 8l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></a></li>\n<li><a href=\"#consulting\"><span>Tanácsadás</span><svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M7 2v10M3 8l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"></path></svg></a></li>\n</ul>\n</nav>\n\n<div class=\"wrap\">\n<section class=\"sub-block svx\" id=\"ai-assistant\" aria-labelledby=\"ai-assistant-title\">\n<h2 class=\"t-h2 sub-h\" id=\"ai-assistant-title\">AI asszisztens</h2>\n<div class=\"sub-c\">\n<p class=\"t-lead\">Átveszi a napi adminisztrációt: előkészíti a leveleket, egyezteti az időpontokat, bekéri a hiányzó dokumentumokat és jegyzetel. Ami kimegy a cégből, azt előbb egy ember hagyja jóvá.</p>\n<h3 class=\"t-label svx-k\">Milyen gondot old meg</h3>\n<p>A dokumentumok bekérését, az időpontok egyeztetését és a jegyzetelést sok cégnél egyetlen ember végzi. Ha ő nincs bent, a folyamat megáll.</p>\n<h3 class=\"t-label svx-k\">Mit kapnak</h3>\n<ul class=\"list-sq\">\n<li>Előkészített leveleket és válaszokat: csak át kell nézni és jóvá kell hagyni őket.</li>\n<li>Időpont-egyeztetést a meglévő naptárból.</li>\n<li>Kérdezni ott lehet tőle, ahol a napi munka zajlik, és minden válasznál megmutatja, melyik dokumentumból vagy programból jött az adat.</li>\n<li>Kis jogosultsággal indul: eleinte csak javasol, magától nem csinál semmit.</li>\n</ul>\n</div>\n</section>\n\n<section class=\"sub-block svx\" id=\"ai-customer-service\" aria-labelledby=\"ai-customer-service-title\">\n<h2 class=\"t-h2 sub-h\" id=\"ai-customer-service-title\">AI ügyfélszolgálat</h2>\n<div class=\"sub-c\">\n<p class=\"t-lead\">Éjjel-nappal válaszol a beérkező kérdésekre a weboldalon, chaten és e-mailben, a cég saját dokumentumai alapján. Amire nem tud felelni, azt összefoglalva továbbadja egy kollégának.</p>\n<h3 class=\"t-label svx-k\">Milyen gondot old meg</h3>\n<p>Az érdeklődő akkor keres, amikor neki jó. Aki aznap nem kap választ, másnap máshol próbálkozik. A recepció vagy az ügyintéző közben épp mással foglalkozik.</p>\n<h3 class=\"t-label svx-k\">Mit kapnak</h3>\n<ul class=\"list-sq\">\n<li>A weboldal a gyakori kérdésekre válaszol, a cég saját anyagai alapján.</li>\n<li>Aki időpontot szeretne, ott helyben kérhet.</li>\n<li>Amihez emberi döntés kell, azt a rendszer továbbadja, nem találgat.</li>\n<li>Látszik, mit kérdeznek a legtöbbször. Ebből derül ki, mi hiányzik a weboldalról.</li>\n</ul>\n</div>\n</section>\n\n<section class=\"sub-block svx\" id=\"integration\" aria-labelledby=\"integration-title\">\n<h2 class=\"t-h2 sub-h\" id=\"integration-title\">Integráció</h2>\n<div class=\"sub-c\">\n<p class=\"t-lead\">Egy rendszerré köti össze a meglévő programokat: a levelezést, a naptárat, a foglalást, a számlázót és a fizetést. Az adatot elég egyszer rögzíteni, onnan magától jut el mindenhová, ahol kell.</p>\n<h3 class=\"t-label svx-k\">Milyen gondot old meg</h3>\n<p>A levelezés, a naptár, a táblázatkezelő, a számlázó és a tárhely külön-külön működik. Ugyanazt az adatot több helyre kell beírni kézzel, és egyik programból a másikba ember viszi át.</p>\n<h3 class=\"t-label svx-k\">Mit kapnak</h3>\n<ul class=\"list-sq\">\n<li>Az adat egyszer kerül be, és minden érintett programban megjelenik.</li>\n<li>A meglévő programok maradnak: azokat kötjük össze, amiket a cég már használ, például a számlázót, az ajánlatkészítőt és a Google Workspace-t.</li>\n<li>Minden programhoz csak annyi jogosultságot kap a rendszer, amennyi a munkához kell.</li>\n</ul>\n</div>\n</section>\n\n<section class=\"sub-block svx\" id=\"custom-development\" aria-labelledby=\"custom-development-title\">\n<h2 class=\"t-h2 sub-h\" id=\"custom-development-title\">Egyedi fejlesztés</h2>\n<div class=\"sub-c\">\n<p class=\"t-lead\">Ha a kész programok nem fedik le a cég működését, a saját folyamataira szabott szoftvert, ügyfélportált vagy alkalmazást építünk. Annyit tud, amennyi kell, és a meglévő rendszerekhez kapcsolódik.</p>\n<h3 class=\"t-label svx-k\">Milyen gondot old meg</h3>\n<p>Van olyan folyamat, amit egyik kész program sem fed le, ezért táblázatokban és levelekben megy, kézzel.</p>\n<h3 class=\"t-label svx-k\">Mit kapnak</h3>\n<ul class=\"list-sq\">\n<li>Előre leírjuk, mi van benne és mi nincs, és minek kell teljesülnie, hogy sikeresnek számítson.</li>\n<li>Egy folyamattal kezdünk, és az első működő verziót éles használat mellett finomítjuk.</li>\n<li>Ahol az adat nem hagyhatja el a céget, ott a szoftver a saját szerverükön fut.</li>\n</ul>\n</div>\n</section>\n\n<section class=\"sub-block svx\" id=\"web-development\" aria-labelledby=\"web-development-title\">\n<h2 class=\"t-h2 sub-h\" id=\"web-development-title\">Webfejlesztés</h2>\n<div class=\"sub-c\">\n<p class=\"t-lead\">Weboldalt tervezünk, építünk és üzemeltetünk. Úgy készül, hogy össze lehessen kötni a foglalással, az ügyfélszolgálattal és a cég többi rendszerével.</p>\n<h3 class=\"t-label svx-k\">Milyen gondot old meg</h3>\n<p>Sok weboldal csak névjegy: nem válaszol és nem foglal, amit pedig az érdeklődő beír, azt valakinek kézzel kell továbbvinnie.</p>\n<h3 class=\"t-label svx-k\">Mit kapnak</h3>\n<ul class=\"list-sq\">\n<li>Megtervezett és megépített weboldalt, tárhellyel és üzemeltetéssel.</li>\n<li>Kapcsolatot a naptárral, a foglalással és a levelezéssel, ha erre szükség van.</li>\n<li>Olyan felépítést, amire később AI ügyfélszolgálat is ráköthető.</li>\n</ul>\n</div>\n</section>\n\n<section class=\"sub-block svx\" id=\"optimization\" aria-labelledby=\"optimization-title\">\n<h2 class=\"t-h2 sub-h\" id=\"optimization-title\">Optimalizálás</h2>\n<div class=\"sub-c\">\n<p class=\"t-lead\">Végigkövetjük, hogyan halad egy ügy a cégen belül, és megkeressük a felesleges, ismétlődő lépéseket. Ezeket a meglévő programokban egyszerűsítjük vagy automatizáljuk, új rendszer bevezetése nélkül.</p>\n<h3 class=\"t-label svx-k\">Milyen gondot old meg</h3>\n<p>Az ügyfél adatai e-mailben érkeznek, aztán kézzel kerülnek egy táblázatba, a számlázóba, majd a többi programba. Ugyanaz a munka többször.</p>\n<h3 class=\"t-label svx-k\">Mit kapnak</h3>\n<ul class=\"list-sq\">\n<li>Leírást arról, hol megy el az idő egy folyamatban, és mely lépései feleslegesek.</li>\n<li>Egyszerűsített vagy automatizált lépéseket a már használt programokban.</li>\n<li>A mai állapot számait előre rögzítjük, hogy legyen mihez mérni.</li>\n</ul>\n</div>\n</section>\n\n<section class=\"sub-block svx\" id=\"operations\" aria-labelledby=\"operations-title\">\n<h2 class=\"t-h2 sub-h\" id=\"operations-title\">Üzemeltetés</h2>\n<div class=\"sub-c\">\n<p class=\"t-lead\">A bevezetett rendszereket folyamatosan felügyeljük, frissítjük és mentjük, a hibákat mi javítjuk. A működés így nem egyetlen ember tudásán és jelenlétén múlik.</p>\n<h3 class=\"t-label svx-k\">Milyen gondot old meg</h3>\n<p>Egy magára hagyott rendszer egy idő után csendben rosszabbul kezd működni: a modellek és a programok hónapok alatt változnak.</p>\n<h3 class=\"t-label svx-k\">Mit kapnak</h3>\n<ul class=\"list-sq\">\n<li>Felügyeletet, frissítést és javítást havidíjban.</li>\n<li>Megnevezett felelőst, akit hívni lehet.</li>\n<li>Ide tartoznak az IT-alapok is: hozzáférések, levelezés, fájlok, weboldal.</li>\n</ul>\n</div>\n</section>\n\n<section class=\"sub-block svx\" id=\"consulting\" aria-labelledby=\"consulting-title\">\n<h2 class=\"t-h2 sub-h\" id=\"consulting-title\">Tanácsadás</h2>\n<div class=\"sub-c\">\n<p class=\"t-lead\">Felmérjük, hogyan működik ma a cég, és megmutatjuk, hol megy el az idő és a pénz. A végén azt is leírjuk, mivel érdemes kezdeni, és mivel nem.</p>\n<h3 class=\"t-label svx-k\">Milyen gondot old meg</h3>\n<p>Sok cég próbált már AI-eszközt, és nem lett belőle semmi. Általában nem a technológiával volt baj: az eszközt nem állították rá egy konkrét, napi folyamatra.</p>\n<h3 class=\"t-label svx-k\">Mit kapnak</h3>\n<ul class=\"list-sq\">\n<li>Felvett, végigvezetett beszélgetést a cég működéséről.</li>\n<li>Két dokumentumot: az egyik megmutatja, hol megy el az idő és a pénz, a másik azt a három dolgot, amivel érdemes kezdeni.</li>\n<li>Ha az jön ki, hogy semmin nem lehet mérhetően javítani, azt is leírjuk.</li>\n</ul>\n</div>\n</section>\n</div>\n\n<section class=\"wrap sub-end\" aria-label=\"Felhívás\">\n<div class=\"sub-cta\">\n<a class=\"btn\" href=\"/contact\">Időpontot kérek</a>\n</div>\n</section>\n</main>\n<dc-import name=\"Lablec\" theme=\"{{theme}}\" hint-size=\"100%,560px\"></dc-import>\n</div>", cls: Component };
})();

/* Clunossys weboldal: ami a canvason nincs, de az élő oldalon kell.
   Téma (Automatikus, Világos, Sötét), az űrlap ellenőrzése, érkezés horgonyra, az oldal elindítása. */
(function () {
  'use strict';
  var SSR = !!window.__CNS_SSR;
  var html = document.documentElement;
  var KEY = 'clunossys-theme';
  var roots = [];
  var memMode = null;

  // ---- Téma: a kézi választás a böngészőben marad (localStorage), az Automatikus törli.
  // Automatikus állásban a látogató helyi ideje dönt: 07:00 és 19:00 között világos, egyébként sötét.
  function getMode() {
    if (memMode) { return memMode; }
    try { var v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') { return v; } } catch (e) {}
    return 'auto';
  }
  function setMode(m) {
    memMode = m;
    try { if (m === 'auto') { localStorage.removeItem(KEY); } else { localStorage.setItem(KEY, m); } } catch (e) {}
  }
  function effective(m) {
    if (SSR) { return 'dark'; }
    if (m !== 'auto') { return m; }
    var h = new Date().getHours();
    return h >= 7 && h < 19 ? 'light' : 'dark';
  }
  var theme = effective(getMode());
  function syncSwitches() {
    var i = ['auto', 'light', 'dark'].indexOf(getMode());
    var groups = document.querySelectorAll('.ts[role="radiogroup"]');
    for (var g = 0; g < groups.length; g++) {
      var btns = groups[g].querySelectorAll('[role="radio"]');
      for (var b = 0; b < btns.length; b++) {
        var on = b === i ? 'true' : 'false';
        if (btns[b].getAttribute('aria-checked') !== on) { btns[b].setAttribute('aria-checked', on); }
      }
    }
  }
  function applyTheme() {
    var m = getMode(), t = effective(m);
    html.setAttribute('data-theme', t);
    html.setAttribute('data-theme-mode', m);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { meta.setAttribute('content', t === 'light' ? '#FAFAFA' : '#09090B'); }
    if (t !== theme) {
      theme = t;
      roots.forEach(function (r) { r.setProps({ theme: t }); });
    }
    syncSwitches();
  }
  // minden újrarajzolás után: a témaváltók állása a sablonban rögzített, ezt igazítjuk a valódi álláshoz
  window.__CNS_AFTER = syncSwitches;

  // ---- Indítás: az előre renderelt tartalom helyére a működő komponensek kerülnek
  var app = document.getElementById('app');
  if (app) {
    var props = {};
    try { props = JSON.parse(app.getAttribute('data-props') || '{}'); } catch (e) {}
    props.theme = theme;
    roots.push(window.__CNS_MOUNT(app, app.getAttribute('data-page'), props));
  }
  if (SSR) { return; }
  applyTheme();
  setInterval(applyTheme, 60000);
  window.addEventListener('storage', function () { memMode = null; applyTheme(); });
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.ts [role="radio"]') : null;
    if (!b) { return; }
    var i = Array.prototype.indexOf.call(b.parentNode.querySelectorAll('[role="radio"]'), b);
    setMode(['auto', 'light', 'dark'][i] || 'auto');
    applyTheme();
  });

  // ---- Érkezés horgonyra másik oldalról (pl. /#referenciak): a görgetős szakaszok a betöltés után nyúlnak meg,
  // ezért a horgonyra még egyszer ráállunk, ha a látogató közben nem görgetett.
  var touched = false;
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (t) {
    window.addEventListener(t, function () { touched = true; }, { passive: true });
  });
  function toHash() {
    if (touched || !location.hash || location.hash.length < 2) { return; }
    var el = null;
    try { el = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) {}
    if (el) { el.scrollIntoView(); }
  }
  if (location.hash) {
    toHash();
    setTimeout(toHash, 300);
    setTimeout(toHash, 900);
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { setTimeout(toHash, 60); }); }
  }

  // ---- Űrlap: a kötelező mezők ellenőrzése. A küldés még nincs bekötve: érvényes kitöltés után az űrlap ezt
  // megmondja, és kiírja az elérhetőségeket. (A bekötéskor ez a rész cserélődik a valódi küldésre.)
  var MSG = { nev: 'A név megadása kötelező.', email: 'Érvényes email-cím szükséges.', other: 'Ez a mező kötelező.' };
  function clearErr(input) {
    var id = input.getAttribute('data-err');
    if (!id) { return; }
    var p = document.getElementById(id);
    if (p && p.parentNode) { p.parentNode.removeChild(p); }
    input.removeAttribute('data-err');
    input.removeAttribute('aria-invalid');
    var d = (input.getAttribute('aria-describedby') || '').split(' ').filter(function (x) { return x && x !== id; });
    if (d.length) { input.setAttribute('aria-describedby', d.join(' ')); } else { input.removeAttribute('aria-describedby'); }
  }
  function note(cls, id, nodes) {
    var p = document.createElement('p');
    p.className = cls; p.id = id;
    var ic = document.createElement('span');
    ic.className = 'err-ic'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = '!';
    var tx = document.createElement('span');
    nodes.forEach(function (n) { tx.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
    p.appendChild(ic); p.appendChild(tx);
    return p;
  }
  function showErr(input, text) {
    clearErr(input);
    var id = input.id + '-hiba';
    input.parentNode.insertBefore(note('err', id, [text]), input.nextSibling);
    input.setAttribute('data-err', id);
    input.setAttribute('aria-invalid', 'true');
    var d = input.getAttribute('aria-describedby');
    input.setAttribute('aria-describedby', d ? d + ' ' + id : id);
  }
  function link(href, text) { var a = document.createElement('a'); a.className = 'link'; a.href = href; a.textContent = text; return a; }
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.classList || !form.classList.contains('form')) { return; }
    e.preventDefault();
    var first = null;
    Array.prototype.forEach.call(form.querySelectorAll('[required]'), function (input) {
      var v = (input.value || '').trim();
      var bad = !v || (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
      if (bad) {
        showErr(input, input.name === 'nev' ? MSG.nev : (input.type === 'email' ? MSG.email : MSG.other));
        if (!first) { first = input; }
      } else { clearErr(input); }
    });
    var old = form.querySelector('.form-note');
    if (old) { old.parentNode.removeChild(old); }
    if (first) { first.focus(); return; }
    var n = note('err form-note', form.parentNode.id + '-allapot', ['Az űrlap még nem küld üzenetet. Addig e-mailben és telefonon vagyunk elérhetők: ',
      link('mailto:info@clunossys.hu', 'info@clunossys.hu'), ', ', link('tel:+36300993897', '+36 30 099 3897'), '.']);
    n.setAttribute('role', 'status');
    var foot = form.querySelector('.form-foot');
    foot.parentNode.insertBefore(n, foot.nextSibling);
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-err')) { clearErr(t); }
  });
})();

