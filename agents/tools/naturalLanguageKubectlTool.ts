import { execSync } from "child_process";
import { MCPAgentRunner } from "@/agents/MCPAgentRunner";
import { monitoringTool } from "./monitoringtool";
import { logsFetcherTool } from "./logsFetcherTool";
import { explainKubeResultTool } from "./explainKubeResultTool";

const agentRunner = new MCPAgentRunner();

export const naturalLanguageKubectlTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const nlQuery = input.query;
  if (!nlQuery) throw new Error("Missing 'query' input");

  // Optional: Fetch pods to provide better context to the model
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

Here are the pods running:
${availablePods}

From the user's request, generate a one-line, safe CLI command using:
- kubectl get/describe/logs/explain/exec/port-forward
- helm install/upgrade/uninstall/list

Rules:
- Use full pod names (e.g. pod/xyz-123-abc) for exec/port-forward
- Use /bin/sh (not bash)
- Include '-n <namespace>' if mentioned
- Never use delete, patch, edit
- DO NOT include markdown, backticks, or explanations

Just return one CLI command.

User:
"${nlQuery}"
`;

  let rawCommand = "";
  try {
    const aiResponse = await agentRunner.runAgentPrompt(prompt, "llama-3.1-8b-instant");
    rawCommand = aiResponse.trim().split("\n")[0];
    console.log("Generated command:", rawCommand);
  } catch (err: any) {
    return { error: "❌ NLP error: " + err.message };
  }

  // Check if it maps to a known tool
  const lower = nlQuery.toLowerCase();

  if (lower.includes("check cluster health")) {
    return await monitoringTool({ type: "cluster-health" });
  }

  if (lower.includes("resource usage") || lower.includes("cpu") || lower.includes("memory usage")) {
    const nsMatch = nlQuery.match(/namespace\s+([a-z0-9-]+)/i);
    return await monitoringTool({
      type: "resource-usage",
      namespace: nsMatch?.[1],
    });
  }

  if (lower.includes("validate resources")) {
    const nsMatch = nlQuery.match(/namespace\s+([a-z0-9-]+)/i);
    return await monitoringTool({
      type: "validate-resources",
      namespace: nsMatch?.[1] || "default",
    });
  }

  if (lower.includes("logs from") || lower.includes("fetch logs")) {
    const podMatch = nlQuery.match(/logs (?:from|of)?\s*([a-zA-Z0-9-]+)/i);
    const nsMatch = nlQuery.match(/namespace\s+([a-z0-9-]+)/i);
    return await logsFetcherTool({
      podName: podMatch?.[1],
      namespace: nsMatch?.[1] || "default",
    });
  }

  // Final fallback: execute AI-generated raw command
  if (!rawCommand.startsWith("kubectl") && !rawCommand.startsWith("helm")) {
    return {
      command: rawCommand,
      error: "❌ Unsupported or unsafe command generated. Execution blocked.",
    };
  }

  try {
    const output = execSync(rawCommand, { encoding: "utf-8" });
    return { command: rawCommand, output };
  } catch (error: any) {
    // Optional: use explanation tool if command failed
    return await explainKubeResultTool({
      kubectl_command: rawCommand,
      output: error.message || "Unknown error",
    });
  }
};
