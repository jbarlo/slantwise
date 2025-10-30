import Database from 'better-sqlite3';
import { AppDal } from '../core/db/app_dal.js';
import { logger } from '../core/logger.js';

export async function calculateUsage(appDal: AppDal) {
  let db: Database.Database | null = null;
  try {
    logger('INFO', 'Initializing database to calculate token usage...');
    db = appDal.db;
    logger('INFO', 'Database ready.');

    // Fetch all token counts
    logger('INFO', 'Fetching token counts from usage log...');
    const tokenRows = appDal.core.getAllTokenCounts();

    if (tokenRows.length === 0) {
      logger('ERROR', 'No token usage logged yet.');
      return;
    }

    // Sum the tokens
    const totalTokens = tokenRows.reduce((sum, row) => sum + row.prompt_tokens, 0);

    logger('INFO', `\n--- Total Token Usage ---`, { force: true });
    logger('INFO', `Total prompt tokens used: ${totalTokens}`, { force: true });
    logger('INFO', `Based on ${tokenRows.length} embedding operations logged.`, { force: true });
    logger('INFO', `-------------------------`, { force: true });
  } catch (error) {
    logger('ERROR', `An error occurred while calculating token usage: ${error}`);
    process.exitCode = 1;
  } finally {
    if (db?.open) {
      logger('INFO', 'Closing database connection.');
      db.close();
    }
  }
}
