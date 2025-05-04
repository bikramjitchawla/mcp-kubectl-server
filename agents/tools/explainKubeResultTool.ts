export const explainKubeResultTool = async (
    input: Record<string, any>
  ): Promise<Record<string, any>> => {
    const { kubectl_command, output } = input;
  
    const prompt = `
  You are a Kubernetes expert. The user ran this command:
  
  ${kubectl_command}
  
  And got this output:
  
  ${output}
  
  Explain what this means in plain English, and suggest any fixes if problems are found.
    `;
  
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama3-8b-8192", // Correct Groq model
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
  
      const json = await res.json();
      console.log("Groq raw response:", JSON.stringify(json, null, 2)); // Add debug log
  
      if (!json?.choices || !Array.isArray(json.choices) || !json.choices.length) {
        console.error("AI response missing choices:", json);
        return {
          content: [{ type: "text", text: "AI response malformed or empty." }],
        };
      }
  
      const explanation = json.choices[0]?.message?.content?.trim() || "No explanation returned.";
  
      return {
        content: [{ type: "text", text: explanation }],
      };
    } catch (err: any) {
      console.error("Groq API fetch error:", err);
      return {
        content: [{ type: "text", text: "Failed to fetch explanation from Groq API." }],
      };
    }
  };
  