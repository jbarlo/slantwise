import watcher from '@parcel/watcher';
import { BrowserWindow } from 'electron';
import type { AppDal } from '@core/db/app_dal.js';
import type { RateLimiter } from '@core/limiting';
import type { ConfigType } from '@config/types.js';
import { processFileCreationOrUpdate, removePathAssociation } from '@core/files.js';
import { getAllFilesRecursive, isDirectorySafe } from '@core/utils.js';

export type WatcherStatus = 'idle' | 'scanning' | 'watching' | 'error';

export interface WatcherStatusUpdate {
  status: WatcherStatus;
  message: string;
  fileCount?: number;
  error?: string;
}

// Store current status so renderer can request it on mount
let currentStatus: WatcherStatusUpdate = {
  status: 'idle',
  message: 'Initializing...'
};

export function getCurrentStatus(): WatcherStatusUpdate {
  return currentStatus;
}

export function sendStatusUpdate(update: WatcherStatusUpdate) {
  // Store the current status
  currentStatus = update;

  // Send to all windows
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach((window) => {
    window.webContents.send('watcher-status', update);
  });
}

export async function performInitialScan(
  watchedDirectory: string,
  appDal: AppDal,
  rateLimiter: RateLimiter,
  config: ConfigType
): Promise<void> {
  sendStatusUpdate({ status: 'scanning', message: 'Starting initial scan...' });

  try {
    const isDirectory = await isDirectorySafe(watchedDirectory);
    if (isDirectory === 'notDir') {
      const error = `Watched path exists but is not a directory: ${watchedDirectory}`;
      sendStatusUpdate({ status: 'error', message: 'Invalid directory', error });
      throw new Error(error);
    } else if (isDirectory === 'missing') {
      const error = `Watched directory must exist: ${watchedDirectory}`;
      sendStatusUpdate({ status: 'error', message: 'Directory not found', error });
      throw new Error(error);
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    sendStatusUpdate({ status: 'error', message: 'Directory access error', error: errorMsg });
    throw error;
  }

  const currentFiles = await getAllFilesRecursive(watchedDirectory);
  const dbFilePathsList: string[] = appDal.core.getAllDocumentPaths();
  const dbFilePaths = new Set(dbFilePathsList);
  const currentFilePaths = new Set(currentFiles);

  sendStatusUpdate({
    status: 'scanning',
    message: `Scanning ${currentFiles.length} files...`,
    fileCount: currentFiles.length
  });

  const processingPromises: Promise<void>[] = [];

  for (const filePath of currentFiles) {
    processingPromises.push(processFileCreationOrUpdate(filePath, appDal, rateLimiter, config));
  }

  for (const dbFilePath of dbFilePaths) {
    if (!currentFilePaths.has(dbFilePath)) {
      processingPromises.push(removePathAssociation(dbFilePath, appDal));
    }
  }

  await Promise.all(processingPromises);

  sendStatusUpdate({
    status: 'idle',
    message: `Indexed ${currentFiles.length} files`,
    fileCount: currentFiles.length
  });
}

export async function startFileWatcher(
  watchedDirectory: string,
  appDal: AppDal,
  rateLimiter: RateLimiter,
  config: ConfigType
): Promise<watcher.AsyncSubscription> {
  sendStatusUpdate({ status: 'watching', message: 'Watching for changes...' });

  const subscription = await watcher.subscribe(watchedDirectory, async (err, events) => {
    if (err) {
      sendStatusUpdate({
        status: 'error',
        message: 'Watcher error',
        error: err instanceof Error ? err.message : String(err)
      });
      return;
    }

    if (events.length > 0) {
      sendStatusUpdate({
        status: 'watching',
        message: `Processing ${events.length} change${events.length > 1 ? 's' : ''}...`
      });
    }

    const eventPromises = events.map(async (event) => {
      const absolutePath = event.path;
      try {
        if (event.type === 'create' || event.type === 'update') {
          await processFileCreationOrUpdate(absolutePath, appDal, rateLimiter, config);
        } else if (event.type === 'delete') {
          await removePathAssociation(absolutePath, appDal);
        }
      } catch (processingError) {
        console.error(`Error processing ${event.type} for ${absolutePath}:`, processingError);
      }
    });

    await Promise.all(eventPromises);

    // Return to watching state after processing
    sendStatusUpdate({ status: 'watching', message: 'Watching for changes...' });
  });

  return subscription;
}
