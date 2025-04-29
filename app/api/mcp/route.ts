import { MCPServer } from "@/agents/MCPServer";

const server = new MCPServer();

export async function POST(req: Request) {
  const body = await req.json();

  try {
    const response = await server.handleMessage(body);

    if (response?.result) {
      return Response.json(response.result);
    } else {
      return Response.json(response.error || { error: "Unknown error occurred" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error handling MCP request:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
