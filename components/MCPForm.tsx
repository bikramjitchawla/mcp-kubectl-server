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
        name: "naturalLanguageKubectl", // hardcoded tool name
        input: { query },
      },
    };

    const res = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    onResult(result);
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        placeholder="Enter your query or input..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        required
        style={{ width: "100%", height: "100px", marginTop: "10px" }}
      />

      <button
        type="submit"
        style={{
          marginTop: "10px",
          display: "block",
          background: "#0070f3",
          color: "white",
          padding: "10px",
          borderRadius: "5px",
        }}
      >
        Submit
      </button>
    </form>
  );
}
