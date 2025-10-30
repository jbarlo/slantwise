// src/logger.ts

import { isDebug } from './config';

// --- Internal Basic Loggers ---
export function logger(
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  opts?: { force?: boolean; func?: (val: string) => void }
): void {
  const debug = isDebug();
  if (!debug && level !== 'ERROR' && !opts?.force) return;

  const timestamp = new Date().toISOString();
  // Basic structured logging example (could use a library like pino/winston later)
  const func = opts?.func ?? console.log;
  func(JSON.stringify({ timestamp, level, message }));
}

function logInfoInternal(message: string): void {
  logger('INFO', message);
}

function logWarnInternal(message: string): void {
  logger('WARN', message);
}

function logErrorInternal(message: string, error?: unknown): void {
  const errorDetails =
    error instanceof Error ? { message: error.message, stack: error.stack } : { details: error };
  logger('ERROR', JSON.stringify({ message, error: errorDetails }));
}

// --- Formatting Helpers ---
export function formatHash(hash?: string): string {
  if (!hash || typeof hash !== 'string') return '[invalid hash]';
  return hash.substring(0, 8) + '...';
}

export function formatCacheKey(key?: string): string {
  if (!key || typeof key !== 'string') return '[invalid key]';
  return key.substring(0, 8) + '...';
}

// --- Specific Event Loggers ---

// -- File Processing (files.ts) --
export function logFileProcessingStart(
  operation: 'Create/Update' | 'Deletion',
  filePath: string
): void {
  logInfoInternal(`Processing ${operation} for: ${filePath}`);
}

export function logFileHashCalculated(filePath: string, hash: string): void {
  logInfoInternal(` -> File: ${filePath}, Hash: ${formatHash(hash)}`);
}

export function logFileEmpty(filePath: string): void {
  logWarnInternal(`File is empty, skipping: ${filePath}`);
}

export function logFileHashingError(filePath: string, error: unknown): void {
  logErrorInternal(`Error reading/hashing file ${filePath}`, error);
}

export function logFileDbProcessingSkipped(filePath: string): void {
  logWarnInternal(
    ` -> Hash calculation failed or empty file. Skipping DB operations for ${filePath}. Ensuring path is removed.`
  );
}

export function logFilePathRemoved(filePath: string): void {
  logInfoInternal(` -> Documents table updated: Removed path association for ${filePath}`);
}

export function logFilePathNotFound(filePath: string): void {
  logInfoInternal(` -> No path association found in documents table for ${filePath}.`);
}

export function logFilePathDeleteError(filePath: string, error: unknown): void {
  logErrorInternal(` -> Failed to delete document path ${filePath}`, error);
}

export function logFileProcessingError(filePath: string, error: unknown): void {
  logErrorInternal(`Error processing file ${filePath}`, error);
}

// -- DB Upsert/Delete (files.ts calls DAL) --
export function logDbUpsertSuccess(filePath: string, hash: string): void {
  logInfoInternal(` -> DB upsert success for path ${filePath} (hash: ${formatHash(hash)})`);
}

export function logDbUpsertError(filePath: string, error: unknown): void {
  logErrorInternal(` -> Failed DB upsert for path ${filePath}`, error);
}

// -- Embedding (files.ts) --
export function logEmbeddingCheckFound(hash: string): void {
  logInfoInternal(` -> Embedding found in cache for hash ${formatHash(hash)}.`);
}

export function logEmbeddingCheckNotFound(hash: string): void {
  logInfoInternal(` -> Embedding not found for hash ${formatHash(hash)}. Enqueuing generation.`);
}

export function logEmbeddingCheckError(hash: string, error: unknown): void {
  logErrorInternal(` -> Failed during embedding check for hash ${formatHash(hash)}`, error);
}

export function logEmbeddingRequestQueued(): void {
  // Optional: Maybe too verbose? Included for completeness.
  // logInfoInternal(` -> Enqueued embedding generation request for hash ${formatHash(hash)}.`);
}

