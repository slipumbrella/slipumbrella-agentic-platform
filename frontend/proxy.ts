import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const publicRoutes = ["/login", "/signup", "/"];
export const API_URL = "http://localhost:8080/api";

export default function proxy(request: NextRequest) {
  // WebSocket upgrade requests — let them pass through
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return NextResponse.next();
  }

  const token = request.cookies.get("token")?.value;
  const { pathname } = request.nextUrl;

  const isPublicRoute = publicRoutes.includes(pathname) || pathname.startsWith("/avatars/");
  const loginUrl = new URL("/login", request.url);
  const dashboardUrl = new URL("/dashboard", request.url);

  // Route gating only. The backend remains the real auth boundary.
  if (!isPublicRoute && !token) {
    loginUrl.searchParams.set("error", "unauthorized");
    return NextResponse.redirect(loginUrl);
  }

  // If they are on Login but HAVE a token -> Send to Dashboard (BUG FIX)
  if (pathname === "/login" && token) {
    return NextResponse.redirect(dashboardUrl);
  }

  // Add security headers to all responses
  const response = NextResponse.next();

  // SECURITY: Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");
  // SECURITY: Prevent MIME type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");
  // SECURITY: XSS Protection (legacy browsers)
  response.headers.set("X-XSS-Protection", "1; mode=block");
  // SECURITY: Referrer policy
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}

// This regex matches ALL routes except static files (images, fonts, next.js internals)
// This ensures middleware runs on EVERY page creation.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
