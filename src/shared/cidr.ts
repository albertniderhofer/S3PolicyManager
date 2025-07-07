/**
 * CIDR (Classless Inter-Domain Routing) utility functions
 * Provides IP address validation and CIDR block matching functionality
 */

export class CidrUtils {
  /**
   * Validate IP address format
   */
  static isValidIpAddress(ip: string): boolean {
    const ipPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipPattern.test(ip);
  }

  /**
   * Check if IP address is within a CIDR block
   */
  static isIpInCidrBlock(ip: string, cidr: string): boolean {
    try {
      const [network, prefixLength] = cidr.split('/');
      const prefix = parseInt(prefixLength, 10);
      
      if (isNaN(prefix) || prefix < 0 || prefix > 32) {
        return false;
      }

      const ipNum = this.ipToNumber(ip);
      const networkNum = this.ipToNumber(network);
      const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
      
      return (ipNum & mask) === (networkNum & mask);
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert IP address string to 32-bit number
   */
  static ipToNumber(ip: string): number {
    const parts = ip.split('.');
    if (parts.length !== 4) {
      throw new Error(`Invalid IP address format: ${ip}`);
    }
    
    return parts.reduce((acc, part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) {
        throw new Error(`Invalid IP address octet: ${part}`);
      }
      return (acc << 8) + num;
    }, 0) >>> 0; // Unsigned 32-bit integer
  }

  /**
   * Check if an IP address is in any of the provided CIDR blocks
   */
  static isIpInAnyCidrBlock(ip: string, cidrList: string[]): boolean {
    if (!this.isValidIpAddress(ip)) {
      return false;
    }

    for (const cidr of cidrList) {
      if (this.isIpInCidrBlock(ip, cidr)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Find which CIDR block matches the given IP address
   */
  static findMatchingCidr(ip: string, cidrList: string[]): string | undefined {
    if (!this.isValidIpAddress(ip)) {
      return undefined;
    }

    for (const cidr of cidrList) {
      if (this.isIpInCidrBlock(ip, cidr)) {
        return cidr;
      }
    }
    
    return undefined;
  }

  /**
   * Get the network address for a given CIDR block
   */
  static getNetworkAddress(cidr: string): string | null {
    try {
      const [network, prefixLength] = cidr.split('/');
      const prefix = parseInt(prefixLength, 10);
      
      if (isNaN(prefix) || prefix < 0 || prefix > 32) {
        return null;
      }

      const networkNum = this.ipToNumber(network);
      const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
      const networkAddress = networkNum & mask;
      
      return this.numberToIp(networkAddress);
    } catch (error) {
      return null;
    }
  }

  /**
   * Convert 32-bit number back to IP address string
   */
  static numberToIp(num: number): string {
    return [
      (num >>> 24) & 0xFF,
      (num >>> 16) & 0xFF,
      (num >>> 8) & 0xFF,
      num & 0xFF
    ].join('.');
  }

  /**
   * Get the broadcast address for a given CIDR block
   */
  static getBroadcastAddress(cidr: string): string | null {
    try {
      const [network, prefixLength] = cidr.split('/');
      const prefix = parseInt(prefixLength, 10);
      
      if (isNaN(prefix) || prefix < 0 || prefix > 32) {
        return null;
      }

      const networkNum = this.ipToNumber(network);
      const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
      const networkAddress = networkNum & mask;
      const broadcastAddress = networkAddress | (~mask >>> 0);
      
      return this.numberToIp(broadcastAddress);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get the number of host addresses in a CIDR block
   */
  static getHostCount(cidr: string): number | null {
    try {
      const [, prefixLength] = cidr.split('/');
      const prefix = parseInt(prefixLength, 10);
      
      if (isNaN(prefix) || prefix < 0 || prefix > 32) {
        return null;
      }

      return Math.pow(2, 32 - prefix);
    } catch (error) {
      return null;
    }
  }
}
