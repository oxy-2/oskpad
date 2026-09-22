'use strict';

const M = 0x4D, B = 0x42, W = 0x57, S = 0x53, Q = 0x51;
const BTN = { LEFT: 1, RIGHT: 2, MIDDLE: 4 };

const els = {
  connect: document.getElementById('btnConnect'),
  connect2: document.getElementById('btnConnect2'),
  dotUsb: document.getElementById('dotUsb'),
  dotBle: document.getElementById('dotBle'),
  txtBle: document.getElementById('txtBle'),
  pkts: document.getElementById('statPkts'),
  gain: document.getElementById('gain'),
  overlay: document.getElementById('overlay'),
  note: document.getElementById('probeNote'),
  help: document.getElementById('help'),
  btnHelp: document.getElementById('btnHelp'),
  btnClose: document.getElementById('btnCloseHelp'),
  btnTheme: document.getElementById('btnTheme'),
  btnFull: document.getElementById('btnFull'),
  blewarn: document.getElementById('blewarn'),
  fx: document.getElementById('fx')
};

const settings = {
  gain: parseFloat(localStorage.getItem('osk.gain') || '1.7')
};
els.gain.value = settings.gain;

class PadLink {
  constructor() {
    this.port = null;
    this.writer = null;
    this.alive = false;
    this.verified = false;
    this.bleOn = false;
    this.pkts = 0;
    this.rx = new Uint8Array(1024);
    this.rxLen = 0;
  }
  async connect() {
    this.port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: 0x239A, usbProductId: 0x80B4 }]
    });
    await this.port.open({ baudRate: 115200 });
    this.writer = this.port.writable.getWriter();
    this.alive = true;
    els.dotUsb.classList.add('on');
    this.readLoop();
    this.query();
    setTimeout(() => {
      if (this.alive && !this.verified) {
        els.note.textContent = 'No response from pad. Tap Connect again and pick the OTHER serial entry.';
      }
    }, 1200);
  }
  drop(msg) {
    this.alive = false;
    try { if (this.writer) this.writer.releaseLock(); } catch (e) {}
    try { if (this.port) this.port.close(); } catch (e) {}
    this.port = null;
    this.writer = null;
    this.verified = false;
    this.bleOn = false;
    els.dotUsb.classList.remove('on');
    els.dotBle.classList.remove('on');
    els.txtBle.textContent = 'BLE';
    els.blewarn.hidden = true;
    if (msg) els.note.textContent = msg;
  }
  async readLoop() {
    while (this.alive && this.port && this.port.readable) {
      const reader = this.port.readable.getReader();
      try {
        while (this.alive) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) this.ingest(value);
        }
      } catch (e) { break; }
      finally { try { reader.releaseLock(); } catch (e) {} }
    }
  }
  ingest(bytes) {
    if (this.rxLen + bytes.length > this.rx.length) this.rxLen = 0;
    this.rx.set(bytes, this.rxLen);
    this.rxLen += bytes.length;
    let i = 0;
    while (i + 2 < this.rxLen) {
      if (this.rx[i] === 0x71) {
        this.verified = true;
        this.bleOn = this.rx[i + 1] === 1;
        this.pkts = this.rx[i + 2];
        els.overlay.hidden = true;
        els.note.textContent = '';
        els.dotBle.classList.toggle('on', this.bleOn);
        els.txtBle.textContent = this.bleOn ? 'BLE linked' : 'BLE idle';
        els.pkts.textContent = this.pkts + ' pkts';
        els.blewarn.hidden = this.bleOn;
        i += 3;
      } else {
        i++;
      }
    }
    if (i) {
      this.rx.copyWithin(0, i, this.rxLen);
      this.rxLen -= i;
    }
  }
  raw(cmd, payload) {
    if (!this.writer) return;
    const buf = new Uint8Array(1 + (payload ? payload.length : 0));
    buf[0] = cmd;
    if (payload) buf.set(payload, 1);
    this.writer.write(buf).catch(() => {});
  }
  move(dx, dy) {
    const p = new Uint8Array(4);
    const v = new DataView(p.buffer);
    v.setInt16(0, clamp(Math.round(dx)), true);
    v.setInt16(2, clamp(Math.round(dy)), true);
    this.raw(M, p);
  }
  buttons(mask) { this.raw(B, new Uint8Array([mask & 7])); }
  wheel(n) { this.raw(W, new Uint8Array([clamp(Math.round(n), -127, 127)])); }
  shift(on) { this.raw(S, new Uint8Array([on ? 1 : 0])); }
  query() { this.raw(Q); }
}
function clamp(v, lo = -32767, hi = 32767) { return Math.max(lo, Math.min(hi, v)); }

const link = new PadLink();
navigator.serial.addEventListener('disconnect', e => {
  if (e.target === link.port) link.drop('Pad unplugged. Replug and reconnect.');
});

const touches = new Map();
const gestureIds = new Set();
let mode = 'idle';
let locked = false;
let twoStart = null;
let pinchAcc = 0;
let orbitLast = null;
let middleHeld = false;
let shiftHeld = false;
let leftHeld = false;
let holdTimer = 0;
let gestureMoved = false;

