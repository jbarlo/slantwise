import { contextBridge, ipcRenderer } from 'electron';

const THEME_CHANGED_IPC_EVENT = 'theme-changed';

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
      }
    }
  });
} catch (error) {
  console.error(error);
}
