import { APIGatewayProxyEvent, SQSRecord } from 'aws-lambda';
import { RequestContext, CognitoTokenPayload, SQSEvent } from './types';


/**
 * Request Context Manager - Instance-based for proper tenant isolation
 * Each Lambda invocation should create its own instance
 */
export class RequestContextManager {
  private context: RequestContext | SQSEvent;
  private correlationId: string;

  private isCognitoTokenPayload(obj: any): obj is CognitoTokenPayload {
    return typeof obj.sub === "string" && typeof obj.exp === "string";
  }

  private isSQSEvent(obj: any): obj is SQSEvent {
    return typeof obj.policyId === "string" && typeof obj.tenantId === "string";
  }

  /**
   * Constructor from token payload and request ID
   */
  constructor(tokenPayload: CognitoTokenPayload | SQSEvent, correlationId: string) {
    if (this.isCognitoTokenPayload(tokenPayload)) {
      this.context = {
        tenantId: tokenPayload['custom:tenant_id'],
        userId: tokenPayload.sub,
        username: tokenPayload.username,
        groups: tokenPayload['cognito:groups'] || [],
        correlationId: correlationId,
        timestamp: new Date().toISOString()
      };
    }
    else if (this.isSQSEvent(tokenPayload)) {
      this.context = {
          eventType: tokenPayload.eventType,
          policyId: tokenPayload.policyId,
          tenantId: tokenPayload.tenantId,
          timestamp: tokenPayload.timestamp,
          triggeredBy: tokenPayload.triggeredBy,
          correlationId: correlationId,
        }  
    }

  }

  getRequestContext(): RequestContext  {
    return this.context as RequestContext;
  }

  getEventContext(): SQSEvent  {
    return this.context as SQSEvent;
  }

  /**
   * Static method for testing purposes - creates a test instance
   */
  createRequestContextForTesting(
    tenantId: string,
    userId: string,
    username: string,
    groups: string[] = ['Admin'],
    requestId: string = 'test-request-id'
  ): RequestContextManager {
    const testPayload: CognitoTokenPayload = {
      'custom:tenant_id': tenantId,
      sub: userId,
      username: username,
      'cognito:groups': groups,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'test',
      aud: 'test',
      token_use: 'access'
    };
    return new RequestContextManager(testPayload, requestId);
  }

  /**
   * Create audit trail object with curren request context
   */
  createRequestAuditTrail(contextManager: RequestContextManager, action: string, resourceId?: string): {
    action: string;
    resourceId?: string;
    tenantId: string;
    userId: string;
    username: string;
    timestamp: string;
    correlationId: string;
  } {
    return {
      action,
      resourceId,
      tenantId: (this.context as RequestContext).tenantId ,
      userId: (this.context as RequestContext).userId ,
      username: (this.context as RequestContext).username ,
      timestamp: (this.context as RequestContext).timestamp ,
      correlationId: this.correlationId,
    };
  }

  /**
   * TBD: Create audit trail object with current event context
   */


  /**
   * Create standardized log entry with context
   */
  createLogEntry(
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
    message: string,
    metadata?: Record<string, any>
  ): {
    level: string;
    message: string;
    tenantId: string;
    timestamp: string;
    correlationId?: string;
    metadata?: Record<string, any>;
  } {    
    return {
      level,
      message,
      tenantId: this.context.tenantId,
      timestamp: this.context.timestamp,
     correlationId: this.correlationId,
      ...(metadata && { metadata })
    };
  }

  /**
   * Validate tenant access to resource
   */
  validateTenantAccess(resourceTenantId: string): void {
    if (resourceTenantId !== this.context.tenantId) {
      throw new Error(`Access denied: Resource belongs to different tenant. Current: ${this.context.tenantId}, Resource: ${resourceTenantId}`);
    }
  }
}
