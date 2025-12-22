import Database from 'libsql';
import { v4 as uuidv4 } from 'uuid';
import { humanId } from 'human-id';
import {
  logDalError,
  logDalPrepareStatementsStart,
  logDalPrepareStatementsSuccess,
  logger
} from '../logger.js';
import { stableStringify, getDerivationCacheKey } from '../utils.js';
import { hash } from '../utils.js';
import { DependencyTree, OperationWarning, StepParams, StepParamsSchema } from './types.js';

interface InternalUserDerivation {
  derivation_id: string;
  recipe_params: string;
  label: string | null;
  final_step_id: string;
  dsl_expression: string;
  created_at: string;
}
export interface UserDerivation extends Omit<InternalUserDerivation, 'recipe_params'> {
  recipe_params: StepParams;
}

interface DerivationsPreparedStatements {
  // Derivations Table
  insertDerivation: Database.Statement;
  updateDerivation: Database.Statement;
  deleteDerivation: Database.Statement;
  findDerivationById: Database.Statement;
  getAllDerivations: Database.Statement;

  // Steps Table
  insertStep: Database.Statement;
  getStepStoredParams: Database.Statement;

  // Global Step Results (cache)
  insertStepResult: Database.Statement;
  insertStepResultLink: Database.Statement;
  findStepResultOutputHash: Database.Statement;
  findStepResultContext: Database.Statement;
  findStepResultByCacheKey: Database.Statement;

  // Step Input Link Tables
  clearStepInputContentLinks: Database.Statement;
  insertStepInputContentLink: Database.Statement;
  clearStepInputStepLinks: Database.Statement;
  insertStepInputStepLink: Database.Statement;
}

function prepareDerivationsStatements(db: Database.Database): DerivationsPreparedStatements {
  logDalPrepareStatementsStart();
  const preparedStatements: DerivationsPreparedStatements = {
    // Derivations Table
    insertDerivation: db.prepare(
      `INSERT INTO derivations (derivation_id, recipe_params, label, final_step_id, dsl_expression, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f','now'), strftime('%Y-%m-%d %H:%M:%f','now'))`
    ),
    updateDerivation: db.prepare(
      `UPDATE derivations SET recipe_params = ?, label = ?, final_step_id = ?, dsl_expression = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE derivation_id = ?`
    ),
    deleteDerivation: db.prepare(`DELETE FROM derivations WHERE derivation_id = ?`),
    findDerivationById: db.prepare(
      'SELECT derivation_id, recipe_params, label, final_step_id, dsl_expression, created_at FROM derivations WHERE derivation_id = ?'
    ),
    getAllDerivations: db.prepare(
      'SELECT derivation_id, recipe_params, label, final_step_id, dsl_expression, created_at FROM derivations'
    ),

    // Steps Table
    insertStep: db.prepare(
      `INSERT INTO steps (step_id, operation_params)
             VALUES (?, ?)`
    ),
    getStepStoredParams: db.prepare('SELECT operation_params FROM steps WHERE step_id = ?'),

    // Global Step Results (cache)
    insertStepResult: db.prepare(
      `INSERT OR IGNORE INTO step_results (
         cache_key,
         output_content_hash,
         resolved_pinned_input_hashes,
         input_content_hashes,
         warnings,
         computed_at
       )
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f','now'))`
    ),
    insertStepResultLink: db.prepare(
      'INSERT OR REPLACE INTO step_result_links (step_id, cache_key, dependency_tree) VALUES (?, ?, ?)'
    ),
    findStepResultOutputHash: db.prepare(
      `SELECT sr.output_content_hash
       FROM step_result_links srl
       JOIN step_results sr ON sr.cache_key = srl.cache_key
       WHERE srl.step_id = ?`
    ),
    findStepResultContext: db.prepare(
      `SELECT sr.output_content_hash,
              sr.resolved_pinned_input_hashes,
              sr.input_content_hashes,
              srl.dependency_tree,
              sr.warnings
       FROM step_result_links srl
       JOIN step_results sr ON sr.cache_key = srl.cache_key
       WHERE srl.step_id = ?`
    ),
    findStepResultByCacheKey: db.prepare(
      `SELECT sr.output_content_hash,
              sr.resolved_pinned_input_hashes,
              sr.input_content_hashes,
              sr.warnings
       FROM step_results sr
       WHERE sr.cache_key = ?`
    ),

    // Step Input Link Tables
    clearStepInputContentLinks: db.prepare('DELETE FROM step_input_content WHERE step_id = ?'),
    insertStepInputContentLink: db.prepare(
      'INSERT OR IGNORE INTO step_input_content (step_id, input_content_hash) VALUES (?, ?)'
    ),
    clearStepInputStepLinks: db.prepare('DELETE FROM step_input_step WHERE consuming_step_id = ?'),
    insertStepInputStepLink: db.prepare(
      'INSERT OR IGNORE INTO step_input_step (consuming_step_id, providing_step_id) VALUES (?, ?)'
    )
  };
  logDalPrepareStatementsSuccess();
  return preparedStatements;
}

