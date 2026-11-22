import { NextResponse, type NextRequest } from "next/server";
import { accessResponse } from "./lib/access";
export function proxy(req: NextRequest) {
  // Supervisors authenticate with CMS and the emailed capability, without needing
  // the shared benchmark password. No other workspace route is made public.
  if (["/cms/approve", "/api/cms/approval"].includes(req.nextUrl.pathname))
    return NextResponse.next();
  return accessResponse(req) || NextResponse.next();
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/).*)",
  ],
};
