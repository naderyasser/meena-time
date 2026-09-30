// Minimal ZKTeco TCP client (port 4370) for «نقل بصمات الموظفين»: read users + fingerprint
// templates from one device and write them to another. node-zklib only reads attendance,
// so the protocol facts below (commands, record layouts, commkey) follow the public pyzk docs.
const net = require('net')

const C = {
  DB_RRQ: 7, USER_WRQ: 8, USERTEMP_RRQ: 9, GET_FREE_SIZES: 50, SAVE_USERTEMPS: 110,
  CONNECT: 1000, EXIT: 1001, ENABLE: 1002, DISABLE: 1003, REFRESH: 1013, AUTH: 1102,
  PREPARE_DATA: 1500, DATA: 1501, FREE_DATA: 1502, RWB: 1503, READ_CHUNK: 1504,
  ACK_OK: 2000, ACK_UNAUTH: 2005,
}
const FCT_FINGERTMP = 2, FCT_USER = 5
const USHRT_MAX = 65535
const TOP1 = 0x5050, TOP2 = 0x7282

function checksum(buf) {
  let sum = 0
  for (let i = 0; i + 1 < buf.length; i += 2) {
    sum += buf.readUInt16LE(i)
    if (sum > USHRT_MAX) sum -= USHRT_MAX
  }
  if (buf.length % 2) sum += buf[buf.length - 1]
  while (sum > USHRT_MAX) sum -= USHRT_MAX
  sum = ~sum
  while (sum < 0) sum += USHRT_MAX
  return sum
}

// The device's «مفتاح الاتصال» (comm key) scrambled with the session id.
function commKey(key, sessionId, ticks = 50) {
  let k = 0
  for (let i = 0; i < 32; i++) k = ((Number(key) >>> i) & 1) ? (k * 2 + 1) : k * 2
  k = (k + sessionId) >>> 0
  const b = Buffer.alloc(4); b.writeUInt32LE(k)
  const x = [b[0] ^ 0x5a, b[1] ^ 0x4b, b[2] ^ 0x53, b[3] ^ 0x4f] // "ZKSO"
  const s = [x[2], x[3], x[0], x[1]] // swap the two 16-bit halves
  const t = ticks & 0xff
  return Buffer.from([s[0] ^ t, s[1] ^ t, t, s[3] ^ t])
}

function packet(command, sessionId, replyId, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(8)
  head.writeUInt16LE(command, 0); head.writeUInt16LE(sessionId, 4); head.writeUInt16LE(replyId, 6)
  head.writeUInt16LE(checksum(Buffer.concat([head, data])), 2)
  const top = Buffer.alloc(8)
  top.writeUInt16LE(TOP1, 0); top.writeUInt16LE(TOP2, 2); top.writeUInt32LE(8 + data.length, 4)
  return Buffer.concat([top, head, data])
}

const cstr = (b) => { const i = b.indexOf(0); return i < 0 ? b : b.subarray(0, i) }
const fixed = (b, n) => { const o = Buffer.alloc(n); Buffer.from(b).copy(o, 0, 0, n); return o }

// Users are kept with their raw name/password bytes so Arabic names survive the copy
// whatever encoding the device uses.
function parseUsers(buf, size) {
  const out = []
  for (let o = 0; o + size <= buf.length; o += size) {
    const r = buf.subarray(o, o + size)
    if (size === 28) out.push({ uid: r.readUInt16LE(0), role: r[2], password: cstr(r.subarray(3, 8)), name: cstr(r.subarray(8, 16)), card: r.readUInt32LE(16), group: String(r[21]), userId: String(r.readUInt32LE(24)) })
    else out.push({ uid: r.readUInt16LE(0), role: r[2], password: cstr(r.subarray(3, 11)), name: cstr(r.subarray(11, 35)), card: r.readUInt32LE(35), group: cstr(r.subarray(40, 47)).toString(), userId: cstr(r.subarray(48, 72)).toString() })
  }
  return out
}

// The record SAVE_USERTEMPS expects: 0x02 + the user record (29 or 73 bytes).
function packUser(u, size) {
  if (size === 28) {
    const b = Buffer.alloc(29); b[0] = 2; b.writeUInt16LE(u.uid, 1); b[3] = u.role
    fixed(u.password, 5).copy(b, 4); fixed(u.name, 8).copy(b, 9); b.writeUInt32LE(u.card >>> 0, 17)
    b[22] = +u.group || 0; b.writeUInt32LE((+u.userId || 0) >>> 0, 25)
    return b
  }
  const b = Buffer.alloc(73); b[0] = 2; b.writeUInt16LE(u.uid, 1); b[3] = u.role
  fixed(u.password, 8).copy(b, 4); fixed(u.name, 24).copy(b, 12); b.writeUInt32LE(u.card >>> 0, 36)
  b[40] = 1; fixed(Buffer.from(String(u.group || '')), 7).copy(b, 41); fixed(Buffer.from(String(u.userId)), 24).copy(b, 49)
  return b
}