export function logEmbeddingRequestSkipped(hash: string): void {
  logInfoInternal(` -> Generation skipped for hash ${formatHash(hash)} due to pending request.`);
}

export function logEmbeddingRequestError(hash: string, error: unknown): void {
  logErrorInternal(` -> Error during embedding request for hash ${formatHash(hash)}`, error);
}

export function logEmbeddingUpsertSuccess(hash: string, modelName: string): void {
  logInfoInternal(
    ` -> Embedding upsert success for hash ${formatHash(hash)} (model: ${modelName}).`
  );
}

export function logEmbeddingUsageLogSuccess(hash: string, tokens: number): void {
  logInfoInternal(` -> Usage logged for hash ${formatHash(hash)} (Tokens: ${tokens}).`);
}

export function logEmbeddingSaveError(hash: string, error: unknown): void {
  logErrorInternal(` -> Failed during embedding upsert/log for hash ${formatHash(hash)}`, error);
}

// -- DAL Operations (database.ts) --
export function logDalError(operation: string, context: string, error: unknown): void {
  logErrorInternal(`DAL Error ${operation} ${context}`, error);
}
export function logDalInitDbDirSuccess(dir: string): void {
  logInfoInternal(`DAL: Ensured database directory exists: ${dir}`);
}
export function logDalInitDbDirError(dir: string, error: unknown): void {
  logErrorInternal(`DAL: Error ensuring database directory ${dir} exists`, error);
}
export function logDalInitDbInfo(dbPath: string, exists: boolean): void {
  logInfoInternal(`DAL: Initializing database file at ${dbPath}... File exists: ${exists}`);
}
export function logDalSchemaApplyStart(schemaPath: string): void {
  logInfoInternal(`DAL: Applying schema from ${schemaPath}...`);
}
export function logDalSchemaApplySuccess(): void {
  logInfoInternal(`DAL: Schema applied successfully.`);
}
export function logDalSchemaApplyError(schemaPath: string, error: unknown): void {
  logErrorInternal(`DAL: Error applying database schema from ${schemaPath}`, error);
}
export function logDalPrepareStatementsStart(): void {
  logInfoInternal('DAL: Preparing database statements...');
}
export function logDalPrepareStatementsSuccess(): void {
  logInfoInternal('DAL: Database statements prepared.');
}
export function logDalGeneratedId(docId: string, hash: string): void {
  logInfoInternal(` -> DAL: Generated new doc_id ${docId} for hash ${formatHash(hash)}`);
}

