import { NextRequest, NextResponse } from "next/server";
import { MCPRequest } from "@/app/types/mcp"; // <-- important import!
import { MCPAgentRunner } from "@/app/agents/mcpagentrunner";

export async function POST(req: NextRequest) {
  const mcpRequest: MCPRequest = await req.json();

  const runner = new MCPAgentRunner();
  const agentOutput = await runner.run(mcpRequest);

  return NextResponse.json({
    agent: mcpRequest.agent,
    goal: mcpRequest.goal,
    result: agentOutput
  });
}
