import { createContext, useEffect, useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import type { Theme } from '@config/types.js';
import type { SystemThemeDetector } from '../lib/theme/types';

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
  resolvedTheme: 'dark'
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

type ThemeProviderProps = {
  children: React.ReactNode;
  storageKey: string;
  defaultTheme: Theme;
  detector: SystemThemeDetector;
};

export function ThemeProvider({
  children,
  storageKey,
  defaultTheme,
  detector
}: ThemeProviderProps) {
  const [theme, setThemeLocalStorage] = useLocalStorage<Theme>(storageKey, defaultTheme);

  // Determine the resolved theme (actual light or dark value)
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  });

  useEffect(() => {
    if (theme !== 'system') return () => {};

    const cleanup = detector.subscribe((isDark) => {
      const newTheme = isDark ? 'dark' : 'light';
      setResolvedTheme(newTheme);
    });

    return cleanup;
  }, [theme, detector]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = (newTheme: Theme) => {
    if (newTheme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      setResolvedTheme(systemTheme);
    } else {
      setResolvedTheme(newTheme);
    }
    setThemeLocalStorage(newTheme);
  };

  const value = { theme, setTheme, resolvedTheme };

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}
