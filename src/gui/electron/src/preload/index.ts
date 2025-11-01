import { contextBridge, ipcRenderer } from 'electron';

const THEME_CHANGED_IPC_EVENT = 'theme-changed';
const WATCHER_STATUS_IPC_EVENT = 'watcher-status';

export interface WatcherStatusUpdate {
  status: 'idle' | 'scanning' | 'watching' | 'error';
  message: string;
  fileCount?: number;
  error?: string;
}

if (!process.contextIsolated) {
  throw new Error(
    'Context isolation is disabled — preload refuses to expose bridge for security reasons.'
  );
}

try {
  contextBridge.exposeInMainWorld('api', {
    invokeTrpc: (path: string, input: unknown) => ipcRenderer.invoke('trpc', path, input),
    system: {
      onThemeChange: (callback: (isDark: boolean) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, isDark: boolean) => callback(isDark);
        ipcRenderer.on(THEME_CHANGED_IPC_EVENT, listener);
        return () => {
          ipcRenderer.removeListener(THEME_CHANGED_IPC_EVENT, listener);
        };
      },
      getWatcherStatus: () => ipcRenderer.invoke('get-watcher-status') as Promise<WatcherStatusUpdate>,
      onWatcherStatusChange: (callback: (status: WatcherStatusUpdate) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, status: WatcherStatusUpdate) =>
          callback(status);
        ipcRenderer.on(WATCHER_STATUS_IPC_EVENT, listener);
        return () => {
          ipcRenderer.removeListener(WATCHER_STATUS_IPC_EVENT, listener);
        };
      }
    }
  });
} catch (error) {
  console.error(error);
}