function parseTemplates(buf) {
  const out = []
  let total = buf.readInt32LE(0), o = 4
  while (total > 0 && o + 6 <= buf.length) {
    const size = buf.readUInt16LE(o)
    if (size < 6) break
    out.push({ uid: buf.readUInt16LE(o + 2), fid: buf.readInt8(o + 4), valid: buf.readInt8(o + 5), template: Buffer.from(buf.subarray(o + 6, o + size)) })
    o += size; total -= size
  }
  return out
}

class ZK {
  constructor(ip, port = 4370, timeout = 10000) { Object.assign(this, { ip, port, timeout }); this.frames = []; this.waiters = []; this.rx = Buffer.alloc(0) }

  open() {
    return new Promise((resolve, reject) => {
      this.sock = net.createConnection({ host: this.ip, port: this.port })
      this.sock.setTimeout(this.timeout, () => this.sock.destroy(new Error('timeout')))
      this.sock.once('connect', resolve)
      this.sock.once('error', (e) => { reject(e); this.fail(e) })
      this.sock.on('close', () => this.fail(new Error('closed')))
      this.sock.on('data', (d) => this.onData(d))
    })
  }

  onData(d) {
    this.rx = Buffer.concat([this.rx, d])
    while (this.rx.length >= 8) {
      if (this.rx.readUInt16LE(0) !== TOP1 || this.rx.readUInt16LE(2) !== TOP2) { this.fail(new Error('bad packet')); return }
      const len = this.rx.readUInt32LE(4)
      if (this.rx.length < 8 + len) return
      const p = this.rx.subarray(8, 8 + len); this.rx = this.rx.subarray(8 + len)
      const f = { code: p.readUInt16LE(0), session: p.readUInt16LE(4), reply: p.readUInt16LE(6), data: Buffer.from(p.subarray(8)) }
      const w = this.waiters.shift()
      w ? w.resolve(f) : this.frames.push(f)
    }
  }

  fail(e) { this.dead = e; for (const w of this.waiters.splice(0)) w.reject(e) }

