interface WatcherStatusUpdate {
  status: 'idle' | 'scanning' | 'watching' | 'error';
  message: string;
  fileCount?: number;
  error?: string;
}

declare global {
  interface Window {
    api: {
      invokeTrpc: (path: string, input: unknown) => Promise<unknown>;
      system: {
        onThemeChange: (callback: (isDark: boolean) => void) => () => void;
        getWatcherStatus: () => Promise<WatcherStatusUpdate>;
        onWatcherStatusChange: (callback: (status: WatcherStatusUpdate) => void) => () => void;
      };
    };
  }
}

export {};
