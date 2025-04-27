import OpenAI from "openai";
import { DiagnoserAgent } from "@/app/agents/diagnoserAgent";
import { FixerAgent } from "@/app/agents/fixerAgent";
import { MCPRequest } from "@/app/types/mcp";
import { execSync } from "child_process";

export class MCPAgentRunner {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,   // your Groq API key
      baseURL: "https://api.groq.com/openai/v1"
    });
  }

  async run(mcp: MCPRequest): Promise<string> {
    let toolOutput = "";

    if (mcp.tools.includes("kubectl")) {
      try {
        toolOutput = execSync(`kubectl get pods -n ${mcp.input_context.namespace}`).toString();
      } catch (error) {
        toolOutput = `Error running kubectl: ${error}`;
      }
    }

    // Step 1: Diagnoser Agent
    const diagnosis = await DiagnoserAgent(toolOutput, this.openai);

    // Step 2: Fixer Agent
    const fix = await FixerAgent(diagnosis, this.openai);

    return `
# Diagnosis:
${diagnosis}

# Suggested Fix:
${fix}

    `;
  }
}
