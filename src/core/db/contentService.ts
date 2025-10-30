import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  logDalError,
  logDalPrepareStatementsStart,
  logDalPrepareStatementsSuccess,
  logDalGeneratedId,
  formatHash
} from '../logger.js';

// Interface for Core Prepared Statements
export interface CorePreparedStatements {
  // Content Cache Operations
  insertContentIfNewStmt: Database.Statement;
  findContentStmt: Database.Statement;

  // Document Operations
  upsertDocStmt: Database.Statement;
  findDocIdByHashStmt: Database.Statement;
  findDocIdByPathStmt: Database.Statement;
  findHashByDocIdStmt: Database.Statement;

  // Document Path Operations
  insertPathStmt: Database.Statement;
  deletePathStmt: Database.Statement;
  getAllPathsStmt: Database.Statement;

  // Embedding Operations
  findEmbeddingStmt: Database.Statement;
  upsertEmbeddingStmt: Database.Statement;
  insertUsageLogStmt: Database.Statement;
  getAllDocumentsWithEmbeddingsStmt: Database.Statement;
  getAllDerivedStepWithEmbeddingsStmt: Database.Statement;
  getAllTokenCountsStmt: Database.Statement;
}

// --- Core Statement Preparation ---
// Moved here from database.ts / app_dal.ts for encapsulation
function prepareCoreStatements(db: Database.Database): CorePreparedStatements {
  logDalPrepareStatementsStart();
  const statements: CorePreparedStatements = {
    // Content Cache Operations
    insertContentIfNewStmt: db.prepare(
      'INSERT OR IGNORE INTO content_cache (content_hash, content) VALUES (?, ?)'
    ),
    findContentStmt: db.prepare('SELECT content FROM content_cache WHERE content_hash = ?'),

    // Document Operations
    upsertDocStmt: db.prepare(
      'INSERT OR REPLACE INTO documents (doc_id, content_hash) VALUES (?, ?)'
    ),
    findDocIdByHashStmt: db.prepare('SELECT doc_id FROM documents WHERE content_hash = ? LIMIT 1'),
    findDocIdByPathStmt: db.prepare(`
      SELECT d.doc_id 
      FROM documents d
      JOIN document_paths dp ON d.doc_id = dp.doc_id
      WHERE dp.absolute_path = ?
      LIMIT 1
    `),
    findHashByDocIdStmt: db.prepare('SELECT content_hash FROM documents WHERE doc_id = ? LIMIT 1'),

    // Document Path Operations
    insertPathStmt: db.prepare(
      'INSERT OR IGNORE INTO document_paths (doc_id, absolute_path) VALUES (?, ?)'
    ),
    deletePathStmt: db.prepare('DELETE FROM document_paths WHERE absolute_path = ?'),
    getAllPathsStmt: db.prepare('SELECT absolute_path FROM document_paths'),

    // Embedding Operations
    findEmbeddingStmt: db.prepare('SELECT embedding FROM hash_embeddings WHERE content_hash = ?'),
    upsertEmbeddingStmt: db.prepare(
      'INSERT OR IGNORE INTO hash_embeddings (content_hash, embedding, model_name) VALUES (?, ?, ?)'
    ),
    insertUsageLogStmt: db.prepare(
      `INSERT INTO embedding_usage_log (content_hash, model_name, prompt_tokens)
             VALUES (?, ?, ?)`
    ),
    getAllDocumentsWithEmbeddingsStmt: db.prepare(`
      SELECT
        dp.absolute_path,
        he.embedding
      FROM
        hash_embeddings he
      JOIN
        documents d ON he.content_hash = d.content_hash
      JOIN
        document_paths dp ON d.doc_id = dp.doc_id
    `),
    getAllDerivedStepWithEmbeddingsStmt: db.prepare(`
      SELECT
        'derived:' || srl.step_id AS id,
        he.embedding
      FROM
        step_result_links srl
      JOIN
        step_results sr ON sr.cache_key = srl.cache_key
      JOIN
        hash_embeddings he ON he.content_hash = sr.output_content_hash
    `),
    getAllTokenCountsStmt: db.prepare('SELECT prompt_tokens FROM embedding_usage_log')

    // Derivation statements removed - belong in DerivationsDal
  };
  logDalPrepareStatementsSuccess();
  return statements;
}

