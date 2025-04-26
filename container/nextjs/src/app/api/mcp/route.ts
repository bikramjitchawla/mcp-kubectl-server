import { NextRequest, NextResponse } from "next/server";
import { RequestStore } from "@/app/memory/requestStore";

export async function POST(req: NextRequest) {
  const mcpRequest = await req.json();
  RequestStore.add(mcpRequest);
  return NextResponse.json({ message: "MCP Request stored." });
}
