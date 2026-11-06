import { NextResponse, type NextRequest } from "next/server";
import { accessResponse } from "./lib/access";
export function proxy(req: NextRequest) {
  return accessResponse(req) || NextResponse.next();
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/).*)",
  ],
};
