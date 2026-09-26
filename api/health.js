/**
 * Liveness probe.
 *
 * This endpoint exists chiefly as the make-or-break test that Vercel zero-config
 * function detection is working for this `framework: null` project. Unauthenticated
 * by design, and deliberately leaks nothing beyond the deployed commit.
 */
import { handler, send, requireMethod } from "./_lib/http.js"

export default handler(async (req, res) => {
  if (!requireMethod(req, res, "GET")) return
  send(res, 200, {
    ok: true,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    env: process.env.VERCEL_ENV ?? "development",
    now: new Date().toISOString(),
  })
})
