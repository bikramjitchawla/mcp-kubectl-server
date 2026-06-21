import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kubernetes Diagnostic MCP',
  description: 'Read-only Kubernetes incident diagnostics for platform teams.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