// -- Derivation Engine (derivationEngine.ts) --
export function logDerivationDefineStart(derivationId: string): void {
  logInfoInternal(`Defining derivation: ${derivationId}`);
}
export function logDerivationDefineInvalidRecipe(derivationId: string): void {
  logWarnInternal(`Missing required fields in derivation recipe ID: ${derivationId}`);
}
export function logDerivationDefinePathNotIndexed(filePath: string, derivationId: string): void {
  logWarnInternal(`Input file path '${filePath}' not indexed for derivation '${derivationId}'.`);
}
export function logDerivationDefineSuccess(derivationId: string, docId: string): void {
  logInfoInternal(`Successfully defined derivation: ${derivationId} linked to doc_id: ${docId}`);
}
export function logDerivationDefineError(derivationId: string, error: unknown): void {
  logErrorInternal(`Error defining derivation ${derivationId}`, error);
}
export function logDerivationDefineDuplicateId(derivationId: string): void {
  logWarnInternal(`Attempted to redefine existing derivation ID '${derivationId}'.`);
}
export function logDerivationDefineFKError(derivationId: string): void {
  // Only logged if FK constraint was still present
  logErrorInternal(
    `Foreign key constraint failed during definition of derivation ${derivationId}. Input doc_id may be invalid.`
  );
}
export function logDerivationComputeStart(derivationId: string): void {
  logInfoInternal(`Computing derivation on read: ${derivationId}`);
}
export function logDerivationComputeNotFound(derivationId: string): void {
  logWarnInternal(`Derivation with ID '${derivationId}' not found during compute.`);
}
export function logDerivationComputeInputDocNotFound(docId: string, derivationId: string): void {
  logWarnInternal(`Input document (ID: ${docId}) not found for derivation ${derivationId}.`);
}
export function logDerivationComputeInputDocFound(
  docId: string,
  filePath: string,
  hash: string
): void {
  logInfoInternal(` -> Found input doc ${docId}: Path=${filePath}, Hash=${formatHash(hash)}`);
}
export function logDerivationComputeInputDocError(docId: string, error: unknown): void {
  logErrorInternal(`DB error getting details for doc_id ${docId}`, error);
}
export function logDerivationCacheHit(derivationId: string, cacheKey: string): void {
  logInfoInternal(
    ` -> Cache hit for derivation ${derivationId} (Key: ${formatCacheKey(cacheKey)})`
  );
}
export function logDerivationCacheMiss(derivationId: string, cacheKey: string): void {
  logInfoInternal(
    ` -> Cache miss for derivation ${derivationId} (Key: ${formatCacheKey(cacheKey)}). Computing...`
  );
}
export function logDerivationInputReadError(filePath: string, docId: string, error: unknown): void {
  logErrorInternal(`Error reading input file ${filePath} (for doc_id ${docId})`, error);
}
export function logDerivationInputReadStaleError(filePath: string, docId: string): void {
  logErrorInternal(
    `DB path ${filePath} for doc_id ${docId} does not exist on disk! Watcher potentially out of sync.`
  );
}
export function logDerivationInputTooLarge(
  derivationId: string,
  length: number,
  limit: number
): void {
  logWarnInternal(
    ` -> Input content size (${length} chars) exceeds limit (${limit} chars) for derivation ${derivationId}.`
  );
}
export function logDerivationOperationStart(derivationId: string, operation: string): void {
  logInfoInternal(` -> Executing ${operation} operation for derivation ${derivationId}...`);
}
export function logDerivationOperationError(
  derivationId: string,
  operation: string,
  error: unknown
): void {
  logErrorInternal(` -> ${operation} operation failed for ${derivationId}`, error);
}
export function logDerivationOperationSuccess(
  derivationId: string,
  operation: string,
  outputLength: number
): void {
  logInfoInternal(
    ` -> ${operation} operation successful for ${derivationId}. Output length: ${outputLength}`
  );
}

export function logDerivationCacheStoreSuccess(cacheKey: string): void {
  logInfoInternal(` -> Stored result in cache for derivation ${cacheKey}`);
}
export function logDerivationCacheStoreError(cacheKey: string, error: unknown): void {
  logErrorInternal(` -> Failed to store result in cache for derivation ${cacheKey}`, error);
}
export function logDerivationComputeUnexpectedError(cacheKey: string, error: unknown): void {
  logErrorInternal(`Unexpected error computing derivation ${cacheKey}`, error);
}

