'use client';
import { useState, useEffect } from 'react';

interface MCPRequest {
  id: string;
  agent: string;
  goal: string;
}

export default function Dashboard() {
  const [requests, setRequests] = useState<MCPRequest[]>([]);

  useEffect(() => {
    const interval = setInterval(fetchRequests, 2000);
    return () => clearInterval(interval);
  }, []);

  const fetchRequests = async () => {
    const res = await fetch('/api/mcp');
    if (res.ok) {
      const data = await res.json();
      setRequests(data.requests);
    }
  };

  const makeDecision = async (id: string, decision: "allow" | "deny") => {
    await fetch('/api/decision', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision })
    });
    fetchRequests();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Pending Agent Requests</h1>
      <div className="space-y-4">
        {requests.map(req => (
          <div key={req.id} className="border p-4 rounded shadow-sm">
            <div><strong>Agent:</strong> {req.agent}</div>
            <div><strong>Goal:</strong> {req.goal}</div>
            <div className="space-x-2 mt-2">
              <button
                onClick={() => makeDecision(req.id, "allow")}
                className="bg-green-500 text-white px-3 py-1 rounded"
              >
                Allow
              </button>
              <button
                onClick={() => makeDecision(req.id, "deny")}
                className="bg-red-500 text-white px-3 py-1 rounded"
              >
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
