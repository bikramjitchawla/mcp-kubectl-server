'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

/** A shell command with a copy affordance — operators paste these into a terminal. */
export function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    navigator.clipboard
      ?.writeText(command)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div className="command-row">
      <code className="command">{command}</code>
      <button
        type="button"
        className="copy-button"
        data-copied={copied}
        onClick={copy}
        aria-label={copied ? 'Command copied' : 'Copy command'}
        title={copied ? 'Copied' : 'Copy command'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
