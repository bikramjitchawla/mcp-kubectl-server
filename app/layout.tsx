import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kubernetes Diagnostic MCP',
  description: 'Read-only Kubernetes incident diagnostics for platform teams.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#17171d' },
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
  ],
};

// Runs before first paint so the stored theme never flashes the wrong palette.
const themeScript = `(function(){try{var c=localStorage.getItem('diagnostics-theme')||'system';var d=c==='dark'||(c!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
