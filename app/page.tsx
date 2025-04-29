'use client';

import { useState } from "react";
import MCPForm from "@/components/MCPForm";
import MCPResult from "@/components/MCPResult";
import { Container, Typography } from "@mui/material";

export default function HomePage() {
  const [result, setResult] = useState<any>(null);

  return (
    <Container maxWidth="md" sx={{ mt: 8 }}>
      <Typography variant="h4" gutterBottom>
        MCP Kubernetes Debugger
      </Typography>
      <MCPForm onResult={setResult} />
      <MCPResult result={result} />
    </Container>
  );
}