  next() {
    if (this.frames.length) return Promise.resolve(this.frames.shift())
    if (this.dead) return Promise.reject(this.dead)
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  async send(command, data) {
    this.replyId = (this.replyId + 1) % USHRT_MAX
    this.sock.write(packet(command, this.session, this.replyId, data))
    const f = await this.next()
    this.replyId = f.reply
    return f
  }

  async ok(command, data, what) {
    const f = await this.send(command, data)
    if (f.code !== C.ACK_OK && f.code !== C.PREPARE_DATA && f.code !== C.DATA) throw new Error(`${what} (${f.code})`)
    return f
  }

  async connect(key = 0) {
    await this.open()
    this.session = 0; this.replyId = USHRT_MAX - 2
    let f = await this.send(C.CONNECT)
    this.session = f.session
    if (f.code === C.ACK_UNAUTH) f = await this.send(C.AUTH, commKey(key || 0, this.session))
    if (f.code === C.ACK_UNAUTH) throw new Error('unauth')
    if (f.code !== C.ACK_OK) throw new Error(`connect (${f.code})`)
  }

  async close() {
    try { await this.send(C.EXIT) } catch {}
    this.sock?.destroy()
  }

  async sizes() {
    const f = await this.ok(C.GET_FREE_SIZES, undefined, 'sizes')
    return { users: f.data.length >= 80 ? f.data.readInt32LE(16) : 0, fingers: f.data.length >= 80 ? f.data.readInt32LE(24) : 0 }
  }

  // Buffered read: either the data comes straight back, or we pull it in chunks.
  async readBuffer(command, fct) {
    const req = Buffer.alloc(11); req[0] = 1; req.writeInt16LE(command, 1); req.writeInt32LE(fct, 3)
    const f = await this.ok(C.RWB, req, 'read')
    if (f.code === C.DATA) return f.data
    const size = f.data.readUInt32LE(1), parts = []
    for (let start = 0; start < size; start += 0xffc0) {
      const r = Buffer.alloc(8); r.writeInt32LE(start, 0); r.writeInt32LE(Math.min(0xffc0, size - start), 4)
      let g = await this.ok(C.READ_CHUNK, r, 'chunk')
      if (g.code === C.DATA) { parts.push(g.data); continue }
      for (;;) { g = await this.next(); if (g.code === C.DATA) parts.push(g.data); else break }
    }
    await this.ok(C.FREE_DATA, undefined, 'free')
    return Buffer.concat(parts)
  }

  async users() {
    const { users } = await this.sizes()
    if (!users) return { size: 72, list: [] }
    const buf = await this.readBuffer(C.USERTEMP_RRQ, FCT_USER)
    const total = buf.readUInt32LE(0)
    const size = total / users === 28 ? 28 : 72
    return { size, list: parseUsers(buf.subarray(4, 4 + total), size) }
  }

  async templates() {
    const { fingers } = await this.sizes()
    return fingers ? parseTemplates(await this.readBuffer(C.DB_RRQ, FCT_FINGERTMP)) : []
  }

  async writeBuffer(buf) {
    await this.ok(C.FREE_DATA, undefined, 'free')
    const n = Buffer.alloc(4); n.writeUInt32LE(buf.length)
    await this.ok(C.PREPARE_DATA, n, 'prepare')
    for (let o = 0; o < buf.length; o += 1024) await this.ok(C.DATA, buf.subarray(o, o + 1024), 'data')
  }

  // One user + all their fingers in one SAVE_USERTEMPS round.
  async saveUser(u, fingers, size) {
    const up = packUser(u, size)
    const table = [], fp = []
    let start = 0
    for (const f of fingers) {
      const t = Buffer.alloc(8); t[0] = 2; t.writeUInt16LE(u.uid, 1); t[3] = 0x10 + f.fid; t.writeUInt32LE(start, 4)
      const body = Buffer.alloc(2 + f.template.length); body.writeUInt16LE(f.template.length, 0); f.template.copy(body, 2)
      table.push(t); fp.push(body); start += body.length
    }
    const tb = Buffer.concat(table), fb = Buffer.concat(fp)
    const head = Buffer.alloc(12); head.writeUInt32LE(up.length, 0); head.writeUInt32LE(tb.length, 4); head.writeUInt32LE(fb.length, 8)
    await this.writeBuffer(Buffer.concat([head, up, tb, fb]))
    const cmd = Buffer.alloc(8); cmd.writeUInt32LE(12, 0); cmd.writeUInt16LE(0, 4); cmd.writeUInt16LE(8, 6)
    await this.ok(C.SAVE_USERTEMPS, cmd, 'save')
  }
}

// Copy the chosen employees (device user ids = employee codes) with every fingerprint from
// one device to another. `sel`: empty = all, an array of codes, or a { from, to } code range.
// A user already on the target keeps
// its uid there and is overwritten; new users get the next free uid.
async function transfer(from, to, sel, onProgress = () => {}) {
  const a = new ZK(from.ip, +from.port || 4370), b = new ZK(to.ip, +to.port || 4370)
  const step = async (label, fn) => { try { return await fn() } catch (e) { throw Object.assign(new Error(label), { cause: e }) } }
  try {
    await step(`تعذّر الاتصال بالجهاز ${from.ip}`, () => a.connect(from.comm_key))
    await step(`تعذّر الاتصال بالجهاز ${to.ip}`, () => b.connect(to.comm_key))
    await a.ok(C.DISABLE, undefined, 'disable'); await b.ok(C.DISABLE, undefined, 'disable')
    const src = await step('تعذّر قراءة المستخدمين من الجهاز المصدر', () => a.users())
    const tpl = await step('تعذّر قراءة البصمات من الجهاز المصدر', () => a.templates())
    const dst = await step('تعذّر قراءة المستخدمين من الجهاز الهدف', () => b.users())
    const want = Array.isArray(sel) && sel.length ? new Set(sel.map(String)) : null
    const inRange = (id) => !sel || Array.isArray(sel) || (/^\d+$/.test(id) && +id >= +sel.from && +id <= +sel.to)
    const users = src.list.filter((u) => (!want || want.has(u.userId)) && inRange(u.userId))
    const existing = new Map(dst.list.map((u) => [u.userId, u.uid]))
    let nextUid = Math.max(0, ...dst.list.map((u) => u.uid)) + 1
    let fingers = 0, done = 0
    for (const u of users) {
      const f = tpl.filter((t) => t.uid === u.uid)
      const uid = existing.get(u.userId) ?? nextUid++
      await step(`تعذّر حفظ الموظف ${u.userId} على الجهاز الهدف`, () => b.saveUser({ ...u, uid }, f, dst.size))
      fingers += f.length; done++
      onProgress(done, users.length)
    }
    await b.ok(C.REFRESH, undefined, 'refresh')
    return { ok: true, users: done, fingers, missing: want ? [...want].filter((c) => !src.list.some((u) => u.userId === c)) : [] }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    for (const z of [a, b]) { try { if (z.sock && !z.dead) await z.ok(C.ENABLE, undefined, 'enable') } catch {} await z.close() }
  }
}

module.exports = { ZK, transfer, checksum, commKey, packet, parseUsers, packUser, parseTemplates, C }
