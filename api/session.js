/**
 * Whether the caller is an admin.
 *
 * The response is deliberately the single boolean and nothing else: this endpoint is
 * called by every page load of the public site to decide whether to render drag
 * handles, so it must never carry secrets, config, or user data.
 */
import { handler, send, requireMethod } from "./_lib/http.js"
import { isAuthenticated, isDevBypass } from "./_lib/auth.js"

export default handler(async (req, res) => {
  if (!requireMethod(req, res, "GET")) return
  const admin = isAuthenticated(req)
  send(res, 200, isDevBypass() ? { admin, dev: true } : { admin })
})
