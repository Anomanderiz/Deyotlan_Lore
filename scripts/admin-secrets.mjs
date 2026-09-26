#!/usr/bin/env node
/**
 * Generate the admin secrets for Vercel env vars.
 *
 *   node scripts/admin-secrets.mjs "your long random password"
 *   node scripts/admin-secrets.mjs --secret-only
 *
 * Prints ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET. The plaintext password is
 * never written anywhere -- only the scrypt hash goes into the env var, because
 * Vercel env vars are viewable in the dashboard and can leak into build logs.
 */
import crypto from "node:crypto"
import { hashPassword } from "../api/_lib/auth.js"

const args = process.argv.slice(2)
const secretOnly = args.includes("--secret-only")
const password = args.find((a) => !a.startsWith("--"))

const sessionSecret = crypto.randomBytes(32).toString("base64url")

if (secretOnly) {
  console.log(`ADMIN_SESSION_SECRET=${sessionSecret}`)
  process.exit(0)
}

if (!password) {
  console.error('Usage: node scripts/admin-secrets.mjs "your long random password"')
  console.error("       node scripts/admin-secrets.mjs --secret-only")
  console.error("")
  console.error("Tip: generate a password with")
  console.error(
    "       node -e \"console.log(require('crypto').randomBytes(18).toString('base64url'))\"",
  )
  process.exit(1)
}

if (password.length < 12) {
  console.error(`Refusing: password is ${password.length} characters.`)
  console.error("The scrypt cost is the only brute-force throttle, so length is the real defence.")
  console.error("Use at least 12 characters, ideally a 24-char random string.")
  process.exit(1)
}

const started = Date.now()
const hash = hashPassword(password)
const elapsed = Date.now() - started

console.log("")
console.log("Set these in Vercel -> Project -> Settings -> Environment Variables")
console.log("(all environments), and in .env.local for local development:")
console.log("")
console.log(`ADMIN_PASSWORD_HASH=${hash}`)
console.log(`ADMIN_SESSION_SECRET=${sessionSecret}`)
console.log("")
console.log(`scrypt took ${elapsed}ms on this machine -- that cost is the login throttle.`)
console.log("Rotating ADMIN_SESSION_SECRET signs every existing session out.")
console.log("")
