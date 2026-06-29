import OpenAI from 'openai';

export interface LlmClient {
  client: OpenAI;
  model: string;
  provider: 'groq' | 'openai';
}

export function buildLlmClient(): LlmClient | undefined {
  if (process.env.GROQ_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      }),
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      provider: 'groq',
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      provider: 'openai',
    };
  }

  return undefined;
}

export function hasLlmClient(): boolean {
  return Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}