// -- Main Orchestration (main.ts) --
export function logMainStarting(): void {
  logInfoInternal('Starting Witchcraft Document Processor...');
}
export function logMainComponentsInitStart(): void {
  logInfoInternal('Initializing application components...');
}
export function logMainComponentsInitSuccess(): void {
  logInfoInternal('Application components initialized.');
}
export function logMainInitialScanStart(): void {
  logInfoInternal('Starting initial file system scan...');
}
export function logMainInitialScanDirEnsured(dir: string): void {
  logInfoInternal(`Ensured watched directory exists: ${dir}`);
}
export function logMainInitialScanDirError(dir: string, error: unknown): void {
  logErrorInternal(`Error creating watched directory ${dir}`, error);
}
export function logMainInitialScanSummary(fileCount: number, dbPathCount: number): void {
  logInfoInternal(`Scan found ${fileCount} files on disk and ${dbPathCount} unique paths in DB.`);
}
export function logMainInitialScanProcessingFiles(): void {
  logInfoInternal('Processing files currently on disk...');
}
export function logMainInitialScanProcessingDeletions(): void {
  logInfoInternal('Checking for deleted paths...');
}
export function logMainInitialScanFoundDeleted(filePath: string): void {
  logInfoInternal(` -> Found deleted path: ${filePath}`);
}
export function logMainInitialScanWaiting(count: number): void {
  logInfoInternal(`Waiting for ${count} initial processing tasks...`);
}
export function logMainInitialScanComplete(): void {
  logInfoInternal('Initial file system scan complete.');
}
export function logMainWatcherStarting(dir: string): void {
  logInfoInternal(`Starting watcher for directory: ${dir}`);
}
export function logMainWatcherError(error: unknown): void {
  logErrorInternal('Error watching files', error);
}
export function logMainWatcherEventError(type: string, filePath: string, error: unknown): void {
  logErrorInternal(`Error processing watcher event (${type}) for ${filePath}`, error);
}
export function logMainWatcherReady(): void {
  logInfoInternal('Watcher setup complete. Monitoring for changes...');
}
export function logMainCleanupStart(): void {
  logInfoInternal('\nInitiating graceful shutdown...');
}
export function logMainUnsubscribingWatcher(): void {
  logInfoInternal('Unsubscribing watcher...');
}
export function logMainUnsubscribeSuccess(): void {
  logInfoInternal('Watcher successfully unsubscribed.');
}
export function logMainUnsubscribeError(error: unknown): void {
  logErrorInternal('Error unsubscribing watcher', error);
}
export function logMainClosingDb(): void {
  logInfoInternal('Closing database connection...');
}
export function logMainCloseDbSuccess(): void {
  logInfoInternal('Database connection closed.');
}
export function logMainCloseDbError(error: unknown): void {
  logErrorInternal('Error closing database', error);
}
export function logMainSetupError(error: unknown): void {
  logErrorInternal('An critical error occurred during setup or watching', error);
}
export function logMainFinally(): void {
  logInfoInternal('Main function finally block reached.');
}
export function logMainFinallyDbCloseWarn(): void {
  logWarnInternal(
    "Closing database in main finally block (cleanup might have failed or didn't run)."
  );
}
export function logMainUnhandledError(error: unknown): void {
  logErrorInternal('Unhandled error escaping main try/catch', error);
}

// -- Embedding Processor (main.ts) --
export function logEmbeddingProcessorStart(hash: string, bytes: number): void {
  logInfoInternal(
    ` -> [Processor] Generating embedding for hash ${formatHash(hash)}... (${bytes} bytes)...`
  );
}
export function logEmbeddingProcessorSuccess(
  hash: string,
  vectorLength: number,
  tokens: number
): void {
  logInfoInternal(
    ` -> [Processor] Embedding generated for ${formatHash(
      hash
    )}... (vector length: ${vectorLength}, tokens: ${tokens}).`
  );
}
export function logEmbeddingProcessorError(hash: string, error: unknown): void {
  logErrorInternal(
    ` -> [Processor] Error generating embedding for hash ${formatHash(hash)}`,
    error
  );
}

// -- Main Directory Check (main.ts) --
export function logMainDirCheckFound(dirPath: string): void {
  logInfoInternal(`Watched directory found: ${dirPath}`);
}
export function logMainDirCheckErrorNotFound(dirPath: string): void {
  logErrorInternal(`Error: Watched directory does not exist: ${dirPath}`);
}
export function logMainDirCheckErrorAccess(dirPath: string, error: unknown): void {
  logErrorInternal(`Error accessing watched directory ${dirPath}`, error);
}

// -- Rate Limit Queue (rateLimitQueue.ts) --
export function logQueueVerbose(queueId: string, message: string, verbose: boolean): void {
  if (!verbose) return; // Check verbosity inside the logger
  logInfoInternal(`[Queue ${queueId}] DEBUG: ${message}`); // Added DEBUG prefix for clarity
}

export function logQueueInit(queueId: string, rpm: number, delay: number): void {
  logInfoInternal(
    `[Queue ${queueId}] Initialized with rate limit ${rpm}/min (delay: ${delay.toFixed(2)}ms).`
  );
}

