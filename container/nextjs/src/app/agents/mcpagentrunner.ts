import OpenAI from "openai";
import { MCPRequest } from "@/app/types/mcp";
import { execSync } from "child_process";

export class MCPAgentRunner {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async run(mcp: MCPRequest): Promise<string> {
    let toolOutput = "";

    if (mcp.tools.includes("kubectl")) {
      try {
        toolOutput = execSync("kubectl get pods -n default").toString();
      } catch (error) {
        toolOutput = `Error running kubectl: ${error}`;
      }
    }

    const prompt = `
Agent: ${mcp.agent}
Goal: ${mcp.goal}
Input Context: ${JSON.stringify(mcp.input_context)}
Tool Output:
${toolOutput}

Please format your response as ${mcp.output_expectation.format} including ${mcp.output_expectation.includes.join(", ")}
`;

    const res = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
    });

    return res.choices[0].message?.content || '';
  }
}
