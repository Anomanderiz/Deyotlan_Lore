/**
 * Authentication for the Deyotlan admin.
 *
 * Single shared password -> scrypt hash in an env var -> HMAC-signed stateless
 * session cookie. No database, no session store, no npm dependencies.
 *
 * Threat model: a single-author D&D campaign wiki. The password gates writes to a
 * public site. It is not protecting anything confidential -- the content it guards is
 * already world-readable at /static/contentIndex.json.
 */
import crypto from "node:crypto"
import { HttpError, parseCookies, isSecureRequest, clientIp } from "./http.js"

export const COOKIE_NAME = "deyotlan_admin"

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const SCRYPT_MAXMEM = 64 * 1024 * 1024

// --- encoding ---------------------------------------------------------------

const b64url = (buf) => Buffer.from(buf).toString("base64url")
const unb64url = (str) => Buffer.from(str, "base64url")

/** Constant-time compare that tolerates length mismatch without throwing. */
function safeEqual(a, b) {
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(String(a))
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(String(b))
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the failure is not measurably faster.
    crypto.timingSafeEqual(bufA, bufA)
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

// --- dev bypass -------------------------------------------------------------

/**
 * Local development with no password configured is treated as always-authenticated.
 *
 * Hard-guarded on `!process.env.VERCEL` so it can never fire in production: on Vercel
 * that variable is always set, so a missing ADMIN_PASSWORD_HASH there fails closed.
 */
export function isDevBypass() {
  return !process.env.VERCEL && !process.env.ADMIN_PASSWORD_HASH
}

let warnedDevBypass = false
function warnDevBypass() {
  if (warnedDevBypass) return
  warnedDevBypass = true
  console.warn(
    "\n  [admin] DEV BYPASS ACTIVE - every request is treated as authenticated.\n" +
      "  [admin] Set ADMIN_PASSWORD_HASH in .env.local to exercise the real login.\n",
  )
}

// --- password ---------------------------------------------------------------

/** Produce a `scrypt$N$r$p$salt$hash` string. Used by scripts/admin-secrets.mjs. */
export function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password.normalize("NFKC"), salt, 32, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  })
  return `scrypt$${N}$${r}$${p}$${b64url(salt)}$${b64url(hash)}`
}

/**
 * Verify a candidate password against ADMIN_PASSWORD_HASH.
 *
 * The ~100ms scrypt cost is deliberately the brute-force throttle: serverless is
 * stateless, so a real rate limiter would need external storage. See the throttle
 * helpers below for the warm-instance supplement.
 */
export function verifyPassword(candidate) {
  const stored = process.env.ADMIN_PASSWORD_HASH
  if (!stored) return false
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    console.error("[admin] ADMIN_PASSWORD_HASH is malformed; expected scrypt$N$r$p$salt$hash")
    return false
  }
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  const salt = unb64url(saltB64)
  const expected = unb64url(hashB64)
  try {
    const derived = crypto.scryptSync(String(candidate).normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    })
    return safeEqual(derived, expected)
  } catch (err) {
    console.error("[admin] scrypt failure:", err.message)
    return false
  }
}

// --- login throttle ---------------------------------------------------------

/**
 * Per-instance failure counter. A warm Vercel instance keeps this between requests;
 * a cold start resets it. That makes it useless against a distributed attacker and
 * mildly annoying to a casual script -- which, combined with the scrypt cost and a
 * long random password, is proportionate here. An accepted limitation, not an oversight.
 */
const failures = new Map()
const THROTTLE_MAX = 10
const THROTTLE_WINDOW_MS = 5 * 60 * 1000

export function throttleCheck(req) {
  const ip = clientIp(req)
  const entry = failures.get(ip)
  if (!entry) return
  if (Date.now() > entry.until) {
    failures.delete(ip)
    return
  }
  if (entry.count >= THROTTLE_MAX) {
    const retryAfter = Math.ceil((entry.until - Date.now()) / 1000)
    throw new HttpError(429, "too_many_attempts", "Too many failed attempts. Try again later.", {
      retryAfter,
    })
  }
}

