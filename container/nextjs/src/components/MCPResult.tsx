export default function MCPResult({ result }: { result: string }) {
    return (
      <div className="p-4 border mt-4 rounded bg-gray-100">
        <h2 className="text-lg font-semibold mb-2">Agent Response:</h2>
        <pre className="whitespace-pre-wrap">{result}</pre>
      </div>
    );
  }
  