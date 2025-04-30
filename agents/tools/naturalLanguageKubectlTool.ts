import { execSync } from "child_process";
import { MCPAgentRunner } from "@/agents/MCPAgentRunner";

const agentRunner = new MCPAgentRunner();

export const naturalLanguageKubectlTool = async (input: Record<string, any>) => {
  const nlQuery = input.query;

  if (!nlQuery) {
    throw new Error("Missing 'query' input");
  }

  // Step 1: Better prompt for Groq/OpenAI
  const prompt = `
You are a Kubernetes expert assistant.

Given a user's request, generate a safe kubectl command.
Strict rules:
- Only use 'kubectl get', 'kubectl describe', 'kubectl logs', 'kubectl explain', 'kubectl port-forward', or 'kubectl exec'.
- For port-forwarding, always use **pod/<pod-name>**, not deployment.
- Always include -n <namespace> if user mentions namespace.
- Never generate delete, patch, or edit commands.
- Reply only with the kubectl command, nothing else.

User request:
"${nlQuery}"
`;

  let kubectlCommand: string;

  try {
    kubectlCommand = await agentRunner.runAgentPrompt(prompt, "llama-3.1-8b-instant");  // or gpt-4
    kubectlCommand = kubectlCommand.trim();
    console.log("Generated kubectl command:", kubectlCommand);
  } catch (error: any) {
    console.error("Error talking to Groq:", error.message);
    return { error: "❌ Failed to connect to AI agent." };
  }

  // Step 2: Execute generated command
  try {
    const output = execSync(kubectlCommand, { encoding: "utf-8" });
    return {
      kubectl_command: kubectlCommand,
      output,
    };
  } catch (error: any) {
    console.error("Command execution failed:", error.message);
    return {
      kubectl_command: kubectlCommand,
      error: error.message || "❌ Failed to execute command.",
    };
  }
};
