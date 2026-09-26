/**
 * Minimal HTTP helpers over raw Node `(req, res)`.
 *
 * Deliberately avoids every Vercel-specific convenience (`res.json`, `req.body`,
 * `req.cookies`). That is what lets the identical handler files run unchanged under
 * both the Vercel Node runtime and the local `quartz build --serve` dev server.
 */

/** Default request body cap. Generous enough for a long session note, small enough
 *  that a runaway client cannot exhaust function memory. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

/** Read the raw request body as a UTF-8 string, aborting past `maxBytes`. */
export function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false

    const fail = (err) => {
      if (settled) return
      settled = true
      req.removeAllListeners("data")
      req.removeAllListeners("end")
      reject(err)
    }

    req.on("data", (chunk) => {
      if (settled) return
      total += chunk.length
      if (total > maxBytes) {
        fail(new HttpError(413, "payload_too_large", `Body exceeds ${maxBytes} bytes.`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString("utf8"))
    })
    req.on("error", fail)
  })
}

/** Read and parse a JSON body. Throws HttpError on malformed input. */
export async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  const raw = await readBody(req, maxBytes)
  if (raw.trim() === "") return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "bad_json", "Body must be a JSON object.")
    }
    return parsed
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(400, "bad_json", "Body is not valid JSON.")
  }
}

/** Send a JSON response. Admin API responses are never cacheable. */
export function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

/** Translate a thrown error into a response. Unknown errors never leak internals. */
export function sendError(res, err) {
  if (err instanceof HttpError) {
    return send(res, err.status, { error: err.code, message: err.message, ...err.extra })
  }
  console.error("[api] unhandled error:", err)
  return send(res, 500, { error: "internal", message: "Something went wrong." })
}

/** Wrap a handler so thrown HttpErrors become responses and nothing escapes. */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (err) {
      if (!res.headersSent) sendError(res, err)
      else {
        console.error("[api] error after headers sent:", err)
        res.end()
      }
    }
  }
}

/** Reject any method not in `allowed`. */
export function requireMethod(req, res, allowed) {
  const methods = Array.isArray(allowed) ? allowed : [allowed]
  if (methods.includes(req.method)) return true
  send(
    res,
    405,
    { error: "method_not_allowed", message: `Expected ${methods.join(" or ")}.` },
    {
      Allow: methods.join(", "),
    },
  )
  return false
}

/** Parse the Cookie header into a plain object. */
export function parseCookies(req) {
  const header = req.headers?.cookie
  if (!header) return {}
  const out = {}
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    const value = part.slice(eq + 1).trim()
    try {
      out[name] = decodeURIComponent(value)
    } catch {
      out[name] = value
    }
  }
  return out
}

/** True when the connection is HTTPS, so the Secure cookie flag is appropriate.
 *  Local dev over plain http://localhost must not set Secure or the cookie is dropped. */
export function isSecureRequest(req) {
  const proto = req.headers?.["x-forwarded-proto"]
  if (typeof proto === "string") return proto.split(",")[0].trim() === "https"
  return Boolean(req.socket?.encrypted)
}

/** Best-effort client IP, for the warm-instance login throttle. */
export function clientIp(req) {
  const fwd = req.headers?.["x-forwarded-for"]
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim()
  return req.socket?.remoteAddress ?? "unknown"
}

export function query(req) {
  const host = req.headers?.host ?? "localhost"
  return new URL(req.url ?? "/", `http://${host}`).searchParams
}
