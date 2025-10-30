import { publicProcedure, router } from './trpc';
import { z } from 'zod/v4';
import {
  createDerivation as coreCreateDerivation,
  updateDerivation as coreUpdateDerivation,
  getOrComputeDerivedContent
} from '@core/derivationEngine/index.js';
import { parseDerivationExpression } from '@core/lang/index.js';
import type { ExternalDerivationParams } from '@core/db/types.js';
import { TRPCError } from '@trpc/server';
import { updateConfig } from '@core/config.js';
import { themeSchema } from '@config/types.js';

export const appRouter = router({
  createDerivation: publicProcedure
    .input(z.object({ expression: z.string(), label: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const parsed = parseDerivationExpression(input.expression);
      if (!parsed.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.errors.join('\n') });
      }

      const derivationParams: ExternalDerivationParams = {
        recipeParams: parsed.params,
        label: input.label ?? null
      };

      const derivationId = coreCreateDerivation(ctx.appDal, derivationParams, input.expression);
      return derivationId;
    }),
  updateDerivation: publicProcedure
    .input(
      z.object({
        derivationId: z.string(),
        expression: z.string(),
        label: z.string().nullable().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = parseDerivationExpression(input.expression);
      if (!parsed.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.errors.join('\n') });
      }

      const derivationParams: ExternalDerivationParams = {
        recipeParams: parsed.params,
        label: input.label ?? null
      };

      const derivationId = coreUpdateDerivation(
        ctx.appDal,
        input.derivationId,
        derivationParams,
        input.expression
      );
      return derivationId;
    }),
  readDerivation: publicProcedure
    .input(z.object({ derivationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getOrComputeDerivedContent(
        ctx.appDal,
        input.derivationId,
        ctx.rateLimiter,
        ctx.config
      );

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to read cell: ${result.error.message}`
        });
      }

      return result.output;
    }),
  getAllDerivations: publicProcedure.query(async ({ ctx }) => {
    const derivations = ctx.appDal.derivations.getAllDerivations();
    return derivations;
  }),
  config: router({
    theme: router({
      get: publicProcedure.query(async ({ ctx }) => {
        return ctx.config.theme;
      }),
      set: publicProcedure.input(themeSchema).mutation(async ({ input }) => {
        try {
          await updateConfig({ theme: input });
        } catch {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to update config'
          });
        }
        return { success: true };
      })
    })
  })
});

export type AppRouter = typeof appRouter;
