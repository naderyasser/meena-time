// Machine-bound activation, same flow as Apex Time's «تسجيل المنتج»:
// the app shows a request code derived from this machine; the vendor signs it
// with the private key (tools/keygen.js); the app verifies the licence code
// with the embedded public key. Runs in Node (Electron main / preview server).

const crypto = require('crypto')
const os = require('os')
const fs = require('fs')
const path = require('path')

const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, 'public.pem'), 'utf8')

function machineFingerprint() {
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
    .map((i) => i.mac)
    .sort()
  return [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model || '', macs[0] || ''].join('|')
}

// «كود الطلب»: 20 hex chars grouped in 4s, e.g. 1A2B-3C4D-5E6F-7A8B-9C0D
function requestCode() {
  const h = crypto.createHash('sha256').update(machineFingerprint()).digest('hex').slice(0, 20).toUpperCase()
  return h.match(/.{4}/g).join('-')
}

// «كود الترخيص» = base64url(signature over "<requestCode>|<edition>") + "." + edition
function verifyLicence(code, reqCode = requestCode()) {
  try {
    const [sig, edition] = String(code || '').trim().split('.')
    if (!sig || !edition) return { ok: false }
    const ok = crypto.verify(null, Buffer.from(`${reqCode}|${edition}`), PUBLIC_KEY, Buffer.from(sig, 'base64url'))
    return ok ? { ok: true, edition } : { ok: false }
  } catch {
    return { ok: false }
  }
}

module.exports = { requestCode, verifyLicence }
