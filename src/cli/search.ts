import Database from 'better-sqlite3';
import { embed, cosineSimilarity } from 'ai';
import { AppDal } from '../core/db/app_dal.js';
import { getEmbeddingModel } from '../core/config.js';
import { logger } from '../core/logger.js';
import { ConfigType } from '../core/config.js';

export async function search(query: string, appDal: AppDal, config: ConfigType) {
  if (query.length === 0) {
    logger('ERROR', 'Search query cannot be empty.');
    return;
  }

  // TODO make sure embeddings are generated for all documents if skipped before

  let db: Database.Database | null = null;
  try {
    logger('INFO', 'Loading configuration for search...');
    const embeddingModel = await getEmbeddingModel(config);

    logger('INFO', 'Initializing database for search...');
    db = appDal.db;
    logger('INFO', 'Database ready.');

    // 1. Embed the search query
    logger('INFO', `Embedding search query: "${query}"...`);
    const { embedding: queryEmbedding } = await embed({
      model: embeddingModel,
      value: query
    });
    logger('INFO', `Query embedding generated (length: ${queryEmbedding.length}).`);

    logger('INFO', 'Fetching documents and embeddings from database...');
    const documents = appDal.core.getAllDocumentsWithEmbeddings();

    if (documents.length === 0) {
      logger('ERROR', 'No documents with embeddings found in the database.');
      return;
    }
    logger('INFO', `Found ${documents.length} documents with embeddings.`);

    logger('INFO', 'Calculating similarities...');
    const results: { path: string; similarity: number }[] = [];
    for (const doc of documents) {
      const docId = doc.type === 'document' ? doc.absolute_path : `derived:${doc.id}`;
      try {
        const docEmbedding: number[] = JSON.parse(doc.embedding);
        const similarity = cosineSimilarity(queryEmbedding, docEmbedding);
        results.push({
          path: docId,
          similarity
        });
      } catch (parseError) {
        logger('ERROR', `Error parsing embedding for ${docId}: ${parseError}`);
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    logger('INFO', '\n--- Search Results (Top 10 most similar first) ---');
    if (results.length > 0) {
      const topResults = results.slice(0, 10);
      topResults.forEach((result) => {
        logger('INFO', `${result.similarity.toFixed(4)}: ${result.path}`);
      });
    } else {
      logger('INFO', 'No results to display.');
    }
    logger('INFO', '-----------------------------------------');
  } catch (error) {
    logger('ERROR', `An error occurred during the search: ${error}`);
    process.exitCode = 1;
  } finally {
    if (db?.open) {
      logger('INFO', 'Closing database connection.');
      db.close();
    }
  }
}
