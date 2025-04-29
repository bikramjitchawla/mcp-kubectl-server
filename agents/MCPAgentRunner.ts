import { OpenAI } from "openai";

export class MCPAgentRunner {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"  
    });
  }

  async runAgentPrompt(prompt: string, model: string = "mixtral-8x7b-32768") {
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a Kubernetes expert." },
        { role: "user", content: prompt }
      ]
    });

    return response.choices[0]?.message?.content || "";
  }
}
