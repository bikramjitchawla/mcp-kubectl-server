// app/page.tsx
'use client';

import { useState } from "react";
import MCPForm from "@/components/MCPForm";
import MCPResult from "@/components/MCPResult";
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Container,
  Box
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";

export default function HomePage() {
  const [result, setResult] = useState<any>(null);

  return (
    <>
      {/* Top App Bar */}
      <AppBar position="static" sx={{ backgroundColor: "#1976d2" }}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            aria-label="menu"
            sx={{ mr: 2 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            variant="h6"
            component="div"
            sx={{ flexGrow: 1, fontWeight: "bold" }}
          >
            Kubernetes CLI Assistant
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: "bold", color: "#ffeb3b" }}
          >
            Natural Language Queries
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ mb: 6 }}>
          <Typography
            variant="h5"
            gutterBottom
            align="center"
            sx={{ fontWeight: "bold", color: "#424242" }}
          >
            Ask me anything about your cluster
          </Typography>
          <MCPForm onResult={setResult} />
        </Box>

        {/* Only show results after submission */}
        {result && (
          <Box>
            <Typography
              variant="h5"
              gutterBottom
              sx={{ fontWeight: "bold", color: "#424242", mb: 2 }}
            >
              Results
            </Typography>
            <MCPResult result={result} />
          </Box>
        )}
      </Container>
    </>
  );
}
