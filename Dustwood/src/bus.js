// Event bus with a synchronous emit and a fixed ring buffer of recent events.
// See Plan.txt §1.8.

function summarize(payload) {
  // Keep the ring lightweight: copy scalars, drop heavy object refs but keep ids.
  if (payload === null || typeof payload !== 'object') return {};
  const out = {};
  for (const k in payload) {
    const v = payload[k];
    if (v === null || typeof v !== 'object') out[k] = v;
    else if (typeof v.id === 'number') out[k + 'Id'] = v.id;
    else if (typeof v.x === 'number' && typeof v.z === 'number') out[k] = [v.x, v.y ?? 0, v.z];
    // otherwise omit (keeps events JSON-able and small)
  }
  return out;
}

export class Bus {
  constructor() {
    this.map = new Map();
    this.ring = [];
    this.ringHead = 0;
    this.ringCap = 512;
    this.time = 0;
    this._seq = 0;
  }

  on(name, fn) {
    let arr = this.map.get(name);
    if (!arr) { arr = []; this.map.set(name, arr); }
    arr.push(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const arr = this.map.get(name);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => { off(); fn(payload); });
    return off;
  }

  clear() {
    this.map.clear();
  }

  emit(name, payload = {}) {
    // record into ring first (synchronous, ordered)
    const rec = { i: this._seq++, t: this.time, type: name, data: summarize(payload) };
    if (this.ring.length < this.ringCap) {
      this.ring.push(rec);
    } else {
      this.ring[this.ringHead] = rec;
      this.ringHead = (this.ringHead + 1) % this.ringCap;
    }
    const arr = this.map.get(name);
    if (arr) {
      // iterate a copy so handlers may unsubscribe during emit
      const list = arr.slice();
      for (let i = 0; i < list.length; i++) list[i](payload);
    }
  }

  // Return events with index >= since, in chronological order.
  since(since) {
    const out = [];
    for (let i = 0; i < this.ring.length; i++) {
      const r = this.ring[i];
      if (r && r.i >= since) out.push(r);
    }
    out.sort((a, b) => a.i - b.i);
    return out;
  }

  nextIndex() { return this._seq; }
}
