// Vendor-side licence generator — NEVER ship this file or keys/private.pem.
// Usage: node tools/keygen.js <request-code> [edition=Gold]
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const [reqCode, edition = 'Gold'] = process.argv.slice(2)
if (!reqCode) {
  console.error('usage: node tools/keygen.js <request-code> [edition]')
  process.exit(1)
}
const key = fs.readFileSync(path.join(__dirname, 'keys', 'private.pem'), 'utf8')
const sig = crypto.sign(null, Buffer.from(`${reqCode.trim().toUpperCase()}|${edition}`), key).toString('base64url')
console.log(`${sig}.${edition}`)
