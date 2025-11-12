import path from 'path';
import Database from 'better-sqlite3';
import watcher from '@parcel/watcher';
import { AppDal, createAppDal } from './db/app_dal.js';
import { getConfig } from './config.js';
import type { ConfigType } from '@config/types.js';
import { processFileCreationOrUpdate, removePathAssociation } from './files.js';
import {
  logMainStarting,
  logMainComponentsInitStart,
  logMainComponentsInitSuccess,
  logMainInitialScanStart,
  logMainDirCheckFound,
  logMainDirCheckErrorNotFound,
  logMainDirCheckErrorAccess,
  logMainInitialScanSummary,
  logMainInitialScanProcessingFiles,
  logMainInitialScanProcessingDeletions,
  logMainInitialScanFoundDeleted,
  logMainInitialScanWaiting,
  logMainInitialScanComplete,
  logMainWatcherStarting,
  logMainWatcherError,
  logMainWatcherEventError,
  logMainWatcherReady,
  logMainCleanupStart,
  logMainUnsubscribingWatcher,
  logMainUnsubscribeSuccess,
  logMainUnsubscribeError,
  logMainClosingDb,
  logMainCloseDbSuccess,
  logMainCloseDbError,
  logMainSetupError,
  logMainFinally,
  logMainFinallyDbCloseWarn,
  logMainUnhandledError
} from './logger.js';
import { createRateLimiter, RateLimiter } from './limiting';
import { getAllFilesRecursive, isDirectorySafe } from './utils.js';

// --- Initialization Phase ---
interface AppComponents {
  config: ConfigType;
  db: Database.Database;
  appDal: AppDal;
  rateLimiter: RateLimiter;
}

async function initializeApp(): Promise<AppComponents> {
  logMainComponentsInitStart();
  const config = await getConfig();
  // Use createAppDal which handles initialization and DAL creation
  const appDal = await createAppDal(config.databasePath);
  // Get the underlying db instance if needed for direct operations like close
  // (Requires AppDal to expose it, or adjust cleanup logic)
  // For now, assume AppDal doesn't expose db directly, manage via AppDal instance?
  // Let's assume createAppDal can return the db instance separately if needed
  // OR modify AppDal to have a close method.
  // Simplest for now: Re-initialize db handle separately for cleanup? No, use AppDal's db.
  // We need the db instance for cleanup. Let's assume AppDal exposes it, or we pass it back.
  // Let's modify AppDal to expose db for cleanup purposes or add a close method.
  // **Decision**: Add a close method to AppDal later. For now, access its private db via type assertion for cleanup.

  const rateLimiter = await createRateLimiter(config);

  logMainComponentsInitSuccess();
  const dbInstance = appDal.db; // Access public db property directly
  return { config, db: dbInstance, appDal, rateLimiter };
}

// --- Initial Scan Phase ---
async function performInitialScan(
  watchedDirectory: string,
  appDal: AppDal,
  rateLimiter: RateLimiter,
  config: ConfigType
): Promise<void> {
  logMainInitialScanStart();
  try {
    const isDirectory = await isDirectorySafe(watchedDirectory);
    if (isDirectory === 'notDir') {
      throw new Error(`Watched path exists but is not a directory: ${watchedDirectory}`);
    } else if (isDirectory === 'missing') {
      logMainDirCheckErrorNotFound(watchedDirectory);
      throw new Error(`Watched directory must exist: ${watchedDirectory}`);
    }
    logMainDirCheckFound(watchedDirectory);
  } catch (error: unknown) {
    logMainDirCheckErrorAccess(watchedDirectory, error);
    throw error; // Re-throw other errors (e.g., permissions)
  }

  const currentFiles = await getAllFilesRecursive(watchedDirectory);
  const dbFilePathsList: string[] = appDal.core.getAllDocumentPaths();
  const dbFilePaths = new Set(dbFilePathsList);
  const currentFilePaths = new Set(currentFiles);

  logMainInitialScanSummary(currentFiles.length, dbFilePaths.size);

  const processingPromises: Promise<void>[] = [];

  logMainInitialScanProcessingFiles();
  for (const filePath of currentFiles) {
    processingPromises.push(processFileCreationOrUpdate(filePath, appDal, rateLimiter, config));
  }

  logMainInitialScanProcessingDeletions();
  for (const dbFilePath of dbFilePaths) {
    if (!currentFilePaths.has(dbFilePath)) {
      logMainInitialScanFoundDeleted(dbFilePath);
      processingPromises.push(removePathAssociation(dbFilePath, appDal));
    }
  }

  logMainInitialScanWaiting(processingPromises.length);
  await Promise.all(processingPromises);
  logMainInitialScanComplete();
}

// --- Watcher Phase ---
async function startFileWatcher(
  watchedDirectory: string,
  appDal: AppDal,
  rateLimiter: RateLimiter,
  config: ConfigType
): Promise<watcher.AsyncSubscription> {
  logMainWatcherStarting(watchedDirectory);
  const subscription = await watcher.subscribe(watchedDirectory, async (err, events) => {
    if (err) {
      logMainWatcherError(err);
      return;
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
        logMainWatcherEventError(event.type, absolutePath, processingError);
      }
    });
    await Promise.all(eventPromises);
  });
  logMainWatcherReady();
  return subscription;
}

// --- Main Orchestration ---
async function main() {
  logMainStarting();

  let components: AppComponents | null = null;
  let watcherSubscription: watcher.AsyncSubscription | null = null;

  const cleanup = async () => {
    logMainCleanupStart();
    if (watcherSubscription) {
      logMainUnsubscribingWatcher();
      try {
        await watcherSubscription.unsubscribe();
        logMainUnsubscribeSuccess();
      } catch (err) {
        logMainUnsubscribeError(err);
      }
      watcherSubscription = null;
    }
    if (components?.db) {
      logMainClosingDb();
      try {
        components.db.close();
        logMainCloseDbSuccess();
      } catch (err) {
        logMainCloseDbError(err);
      }
    }
    components = null;
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    components = await initializeApp();

    if (components.config.watchedDirectory) {
      const watchedDirectory = path.resolve(components.config.watchedDirectory);
      await performInitialScan(
        watchedDirectory,
        components.appDal,
        components.rateLimiter,
        components.config
      );
      watcherSubscription = await startFileWatcher(
        watchedDirectory,
        components.appDal,
        components.rateLimiter,
        components.config
      );
      await new Promise(() => {}); // Keep running
    } else {
      console.log('No watched directory configured. Running without file scanning/watching.');
      await new Promise(() => {}); // Keep running
    }
  } catch (error) {
    logMainSetupError(error);
    process.exitCode = 1;
    // Cleanup attempts to close db via components.db
    await cleanup();
  } finally {
    logMainFinally();
    // Check the db instance obtained during init
    if (components?.db?.open) {
      logMainFinallyDbCloseWarn();
      components.db.close();
    }
  }
}

main().catch((error) => {
  logMainUnhandledError(error);
  process.exitCode = 1;
});
