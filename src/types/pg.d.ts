// The part of node-postgres this app uses (src/lib/projectDb.ts asks the cluster whether a
// project database still exists). The package ships no types and @types/pg is not installed.
declare module "pg" {
  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
