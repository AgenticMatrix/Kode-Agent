declare module 'proper-lockfile' {
  interface LockOptions {
    stale?: number;
    update?: number;
    retries?: {
      retries: number;
      minTimeout: number;
      maxTimeout: number;
      factor?: number;
      randomize?: boolean;
    };
    realpath?: boolean;
    lockfilePath?: string;
  }

  function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
  function unlock(file: string, options?: { realpath?: boolean }): Promise<void>;
  function check(file: string, options?: { stale?: number; realpath?: boolean }): Promise<boolean>;

  export { lock, unlock, check };
  export type { LockOptions };
}