export function throttleRecordFailure(req) {
  const ip = clientIp(req)
  const now = Date.now()
  const entry = failures.get(ip)
  if (!entry || now > entry.until) {
    failures.set(ip, { count: 1, until: now + THROTTLE_WINDOW_MS })
  } else {
    entry.count += 1
  }
  // Bound memory on a long-lived warm instance.
  if (failures.size > 1000) {
    for (const [key, value] of failures) {
      if (now > value.until) failures.delete(key)
    }
  }
}

export function throttleReset(req) {
  failures.delete(clientIp(req))
}

// --- session cookie ---------------------------------------------------------

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) {
    if (isDevBypass()) return "dev-insecure-secret"
    throw new HttpError(500, "misconfigured", "ADMIN_SESSION_SECRET is not set.")
  }
  return secret
}

export function signSession({ ttlSeconds = SESSION_TTL_SECONDS } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(JSON.stringify({ v: 1, sub: "admin", iat: now, exp: now + ttlSeconds }))
  const sig = b64url(crypto.createHmac("sha256", sessionSecret()).update(payload).digest())
  return `${payload}.${sig}`
}

export function verifySessionToken(token) {
  if (typeof token !== "string") return null
  const dot = token.indexOf(".")
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)

  const expected = b64url(crypto.createHmac("sha256", sessionSecret()).update(payload).digest())
  if (!safeEqual(sig, expected)) return null

  let claims
  try {
    claims = JSON.parse(unb64url(payload).toString("utf8"))
  } catch {
    return null
  }
  if (claims?.v !== 1 || claims.sub !== "admin") return null
  if (typeof claims.exp !== "number" || Math.floor(Date.now() / 1000) >= claims.exp) return null
  return claims
}

function cookieAttributes(req, maxAge) {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`]
  // Local dev over plain http://localhost must not set Secure or the cookie is dropped.
  if (isSecureRequest(req)) attrs.push("Secure")
  return attrs.join("; ")
}

export function sessionCookieHeader(req, token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(req, SESSION_TTL_SECONDS)}`
}

export function clearCookieHeader(req) {
  return `${COOKIE_NAME}=; ${cookieAttributes(req, 0)}`
}

/** True when the request carries a valid admin session (or dev bypass is active). */
export function isAuthenticated(req) {
  if (isDevBypass()) {
    warnDevBypass()
    return true
  }
  const token = parseCookies(req)[COOKIE_NAME]
  return verifySessionToken(token) !== null
}

// --- CSRF -------------------------------------------------------------------

/**
 * Three cheap layers, no token store:
 *
 *  1. SameSite=Strict on the session cookie -- nothing links into /admin from
 *     elsewhere, so Strict costs nothing and blocks cross-site submission outright.
 *  2. Require JSON content-type AND a custom header. Both force a CORS preflight for
 *     a cross-origin caller, and no CORS headers are ever emitted, so it fails.
 *  3. Reject a present-but-foreign Origin.
 */
export const CSRF_HEADER = "x-deyotlan-admin"

export function assertSameOrigin(req) {
  const origin = req.headers?.origin
  if (!origin) return // same-origin non-CORS requests often omit it entirely
  let host
  try {
    host = new URL(origin).host
  } catch {
    throw new HttpError(403, "bad_origin", "Malformed Origin header.")
  }
  if (host !== req.headers.host) {
    throw new HttpError(403, "bad_origin", "Cross-origin request rejected.")
  }
}

export function assertCsrf(req) {
  if (req.headers?.[CSRF_HEADER] !== "1") {
    throw new HttpError(403, "csrf", `Missing ${CSRF_HEADER} header.`)
  }
  const ct = String(req.headers?.["content-type"] ?? "")
  if (!ct.includes("application/json")) {
    throw new HttpError(415, "bad_content_type", "Expected application/json.")
  }
  assertSameOrigin(req)
}

/**
 * Gate for every mutating endpoint. Returns false having already written the
 * response, so handlers read: `if (!guard(req, res)) return`.
 */
export function guard(req, res) {
  try {
    assertCsrf(req)
  } catch (err) {
    res.writeHead(err.status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    res.end(JSON.stringify({ error: err.code, message: err.message }))
    return false
  }
  if (!isAuthenticated(req)) {
    res.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    res.end(JSON.stringify({ error: "unauthorized", message: "Sign in to continue." }))
    return false
  }
  return true
}
