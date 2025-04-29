'use client';
import { useState } from "react";
import MCPForm from "@/components/MCPForm";
import MCPResult from "@/components/MCPResult";

export default function HomePage() {
  const [result, setResult] = useState<any>(null);

  return (
    <div style={{ padding: "40px" }}>
      <h1>MCP Kubernetes Debugger</h1>
      <MCPForm onResult={setResult} />
      <MCPResult result={result} />
    </div>
  );
}
