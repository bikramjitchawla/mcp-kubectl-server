'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Choice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'diagnostics-theme';

/** Resolves "system" against the OS preference and stamps the result on <html>. */
function apply(choice: Choice) {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = resolved;
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>('system');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Choice | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') setChoice(stored);
  }, []);

  // While following the OS, keep up with changes to it.
  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [choice]);

  const pick = (next: Choice) => {
    setChoice(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const options: { value: Choice; label: string; icon: React.ReactNode }[] = [
    { value: 'system', label: 'Match system theme', icon: <Monitor size={14} /> },
    { value: 'light', label: 'Light theme', icon: <Sun size={14} /> },
    { value: 'dark', label: 'Dark theme', icon: <Moon size={14} /> },
  ];

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => pick(option.value)}
          aria-pressed={choice === option.value}
          aria-label={option.label}
          title={option.label}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
