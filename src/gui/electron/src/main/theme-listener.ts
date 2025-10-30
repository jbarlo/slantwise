import { BrowserWindow, nativeTheme } from 'electron';

const THEME_CHANGED_IPC_EVENT = 'theme-changed';

// Listen for native theme changes and notify renderer
export function registerThemeListener(mainWindow: BrowserWindow) {
  nativeTheme.on('updated', () => {
    mainWindow.webContents.send(THEME_CHANGED_IPC_EVENT, nativeTheme.shouldUseDarkColors);
  });
}
