import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { TRPCError, type AnyRouter, type inferRouterContext } from '@trpc/server';
import { get, isNil } from 'lodash-es';

export function registerTRPC<TRouter extends AnyRouter>(
  router: TRouter,
  createContext?: (opts: {
    event: IpcMainInvokeEvent;
  }) => Promise<inferRouterContext<TRouter>> | inferRouterContext<TRouter>
) {
  ipcMain.handle('trpc', async (event: IpcMainInvokeEvent, path: string, input: unknown) => {
    const ctx = await createContext?.({ event });

    const caller = router.createCaller(ctx);

    const splitPath = path.split('.');

    const procedureFn = get(caller, splitPath);

    if (isNil(procedureFn)) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    return procedureFn(input);
  });
}