/**
 * Encapsulates direct database interactions for core content tables.
 * (content_cache, documents, document_paths, hash_embeddings, embedding_usage_log)
 */
export class ContentService {
  // Keep db private - transactions managed by AppDal
  private db: Database.Database;
  private statements: CorePreparedStatements;

  // Constructor now takes prepared statements
  constructor(db: Database.Database) {
    this.db = db;
    this.statements = prepareCoreStatements(this.db);
  }

  // --- Content Cache Operations ---

  /** Caches the content associated with a hash. Ignores if hash already exists. */
  insertContentIfNew(contentHash: string, content: string): void {
    try {
      this.statements.insertContentIfNewStmt.run(contentHash, content);
    } catch (error) {
      logDalError('upsertContent', `hash: ${formatHash(contentHash)}`, error);
      throw error;
    }
  }

  /** Finds content by its hash. */
  findContentByHash(contentHash: string): string | undefined {
    try {
      const row = this.statements.findContentStmt.get(contentHash) as
        | { content: string }
        | undefined;
      return row?.content;
    } catch (error) {
      logDalError('findContentByHash', `hash: ${formatHash(contentHash)}`, error);
      throw error;
    }
  }

  // --- Document & Path Operations ---

  /** Finds an existing doc_id associated with a content hash. */
  findDocIdByHash(hash: string): string | undefined {
    try {
      const row = this.statements.findDocIdByHashStmt.get(hash) as { doc_id: string } | undefined;
      return row?.doc_id;
    } catch (error) {
      logDalError('findDocIdByHash', `hash: ${formatHash(hash)}`, error);
      throw error;
    }
  }

  /** Finds a document ID by its absolute path. */
  findDocIdByPath(absolutePath: string): string | undefined {
    try {
      const row = this.statements.findDocIdByPathStmt.get(absolutePath) as
        | { doc_id: string }
        | undefined;
      return row?.doc_id;
    } catch (error) {
      logDalError('findDocIdByPath', `path: ${absolutePath}`, error);
      throw error;
    }
  }

  /**
   * Ensures a document exists for the content hash and associates it with the absolute path.
   * Caches the content itself.
   * Uses INSERT OR IGNORE for path insertion based on UNIQUE (doc_id, absolute_path).
   * Requires external transaction for atomicity between content/doc/path insert.
   * !! IMPORTANT: This method is NOT ATOMIC by itself. Use within AppDal.executeTransaction !!
   */
  upsertDocumentAndPathTransactionInner(
    absolutePath: string,
    contentHash: string,
    content: string
  ): string /* Returns docId */ {
    let docId: string | undefined;
    let operation: string = 'start'; // Track action for logging

    try {
      // 1. Cache the content (INSERT OR IGNORE)
      operation = 'upsertContent';
      // Note: No try/catch here, transaction will handle rollback
      this.statements.insertContentIfNewStmt.run(contentHash, content);

      // 2. Find or create the document record
      operation = 'findDocIdByPath';
      docId = this.findDocIdByPath(absolutePath); // Reuse public method

      if (!docId) {
        docId = uuidv4();
        logDalGeneratedId(docId, contentHash);
      } else {
        operation = `foundDocId(${docId})`;
      }

      // Note: No try/catch here, transaction will handle rollback
      operation = `upsertDocument(${docId})`;
      this.statements.upsertDocStmt.run(docId, contentHash);

      // 3. Always INSERT OR IGNORE the path association.
      operation = `insertPath(${docId}, ${absolutePath})`;
      // Note: No try/catch here, transaction will handle rollback
      this.statements.insertPathStmt.run(docId, absolutePath);

      return docId; // Return the determined docId
    } catch (error) {
      // Log context from within the operation attempt
      const context = `path: ${absolutePath}, hash: ${formatHash(contentHash)}${
        docId ? ', docId: ' + docId : ''
      }, lastOp: ${operation}`;
      logDalError('upsertDocumentAndPathTransactionInner', context, error);
      // Re-throw to trigger transaction rollback
      throw error;
    }
  }

