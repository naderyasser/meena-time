// Fake ZKTeco device (TCP 4370 protocol) for zk-test.mjs: keeps users + fingerprint
// templates in memory, answers the commands lib/zk.js sends, and checks every checksum.
import net from 'net'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { C, checksum, commKey, packet, parseUsers } = require('../lib/zk.js')

export function startMockZK({ port, size = 72, key = 0, users = [], templates = [], chunkedFrom = 1000 }) {
  const state = { size, users, templates, badChecksums: 0, commands: [] }
  const server = net.createServer((sock) => {
    let rx = Buffer.alloc(0), session = 0x2a2a, authed = !key, pending = null, upload = null
    const reply = (code, replyId, data) => sock.write(packet(code, session, replyId, data))
    sock.on('data', (d) => {
      rx = Buffer.concat([rx, d])
      while (rx.length >= 8 && rx.length >= 8 + rx.readUInt32LE(4)) {
        const len = rx.readUInt32LE(4), p = Buffer.from(rx.subarray(8, 8 + len)); rx = rx.subarray(8 + len)
        const sum = p.readUInt16LE(2); p.writeUInt16LE(0, 2)
        if (checksum(p) !== sum) state.badChecksums++
        const cmd = p.readUInt16LE(0), rid = p.readUInt16LE(6), data = p.subarray(8)
        state.commands.push(cmd)
        if (cmd === C.CONNECT) { reply(authed ? C.ACK_OK : C.ACK_UNAUTH, rid); continue }
        if (cmd === C.AUTH) { authed = commKey(key, session).equals(data); reply(authed ? C.ACK_OK : C.ACK_UNAUTH, rid); continue }
        if (!authed) { reply(C.ACK_UNAUTH, rid); continue }
        if (cmd === C.GET_FREE_SIZES) {
          const b = Buffer.alloc(92); b.writeInt32LE(state.users.length, 16); b.writeInt32LE(state.templates.length, 24)
          reply(C.ACK_OK, rid, b)
        } else if (cmd === C.RWB) {
          const what = data.readInt16LE(1), fct = data.readInt32LE(3)
          const body = what === C.USERTEMP_RRQ && fct === 5 ? usersBuf(state) : templatesBuf(state)
          if (body.length < chunkedFrom) { reply(C.DATA, rid, body); continue }
          pending = body
          const b = Buffer.alloc(5); b.writeUInt32LE(body.length, 1); reply(C.ACK_OK, rid, b)
        } else if (cmd === C.READ_CHUNK) {
          const start = data.readInt32LE(0), n = data.readInt32LE(4), part = pending.subarray(start, start + n)
          const sz = Buffer.alloc(4); sz.writeUInt32LE(part.length); reply(C.PREPARE_DATA, rid, sz)
          const half = part.length >> 1 // two DATA frames, like devices that split big chunks
          reply(C.DATA, rid, part.subarray(0, half)); reply(C.DATA, rid, part.subarray(half)); reply(C.ACK_OK, rid)
        } else if (cmd === C.PREPARE_DATA) { upload = []; reply(C.ACK_OK, rid) }
        else if (cmd === C.DATA) { upload.push(Buffer.from(data)); reply(C.ACK_OK, rid) }
        else if (cmd === C.SAVE_USERTEMPS) { save(state, Buffer.concat(upload)); upload = null; reply(C.ACK_OK, rid) }
        else reply(C.ACK_OK, rid) // FREE_DATA, DISABLE, ENABLE, REFRESH, EXIT
      }
    })
    sock.on('error', () => {})
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, state })))
}

export function userRecord(u, size) {
  const r = Buffer.alloc(size)
  r.writeUInt16LE(u.uid, 0); r[2] = u.role || 0
  if (size === 28) { Buffer.from(u.name).copy(r, 8, 0, 8); r.writeUInt32LE(+u.userId, 24) }
  else { Buffer.from(u.password || '').copy(r, 3, 0, 8); Buffer.from(u.name).copy(r, 11, 0, 24); r.writeUInt32LE(u.card || 0, 35); Buffer.from(String(u.userId)).copy(r, 48) }
  return r
}

function usersBuf(s) {
  const recs = Buffer.concat(s.users.map((u) => userRecord(u, s.size)))
  const n = Buffer.alloc(4); n.writeUInt32LE(recs.length)
  return Buffer.concat([n, recs])
}

function templatesBuf(s) {
  const recs = Buffer.concat(s.templates.map((t) => {
    const h = Buffer.alloc(6); h.writeUInt16LE(t.template.length + 6, 0); h.writeUInt16LE(t.uid, 2); h.writeInt8(t.fid, 4); h.writeInt8(t.valid ?? 1, 5)
    return Buffer.concat([h, t.template])
  }))
  const n = Buffer.alloc(4); n.writeInt32LE(recs.length)
  return Buffer.concat([n, recs])
}

// SAVE_USERTEMPS buffer: [ulen, tlen, flen] + 0x02·user + table(8 B each) + (len u16 + template)*.
function save(s, buf) {
  const ulen = buf.readUInt32LE(0), tlen = buf.readUInt32LE(4)
  const rec = buf.subarray(13, 12 + ulen) // skip the 0x02 marker
  const raw = Buffer.alloc(s.size)
  if (s.size === 28) { rec.copy(raw, 0, 0, 16); raw.writeUInt32LE(rec.readUInt32LE(16), 16); raw[21] = rec[21]; raw.writeUInt32LE(rec.readUInt32LE(24), 24) }
  else { rec.copy(raw, 0, 0, 39); rec.copy(raw, 40, 40, 72) }
  const u = parseUsers(raw, s.size)[0]
  s.users = s.users.filter((x) => x.uid !== u.uid).concat({ ...u, name: u.name })
  s.templates = s.templates.filter((t) => t.uid !== u.uid)
  const fstart = 12 + ulen + tlen
  for (let o = 12 + ulen; o < 12 + ulen + tlen; o += 8) {
    const fid = buf[o + 3] - 0x10, at = fstart + buf.readUInt32LE(o + 4), n = buf.readUInt16LE(at)
    s.templates.push({ uid: u.uid, fid, valid: 1, template: Buffer.from(buf.subarray(at + 2, at + 2 + n)) })
  }
}
