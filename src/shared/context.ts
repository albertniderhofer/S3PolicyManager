import { APIGatewayProxyEvent } from 'aws-lambda';
import { RequestContext, CognitoTokenPayload } from './types';

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
  static initializeFromEvent(eventContext: {
    tenantId: string;
    userId?: string;
    username: string;
    requestId: string;
    timestamp: string;
    userGroups: string[];
    traceId?: string;
    correlationId?: string;
  }): void {
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
