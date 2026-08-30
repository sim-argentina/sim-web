// Polyfill de Promise.withResolvers (disponible desde Node 22). pdfjs-dist@4 lo
// usa internamente; algunos runtimes de Vercel corren Node 20, donde no existe y
// el parser fallaría con un 500. Este módulo se importa ANTES que pdfjs para
// garantizar que esté definido. Idempotente y sin efectos si ya existe.
type Resolvers<T> = { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void };

const P = Promise as unknown as { withResolvers?: <T>() => Resolvers<T> };
if (typeof P.withResolvers !== "function") {
  P.withResolvers = function <T>(): Resolvers<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