function centroid() {
  let x = 0, y = 0;
  for (const t of touches.values()) { x += t.x; y += t.y; }
  return { x: x / touches.size, y: y / touches.size };
}
function spread() {
  const pts = [...touches.values()];
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}
function setButtons() {
  link.buttons((leftHeld ? BTN.LEFT : 0) | (middleHeld ? BTN.MIDDLE : 0));
}
function holdMiddle(on) { if (on !== middleHeld) { middleHeld = on; setButtons(); } }
function holdLeft(on) { if (on !== leftHeld) { leftHeld = on; setButtons(); } }
function holdShift(on) { if (on !== shiftHeld) { shiftHeld = on; link.shift(on); } }
function releaseAll() {
  holdLeft(false);
  holdMiddle(false);
  holdShift(false);
  setButtons();
}
function tap(mask) {
  link.buttons(mask);
  setTimeout(() => link.buttons(0), 55);
}
function enterOrbit() {
  if (shiftHeld) holdShift(false);
  mode = 'orbit';
  locked = true;
  holdMiddle(true);
  orbitLast = null;
}

function onTouchStart(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    touches.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY });
    gestureIds.add(t.identifier);
  }
  if (mode === 'idle') {
    mode = 'pending';
    locked = false;
    pinchAcc = 0;
    twoStart = null;
    holdTimer = performance.now();
    gestureMoved = false;
  }
  const n = touches.size;
  if (n >= 3) enterOrbit();
  else if (n === 2 && (mode === 'pending' || mode === 'move')) { mode = 'two'; twoStart = null; }
  fx.dirty = true;
}

function onTouchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const rec = touches.get(t.identifier);
    if (!rec) continue;
    if (Math.hypot(t.clientX - rec.sx, t.clientY - rec.sy) > 14) gestureMoved = true;
    rec.x = t.clientX;
    rec.y = t.clientY;
  }
  const n = touches.size;
  if (!n) return;
  const now = performance.now();

  if (mode === 'pending') {
    if (n === 1) mode = 'move';
    else if (n === 2) { mode = 'two'; twoStart = null; }
    else enterOrbit();
  }

  if (mode === 'move' && n >= 1) {
    if (!locked && !gestureMoved && now - holdTimer > 320) {
      locked = true;
      holdLeft(true);
    }
    for (const t of e.changedTouches) {
      const rec = touches.get(t.identifier);
      if (!rec) continue;
      link.move((t.clientX - rec.x) * settings.gain, (t.clientY - rec.y) * settings.gain);
    }
  } else if (mode === 'two' && n === 2) {
    const c = centroid();
    if (!twoStart) twoStart = { c: c, d: spread(), lastD: spread() };
    if (!locked) {
      const dc = Math.hypot(c.x - twoStart.c.x, c.y - twoStart.c.y);
      const dd = Math.abs(spread() - twoStart.d);
      if (dc + dd > 18) {
        locked = true;
        if (dc > dd * 1.1) {
          mode = 'pan';
          holdShift(true);
          holdMiddle(true);
        } else {
          mode = 'pinch';
        }
        twoStart.c = c;
      }
    } else if (mode === 'pan') {
      link.move((c.x - twoStart.c.x) * settings.gain, (c.y - twoStart.c.y) * settings.gain);
      twoStart.c = c;
    } else if (mode === 'pinch') {
      const d = spread();
      pinchAcc += d - twoStart.lastD;
      twoStart.lastD = d;
      const step = 42;
      while (Math.abs(pinchAcc) >= step) {
        link.wheel(pinchAcc > 0 ? 2 : -2);
        pinchAcc += pinchAcc > 0 ? -step : step;
      }
    }
  } else if (mode === 'orbit' && n >= 3) {
    const c = centroid();
    if (orbitLast) link.move((c.x - orbitLast.x) * settings.gain, (c.y - orbitLast.y) * settings.gain);
    orbitLast = c;
  }
  fx.dirty = true;
}

function onTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const rec = touches.get(t.identifier);
    if (rec) fx.ghosts.push({ x: rec.x, y: rec.y, t: performance.now() });
    touches.delete(t.identifier);
  }
  const n = touches.size;

  if (mode === 'orbit') {
    if (n === 0) { releaseAll(); mode = 'idle'; endGesture(); }
    else if (n < 3) {
      holdMiddle(false);
      if (n === 1) { mode = 'move'; locked = true; }
      else { releaseAll(); mode = 'idle'; endGesture(); }
      orbitLast = null;
    }
  } else if (mode === 'pan' || mode === 'pinch') {
    if (n === 0) { releaseAll(); mode = 'idle'; endGesture(); }
    else if (n === 1) { releaseAll(); mode = 'move'; }
  } else if (mode === 'move' || mode === 'two' || mode === 'pending') {
    if (n === 0) {
      const dt = performance.now() - holdTimer;
      if (!locked && !gestureMoved && dt < 300 && gestureIds.size > 0) {
        tap(gestureIds.size === 1 ? BTN.LEFT : gestureIds.size === 2 ? BTN.RIGHT : BTN.MIDDLE);
      }
      releaseAll();
      mode = 'idle';
      endGesture();
    } else if (n === 2 && mode === 'move') {
      mode = 'two';
      twoStart = null;
    }
  }
  fx.dirty = true;
}
function anyFarMove() {
  for (const id of gestureIds) {
    const rec = touches.get(id);
    if (rec && Math.hypot(rec.x - rec.sx, rec.y - rec.sy) > 14) return true;
  }
  return false;
}
function endGesture() { gestureIds.clear(); }

