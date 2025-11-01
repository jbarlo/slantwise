import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import path from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import { appRouter } from '../../../shared/server';
import { registerTRPC } from './trpc-ipc';
import { getConfig } from '@core/config.js';
import type { ConfigType } from '@config/types.js';
import { createAppDal, AppDal } from '@core/db/app_dal.js';
import { createRateLimiter, RateLimiter } from '@core/limiting';
import { registerThemeListener } from './theme-listener';
import type { AsyncSubscription } from '@parcel/watcher';
import {
  performInitialScan,
  startFileWatcher,
  sendStatusUpdate,
  getCurrentStatus
} from './watcher';

// Global state for app context and watcher
let appContext: {
  appDal: AppDal;
  rateLimiter: RateLimiter;
  config: ConfigType;
} | null = null;

let watcherSubscription: AsyncSubscription | null = null;

// TODO move context creation to shared/server
async function createAppContext(): Promise<{
  appDal: AppDal;
  rateLimiter: RateLimiter;
  config: ConfigType;
}> {
  if (appContext) {
    return appContext;
  }

  const config = await getConfig();
  const appDal = await createAppDal(config.databasePath);
  const rateLimiter = await createRateLimiter(config);
  appContext = { appDal, rateLimiter, config };
  return appContext;
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  registerTRPC(appRouter, async () => await createAppContext());
  registerThemeListener(mainWindow);
}

// Initialize file watcher
async function initializeFileWatcher() {
  try {
    const context = await createAppContext();
    const watchedDirectory = path.resolve(context.config.watchedDirectory);

    await performInitialScan(
      watchedDirectory,
      context.appDal,
      context.rateLimiter,
      context.config
    );

    watcherSubscription = await startFileWatcher(
      watchedDirectory,
      context.appDal,
      context.rateLimiter,
      context.config
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Failed to initialize file watcher:', errorMessage);
    sendStatusUpdate({
      status: 'error',
      message: 'Failed to start file watcher',
      error: errorMessage
    });
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('dev.slantwise.slantwise');

  // Register IPC handler for watcher status
  ipcMain.handle('get-watcher-status', () => {
    return getCurrentStatus();
  });

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  // Initialize file watcher after window is created
  await initializeFileWatcher();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Cleanup function
async function cleanup() {
  if (watcherSubscription) {
    try {
      await watcherSubscription.unsubscribe();
      console.log('File watcher unsubscribed successfully');
    } catch (error) {
      console.error('Error unsubscribing file watcher:', error);
    }
    watcherSubscription = null;
  }

  if (appContext?.appDal?.db) {
    try {
      appContext.appDal.db.close();
      console.log('Database closed successfully');
    } catch (error) {
      console.error('Error closing database:', error);
    }
  }
  appContext = null;
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup before quitting
app.on('before-quit', async (event) => {
  if (watcherSubscription || appContext) {
    event.preventDefault();
    await cleanup();
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