// --- Derivations Data Access Layer ---
// This class now manages "Steps" internally, though named DerivationsDal as per user request.
/**
 * Manages database interactions for atomic execution steps, their results, and input links.
 */
export class DerivationsService {
  private db: Database.Database;
  private statements: DerivationsPreparedStatements;

  constructor(db: Database.Database) {
    this.db = db;
    this.statements = prepareDerivationsStatements(this.db);
  }

  /**
   * Creates a new user-defined derivation record.
   * The final_step_id is required.
   */
  createDerivation(
    recipeParams: StepParams,
    label: string | null,
    finalStepId: string,
    dslExpression: string
  ): string {
    const derivationId = humanId({ separator: '-', capitalize: false });
    try {
      const recipeParamsString = stableStringify(recipeParams);
      this.statements.insertDerivation.run(
        derivationId,
        recipeParamsString,
        label,
        finalStepId,
        dslExpression
      );
    } catch (error) {
      logDalError('createUserDerivation', `id: ${derivationId}, label: ${label}`, error);
      throw error;
    }
    return derivationId;
  }

  updateDerivation(
    derivationId: string,
    recipeParams: StepParams,
    label: string | null,
    finalStepId: string,
    dslExpression: string
  ): string {
    try {
      const recipeParamsString = stableStringify(recipeParams);
      this.statements.updateDerivation.run(
        recipeParamsString,
        label,
        finalStepId,
        dslExpression,
        derivationId
      );
    } catch (error) {
      logDalError('updateDerivation', `id: ${derivationId}, label: ${label}`, error);
      throw error;
    }
    return derivationId;
  }

  deleteDerivation(derivationId: string): string {
    try {
      this.statements.deleteDerivation.run(derivationId);
    } catch (error) {
      logDalError('deleteDerivation', `id: ${derivationId}`, error);
      throw error;
    }
    return derivationId;
  }

  findDerivationById(derivationId: string): UserDerivation | undefined {
    try {
      // derivationId is a human-readable ID (e.g., "tame-green-peacock")
      const internalUserDerivation = this.statements.findDerivationById.get(derivationId) as
        | InternalUserDerivation
        | undefined;
      const userDerivation: UserDerivation | undefined = internalUserDerivation
        ? {
            ...internalUserDerivation,
            recipe_params: StepParamsSchema.parse(JSON.parse(internalUserDerivation.recipe_params))
          }
        : undefined;
      // Ensure final_step_id is treated as non-nullable if present, consistent with UserDerivation interface
      if (userDerivation && userDerivation.final_step_id === null) {
        // This case should ideally not happen if schema enforces NOT NULL and DAL inserts it.
        // Log a warning or error if it does, as it indicates a mismatch or data integrity issue.
        logger(
          'WARN',
          `UserDerivation ${derivationId} has a null final_step_id, but interface expects string.`
        );
        // Depending on strictness, could throw an error or coerce type if that's intended recovery.
      }
      return userDerivation;
    } catch (error) {
      logDalError('findUserDerivationById', `id: ${derivationId}`, error);
      throw error;
    }
  }

