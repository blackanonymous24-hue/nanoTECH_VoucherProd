import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

const requestSignalStorage = new AsyncLocalStorage<AbortSignal>();

/** Signal lié à la requête HTTP — abort quand le client ferme (logout, onglet, idle). */
export function getRequestAbortSignal(): AbortSignal | undefined {
  return requestSignalStorage.getStore();
}

export function throwIfRequestAborted(): void {
  const signal = getRequestAbortSignal();
  if (signal?.aborted) {
    throw new DOMException("Client disconnected", "AbortError");
  }
}

/** Propage l'annulation client à toutes les opérations MikroTik de la requête. */
export function clientDisconnectMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ac = new AbortController();
  const abort = () => {
    if (!ac.signal.aborted) ac.abort();
  };
  req.once("close", abort);
  res.once("close", abort);
  requestSignalStorage.run(ac.signal, () => next());
}

export async function raceRequestAbort<T>(promise: Promise<T>): Promise<T> {
  const signal = getRequestAbortSignal();
  if (!signal) return promise;
  if (signal.aborted) throw new DOMException("Client disconnected", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Client disconnected", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}
