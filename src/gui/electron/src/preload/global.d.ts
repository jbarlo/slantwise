declare global {
  interface Window {
    api: {
      invokeTrpc: (path: string, input: unknown) => Promise<unknown>;
      system: {
        onThemeChange: (callback: (isDark: boolean) => void) => () => void;
      };
    };
  }
}

export {};
