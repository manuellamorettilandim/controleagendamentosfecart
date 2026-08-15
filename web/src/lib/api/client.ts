import type { AuthConfig, AuthGateway } from "../session/auth";

export type { AuthConfig, AuthGateway, AuthSession } from "../session/auth";

export interface ApiClient {
  user(path: string, options?: RequestInit, retry?: boolean, config?: AuthConfig | null): Promise<any>;
  admin(path: string, options?: RequestInit): Promise<any>;
}

interface ApiClientDependencies {
  auth?: Partial<AuthGateway>;
  fetcher?: typeof fetch;
  redirect?: (path: string) => void;
}

function defaultAuth(): Partial<AuthGateway> {
  if (typeof window === "undefined") return {};
  return window.RemoteCodexAuth || {};
}

async function readJson(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

export function createApiClient(dependencies: ApiClientDependencies = {}): ApiClient {
  const auth = dependencies.auth || defaultAuth();
  const fetcher = dependencies.fetcher || fetch;
  const redirect = dependencies.redirect || ((path: string) => window.location.replace(path));

  async function request(path: string, options: RequestInit, token: string, errorMessage: string): Promise<any> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    const response = await fetcher(path, {
      ...options,
      headers,
      cache: "no-store",
    });
    const data = await readJson(response);
    if (!response.ok) {
      const error = new Error(data.error || errorMessage) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function user(path: string, options: RequestInit = {}, retry = true, config: AuthConfig | null = null): Promise<any> {
    const session = auth.getSession?.();
    if (!session?.access_token) {
      redirect("/login");
      throw new Error("Sessão ausente.");
    }

    try {
      return await request(path, options, session.access_token, "Não foi possível concluir a operação.");
    } catch (error) {
      const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
      if (status === 401 && retry && session.refresh_token && auth.refreshSession) {
        const nextConfig = config || await auth.loadConfig?.();
        if (nextConfig) {
          await auth.refreshSession(nextConfig);
          return user(path, options, false, nextConfig);
        }
      }
      throw error;
    }
  }

  async function admin(path: string, options: RequestInit = {}): Promise<any> {
    const token = auth.getSession?.()?.access_token;
    if (!token) return null;
    return request(path, options, token, "Não foi possível concluir a ação.");
  }

  return { user, admin };
}

export const apiClient = createApiClient();

declare global {
  interface Window {
    FecartApi?: ApiClient;
  }
}

if (typeof window !== "undefined") window.FecartApi = apiClient;
