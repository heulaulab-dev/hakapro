import { NextResponse } from "next/server";
import { readiness } from "@/server/readiness";

export async function GET() {
  const result = await readiness();
  return NextResponse.json(result, { status: result.ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
