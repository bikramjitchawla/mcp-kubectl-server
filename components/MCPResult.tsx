'use client';

import {
  Typography,
  Paper,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  CircularProgress,
  Card,
  CardContent,
  Snackbar,
  Alert,
} from '@mui/material';
import { useState } from 'react';

function parseOutput(output: string): string[][] {
  if (!output || typeof output !== 'string') return [];
  const lines = output.trim().split('\n');
  return lines.map((line) =>
    line.trim().split(/\s{2,}|\t+/).filter(Boolean)
  );
}

export default function MCPResult({ result }: { result: any }) {
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);

  const res = result?.result?.result || result?.result || {};
  const command = res.command || res.kubectl_command;
  const output = res.output || '';
  const error = res.error || '';
  const table = parseOutput(output);

  const handleExplain = async () => {
    if (!command || !output) return;

    setLoading(true);
    setAiExplanation(null);

    const response = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "uuid-" + Math.random().toString(36).substring(2),
        method: "mcp.tool.call",
        params: {
          name: "explain_kubectl_result",
          input: { kubectl_command: command, output },
        },
      }),
    });

    const data = await response.json();
    const text =
      data?.result?.content?.[0]?.text ||
      data?.result?.choices?.[0]?.message?.content ||
      "No explanation returned.";

    setAiExplanation(text.trim());
    setLoading(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(aiExplanation || '');
    setToastOpen(true);
  };

  return (
    <Box sx={{ mt: 4 }}>
      {command && (
        <>
          <Typography variant="h6" gutterBottom>
            Command Executed:
          </Typography>
          <Paper sx={{ p: 2, mb: 2, backgroundColor: '#f9f9f9' }}>
            <code>{command}</code>
          </Paper>
        </>
      )}

      {error ? (
        <Paper sx={{ p: 2, mb: 2, backgroundColor: '#fff3cd', border: '1px solid #ffeeba' }}>
          <Typography color="error" fontWeight="bold">Error:</Typography>
          <pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
        </Paper>
      ) : table.length > 1 ? (
        <TableContainer component={Paper} sx={{ mb: 3 }}>
          <Table>
            <TableHead>
              <TableRow>
                {table[0].map((header, i) => (
                  <TableCell key={i} sx={{ fontWeight: 'bold' }}>{header}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {table.slice(1).map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell key={j}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        output && (
          <Paper sx={{ p: 2, mb: 2, backgroundColor: '#f4f4f4' }}>
            <Typography fontWeight="bold">Raw Output:</Typography>
            <pre>{output}</pre>
          </Paper>
        )
      )}

      {command && output && (
        <Box sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleExplain} disabled={loading}>
            {loading ? <CircularProgress size={20} /> : "💡 Explain with AI"}
          </Button>
        </Box>
      )}

      {aiExplanation && (
        <Card sx={{ mt: 4, backgroundColor: '#f0f8ff', boxShadow: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              💡 AI Explanation
            </Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {aiExplanation}
            </Typography>
            <Box sx={{ textAlign: 'right', mt: 2 }}>
              <Button size="small" variant="outlined" onClick={handleCopy}>
                📋 Copy
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Snackbar
        open={toastOpen}
        autoHideDuration={2000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setToastOpen(false)}>
          Copied to clipboard ✅
        </Alert>
      </Snackbar>
    </Box>
  );
}
