import MCPForm from '@/components/MCPForm';
import MCPResult from '@/components/MCPResult';
import { useState } from 'react';

export default function HomePage() {
  const [result, setResult] = useState('');

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold mb-6">MCP Agent Interface</h1>
      <MCPForm onResult={(output) => setResult(output)} />
      {result && <MCPResult result={result} />}
    </div>
  );
}
