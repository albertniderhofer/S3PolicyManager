import { APIGatewayProxyEvent } from 'aws-lambda';
import { RequestContext, CognitoTokenPayload } from './types';
import { CidrCache } from './cidr-cache';

/**
 * Global Request Context Manager
 * Provides centralized access to request context including tenant isolation
 */
export class RequestContextManager {
  private static context: RequestContext | null = null;

  /**
   * Initialize context from token payload and request ID
   */
  static initialize(tokenPayload: CognitoTokenPayload, requestId: string): void {
    this.context = {
      tenantId: tokenPayload['custom:tenant_id'],
      userId: tokenPayload.sub,
      username: tokenPayload.username,
      groups: tokenPayload['cognito:groups'] || [],
      requestId,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Initialize context from event data (for Step Functions and API Gateway)
   */
  static async initializeFromEvent(eventContext: {
    tenantId: string;
    userId?: string;
    username: string;
    requestId: string;
    timestamp: string;
    userGroups: string[];
    traceId?: string;
    correlationId?: string;
  }): Promise<void> {
    this.context = {
      tenantId: eventContext.tenantId,
      userId: eventContext.userId || `system-${eventContext.username}`,
      username: eventContext.username,
      groups: eventContext.userGroups,
      requestId: eventContext.requestId,
      timestamp: eventContext.timestamp,
      traceId: eventContext.traceId,
      correlationId: eventContext.correlationId
    };

    // Load CIDR blacklist for this tenant
    await this.loadCidrBlacklist();
  }

  /**
   * Get the current tenant ID - used for all database operations
   */
  static getTenantId(): string {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.tenantId;
  }

  /**
   * Get the current username - used for audit trails
   */
  static getUsername(): string {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.username;
  }

  /**
   * Get the current user ID
   */
  static getUserId(): string {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.userId;
  }

  /**
   * Get user groups for authorization checks
   */
  static getUserGroups(): string[] {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.groups;
  }

  /**
   * Get the request ID for logging and tracing
   */
  static getRequestId(): string {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.requestId;
  }

  /**
   * Get the request timestamp
   */
  static getTimestamp(): string {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.timestamp;
  }

  /**
   * Get the trace ID for distributed tracing
   */
  static getTraceId(): string | undefined {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.traceId;
  }

  /**
   * Get the correlation ID for request correlation
   */
  static getCorrelationId(): string | undefined {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.correlationId;
  }

  /**
   * Get the full request context
   */
  static getFullContext(): RequestContext {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return { ...this.context };
  }

  /**
   * Check if user has admin privileges
   */
  static isAdmin(): boolean {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.groups.includes('Admin');
  }

  /**
   * Clear the context (useful for testing)
   */
  static clear(): void {
    this.context = null;
  }

  /**
   * Check if context is initialized
   */
  static isInitialized(): boolean {
    return this.context !== null;
  }

  /**
   * Create a context for testing purposes
   */
  static initializeForTesting(
    tenantId: string,
    userId: string,
    username: string,
    groups: string[] = ['Admin'],
    requestId: string = 'test-request-id'
  ): void {
    this.context = {
      tenantId,
      userId,
      username,
      groups,
      requestId,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Load CIDR blacklist for current tenant and store in context
   */
  private static async loadCidrBlacklist(): Promise<void> {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }

    try {
      const cidrList = await CidrCache.getCidrList(this.context.tenantId);
      this.context.cidrBlackList = cidrList;
      
      console.log(`Loaded ${cidrList.length} CIDR entries for tenant ${this.context.tenantId}`, {
        tenantId: this.context.tenantId,
        requestId: this.context.requestId,
        cidrCount: cidrList.length
      });
    } catch (error) {
      console.warn(`Failed to load CIDR blacklist for tenant ${this.context.tenantId}, continuing without CIDR checking:`, {
        tenantId: this.context.tenantId,
        requestId: this.context.requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Continue with empty CIDR list as per requirement
      this.context.cidrBlackList = [];
    }
  }

  /**
   * Get CIDR blacklist from context
   */
  static getCidrBlacklist(): string[] {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }
    return this.context.cidrBlackList || [];
  }

  /**
   * Check if an IP address is blacklisted
   */
  static isIpBlacklisted(ip: string): boolean {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }

    const cidrList = this.context.cidrBlackList || [];
    if (cidrList.length === 0) {
      return false;
    }

    // Check IP against each CIDR block
    for (const cidr of cidrList) {
      if (this.isIpInCidr(ip, cidr)) {
        console.log(`IP ${ip} matches CIDR blacklist entry: ${cidr}`, {
          ip,
          cidr,
          tenantId: this.context.tenantId,
          requestId: this.context.requestId
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an IP address is within a CIDR block
   */
  private static isIpInCidr(ip: string, cidr: string): boolean {
    try {
      const [network, prefixLength] = cidr.split('/');
      const prefix = parseInt(prefixLength, 10);
      
      if (isNaN(prefix) || prefix < 0 || prefix > 32) {
        console.warn(`Invalid CIDR prefix length: ${cidr}`);
        return false;
      }

      const ipNum = this.ipToNumber(ip);
      const networkNum = this.ipToNumber(network);
      const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
      
      return (ipNum & mask) === (networkNum & mask);
    } catch (error) {
      console.warn(`Error checking IP ${ip} against CIDR ${cidr}:`, error);
      return false;
    }
  }

  /**
   * Convert IP address string to number
   */
  private static ipToNumber(ip: string): number {
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
   * Refresh CIDR cache for current tenant
   */
  static async refreshCidrCache(): Promise<void> {
    if (!this.context) {
      throw new Error('Request context not initialized. Call initialize() first.');
    }

    try {
      await CidrCache.refreshCache(this.context.tenantId);
      await this.loadCidrBlacklist(); // Reload into context
      
      console.log(`Successfully refreshed CIDR cache for tenant ${this.context.tenantId}`, {
        tenantId: this.context.tenantId,
        requestId: this.context.requestId,
        newCidrCount: this.context.cidrBlackList?.length || 0
      });
    } catch (error) {
      console.error(`Failed to refresh CIDR cache for tenant ${this.context.tenantId}:`, {
        tenantId: this.context.tenantId,
        requestId: this.context.requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

/**
 * Context utilities for common operations
 */
export class ContextUtils {
  /**
   * Extract request ID from API Gateway event
   */
  static extractRequestId(event: APIGatewayProxyEvent): string {
    return event.requestContext.requestId;
  }

  /**
   * Create audit trail object with current context
   */
  static createAuditTrail(action: string, resourceId?: string): {
    action: string;
    resourceId?: string;
    tenantId: string;
    userId: string;
    username: string;
    timestamp: string;
    requestId: string;
  } {
    return {
      action,
      resourceId,
      tenantId: RequestContextManager.getTenantId(),
      userId: RequestContextManager.getUserId(),
      username: RequestContextManager.getUsername(),
      timestamp: RequestContextManager.getTimestamp(),
      requestId: RequestContextManager.getRequestId()
    };
  }

  /**
   * Create standardized log entry with context
   */
  static createLogEntry(
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
    message: string,
    metadata?: Record<string, any>
  ): {
    level: string;
    message: string;
    tenantId: string;
    userId: string;
    requestId: string;
    timestamp: string;
    traceId?: string;
    correlationId?: string;
    metadata?: Record<string, any>;
  } {
    const traceId = RequestContextManager.getTraceId();
    const correlationId = RequestContextManager.getCorrelationId();
    
    return {
      level,
      message,
      tenantId: RequestContextManager.getTenantId(),
      userId: RequestContextManager.getUserId(),
      requestId: RequestContextManager.getRequestId(),
      timestamp: RequestContextManager.getTimestamp(),
      ...(traceId && { traceId }),
      ...(correlationId && { correlationId }),
      ...(metadata && { metadata })
    };
  }

  /**
   * Validate tenant access to resource
   */
  static validateTenantAccess(resourceTenantId: string): void {
    const currentTenantId = RequestContextManager.getTenantId();
    if (resourceTenantId !== currentTenantId) {
      throw new Error(`Access denied: Resource belongs to different tenant. Current: ${currentTenantId}, Resource: ${resourceTenantId}`);
    }
  }
}
