import OpenAI from "openai";  // ✅ Add this

export async function DiagnoserAgent(kubectlOutput: string, openai: OpenAI) {
  const prompt = `
You are a Kubernetes Diagnoser.
Analyze the following pod status:

${kubectlOutput}

Find the root cause of failure and summarize it in markdown.
  `;

  const res = await openai.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }]
  });

  return res.choices[0].message?.content || "";
}
