import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Snackbar,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TableChartIcon from '@mui/icons-material/TableChart';

function parseOutput(output: string): string[][] {
  if (!output) return [];
  return output.trim().split('\n').map(line =>
    line.trim().split(/\s{2,}|\t+/).filter(Boolean)
  );
}

export default function MCPResult({ result }: { result: any }) {
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [loadingExplain, setLoadingExplain] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);

  const res = result?.result?.result || result?.result || {};
  const command = res.command || res.kubectl_command || '';
  const output = res.output || '';
  const error = res.error || '';
  const table = parseOutput(output);

  const handleExplain = async () => {
    setLoadingExplain(true);
    setAiExplanation(null);
    try {
      const payload = {
        id: `uuid-${Math.random().toString(36).substring(2)}`,
        method: 'mcp.tool.call',
        params: {
          name: 'explain_kubectl_result',
          input: { kubectl_command: command, output },
        },
      };
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      const text = data?.result?.content?.[0]?.text ||
                   data?.result?.choices?.[0]?.message?.content ||
                   'No explanation returned.';
      setAiExplanation(text.trim());
    } catch {
      setAiExplanation('Failed to fetch AI explanation.');
    } finally {
      setLoadingExplain(false);
    }
  };

  const handleCopy = () => {
    if (aiExplanation) {
      navigator.clipboard.writeText(aiExplanation);
      setToastOpen(true);
    }
  };

  return (
    <Box display="flex" justifyContent="center" mt={4} px={2}>
      <Card sx={{ width: '100%', maxWidth: 700, boxShadow: 3, borderRadius: 2 }}>
        <CardContent>
          {command && (
            <Box mb={2}>
              <Typography variant="subtitle1" gutterBottom>
                Command:
              </Typography>
              <Box component="pre" sx={{ backgroundColor: '#f5f5f5', p: 1, borderRadius: 1 }}>
                {command}
              </Box>
            </Box>
          )}

          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : table.length > 1 ? (
            <TableContainer sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {table[0].map((h, i) => (
                      <TableCell key={i} sx={{ fontWeight: 'bold' }}>
                        {h}
                      </TableCell>
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
          ) : output ? (
            <Box component="pre" sx={{ backgroundColor: '#f5f5f5', p: 1, borderRadius: 1, mb: 2 }}>
              {output}
            </Box>
          ) : (
            <Typography>No output returned.</Typography>
          )}
        </CardContent>

        <CardActions sx={{ justifyContent: 'flex-end', px: 2, pb: 2 }}>
          {command && output && (
            <Button
              startIcon={<TableChartIcon />}
              onClick={handleExplain}
              disabled={loadingExplain}
            >
              {loadingExplain ? <CircularProgress size={20} /> : 'Explain'}
            </Button>
          )}
          {aiExplanation && (
            <Button startIcon={<ContentCopyIcon />} onClick={handleCopy}>
              Copy Explanation
            </Button>
          )}
        </CardActions>
      </Card>

      {aiExplanation && (
        <Card sx={{ width: '100%', maxWidth: 700, boxShadow: 3, borderRadius: 2, mt: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" gutterBottom>
              AI Explanation:
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {aiExplanation}
            </Typography>
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