import { NextRequest, NextResponse } from "next/server";
import { RequestStore } from "@/memory/requestStore";
import { MCPAgentRunner } from "@/agents/mcpagentrunner";


export async function POST(req: NextRequest) {
  const { id, decision } = await req.json();
  const request = RequestStore.find(id);

  if (!request) return NextResponse.json({ message: "Request not found." });

  if (decision === "allow") {
    const runner = new MCPAgentRunner();
    const output = await runner.run(request);
    RequestStore.remove(id);
    return NextResponse.json({ message: "Action executed", output });
  } else {
    RequestStore.remove(id);
    return NextResponse.json({ message: "Action denied" });
  }
}
