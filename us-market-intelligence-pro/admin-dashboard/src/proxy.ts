import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: redirects requests without a session cookie to /login.
 * The session is decrypted and the role enforced on the server (and again by the backend).
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("umip_session");
  if (!hasSession) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon.svg|healthz).*)"],
};
