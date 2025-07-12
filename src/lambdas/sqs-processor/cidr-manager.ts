import { CidrCache } from '../../shared/cidr-cache';
import { CidrUtils } from '../../shared/cidr';


export class CidrManager {

  /**
   * Get CIDR blacklist from context
   */
  async getCidrBlacklist(tenantId: string): Promise<string[]> {
    let ciderBlackList: string[] = [];
    try {
       ciderBlackList = await CidrCache.getCidrList(tenantId) || [];
    } catch (error) {
      console.warn(`Failed to load CIDR blacklist for tenant ${tenantId}, continuing without CIDR checking:`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    return ciderBlackList;
  }

  /**
   * Check if an IP address is blacklisted
   */
  async isIpBlacklisted(tenantId: string, ip: string): Promise<boolean> {
    const cidrList = await this.getCidrBlacklist(tenantId);
    if (cidrList.length === 0) {
      return false;
    }

    // Check IP against each CIDR block
    if (CidrUtils.isIpInAnyCidrBlock(ip, cidrList)) {
      console.log(`IP ${ip} matches CIDR blacklist: ${cidrList}`, {
        ip,
        tenantId: tenantId
      });
      return true;
    }
    return false;
  }
}


