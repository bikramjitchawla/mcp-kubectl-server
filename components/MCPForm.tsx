'use client';
import { useState } from "react";

export default function MCPForm({ onResult }: { onResult: (result: any) => void }) {
  const [query, setQuery] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const body = {
      id: "uuid-" + Math.random().toString(36).substr(2, 9),
      method: "mcp.tool.call",
      params: {
        name: "naturalLanguageKubectl",
        input: { query }
      }
    };

    const res = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const result = await res.json();
    onResult(result);
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        placeholder="Enter your natural language query..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        required
      />
      <button type="submit" style={{ marginTop: "10px" }}>Submit Query</button>
    </form>
  );
}
