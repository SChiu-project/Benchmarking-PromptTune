import { createHash, timingSafeEqual } from "node:crypto";
import { isVercel } from "./runtime";
const equal = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
export function accessResponse(req: Request): Response | null {
  const password = process.env.APP_PASSWORD;
  if (isVercel() && (!password || password.length < 16))
    return Response.json(
      {
        error:
          "Set APP_PASSWORD to at least 16 characters before using the hosted workspace.",
      },
      { status: 503 },
    );
  if (!password) return null;
  const value = req.headers.get("authorization") || "";
  let user = "",
    secret = "";
  try {
    if (value.startsWith("Basic ")) {
      const decoded = Buffer.from(value.slice(6), "base64").toString("utf8"),
        colon = decoded.indexOf(":");
      if (colon >= 0) {
        user = decoded.slice(0, colon);
        secret = decoded.slice(colon + 1);
      }
    }
  } catch {}
  if (
    equal(user, process.env.APP_USERNAME || "benchmark") &&
    equal(secret, password)
  )
    return null;
  return new Response("Sign in to Doc Search Benchmark.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Doc Search Benchmark", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}
