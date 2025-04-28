'use client';
import { useState } from 'react';

export default function MCPForm({ onResult }: { onResult: (output: string) => void }) {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const res = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        agent: 'Diagnoser',
        goal: prompt,
        tools: ['kubectl'],
        input_context: { namespace: 'default' },
        output_expectation: { format: 'markdown', includes: ['root cause', 'fix'] }
      }),
    });

    const data = await res.json();
    onResult(data.result);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Enter your prompt / goal..."
        className="w-full border p-2 rounded"
        rows={4}
      />
      <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
        Submit
      </button>
    </form>
  );
}