  getAllDerivations(): UserDerivation[] {
    const internalDerivations = this.statements.getAllDerivations.all() as InternalUserDerivation[];
    return internalDerivations.map((internalDerivation) => ({
      ...internalDerivation,
      recipe_params: StepParamsSchema.parse(JSON.parse(internalDerivation.recipe_params))
    }));
  }

  // --- Step Management Methods (largely from previous refactor) ---

  /**
   * Defines a new step, including parsing inputs FROM stepParams and managing GC links.
   * Uses an internal transaction.
   * Returns the generated step_id.
   * @param stepParams The StepParams object (not stringified yet).
   */
  defineStep(stepParams: StepParams): string {
    const stepId = uuidv4();
    // Extract inputs *before* stringifying the whole recipe for storage
    const inputsToLink = stepParams.inputs;
    // Stringify the complete recipe (including inputs) for storage
    const stepParamsString = stableStringify(stepParams);

    const transaction = this.db.transaction(() => {
      try {
        // 1. Insert the main derivation definition (only recipe_params)
        this.statements.insertStep.run(stepId, stepParamsString);

        // 2. Clear existing links (in case of future update logic)
        this.statements.clearStepInputContentLinks.run(stepId);
        this.statements.clearStepInputStepLinks.run(stepId);

        // 3. Use extracted inputsToLink to insert new links
        for (const item of inputsToLink) {
          if (item.type === 'content') {
            this.statements.insertStepInputContentLink.run(stepId, item.hash);
          } else if (item.type === 'constant') {
            const valueHash = hash(item.value);
            this.statements.insertStepInputContentLink.run(stepId, valueHash);
          } else if (item.type === 'derivation') {
            // For derivation, no link is created at definition time.
            // The derivation will be resolved at computation time.
            continue;
          } else if (item.type === 'pinned_path') {
            // For pinned_path, no link is created at definition time.
            // The path will be resolved at computation time.
            continue;
          } else if (item.type === 'internal_step_link') {
            this.statements.insertStepInputStepLink.run(stepId, item.targetStepId);
          }
        }
      } catch (error) {
        logDalError(
          'defineDerivation (txn)',
          `stepId: ${stepId}, recipe: ${stepParamsString.substring(0, 50)}`,
          error
        );
        throw error; // Rollback transaction
      }
    });

    transaction();
    return stepId;
  }

  getStepStoredParams(stepId: string): StepParams | undefined {
    try {
      const row = this.statements.getStepStoredParams.get(stepId) as
        | { operation_params: string }
        | undefined;

      if (!row || !row.operation_params) {
        return undefined;
      }
      return StepParamsSchema.parse(JSON.parse(row.operation_params));
    } catch (error) {
      logDalError('getStepStoredParams', `stepId: ${stepId}`, error);
      throw error;
    }
  }

  findStepResultOutputHash(stepId: string): string | undefined {
    try {
      const row = this.statements.findStepResultOutputHash.get(stepId) as
        | { output_content_hash: string }
        | undefined;
      return row?.output_content_hash;
    } catch (error) {
      logDalError('findStepResultOutputHash', `id: ${stepId}`, error);
      throw error;
    }
  }

