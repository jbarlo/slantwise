import fs from 'fs/promises';
import path from 'path';
import Database from 'libsql';
import { ContentService } from './contentService.js';
import { DerivationsService } from './derivationsService.js';
// Import loggers for initialization
import {
  logDalInitDbDirSuccess,
  logDalInitDbDirError,
  logDalInitDbInfo,
  logDalSchemaApplyStart,
  logDalSchemaApplySuccess,
  logDalSchemaApplyError
} from '../logger.js';
import { DependencyTree, OperationWarning, StepParams } from './types.js';
// Import SQL schemas as raw strings
import coreSchemaContent from './schema.sql?raw';
import derivationsSchemaContent from './derivations_schema.sql?raw';

// --- Database Initialization (Handles Multiple Schemas) ---
async function createDatabase(dbPath: string): Promise<Database.Database> {
  const absoluteDbPath = path.resolve(dbPath);
  const dbDirectory = path.dirname(absoluteDbPath);

  // Ensure directory exists
  try {
    await fs.mkdir(dbDirectory, { recursive: true });
    logDalInitDbDirSuccess(dbDirectory);
  } catch (error) {
    logDalInitDbDirError(dbDirectory, error);
    throw error;
  }

  const dbFileExists = await fs
    .access(absoluteDbPath)
    .then(() => true)
    .catch(() => false);
  logDalInitDbInfo(absoluteDbPath, dbFileExists);

  const db = new Database(absoluteDbPath /*, { verbose: (val:string) => logger('VERBOSE', val) }*/);

  return db;
}

async function initializeDatabase(db: Database.Database): Promise<Database.Database> {
  // Apply schemas sequentially
  const schemas = [
    { name: 'core schema', content: coreSchemaContent },
    { name: 'derivations schema', content: derivationsSchemaContent }
  ];

  try {
    for (const schema of schemas) {
      logDalSchemaApplyStart(schema.name);
      db.exec(schema.content);
      logDalSchemaApplySuccess();
    }
  } catch (error: unknown) {
    logDalSchemaApplyError('Unknown Schema', error);
    db.close();
    throw error;
  }

  return db;
}

// --- Application DAL Facade ---

/**
 * Provides a unified interface to different database access modules (Core, Derivations).
 * Manages the underlying database connection and transactions.
 */
export class AppDal {
  public db: Database.Database;

  public core: ContentService;
  public derivations: DerivationsService;

  constructor(db: Database.Database) {
    this.db = db;

    // Instantiate specific DALs
    this.core = new ContentService(this.db);
    this.derivations = new DerivationsService(this.db);
  }

  /**
   * Executes a callback function within a database transaction.
   * Provides the necessary DAL instances to the callback.
   * Handles commit/rollback automatically.
   *
   * @param callback Function to execute within the transaction. Receives DAL instances.
   */
  executeTransaction<T>(
    callback: (dals: {
      core: ContentService;
      derivations: DerivationsService;
      upsertDocumentAndPathInTransaction: (
        absolutePath: string,
        contentHash: string,
        content: string
      ) => string;
      saveComputedDerivationInTransaction: (
        finalStepIdToSave: string,
        stepParams: StepParams,
        outputContentHash: string,
        outputContent: string,
        resolvedPinnedInputHashesJson: Record<string, { type: 'content'; hash: string }>,
        inputContentHashes: string[],
        dependencyTree: DependencyTree,
        warnings: OperationWarning[]
      ) => void;
    }) => T
  ): T {
    const transaction = this.db.transaction(() => {
      return callback({
        core: this.core,
        derivations: this.derivations,
        upsertDocumentAndPathInTransaction: (...params) =>
          this.upsertDocumentAndPathInTransaction(...params, this.core),
        saveComputedDerivationInTransaction: (...params) =>
          this.saveComputedDerivationInTransaction(...params, this.core, this.derivations)
      });
    });
    // Typesafe Transaction execution - ensures return type T
    const runTransaction = transaction as (...args: unknown[]) => T;
    return runTransaction();
  }

  upsertDocumentAndPathInTransaction(
    absolutePath: string,
    contentHash: string,
    content: string,
    core: ContentService
  ): string /* Returns docId */ {
    return core.upsertDocumentAndPathTransactionInner(absolutePath, contentHash, content);
  }
  /**
   * Convenience method to handle the common pattern of upserting document/path info.
   * Executes the necessary CoreDal method within a transaction.
   */
  upsertDocumentAndPath(
    absolutePath: string,
    contentHash: string,
    content: string
  ): string /* Returns docId */ {
    return this.executeTransaction(({ core }) => {
      return this.upsertDocumentAndPathInTransaction(absolutePath, contentHash, content, core);
    });
  }

  saveComputedDerivationInTransaction(
    finalStepIdToSave: string,
    stepParams: StepParams,
    outputContentHash: string,
    outputContent: string,
    resolvedPinnedInputHashesJson: Record<string, { type: 'content'; hash: string }>,
    inputContentHashes: string[],
    dependencyTree: DependencyTree,
    warnings: OperationWarning[],
    core: ContentService,
    derivations: DerivationsService
  ): void {
    core.insertContentIfNew(outputContentHash, outputContent);
    derivations.saveComputedResultInner(
      finalStepIdToSave,
      stepParams,
      outputContentHash,
      resolvedPinnedInputHashesJson,
      inputContentHashes,
      dependencyTree,
      warnings
    );
  }

  /**
   * Convenience method to save computed derivation output atomically.
   * Stores content in content_cache and result mapping in step_results.
   */
  saveComputedDerivation(
    finalStepIdToSave: string,
    stepParams: StepParams,
    outputContentHash: string,
    outputContent: string,
    resolvedPinnedInputHashesJson: Record<string, { type: 'content'; hash: string }>,
    inputContentHashes: string[],
    dependencyTree: DependencyTree,
    warnings: OperationWarning[]
  ): void {
    this.executeTransaction(({ core, derivations }) => {
      this.saveComputedDerivationInTransaction(
        finalStepIdToSave,
        stepParams,
        outputContentHash,
        outputContent,
        resolvedPinnedInputHashesJson,
        inputContentHashes,
        dependencyTree,
        warnings,
        core,
        derivations
      );
    });
  }

  // Add other cross-domain convenience methods if needed
}

/**
 * Initializes the database and creates the AppDal instance.
 * This is the main entry point for obtaining the DAL.
 */
export async function createAppDal(dbPath: string): Promise<AppDal> {
  const db = await initializeDatabase(await createDatabase(dbPath));
  return new AppDal(db);
}

const createMockDatabase = (): Database.Database => {
  const db = new Database(':memory:');
  return db;
};

export async function createMockAppDal(): Promise<AppDal> {
  const db = await initializeDatabase(createMockDatabase());
  return new AppDal(db);
}
