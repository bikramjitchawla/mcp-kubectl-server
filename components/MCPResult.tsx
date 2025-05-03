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
    line
      .trim()
      .split(/\s{2,}/) // split by 2+ spaces
      .filter(Boolean)
  );
}

// ✨ Function to bold Kubernetes keywords
function formatAIText(text: string) {
  if (!text) return '';

  const keywords = ['Pod', 'Deployment', 'Namespace', 'Service', 'Node', 'PersistentVolume', 'PersistentVolumeClaim', 'Ingress', 'ReplicaSet'];

  let formatted = text;
  for (const word of keywords) {
    const regex = new RegExp(`\\b(${word})\\b`, 'g');
    formatted = formatted.replace(regex, '**$1**');
  }
  return formatted;
}

export default function MCPResult({ result }: { result: any }) {
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);

  if (!result) {
    return (
      <Box sx={{ mt: 4 }}>
        <Typography variant="body1">No result yet.</Typography>
      </Box>
    );
  }

  const res = result?.result;
  const command = res?.kubectl_command || result?.kubectl_command;
  const output = res?.output || result?.output;

  const tableData = parseOutput(output);
  const headers = tableData[0] || [];
  const rows = tableData.slice(1);

  async function handleExplain() {
    if (!command || !output) return;

    setLoading(true);

    try {
      const explainBody = {
        id: 'uuid-' + Math.random().toString(36).substr(2, 9),
        method: 'mcp.tool.call',
        params: {
          name: 'explain_kubectl_result',
          input: {
            kubectl_command: command,
            output: output,
          },
        },
      };

      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(explainBody),
      });

      const data = await res.json();
      console.log('📦 Full API response:', data);

      const explanation =
        data?.result?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.message?.content ||
        data?.result?.content?.[0]?.text ||
        null;

      console.log('💬 Extracted explanation:', explanation);

      if (explanation) {
        setAiResponse(explanation.trim());
      } else {
        setAiResponse('❌ No explanation returned.');
      }
    } catch (err) {
      console.error('❌ Failed to fetch AI explanation:', err);
      setAiResponse('❌ Failed to fetch AI explanation.');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (aiResponse) {
      navigator.clipboard.writeText(aiResponse);
      setToastOpen(true);
    }
  }

  return (
    <Box sx={{ mt: 4 }}>
      {command && (
        <>
          <Typography variant="h6" gutterBottom>
            Command:
          </Typography>
          <Paper sx={{ p: 2, mb: 3, backgroundColor: '#f5f5f5' }}>
            <code>{command}</code>
          </Paper>
        </>
      )}

      {rows.length > 0 ? (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                {headers.map((header, i) => (
                  <TableCell key={i} sx={{ fontWeight: 'bold' }}>
                    {header}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, rIdx) => (
                <TableRow key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <TableCell key={cIdx}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : output ? (
        <Paper sx={{ p: 2, backgroundColor: '#f5f5f5' }}>
          <Typography variant="body2" fontWeight="bold">
            Raw Output:
          </Typography>
          <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
            {output}
          </pre>
        </Paper>
      ) : (
        <Paper sx={{ p: 2, backgroundColor: '#f5f5f5' }}>
          <Typography>No output returned from the tool.</Typography>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </Paper>
      )}

      {command && output && (
        <Box sx={{ mt: 4 }}>
          <Button variant="contained" onClick={handleExplain} disabled={loading}>
            {loading ? <CircularProgress size={20} /> : 'Explain with AI'}
          </Button>
        </Box>
      )}

      {aiResponse && (
        <Card
          sx={{
            mt: 4,
            p: 3,
            backgroundColor: '#f0f8ff',
            boxShadow: 3,
            maxHeight: 500,
            overflowY: 'auto',
          }}
        >
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
              💡 <span style={{ marginLeft: '8px' }}>AI Insight</span>
            </Typography>

            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                lineHeight: 1.7,
                fontSize: '1rem',
                color: '#333',
                mt: 2,
              }}
              dangerouslySetInnerHTML={{ __html: formatAIText(aiResponse).replace(/\n/g, '<br/>') }}
            />

            <Box sx={{ mt: 2, textAlign: 'right' }}>
              <Button
                size="small"
                variant="outlined"
                onClick={handleCopy}
              >
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