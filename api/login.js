import { handler, send, requireMethod, readJson, HttpError } from "./_lib/http.js"
import {
  assertCsrf,
  verifyPassword,
  signSession,
  sessionCookieHeader,
  isDevBypass,
  throttleCheck,
  throttleRecordFailure,
  throttleReset,
} from "./_lib/auth.js"

export default handler(async (req, res) => {
  if (!requireMethod(req, res, "POST")) return
  assertCsrf(req)
  throttleCheck(req)

  if (isDevBypass()) {
    return send(
      res,
      200,
      { admin: true, dev: true },
      { "Set-Cookie": sessionCookieHeader(req, signSession()) },
    )
  }

  if (!process.env.ADMIN_PASSWORD_HASH) {
    throw new HttpError(500, "misconfigured", "ADMIN_PASSWORD_HASH is not set.")
  }

  // Cap the body hard: a password is never large, and scrypt over a huge string is
  // a cheap way to burn function time.
  const body = await readJson(req, 4096)
  const password = typeof body.password === "string" ? body.password : ""

  if (!verifyPassword(password)) {
    throttleRecordFailure(req)
    throw new HttpError(401, "bad_credentials", "Incorrect password.")
  }

  throttleReset(req)
  send(res, 200, { admin: true }, { "Set-Cookie": sessionCookieHeader(req, signSession()) })
})