  findStepResultContext(stepId: string):
    | {
        output_content_hash: string;
        resolved_pinned_input_hashes: Record<string, { type: 'content'; hash: string }> | null;
        input_content_hashes: string[];
        dependency_tree: DependencyTree;
        warnings: OperationWarning[];
      }
    | undefined {
    try {
      // Expects raw step_id
      const row = this.statements.findStepResultContext.get(stepId) as
        | {
            output_content_hash: string;
            resolved_pinned_input_hashes: string | null;
            input_content_hashes: string;
            dependency_tree: string;
            warnings: string | null;
          }
        | undefined;
      if (!row) {
        return undefined;
      }
      // TODO util to format output
      return {
        output_content_hash: row.output_content_hash,
        // TODO schema validation
        resolved_pinned_input_hashes: row.resolved_pinned_input_hashes
          ? JSON.parse(row.resolved_pinned_input_hashes)
          : null,
        // TODO schema validation
        input_content_hashes: row.input_content_hashes ? JSON.parse(row.input_content_hashes) : [],
        // TODO schema validation
        dependency_tree: row.dependency_tree ? JSON.parse(row.dependency_tree) : [],
        // TODO schema validation
        warnings: row.warnings ? JSON.parse(row.warnings) : []
      };
    } catch (error) {
      logDalError('findStepResultContext', `id: ${stepId}`, error);
      throw error;
    }
  }

  findCacheRowByKey(cacheKey: string):
    | {
        output_content_hash: string;
        resolved_pinned_input_hashes: Record<string, { type: 'content'; hash: string }> | null;
        input_content_hashes: string[];
        warnings: OperationWarning[];
      }
    | undefined {
    try {
      const row = this.statements.findStepResultByCacheKey.get(cacheKey) as
        | {
            output_content_hash: string;
            resolved_pinned_input_hashes: string | null;
            input_content_hashes: string;
            warnings: string | null;
            dependency_tree: string | null;
          }
        | undefined;
      if (!row) {
        return undefined;
      }
      return {
        output_content_hash: row.output_content_hash,
        // TODO schema validation
        resolved_pinned_input_hashes: row.resolved_pinned_input_hashes
          ? JSON.parse(row.resolved_pinned_input_hashes)
          : null,
        // TODO schema validation
        input_content_hashes: row.input_content_hashes ? JSON.parse(row.input_content_hashes) : [],
        // TODO schema validation
        warnings: row.warnings ? JSON.parse(row.warnings) : []
      };
    } catch (error) {
      logDalError('findCacheRowByKey', `key: ${cacheKey}`, error);
      throw error;
    }
  }

  linkStepToCache(stepId: string, cacheKey: string, dependencyTree: DependencyTree): void {
    const stringifiedDependencyTree = dependencyTree ? stableStringify(dependencyTree) : null;
    try {
      this.statements.insertStepResultLink.run(stepId, cacheKey, stringifiedDependencyTree);
    } catch (error) {
      logDalError('linkStepToCache', `stepId: ${stepId}`, error);
      throw error;
    }
  }

  /**
   * Saves the result of a computed derivation step.
   * Designed to be called within a transaction managed by AppDal.
   * Assumes the corresponding output content is already saved in content_cache.
   */
  saveComputedResultInner(
    stepId: string,
    stepParams: StepParams,
    outputContentHash: string,
    resolvedPinnedInputHashesJson: Record<string, { type: 'content'; hash: string }>,
    inputContentHashes: string[],
    dependencyTree: DependencyTree,
    warnings: OperationWarning[]
  ): void {
    const cacheKey = getDerivationCacheKey(stepParams, inputContentHashes);

    const stringifiedResolvedPinnedInputHashesJson = resolvedPinnedInputHashesJson
      ? stableStringify(resolvedPinnedInputHashesJson)
      : null;
    const stringifiedInputContentHashes = stableStringify(inputContentHashes);
    const stringifiedDependencyTree = dependencyTree ? stableStringify(dependencyTree) : null;
    const stringifiedWarnings = stableStringify(warnings);

    try {
      // FIXME transaction
      this.statements.insertStepResult.run(
        cacheKey,
        outputContentHash,
        stringifiedResolvedPinnedInputHashesJson,
        stringifiedInputContentHashes,
        stringifiedWarnings
      );

      this.statements.insertStepResultLink.run(stepId, cacheKey, stringifiedDependencyTree);
    } catch (error) {
      logDalError('saveStepResult', `stepId: ${stepId}`, error);
      throw error;
    }
  }
}
