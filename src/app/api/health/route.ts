import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "hakapro", timestamp: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
