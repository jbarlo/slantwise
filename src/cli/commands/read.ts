import { Command } from 'commander';
import { getContext, isInteractive, GlobalOptions } from '../index.js';
import { getOrComputeDerivedContent, EngineEvent } from '@core/derivationEngine/index.js';
import { getFormula } from './utils.js';

/** Progress state for stderr output */
type ProgressState = {
  total: number;
  completed: number;
  cached: number;
  completedTokens: number; // tokens from finished steps
  streamingTokens: number; // tokens from current LLM call (estimated)
  thinkingFrame: number; // -1 when not thinking, 0+ cycles ellipsis
};

/** Create a progress handler that writes to stderr when TTY */
function createProgressHandler() {
  const isTTY = process.stderr.isTTY || process.env.SLANTWISE_FORCE_PROGRESS;
  if (!isTTY) {
    // Non-TTY: silent per plan decisions
    return { onEvent: () => {}, finalize: () => {} };
  }

  const state: ProgressState = {
    total: 0,
    completed: 0,
    cached: 0,
    completedTokens: 0,
    streamingTokens: 0,
    thinkingFrame: -1
  };
  let dirty = false;

  const ELLIPSIS = ['.', '.', '..', '..', '...', '...'];

  const render = () => {
    const cachedStr = state.cached > 0 ? ` (${state.cached} cached)` : '';
    const totalTokens = state.completedTokens + state.streamingTokens;
    const streamingIndicator = state.streamingTokens > 0 ? '~' : '';
    const thinkingIndicator =
      state.thinkingFrame >= 0 ? ` | Thinking${ELLIPSIS[state.thinkingFrame % ELLIPSIS.length]}` : '';

    const line = `Formulas: ${state.completed}/${state.total}${cachedStr} | Tokens: ${streamingIndicator}${totalTokens}${thinkingIndicator}`;
    process.stderr.write(`\r\x1b[K${line}`);
  };

  const scheduleRender = () => {
    if (!dirty) {
      dirty = true;
      setImmediate(() => {
        render();
        dirty = false;
      });
    }
  };

  const onEvent = (event: EngineEvent) => {
    if (event.type === 'PLAN_READY') {
      state.total = event.plan.planUnits.length;
      scheduleRender();
    } else if (event.type === 'LLM_THINKING_UPDATE') {
      // Model is in hidden thinking phase (no streaming tokens)
      state.thinkingFrame = state.thinkingFrame < 0 ? 0 : state.thinkingFrame + 1;
      scheduleRender();
    } else if (event.type === 'LLM_TOKEN_UPDATE') {
      // Streaming token update - clear thinking state
      state.thinkingFrame = -1;
      state.streamingTokens = event.tokensOutput;
      scheduleRender();
    } else if (event.type === 'LLM_CALL_END') {
      // LLM call finished - add actual tokens, clear streaming/thinking
      state.thinkingFrame = -1;
      state.completedTokens += event.tokensOutput;
      state.streamingTokens = 0;
      scheduleRender();
    } else if (event.type === 'STEP_COMPLETE') {
      state.completed++;
      if (event.execTree.cacheStatus !== 'computed') {
        state.cached++;
      }
      // Token counting now handled by LLM_CALL_END
      state.thinkingFrame = -1;
      state.streamingTokens = 0;
      scheduleRender();
    }
  };

  const finalize = () => {
    // Clear the progress line before output
    process.stderr.write('\r\x1b[K');
  };

  return { onEvent, finalize };
}

export const readCommand = new Command('read')
  .description('Read/execute a formula and output its result')
  .argument('[identifier]', 'Formula ID or label')
  .option('-y, --no-interactive', 'Disable interactive prompts')
  .option('-r, --reroll', 'Force recalculation and bypass cache')
  .action(async (identifierArg: string | undefined) => {
    const ctx = await getContext();
    const globalOpts = readCommand.optsWithGlobals<GlobalOptions>();
    const localOpts = readCommand.opts<{ reroll?: boolean }>();
    const interactive = isInteractive(globalOpts);

    const formulas = ctx.appDal.derivations.getAllDerivations();

    if (formulas.length === 0) {
      console.error('No formulas found.');
      process.exit(1);
    }

    const formulaResult = await getFormula(
      identifierArg,
      interactive,
      formulas,
      'Select formula to read:'
    );
    if (!formulaResult.success) {
      console.error(formulaResult.error);
      process.exit(formulaResult.code);
    }

    const formula = formulaResult.formula;

    const progress = createProgressHandler();

    const result = await getOrComputeDerivedContent(
      ctx.appDal,
      formula.derivation_id,
      ctx.rateLimiter,
      ctx.config,
      { skipCache: localOpts.reroll, onEvent: progress.onEvent }
    );

    progress.finalize();

    if (!result.success) {
      console.error(result.error.message);
      process.exit(1);
    }

    console.log(result.output);
  });
