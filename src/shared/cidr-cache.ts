import { RequestContextManager } from './context';
import { PolicyRepository, CIDRRepository } from './repository';
import { Cidr } from './types';

/**
 * Container-level CIDR cache for efficient IP blacklist checking
 * Caches CIDR data per tenant with TTL-based expiration
 */
export class CidrCache {
  private static cache: Map<string, string[]> = new Map(); // tenantId -> CIDR array
  private static lastLoaded: Map<string, number> = new Map(); // tenantId -> timestamp
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  /**
   * Get CIDR list for a tenant (with caching)
   */
  static async getCidrList(tenantId: string): Promise<string[]> {
    // Check if we have valid cached data
    if (this.isCacheValid(tenantId)) {
      const cachedData = this.cache.get(tenantId);
      if (cachedData) {
        console.log(`Using cached CIDR data for tenant ${tenantId}`, {
          count: cachedData.length,
          cacheAge: Date.now() - (this.lastLoaded.get(tenantId) || 0)
        });
        return cachedData;
      }
    }

    // Cache is invalid or doesn't exist, refresh it
    await this.refreshCache(tenantId);
    return this.cache.get(tenantId) || [];
  }

  /**
   * Refresh CIDR cache for a specific tenant
   */
  static async refreshCache(tenantId: string): Promise<void> {
    try {
      console.log(`Refreshing CIDR cache for tenant ${tenantId}`);

      // Fetch CIDR data from repository
      const cidrRecords: Cidr[] = await CIDRRepository.getAllCidr(tenantId);
      const cidrList = cidrRecords.map(record => record.cidr);

      // Update cache
      this.cache.set(tenantId, cidrList);
      this.lastLoaded.set(tenantId, Date.now());

      console.log(`Successfully refreshed CIDR cache for tenant ${tenantId}`, {
        count: cidrList.length,
        cidrs: cidrList
      }); 
    } catch (error) {
      console.error(`Failed to refresh CIDR cache for tenant ${tenantId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Set empty cache to prevent repeated failures
      this.cache.set(tenantId, []);
      this.lastLoaded.set(tenantId, Date.now());
      
      throw error;
    }
  }

  /**
   * Check if cached data is still valid for a tenant
   */
  static isCacheValid(tenantId: string): boolean {
    const lastLoaded = this.lastLoaded.get(tenantId);
    if (!lastLoaded) {
      return false;
    }
    
    const age = Date.now() - lastLoaded;
    return age < this.CACHE_TTL;
  }

  /**
   * Clear cache for a specific tenant (useful for testing or manual refresh)
   */
  static clearTenantCache(tenantId: string): void {
    this.cache.delete(tenantId);
    this.lastLoaded.delete(tenantId);
    console.log(`Cleared CIDR cache for tenant ${tenantId}`);
  }

  /**
   * Clear all cached data (useful for testing)
   */
  static clearAllCache(): void {
    this.cache.clear();
    this.lastLoaded.clear();
    console.log('Cleared all CIDR cache data');
  }

  /**
   * Get cache statistics for monitoring
   */
  static getCacheStats(): {
    totalTenants: number;
    cacheEntries: Array<{
      tenantId: string;
      cidrCount: number;
      ageMs: number;
      isValid: boolean;
    }>;
  } {
    const stats = {
      totalTenants: this.cache.size,
      cacheEntries: [] as Array<{
        tenantId: string;
        cidrCount: number;
        ageMs: number;
        isValid: boolean;
      }>
    };

    for (const [tenantId, cidrList] of this.cache.entries()) {
      const lastLoaded = this.lastLoaded.get(tenantId) || 0;
      const ageMs = Date.now() - lastLoaded;
      
      stats.cacheEntries.push({
        tenantId,
        cidrCount: cidrList.length,
        ageMs,
        isValid: this.isCacheValid(tenantId)
      });
    }

    return stats;
  }
}