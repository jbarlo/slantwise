import { useContext, useEffect, useRef } from 'react';
import { ThemeProviderContext } from '../components/theme-provider';
import { trpc } from '../utils';

export function useTheme() {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  const utils = trpc.useUtils();

  const themeQuery = trpc.config.theme.get.useQuery(undefined, {
    // load once on mount
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });

  const themeMutation = trpc.config.theme.set.useMutation({
    onSuccess: () => {
      utils.config.theme.get.invalidate();
    }
  });

  const { setTheme: contextSetTheme } = context;

  const contextInitializedLatchRef = useRef(false);
  useEffect(() => {
    if (themeQuery.data && !contextInitializedLatchRef.current) {
      contextInitializedLatchRef.current = true;
      contextSetTheme(themeQuery.data);
    }
  }, [themeQuery.data, contextSetTheme]);

  const setTheme = (theme: typeof context.theme) => {
    context.setTheme(theme);
    themeMutation.mutate(theme);
  };

  return {
    theme: context.theme,
    resolvedTheme: context.resolvedTheme,
    setTheme
  };
}
