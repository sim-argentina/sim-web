import { NextResponse } from "next/server";
import { getCurrentAdminRole } from "@/lib/adminGuards";

export async function GET() {
  const role = await getCurrentAdminRole();
  return NextResponse.json({ role });
}