document.body.addEventListener('touchstart', onTouchStart, { passive: false });
document.body.addEventListener('touchmove', onTouchMove, { passive: false });
document.body.addEventListener('touchend', onTouchEnd, { passive: false });
document.body.addEventListener('touchcancel', onTouchEnd, { passive: false });
document.addEventListener('contextmenu', e => e.preventDefault());

const theme = {
  light: localStorage.getItem('osk.theme') === 'light',
  bg() { return this.light ? '#ffffff' : '#000000'; },
  cross() { return this.light ? '#808080' : '#ffffff'; },
  touch() { return this.light ? 'rgba(40,40,40,' : 'rgba(255,255,255,'; },
  label() { return this.light ? 'rgba(90,90,90,.8)' : 'rgba(160,160,160,.8)'; },
  apply() {
    document.documentElement.classList.toggle('light', this.light);
    localStorage.setItem('osk.theme', this.light ? 'light' : 'dark');
    fx.buildGrid();
  },
  toggle() { this.light = !this.light; this.apply(); }
};

const fx = {
  canvas: els.fx,
  ctx: els.fx.getContext('2d'),
  grid: null,
  dirty: true,
  ghosts: [],
  spacing: 36,
  arm: 4,
  resize() {
    this.canvas.width = innerWidth * devicePixelRatio;
    this.canvas.height = innerHeight * devicePixelRatio;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.buildGrid();
  },
  buildGrid() {
    const s = this.spacing, a = this.arm;
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const c = off.getContext('2d');
    c.scale(devicePixelRatio, devicePixelRatio);
    c.fillStyle = theme.bg();
    c.fillRect(0, 0, innerWidth, innerHeight);
    c.strokeStyle = theme.cross();
    c.lineWidth = 1;
    c.beginPath();
    for (let y = s; y < innerHeight; y += s) {
      for (let x = s; x < innerWidth; x += s) {
        c.moveTo(x - a + .5, y + .5);
        c.lineTo(x + a + .5, y + .5);
        c.moveTo(x + .5, y - a + .5);
        c.lineTo(x + .5, y + a + .5);
      }
    }
    c.stroke();
    this.grid = off;
    this.dirty = true;
  },
  draw() {
    if (!this.dirty && !this.ghosts.length && !touches.size) { requestAnimationFrame(() => this.draw()); return; }
    this.dirty = false;
    const c = this.ctx;
    if (this.grid) c.drawImage(this.grid, 0, 0, innerWidth, innerHeight);
    for (const t of touches.values()) {
      c.beginPath();
      c.arc(t.x, t.y, 12, 0, Math.PI * 2);
      c.strokeStyle = theme.touch() + '.9)';
      c.lineWidth = 2;
      c.stroke();
      c.beginPath();
      c.arc(t.x, t.y, 3.5, 0, Math.PI * 2);
      c.fillStyle = theme.touch() + '.9)';
      c.fill();
    }
    const now = performance.now();
    this.ghosts = this.ghosts.filter(g => now - g.t < 350);
    for (const g of this.ghosts) {
      const a = 1 - (now - g.t) / 350;
      c.beginPath();
      c.arc(g.x, g.y, 12 * a, 0, Math.PI * 2);
      c.strokeStyle = theme.touch() + (0.35 * a).toFixed(3) + ')';
      c.lineWidth = 2;
      c.stroke();
    }
    c.font = '12px system-ui';
    c.fillStyle = theme.label();
    c.fillText(mode.toUpperCase(), 14, innerHeight - 14);
    requestAnimationFrame(() => this.draw());
  }
};
addEventListener('resize', () => fx.resize());
fx.resize();
theme.apply();
requestAnimationFrame(() => fx.draw());

async function doConnect() {
  try {
    await link.connect();
  } catch (e) {
    if (e.name === 'NotFoundError') return;
    els.note.textContent = String(e.message || e);
  }
}
els.connect.addEventListener('click', doConnect);
els.connect2.addEventListener('click', doConnect);
els.btnSkip = document.getElementById('btnSkip');
els.btnSkip.addEventListener('click', () => { els.overlay.hidden = true; });
els.btnTheme.addEventListener('click', () => theme.toggle());
els.btnFull.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});
els.btnHelp.addEventListener('click', () => { els.help.hidden = !els.help.hidden; });
els.btnClose.addEventListener('click', () => { els.help.hidden = true; });
els.gain.addEventListener('input', () => {
  settings.gain = parseFloat(els.gain.value);
  localStorage.setItem('osk.gain', String(settings.gain));
});
