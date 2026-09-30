// «نقل بصمات الموظفين» protocol test: lib/zk.js against two fake devices (tools/mock-zk.mjs).
// Run: node tools/zk-test.mjs
import { createRequire } from 'module'
import { startMockZK } from './mock-zk.mjs'
const require = createRequire(import.meta.url)
const { transfer } = require('../lib/zk.js')

let pass = 0, fail = 0
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' ' + info : ''}`) }
const tpl = (seed, n) => Buffer.from(Array.from({ length: n }, (_, i) => (seed * 31 + i * 7) & 0xff))
const nameOf = (st, id) => st.users.find((u) => u.userId === id)?.name?.toString()
const fingersOf = (st, id) => { const u = st.users.find((x) => x.userId === id); return u ? st.templates.filter((t) => t.uid === u.uid) : [] }

// Source: 3 employees, Arabic names (UTF-8 bytes), 1–3 fingers each.
const A = await startMockZK({ port: 14370, users: [
  { uid: 1, userId: '1001', name: 'أحمد علي', password: '12', card: 555 },
  { uid: 2, userId: '1002', name: 'سارة', role: 14 },
  { uid: 5, userId: '1003', name: 'محمد' },
], templates: [
  { uid: 1, fid: 0, template: tpl(1, 520) }, { uid: 1, fid: 6, template: tpl(2, 610) },
  { uid: 2, fid: 1, template: tpl(3, 480) },
  { uid: 5, fid: 0, template: tpl(4, 500) }, { uid: 5, fid: 1, template: tpl(5, 505) }, { uid: 5, fid: 9, template: tpl(6, 700) },
] })
// Target: comm key 1234; already has 1002 at uid 7 (old finger) and an unrelated 2000.
const B = await startMockZK({ port: 14371, key: 1234, users: [
  { uid: 7, userId: '1002', name: 'قديم' }, { uid: 3, userId: '2000', name: 'x' },
], templates: [{ uid: 7, fid: 4, template: tpl(9, 300) }, { uid: 3, fid: 0, template: tpl(8, 300) }] })

const devA = { ip: '127.0.0.1', port: 14370 }, devB = { ip: '127.0.0.1', port: 14371, comm_key: '1234' }

let r = await transfer(devA, devB, ['1001', '1002', '9999'])
check('selected transfer ok', r.ok, r.error)
check('2 users copied', r.users === 2, JSON.stringify(r))
check('3 fingers copied', r.fingers === 3)
check('unknown code reported', r.missing?.join() === '9999')
check('new user gets next free uid', B.state.users.find((u) => u.userId === '1001')?.uid === 8)
check('existing user keeps its uid', B.state.users.find((u) => u.userId === '1002')?.uid === 7)
check('Arabic name bytes kept', nameOf(B.state, '1001') === 'أحمد علي', nameOf(B.state, '1001'))
check('name overwritten', nameOf(B.state, '1002') === 'سارة')
check('templates byte-exact', fingersOf(B.state, '1001').length === 2 && fingersOf(B.state, '1001').every((t) => t.template.equals(A.state.templates.find((s) => s.uid === 1 && s.fid === t.fid).template)))
check('old finger replaced', fingersOf(B.state, '1002').map((t) => t.fid).join() === '1')
check('privilege, password, card kept', (() => { const u = B.state.users.find((x) => x.userId === '1001'); return u.password.toString() === '12' && u.card === 555 && B.state.users.find((x) => x.userId === '1002').role === 14 })())
check('unrelated user untouched', fingersOf(B.state, '2000').length === 1 && B.state.users.length === 3)
check('not selected not copied', !B.state.users.some((u) => u.userId === '1003'))
check('checksums valid both ways', A.state.badChecksums === 0 && B.state.badChecksums === 0)
check('devices re-enabled + refreshed', B.state.commands.includes(1013) && B.state.commands.at(-2) === 1002)

r = await transfer(devA, devB, [])
check('transfer all', r.ok && r.users === 3 && r.fingers === 6, JSON.stringify(r))
check('idempotent: no duplicates', B.state.users.length === 4 && B.state.templates.length === 7)

// Big source → chunked reads over 0xffc0 bytes; old ZK6 (28-byte) target.
const big = Array.from({ length: 60 }, (_, i) => ({ uid: i + 1, userId: String(3000 + i), name: `E${i}` }))
const bigT = big.flatMap((u) => [0, 1, 2].map((fid) => ({ uid: u.uid, fid, template: tpl(u.uid + fid, 450) })))
const Cdev = await startMockZK({ port: 14372, users: big, templates: bigT })
const D = await startMockZK({ port: 14373, size: 28, users: [{ uid: 1, userId: '1', name: 'admin' }] })
r = await transfer({ ip: '127.0.0.1', port: 14372 }, { ip: '127.0.0.1', port: 14373 }, [])
check('chunked read (>64 KB) + 28-byte target', r.ok && r.users === 60 && r.fingers === 180, JSON.stringify(r))
check('28-byte target records', D.state.users.length === 61 && D.state.users.find((u) => u.userId === '3059')?.name.toString() === 'E59')
check('28-byte target templates exact', D.state.templates.length === 180 && D.state.templates.every((t) => t.template.equals(bigT.find((s) => s.uid === +D.state.users.find((u) => u.uid === t.uid).userId - 2999 && s.fid === t.fid).template)))

r = await transfer(devA, { ip: '127.0.0.1', port: 14371, comm_key: '1' }, [])
check('wrong comm key → clear error', !r.ok && /14371|127\.0\.0\.1/.test(r.error), r.error)
r = await transfer(devA, { ip: '127.0.0.1', port: 14399 }, [])
check('unreachable target → clear error', !r.ok && r.error.includes('تعذّر الاتصال'), r.error)

const E = await startMockZK({ port: 14374 })
r = await transfer(devA, { ip: '127.0.0.1', port: 14374 }, { from: 1002, to: 1003 })
check('code range selection', r.ok && r.users === 2 && E.state.users.map((u) => u.userId).sort().join() === '1002,1003', JSON.stringify(r))
for (const m of [A, B, Cdev, D, E]) m.server.close()
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
