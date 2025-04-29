import { MCPServer } from "@/agents/MCPServer";

const server = new MCPServer();

export async function POST(req: Request) {
  const body = await req.json();

  try {
    const response = await server.handleMessage(body);

    return Response.json(response);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
