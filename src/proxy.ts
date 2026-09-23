import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  apiAuthPrefix,
  authRoutes,
  DEFAULT_LOGIN_REDIRECT,
  LOGIN_ROUTE,
  publicRoutes,
} from "./routes";

const isPathPublic = (pathname: string): boolean => {
  return publicRoutes.some((route) => {
    if (route.endsWith("/**")) {
      const baseRoute = route.slice(0, -3);
      return pathname.startsWith(baseRoute);
    }
    return route === pathname;
  });
};

export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { nextUrl } = request;
  const { pathname } = request.nextUrl;
  const searchParams = nextUrl.searchParams.toString();
  const pathWithSearchParams = `${nextUrl.pathname}${
    searchParams.length > 0 ? `?${searchParams}` : ""
  }`;

  if (
    pathname.startsWith(apiAuthPrefix) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/trpc/") ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }

  // Public routes (marketing/site pages, invite acceptance, tool/track
  // endpoints, etc.) never require authentication.
  if (isPathPublic(pathname)) {
    return NextResponse.next();
  }

  // only playwright allowed in this route
  if (request.nextUrl.pathname.includes("/prev/")) {
    const secret = request.headers.get("x-preview-secret");

    if (secret !== process.env.PLAYRIGHT_PREVIEW_SECRET_TOKEN) {
      return new NextResponse(null, { status: 404 });
    }
  }

  // 1. Get Host and Domain
  const hostname = request.headers.get("host");
  const baseDomain = process.env.NEXT_PUBLIC_DOMAIN;

  let customSubDomain;

  // 2. Extract Subdomain safely
  if (hostname && baseDomain && hostname !== baseDomain) {
    if (hostname.endsWith(`.${baseDomain}`)) {
      customSubDomain = hostname.replace(`.${baseDomain}`, "");
    }
  }

  // 3. Rewrite to Subdomain Route
  if (customSubDomain) {
    return NextResponse.rewrite(
      new URL(`/${customSubDomain}${pathWithSearchParams}`, request.url),
    );
  }

  // --- STANDARD ROUTES BELOW ---

  if (nextUrl.pathname === "/" && hostname === baseDomain) {
    return NextResponse.rewrite(new URL("/", request.url));
  }

  if (nextUrl.pathname === "/") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/payments/webhooks")) {
    return NextResponse.next();
  }

  if (sessionCookie && authRoutes.includes(pathname)) {
    return NextResponse.redirect(new URL(DEFAULT_LOGIN_REDIRECT, request.url));
  }

  if (!sessionCookie && pathname.startsWith("/workspace")) {
    return NextResponse.redirect(new URL(LOGIN_ROUTE, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
