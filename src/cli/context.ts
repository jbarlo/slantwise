import { getConfig } from '@core/config.js';
import { createAppDal, AppDal } from '@core/db/app_dal.js';
import { createRateLimiter, RateLimiter } from '@core/limiting/index.js';
import type { ConfigType } from '@config/types.js';

export type CliContext = {
  appDal: AppDal;
  rateLimiter: RateLimiter;
  config: ConfigType;
};

export async function createCliContext(): Promise<CliContext> {
  const config = await getConfig();
  const appDal = await createAppDal(config.databasePath);
  const rateLimiter = await createRateLimiter(config);
  return { appDal, rateLimiter, config };
}