  /** Deletes a specific document path association. Returns the number of rows changed. */
  deleteDocumentPath(absolutePath: string): number {
    try {
      const result = this.statements.deletePathStmt.run(absolutePath);
      return result.changes;
    } catch (error) {
      logDalError('deleteDocumentPath', `path: ${absolutePath}`, error);
      throw error;
    }
  }

  /** Gets all unique document paths currently stored. */
  getAllDocumentPaths(): string[] {
    try {
      const rows = this.statements.getAllPathsStmt.all() as {
        absolute_path: string;
      }[];
      return rows.map((row) => row.absolute_path);
    } catch (error) {
      logDalError('getAllDocumentPaths', '', error);
      throw error;
    }
  }

  // --- Embedding Operations ---

  /** Finds an existing embedding for a content hash. */
  findEmbedding(hash: string): { embedding: string } | undefined {
    try {
      return this.statements.findEmbeddingStmt.get(hash) as { embedding: string } | undefined;
    } catch (error) {
      logDalError('findEmbedding', `hash: ${formatHash(hash)}`, error);
      throw error;
    }
  }

  /** Inserts or ignores an embedding for a content hash. */
  upsertEmbedding(hash: string, embedding: string, modelName: string): void {
    try {
      this.statements.upsertEmbeddingStmt.run(hash, embedding, modelName);
    } catch (error) {
      logDalError('upsertEmbedding', `hash: ${formatHash(hash)}`, error);
      throw error;
    }
  }

  /** Inserts a record into the embedding usage log. */
  insertUsageLog(hash: string, modelName: string, promptTokens: number): void {
    try {
      this.statements.insertUsageLogStmt.run(hash, modelName, promptTokens);
    } catch (error) {
      logDalError('insertUsageLog', `hash: ${formatHash(hash)}, model: ${modelName}`, error);
      throw error;
    }
  }

  /** Gets all documents with their embeddings. */
  getAllDocumentsWithEmbeddings(): (
    | {
        type: 'document';
        absolute_path: string;
        embedding: string;
      }
    | {
        type: 'derived';
        id: string;
        embedding: string;
      }
  )[] {
    try {
      const regularDocs = this.statements.getAllDocumentsWithEmbeddingsStmt.all() as {
        absolute_path: string;
        embedding: string;
      }[];
      // FIXME: how this function is used, this should actually return only the
      // documents with embeddings belonging to the derivation instead of
      // including orphaned embeddings
      const derivedDocs = this.statements.getAllDerivedStepWithEmbeddingsStmt.all() as {
        id: string;
        embedding: string;
      }[];

      return [
        ...regularDocs.map((doc) => ({
          type: 'document' as const,
          absolute_path: doc.absolute_path,
          embedding: doc.embedding
        })),
        ...derivedDocs.map((d) => ({
          type: 'derived' as const,
          id: d.id,
          embedding: d.embedding
        }))
      ];
    } catch (error) {
      logDalError('getAllDocumentsWithEmbeddings', '', error);
      throw error;
    }
  }

  /** Gets all token counts from the usage log. */
  getAllTokenCounts(): { prompt_tokens: number }[] {
    try {
      return this.statements.getAllTokenCountsStmt.all() as {
        prompt_tokens: number;
      }[];
    } catch (error) {
      logDalError('getAllTokenCounts', '', error);
      throw error;
    }
  }

  /** Finds a content hash by its document ID. */
  findHashByDocId(docId: string): string | undefined {
    try {
      const row = this.statements.findHashByDocIdStmt.get(docId) as
        | { content_hash: string }
        | undefined;
      return row?.content_hash;
    } catch (error) {
      logDalError('findHashByDocId', `docId: ${docId}`, error);
      throw error;
    }
  }
}
