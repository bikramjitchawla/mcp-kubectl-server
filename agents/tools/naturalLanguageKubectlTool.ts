import { execSync } from "child_process";
import { MCPAgentRunner } from "@/agents/MCPAgentRunner";

const agentRunner = new MCPAgentRunner();

export const naturalLanguageKubectlTool = async (input: Record<string, any>) => {
  const nlQuery = input.query;

  if (!nlQuery) {
    throw new Error("Missing 'query' input");
  }
  const prompt = `
You are a Kubernetes expert.
Given the user's request, generate the correct kubectl or helm CLI command.
You are allowed to use:
- kubectl get, describe, logs
- kubectl exec, port-forward, scale, rollout, explain
- helm install, helm upgrade, helm uninstall
You must NEVER generate dangerous commands like delete, patch, edit, unless the user specifically asks for it.

Reply ONLY with the CLI command (no markdown, no explanation).

User Request:
"${nlQuery}"
`;

  let kubectlCommand: string;

  try {
    kubectlCommand = await agentRunner.runAgentPrompt(prompt, "llama3-8b-8192");  // Best for Groq
    kubectlCommand = kubectlCommand.trim();
  } catch (error: any) {
    console.error("❌ Error talking to Groq:", error.message);
    return { error: "Failed to connect to AI agent." };
  }

  try {
    const output = execSync(kubectlCommand).toString();
    return {
      kubectl_command: kubectlCommand,
      output
    };
  } catch (error: any) {
    return {
      kubectl_command: kubectlCommand,
      error: error.message
    };
  }
};
