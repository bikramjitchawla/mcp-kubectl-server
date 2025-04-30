// agents/MCPServer.ts

import { v4 as uuidv4 } from "uuid";
import { allTools } from "./tools/tool";

export type ToolHandler = (input: Record<string, any>) => Promise<Record<string, any>>;

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required: boolean }>;
  handler: ToolHandler;
}

export class MCPServer {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    for (const tool of allTools) {
      const validParameters: Tool["parameters"] = Object.fromEntries(
        Object.entries(tool.parameters).filter(
          ([_, param]) =>
            param !== undefined &&
            typeof param === "object" &&
            typeof param.type === "string" &&
            typeof param.description === "string" &&
            typeof param.required === "boolean"
        )
      );

      this.registerTool({
        name: tool.name,
        description: tool.description,
        parameters: validParameters,
        handler: tool.handler,
      });
    }
  }

  registerTool(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  async handleMessage(message: any) {
    if (!message.method) throw new Error("Invalid MCP message: missing method");

    const id = message.id || uuidv4();

    switch (message.method) {
      case "mcp.tool.call": {
        const toolName = message.params?.name;
        const toolInput = message.params?.input || {};

        if (!toolName || !this.tools.has(toolName)) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Tool not found: ${toolName}` },
          };
        }

        const tool = this.tools.get(toolName)!;

        try {
          const result = await tool.handler(toolInput);
          return { jsonrpc: "2.0", id, result };
        } catch (error) {
          console.error(`Error executing tool "${toolName}":`, error);
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: `Error running tool: ${String(error)}` },
          };
        }
      }

      case "mcp.tools.list": {
        const toolList = Array.from(this.tools.values()).map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }));
        return { jsonrpc: "2.0", id, result: { tools: toolList } };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown method: ${message.method}` },
        };
    }
  }
}
