import { handler, send, requireMethod } from "./_lib/http.js"
import { assertCsrf, clearCookieHeader } from "./_lib/auth.js"

export default handler(async (req, res) => {
  if (!requireMethod(req, res, "POST")) return
  // No auth check: logging out without a valid session is a no-op, not an error.
  assertCsrf(req)
  send(res, 200, { admin: false }, { "Set-Cookie": clearCookieHeader(req) })
})
