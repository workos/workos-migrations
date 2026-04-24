import type { WorkOS } from '@workos-inc/node';
import type { SerializedCacheEntry } from '../shared/types.js';
import { getOrganizationById, getOrganizationByExternalId, createOrganization } from './org-api.js';

export interface OrgCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  capacity: number;
  hitRate: number;
}

interface OrgCacheEntry {
  id: string;
  externalId?: string;
  name?: string;
  cachedAt: number;
}

export interface OrgResolveOptions {
  orgId?: string;
  orgExternalId?: string;
  createIfMissing?: boolean;
  orgName?: string;
}

export interface OrgCacheOptions {
  maxSize?: number;
  dryRun?: boolean;
}

export class OrgCache {
  private cache: Map<string, OrgCacheEntry>;
  private inFlightRequests: Map<string, Promise<string | null>>;
  private stats: { hits: number; misses: number; evictions: number };
  private readonly maxSize: number;
  private readonly dryRun: boolean;
  private workos: WorkOS | null;

  constructor(workos: WorkOS | null, options?: OrgCacheOptions) {
    this.workos = workos;
    this.cache = new Map();
    this.inFlightRequests = new Map();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
    this.maxSize = options?.maxSize ?? 10000;
    this.dryRun = options?.dryRun ?? false;
  }

  async resolve(options: OrgResolveOptions): Promise<string | null> {
    const { orgId, orgExternalId, createIfMissing, orgName } = options;

    if (orgId && orgExternalId) {
      throw new Error('Cannot specify both orgId and orgExternalId');
    }
    if (!orgId && !orgExternalId) {
      return null;
    }

    const cacheKey = this.generateCacheKey(orgId, orgExternalId);

    // Check cache
    const cached = this.get(cacheKey);
    if (cached) {
      this.stats.hits += 1;
      return cached.id;
    }

    // Coalesce in-flight requests
    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) {
      return await inFlight;
    }

    const requestPromise = this.fetchAndCache(
      cacheKey,
      orgId,
      orgExternalId,
      createIfMissing,
      orgName,
    );
    this.inFlightRequests.set(cacheKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  private get(key: string): OrgCacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private set(key: string, entry: OrgCacheEntry): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        this.stats.evictions += 1;
      }
    }
    this.cache.set(key, entry);
  }

  private async fetchAndCache(
    cacheKey: string,
    orgId?: string,
    orgExternalId?: string,
    createIfMissing?: boolean,
    orgName?: string,
  ): Promise<string | null> {
    this.stats.misses += 1;

    if (this.dryRun) {
      let resolvedOrgId: string | null = null;
      if (orgId) {
        resolvedOrgId = orgId;
      } else if (orgExternalId) {
        resolvedOrgId = `org_dryrun_${orgExternalId}`;
      }
      if (resolvedOrgId) {
        this.set(cacheKey, {
          id: resolvedOrgId,
          externalId: orgExternalId,
          name: orgName,
          cachedAt: Date.now(),
        });
      }
      return resolvedOrgId;
    }

    if (!this.workos) {
      throw new Error('WorkOS client required for non-dry-run org resolution');
    }

    let resolvedOrgId: string | null = null;

    if (orgId) {
      const exists = await getOrganizationById(this.workos, orgId);
      resolvedOrgId = exists ? orgId : null;
    } else if (orgExternalId) {
      resolvedOrgId = await getOrganizationByExternalId(this.workos, orgExternalId);

      if (!resolvedOrgId && createIfMissing && orgName) {
        try {
          resolvedOrgId = await createOrganization(this.workos, orgName, orgExternalId);
        } catch (err: any) {
          const errorMsg = err?.message || '';
          const isExternalIdConflict =
            errorMsg.includes('external_id') && errorMsg.includes('already been assigned');

          if (isExternalIdConflict) {
            for (let attempt = 1; attempt <= 3; attempt++) {
              if (attempt > 1) {
                await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
              }
              resolvedOrgId = await getOrganizationByExternalId(this.workos!, orgExternalId);
              if (resolvedOrgId) break;
            }
            if (!resolvedOrgId) {
              throw new Error(
                `Organization with external_id "${orgExternalId}" reported as existing ` +
                  `but could not be retrieved after 3 retries. Original: ${errorMsg}`,
              );
            }
          } else {
            throw err;
          }
        }
      }
    }

    if (resolvedOrgId) {
      const entry: OrgCacheEntry = {
        id: resolvedOrgId,
        externalId: orgExternalId,
        name: orgName,
        cachedAt: Date.now(),
      };
      this.set(cacheKey, entry);

      // Dual-key caching
      if (resolvedOrgId && orgExternalId) {
        const idKey = this.generateCacheKey(resolvedOrgId, undefined);
        this.set(idKey, entry);
      }
    }

    return resolvedOrgId;
  }

  private generateCacheKey(orgId?: string, orgExternalId?: string): string {
    if (orgId) return `id:${orgId}`;
    if (orgExternalId) return `ext:${orgExternalId}`;
    throw new Error('Must provide orgId or orgExternalId for cache key');
  }

  getStats(): OrgCacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      size: this.cache.size,
      capacity: this.maxSize,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  serialize(): SerializedCacheEntry[] {
    const entries: SerializedCacheEntry[] = [];
    for (const [key, entry] of this.cache.entries()) {
      entries.push({
        key,
        id: entry.id,
        externalId: entry.externalId,
        name: entry.name,
      });
    }
    return entries;
  }

  static deserialize(
    workos: WorkOS | null,
    entries: SerializedCacheEntry[],
    options?: OrgCacheOptions,
  ): OrgCache {
    const cache = new OrgCache(workos, options);
    for (const entry of entries) {
      cache.cache.set(entry.key, {
        id: entry.id,
        externalId: entry.externalId,
        name: entry.name,
        cachedAt: Date.now(),
      });
    }
    return cache;
  }

  mergeEntries(entries: SerializedCacheEntry[]): void {
    for (const entry of entries) {
      if (!this.cache.has(entry.key)) {
        this.cache.set(entry.key, {
          id: entry.id,
          externalId: entry.externalId,
          name: entry.name,
          cachedAt: Date.now(),
        });
      }
    }
  }
}
