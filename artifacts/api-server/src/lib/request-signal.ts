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
  const abortIfClientGone = () => {
    // Évite les faux positifs (keep-alive nginx / fin de corps POST) tant que la réponse n'a pas démarré.
    if (ac.signal.aborted || res.headersSent || res.writableEnded) return;
    ac.abort();
  };
  req.once("aborted", abortIfClientGone);
  req.once("close", abortIfClientGone);
  res.once("close", abortIfClientGone);
  requestSignalStorage.run(ac.signal, () => next());
}

/** Mutations courtes (add user…) : ne pas lier au signal HTTP — évite « Client disconnected » en file d'attente MikroTik. */
export function runWithoutRequestAbort<T>(fn: () => Promise<T>): Promise<T> {
  return requestSignalStorage.run(undefined as unknown as AbortSignal, fn);
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
