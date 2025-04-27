import OpenAI from "openai";


export async function FixerAgent(diagnosis: string, openai: OpenAI) {
    const prompt = `
  You are a Kubernetes Fixer.
  Given the diagnosis:
  
  ${diagnosis}
  
  Suggest the kubectl command or configuration change to fix the issue.
  Only return the fix command or a very short explanation.
    `;
  
    const res = await openai.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }]
    });
  
    return res.choices[0].message?.content || "";
  }
  