export function logQueueTaskAdded(
  queueId: string,
  taskId: string,
  isDuplicate: boolean,
  queueSize: number
): void {
  logInfoInternal(
    `[Queue ${queueId}] Added task ${taskId}. Duplicate: ${isDuplicate}. Queue size: ${queueSize}`
  );
}

export function logQueueDuplicateTask(queueId: string, taskId: string): void {
  logWarnInternal(`[Queue ${queueId}] Task with ID ${taskId} is already pending or processing.`);
}

export function logQueueStartProcessingCycle(queueId: string): void {
  logInfoInternal(`[Queue ${queueId}] Processor was idle. Starting processing cycle.`);
}

export function logQueueProcessorAlreadyRunning(queueId: string): void {
  logInfoInternal(`[Queue ${queueId}] Processor is already running.`);
}

export function logQueueEmpty(queueId: string): void {
  logInfoInternal(`[Queue ${queueId}] Embedding queue empty. Processor pausing.`);
}

export function logQueueRateLimitInfo(
  queueId: string,
  available: number,
  limit: number,
  intervalMs: number
): void {
  logInfoInternal(
    `[Queue ${queueId}] Rate limit check: ${available} available of ${limit} per ${intervalMs}ms.`
  );
}

export function logQueueProcessingTask(queueId: string, taskId: string): void {
  logInfoInternal(`[Queue ${queueId}] Checking processing for task with ID: ${taskId}`);
}

export function logQueueTaskSuccess(queueId: string, taskId: string): void {
  logInfoInternal(`[Queue ${queueId}] Task completed successfully for ID: ${taskId}.`);
}

export function logQueueTaskError(queueId: string, taskId: string, error: unknown): void {
  logErrorInternal(`[Queue ${queueId}] Error processing task for ID: ${taskId}`, error);
}

export function logQueueTaskReleasing(queueId: string, taskId: string, wasSuccess: boolean): void {
  logInfoInternal(
    `[Queue ${queueId}] Releasing lock and notifying for task ${taskId}. Success: ${wasSuccess}`
  );
}

export function logQueueProcessorLoopError(queueId: string, error: unknown): void {
  logErrorInternal(`[Queue ${queueId}] Unexpected error in processor loop`, error);
}

export function logQueueShutdown(): void {
  logInfoInternal('[Queue] Shutdown requested. No new tasks will be processed.');
}

// -- Config Loading (config.ts) --
export function logConfigLoadingAttempt(filePath: string): void {
  logInfoInternal(`Attempting to load configuration from: ${filePath}`);
}

export function logConfigLoadSuccess(): void {
  logInfoInternal('Configuration loaded and validated successfully.');
}

export function logConfigValidationError(
  filePath: string,
  errors: { path: (string | number)[]; message: string }[]
): void {
  logErrorInternal(`Configuration file at ${filePath} is invalid:`);
  errors.forEach((err) => {
    logger(
      'ERROR',
      `- ${err.path.map((p) => p.toString()).join('.') || 'config'}: ${err.message}`,
      // Use console.error directly here as it's user-facing specific error
      // details
      { func: console.error }
    );
  });
  logInfoInternal('Please fix the errors in the configuration file.'); // Added info log for guidance
}

export function logConfigNotFound(filePath: string): void {
  logWarnInternal(`Configuration file not found at ${filePath}. Creating default.`);
}

export function logConfigDefaultCreated(filePath: string): void {
  logInfoInternal(`Default configuration file created at: ${filePath}`);
}

export function logConfigDefaultCreateError(error: unknown): void {
  logErrorInternal('Error creating default configuration file', error);
}

export function logConfigReadError(filePath: string, error: unknown): void {
  logErrorInternal(`Error reading configuration file ${filePath}`, error);
}

// Renamed and combined summary logs
export function logConfigSummary(dbPath: string, watchDir: string, rpmInfo: string): void {
  logInfoInternal(`Database path configured: ${dbPath}`);
  logInfoInternal(`Watched directory configured: ${watchDir}`);
  logInfoInternal(`Embedding RPM Limit configured: ${rpmInfo}`);
}
