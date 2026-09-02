import { PostgresServiceClient } from "./postgres.js";
import { SupabaseServiceClient, type SupabaseAdminKeyType } from "./supabase.js";

export type CentralServiceClient = PostgresServiceClient | SupabaseServiceClient;

export function centralServiceFromEnvironment(env: NodeJS.ProcessEnv = process.env): CentralServiceClient {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) return new PostgresServiceClient(databaseUrl);

  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  const legacyKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const key = secretKey || legacyKey;
  if (!url || !key) throw new Error("Configure DATABASE_URL ou, durante a transição, SUPABASE_URL e SUPABASE_SECRET_KEY.");
  const keyType: SupabaseAdminKeyType = secretKey ? "secret" : "service_role";
  return new SupabaseServiceClient(url, key, keyType);
}

