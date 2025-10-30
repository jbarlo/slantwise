import { AppDal } from './db/app_dal.js';
import {
  logFileProcessingStart,
  logFileHashCalculated,
  logFileEmpty,
  logFileHashingError,
  logFileDbProcessingSkipped,
  logFilePathRemoved,
  logFilePathNotFound,
  logFilePathDeleteError,
  logFileProcessingError,
  logDbUpsertSuccess,
  logDbUpsertError,
  logEmbeddingCheckFound,
  logEmbeddingCheckNotFound,
  logEmbeddingCheckError,
  logEmbeddingRequestQueued,
  logEmbeddingRequestSkipped,
  logEmbeddingRequestError,
  logEmbeddingUpsertSuccess,
  logEmbeddingUsageLogSuccess,
  logEmbeddingSaveError
} from './logger.js';
import { hash, readFileSafe } from './utils.js';
import type { ConfigType } from '@config/types.js';
import { RateLimiter } from './limiting';

// --- File Hashing & Embedding ---
// Modified to return both hash and buffer
async function _calculateHashAndGetContent(
  filePath: string
): Promise<{ isContentful: false } | { isContentful: true; hash: string; content: string }> {
  try {
    const fileResult = await readFileSafe(filePath);

    if (!fileResult.success) {
      logFileHashingError(filePath, 'File not found');
      return { isContentful: false };
    }

    const fileContent = fileResult.file;

    if (fileContent.length === 0) {
      logFileEmpty(filePath);
      return { isContentful: false };
    }
    const hexHash = hash(fileContent);
    return { isContentful: true, hash: hexHash, content: fileContent };
  } catch (error: unknown) {
    logFileHashingError(filePath, error);
    throw error;
  }
}

async function _queueEmbeddingRequestIfNeeded(
  currentHash: string,
  content: string,
  appDal: AppDal,
  limiter: RateLimiter,
  config: ConfigType
) {
  const skipEmbedding = config.skipEmbedding;
  if (skipEmbedding) {
    logEmbeddingRequestSkipped(currentHash);
    return;
  }

  try {
    const existingEmbeddingRow = appDal.core.findEmbedding(currentHash);
    if (existingEmbeddingRow) {
      logEmbeddingCheckFound(currentHash);
    } else {
      logEmbeddingCheckNotFound(currentHash);
      logEmbeddingRequestQueued();
      try {
        const result = await limiter.enqueue('embedding', currentHash, {
          contentHash: currentHash,
          content
        });

        // Use AppDal transaction method after successful enqueue
        appDal.executeTransaction(({ core }) => {
          try {
            core.insertUsageLog(currentHash, result.modelName, result.usage.promptTokens);
            logEmbeddingUsageLogSuccess(currentHash, result.usage.promptTokens);
            core.upsertEmbedding(currentHash, result.embedding, result.modelName);
            logEmbeddingUpsertSuccess(currentHash, result.modelName);
          } catch (dalError) {
            // Log DAL errors during transaction
            logEmbeddingSaveError(currentHash, dalError);
            throw dalError; // Re-throw to signal transaction failure
          }
        });
      } catch (queueOrDalError) {
        // Handle errors from queue.enqueue or the executeTransaction call
        if (String(queueOrDalError).includes('pending')) {
          logEmbeddingRequestSkipped(currentHash);
        } else {
          logEmbeddingRequestError(currentHash, queueOrDalError);
        }
      }
    }
  } catch (dalError) {
    logEmbeddingCheckError(currentHash, dalError);
  }
}

export async function processFileCreationOrUpdate(
  absolutePath: string,
  appDal: AppDal, // Use AppDal instance
  limiter: RateLimiter,
  config: ConfigType
) {
  logFileProcessingStart('Create/Update', absolutePath);
  try {
    const hashResult = await _calculateHashAndGetContent(absolutePath);

    if (!hashResult.isContentful) {
      logFileDbProcessingSkipped(absolutePath);
      // Ensure the path association is removed if hashing fails
      await removePathAssociation(absolutePath, appDal);
      return;
    }

    const { hash: currentHash, content } = hashResult;
    logFileHashCalculated(absolutePath, currentHash);

    try {
      appDal.upsertDocumentAndPath(absolutePath, currentHash, content);
      logDbUpsertSuccess(absolutePath, currentHash);
    } catch (dalError) {
      logDbUpsertError(absolutePath, dalError);
      return;
    }

    await _queueEmbeddingRequestIfNeeded(currentHash, content, appDal, limiter, config);
  } catch (processingError) {
    logFileProcessingError(absolutePath, processingError);
  }
}

export async function removePathAssociation(
  absolutePath: string,
  appDal: AppDal // Use AppDal instance
) {
  logFileProcessingStart('Deletion', absolutePath);
  try {
    // Use CoreDal method via AppDal
    const changes = appDal.core.deleteDocumentPath(absolutePath);
    if (changes > 0) {
      logFilePathRemoved(absolutePath);
    } else {
      logFilePathNotFound(absolutePath);
    }
  } catch (dalError) {
    logFilePathDeleteError(absolutePath, dalError);
  }
}
