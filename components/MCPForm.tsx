'use client';

import { useState } from "react";
import { Button, TextField, Typography, Box } from "@mui/material";

export default function MCPForm({ onResult }: { onResult: (result: any) => void }) {
  const [query, setQuery] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const body = {
      id: "uuid-" + Math.random().toString(36).substr(2, 9),
      method: "mcp.tool.call",
      params: {
        name: "naturalLanguageKubectl",
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
    <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Enter your Kubernetes query:
      </Typography>
      <TextField
        label="Query"
        placeholder="e.g., get the namespaces"
        multiline
        minRows={4}
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        variant="outlined"
        margin="normal"
        required
      />
      <Button variant="contained" type="submit">
        Submit
      </Button>
    </Box>
  );
}
