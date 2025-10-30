import { createTRPCProxyClient, TRPCClientError, TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '@shared/server';

// TODO perform as batch link?
export const createIpcLink = (): TRPCLink<AppRouter> => {
  return () => {
    return ({ op }) =>
      observable((observer) => {
        window.api
          .invokeTrpc(op.path, op.input)
          .then((data: unknown) => {
            observer.next({ result: { data } });
            observer.complete();
          })
          .catch((err: unknown) => observer.error(err as TRPCClientError<AppRouter>));

        return () => {};
      });
  };
};

export const client = createTRPCProxyClient<AppRouter>({
  // TODO logger link
  links: [createIpcLink()]
});
