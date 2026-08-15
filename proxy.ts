import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function matches(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function proxy(request: NextRequest) {
  const accessCode = process.env.MVP_ACCESS_CODE?.trim();
  const explicitlyUnprotected = process.env.ALLOW_UNPROTECTED_MVP === "true";

  if (!accessCode) {
    if (process.env.NODE_ENV !== "production" || explicitlyUnprotected) {
      return NextResponse.next();
    }
    return new NextResponse("Vera deployment access is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const expected = `Basic ${Buffer.from(`vera:${accessCode}`).toString("base64")}`;
  const supplied = request.headers.get("authorization") || "";
  if (matches(supplied, expected)) {
    return NextResponse.next();
  }

  return new NextResponse("Vera MVP access required.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="Vera MVP", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
