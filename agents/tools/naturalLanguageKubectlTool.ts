import { execSync } from "child_process";
import { MCPAgentRunner } from "@/agents/MCPAgentRunner";
import { allTools } from "./tool";

const agentRunner = new MCPAgentRunner();

// Define matchers to route commands to tools
const toolCommandMatchers: {
  name: string;
  match: (cmd: string) => boolean;
  extractParams: (cmd: string) => Record<string, any> | null;
}[] = [
  {
    name: "monitoringTool",
    match: (cmd) => cmd.startsWith("kubectl logs "),
    extractParams: (cmd) => {
      const podMatch = cmd.match(/logs\s+([^\s]+)/);
      const nsMatch = cmd.match(/-n\s+([^\s]+)/) || cmd.match(/--namespace\s+([^\s]+)/);
      if (!podMatch) return null;

      return {
        type: "pod-logs",
        podName: podMatch[1],
        namespace: nsMatch?.[1] || "default",
      };
    },
  },
  {
    name: "monitoringTool",
    match: (cmd) => cmd.startsWith("kubectl describe pod "),
    extractParams: (cmd) => {
      const podMatch = cmd.match(/describe pod\s+([^\s]+)/);
      const nsMatch = cmd.match(/-n\s+([^\s]+)/);
      if (!podMatch) return null;

      return {
        type: "pod-health",
        podName: podMatch[1],
        namespace: nsMatch?.[1] || "default",
      };
    },
  },
  {
    name: "monitoringTool",
    match: (cmd) => cmd.startsWith("kubectl get events"),
    extractParams: (cmd) => {
      const nsMatch = cmd.match(/-n\s+([^\s]+)/) || cmd.match(/--namespace\s+([^\s]+)/);
      return {
        type: "events",
        namespace: nsMatch?.[1] || "default",
      };
    },
  },
  {
    name: "monitoringTool",
    match: (cmd) => cmd.includes("top pod") || cmd.includes("top pods"),
    extractParams: (cmd) => {
      const nsMatch = cmd.match(/-n\s+([^\s]+)/);
      return {
        type: "resource-usage",
        namespace: nsMatch?.[1] || undefined,
      };
    },
  },
  {
    name: "monitoringTool",
    match: (cmd) => cmd === "kubectl get componentstatuses",
    extractParams: () => ({
      type: "cluster-health",
    }),
  },
];

export const naturalLanguageKubectlTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const nlQuery = input.query;
  if (!nlQuery) throw new Error("Missing 'query' input");

  let availablePods = "";
  try {
    availablePods = execSync("kubectl get pods -A -o name", {
      encoding: "utf-8",
    });
  } catch {
    availablePods = "";
  }

  const prompt = `
You are a Kubernetes and Helm CLI assistant.

Only generate SAFE one-line CLI commands based on user requests.

Allowed:
- helm version --short
- helm repo list
- helm repo update
- helm list [--all-namespaces]
- helm install/upgrade/uninstall/list

DO NOT use: delete, patch, apply, edit, or any unknown flags.
NEVER use -a, --app-version, or unsupported flags.

Return ONE line only, without explanation.

User request:
"${nlQuery}"
`;

  let rawCommand = "";

  try {
    const aiResponse = await agentRunner.runAgentPrompt(prompt, "llama-3.1-8b-instant");
    rawCommand = aiResponse.trim().split("\n")[0];
    console.log("Generated command:", rawCommand);

    // Block dangerous commands
    if (!rawCommand.startsWith("kubectl") && !rawCommand.startsWith("helm")) {
      return {
        command: rawCommand,
        error: "Unsupported command. Execution blocked.",
      };
    }

    // Check for matching tools
    for (const matcher of toolCommandMatchers) {
      if (matcher.match(rawCommand)) {
        const tool = allTools.find((t) => t.name === matcher.name);
        const params = matcher.extractParams(rawCommand);
        if (tool && params) {
          try {
            const result = await tool.handler(params);
            return { command: rawCommand, ...result };
          } catch (err: any) {
            return {
              command: rawCommand,
              error: err.message || "Tool execution failed.",
            };
          }
        }
      }
    }

    // Fallback: safe command execution
    const output = execSync(rawCommand, { encoding: "utf-8" }).trim();
    return { command: rawCommand, output };
  } catch (error: any) {
    return {
      command: rawCommand,
      error: error.message || "Command execution failed.",
    };
  }
};
