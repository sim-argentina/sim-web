import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();
  const role = cookieStore.get("sim-admin-role")?.value ?? null;
  return NextResponse.json({ role });
}
