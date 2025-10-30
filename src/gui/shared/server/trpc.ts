import { initTRPC } from '@trpc/server';
import type { AppDal } from '@core/db/app_dal.js';
import type { RateLimiter } from '@core/limiting';
import type { ConfigType } from '@config/types.js';

export type TRPCContext = { appDal: AppDal; rateLimiter: RateLimiter; config: ConfigType };
const create = () => {
  return initTRPC.context<TRPCContext>().create();
};

let t: ReturnType<typeof create> | null = null;

if (!t) {
  t = create();
}

export const router = t.router;
export const publicProcedure = t.procedure;
