'use client';

export default function MCPResult({ result }: { result: any }) {
  if (!result) return null;

  return (
    <div style={{ marginTop: "20px" }}>
      <h3>Result:</h3>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}
