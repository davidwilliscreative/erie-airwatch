import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { demoAdminEnabled, isLive, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

// Admin routes require a Supabase session at MFA level aal2. The database checks
// role and MFA again on every admin call, so this is a convenience, not the only gate.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!isLive) {
    if (demoAdminEnabled) return NextResponse.next();
    return new NextResponse("Not found", { status: 404 });
  }
  if (pathname.startsWith("/admin/login")) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!user || aal?.currentLevel !== "aal2") {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  res.headers.set("cache-control", "no-store");
  return res;
}

export const config = { matcher: ["/admin/:path*"] };
