import { execSync } from "child_process";
import { MCPAgentRunner } from "@/agents/MCPAgentRunner";

const agentRunner = new MCPAgentRunner();

export const naturalLanguageKubectlTool = async (input: Record<string, any>) => {
  const nlQuery = input.query;

  if (!nlQuery) {
    throw new Error("Missing 'query' input");
  }

  // Step 1: Send prompt to Groq
  const prompt = `
You are a Kubernetes expert.
Given the user's request, generate a SAFE kubectl command.
Only use 'kubectl get', 'kubectl describe', 'kubectl logs' commands.
Never generate commands like delete, patch, edit, etc.
Just reply with the command, no explanation.

User Request:
"${nlQuery}"
`;

  let kubectlCommand: string;

  try {
    kubectlCommand = await agentRunner.runAgentPrompt(prompt, "mixtral-8x7b-32768");  // or "gpt-4" if using OpenAI
    kubectlCommand = kubectlCommand.trim();
  } catch (error: any) {
    console.error("Error talking to Groq:", error.message);
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
