/**
 * Workers 运行时与本项目变量的类型声明。
 *
 * 这里刻意不写顶层 import/export，让下面的类型成为全局环境类型（不是模块导出），
 * 这样 `src/lib/db.ts` 里直接用 `D1Database` 就行，不必从一个 .d.ts 里 import 类型。
 *
 * D1 只声明本项目用到的最小面：prepare/bind/first/run/all/batch。
 * 需要更完整的类型时再换 @cloudflare/workers-types，那会引入一个开发依赖。
 */

type D1ResultMeta = {
  last_row_id?: number;
  changes?: number;
};

type D1Result<T> = {
  results: T[];
  meta: D1ResultMeta;
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  run(): Promise<D1Result<unknown>>;
  all<T = unknown>(): Promise<D1Result<T>>;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

type Fetcher = {
  fetch(request: Request): Promise<Response>;
};

type WorkerEnv = {
  ASSETS: Fetcher;
  APP_URL?: string;
  DB?: D1Database;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
};

declare module 'cloudflare:workers' {
  export const env: WorkerEnv;
}
