import type { ModKindT, ModSourceIdT } from "@deploykit/shared";

/** What a server can take. Aliases (LATEST) are resolved before reaching an adapter. */
interface ModFilterI {
  loaders: string[] | null;
  kind: ModKindT;
  gameVersion: string | null;
}

interface ModSummaryI {
  source: ModSourceIdT;
  projectId: string;
  slug: string | null;
  name: string;
  summary: string;
  iconUrl: string | null;
  author: string | null;
  downloads: number;
  url: string;
  kind: ModKindT;
  /** False when DeployKit cannot install it (client-only, no distribution, wrong app). */
  installable: boolean;
  reason?: string;
}

interface ModSearchResultI {
  hits: ModSummaryI[];
  total: number;
  offset: number;
  limit: number;
}

interface ModVersionI {
  id: string;
  label: string;
  gameVersions: string[];
  loaders: string[];
  publishedAt: string;
  type: "release" | "beta" | "alpha";
}

interface ModSourceContextI {
  apiKey: string | null;
  appId?: number;
}

interface ModSourceAdapterI {
  id: ModSourceIdT;
  /** Whether search / install work with this context, and why not. */
  capabilities(ctx: ModSourceContextI): { search: boolean; install: boolean; reason?: string };
  search(
    query: string,
    filter: ModFilterI,
    offset: number,
    ctx: ModSourceContextI,
  ): Promise<ModSearchResultI>;
  project(ref: string, ctx: ModSourceContextI): Promise<ModSummaryI>;
  versions(
    projectId: string,
    filter: ModFilterI | null,
    ctx: ModSourceContextI,
  ): Promise<ModVersionI[]>;
  /** Pull a project id/slug out of a URL or bare id; null when it is not this source's. */
  parseRef(input: string): string | null;
  /** Throws ModSourceError("UNAUTHORIZED") when the provider rejects the key. */
  validateKey?(key: string): Promise<void>;
}

export type {
  ModFilterI,
  ModSummaryI,
  ModSearchResultI,
  ModVersionI,
  ModSourceContextI,
  ModSourceAdapterI,
};
