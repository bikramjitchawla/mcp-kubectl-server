import { v4 as uuidv4 } from 'uuid';
import { echoTool } from './tools/echoTool';
import { naturalLanguageKubectlTool } from './tools/naturalLanguageKubectlTool';
import { scaleDeploymentTool } from './tools/scaleDeploymentTool';
import { logsFetcherTool } from './tools/logsFetcherTool';
import { rolloutCheckerTool } from './tools/rolloutCheckerTool';
import { namespaceAnalyzerTool } from './tools/namespaceAnalyzerTool';

export type ToolHandler = (input: Record<string, any>) => Promise<Record<string, any>>;

interface Tool {
  description: string;
  parameters: Record<string, { type: string; description: string; required: boolean }>;
  handler: ToolHandler;
}

export class MCPServer {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerTool("echo", "Simple echo tool", { message: { type: "string", description: "Text to echo", required: true } }, echoTool);
    this.registerTool("naturalLanguageKubectl", "Natural language to kubectl", { query: { type: "string", description: "Query text", required: true } }, naturalLanguageKubectlTool);
    this.registerTool("scaleDeployment", "Scale a Kubernetes deployment", {
      deployment: { type: "string", description: "Deployment name", required: true },
      replicas: { type: "number", description: "Number of replicas", required: true },
      namespace: { type: "string", description: "Namespace (optional)", required: false }
    }, scaleDeploymentTool);
    this.registerTool("logsFetcher", "Fetch logs for a pod", {
      podName: { type: "string", description: "Pod name", required: true },
      namespace: { type: "string", description: "Namespace", required: false }
    }, logsFetcherTool);
    this.registerTool("rolloutChecker", "Check rollout status of a deployment", {
      deployment: { type: "string", description: "Deployment name", required: true },
      namespace: { type: "string", description: "Namespace", required: false }
    }, rolloutCheckerTool);
    this.registerTool("namespaceAnalyzer", "Analyze all Kubernetes namespaces", {}, namespaceAnalyzerTool);
  }

  registerTool(name: string, description: string, parameters: Record<string, { type: string; description: string; required: boolean }>, handler: ToolHandler) {
    this.tools.set(name, { description, parameters, handler });
  }

  async handleMessage(message: any) {
    if (!message.method) throw new Error("Invalid MCP message: missing method");

    const id = message.id || uuidv4();

    switch (message.method) {
      case "mcp.tool.call":
        const toolName = message.params?.name;
        const toolInput = message.params?.input || {};

        if (!toolName || !this.tools.has(toolName)) {
          return { jsonrpc: "2.0", id, error: { code: -32601, message: `Tool not found: ${toolName}` } };
        }

        const tool = this.tools.get(toolName)!;
        try {
          const result = await tool.handler(toolInput);
          return { jsonrpc: "2.0", id, result };
        } catch (error) {
          return { jsonrpc: "2.0", id, error: { code: -32603, message: `Error running tool: ${String(error)}` } };
        }

      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${message.method}` } };
    }
  }
}
