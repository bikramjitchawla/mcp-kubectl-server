import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActions,
  TextField,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Stack,
  Divider,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';

export default function MCPForm({ onResult }: { onResult: (result: any) => void }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!query.trim()) {
      setError('Please enter a valid query.');
      return;
    }

    setLoading(true);
    try {
      const body = {
        id: `uuid-${Math.random().toString(36).substr(2, 9)}`,
        method: 'mcp.tool.call',
        params: {
          name: 'naturalLanguageKubectl',
          input: { query },
        },
      };

      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Network response was not ok');
      }

      const result = await res.json();
      onResult(result);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setQuery('');
    setError(null);
  };

  return (
    <Box display="flex" justifyContent="center" alignItems="center" mt={4} px={2}>
      <Card sx={{ width: '100%', maxWidth: 600, boxShadow: 3, borderRadius: 2 }}>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <Typography variant="h5" gutterBottom align="center">
              Kubernetes Natural Language CLI
            </Typography>
            <Divider sx={{ my: 2 }} />

            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}

              <TextField
                label="Your Kubernetes question"
                placeholder="e.g., List all pods in the default namespace"
                multiline
                minRows={3}
                fullWidth
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={loading}
                variant="outlined"
                required
              />
            </Stack>
          </CardContent>

          <CardActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
            <Button
              startIcon={<RefreshIcon />}
              onClick={handleReset}
              disabled={loading && !query.trim()}
            >
              Clear
            </Button>

            <Button
              variant="contained"
              endIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
              type="submit"
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Submit'}
            </Button>
          </CardActions>
        </form>
      </Card>
    </Box>
  );
}
