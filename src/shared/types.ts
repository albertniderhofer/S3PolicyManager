export interface PolicyRule {
  id: string;
  name: string;
  source: {
    user: string;
  };
  destination: {
    domains: string;
  };
  time: {
    not_between: [string, string];
    days: string[];
  };
  action: 'block' | 'allow';
  track: {
    log: boolean;
    comment: string;
  };
}

export interface Policy {
  _id: string;
  name: string;
  description: string;
  enabled: boolean;
  created: string;
  updated: string;
  createdBy: string;
  updatedBy: string;
  status: 'draft' | 'published' | 'deleted';
  rules: PolicyRule[];
}

export interface PolicyRecord {
  PK: string;
  SK: string;
  PolicyID: string;
  TenantID: string;
  PolicyContent: string;
  State: 'created' | 'in-publish' | 'published' | 'deleted';
  Created: string;
  Updated: string;
  CreatedBy: string;
  UpdatedBy: string;
}

export interface RequestContext {
  tenantId: string;
  userId: string;
  username: string;
  groups: string[];
  requestId: string;
  timestamp: string;
  traceId?: string;
  correlationId?: string;
}

export interface SQSEvent {
  eventType: 'create' | 'update' | 'delete';
  policyId: string;
  tenantId: string;
  timestamp: string;
  triggeredBy: string;
}

export interface CognitoTokenPayload {
  sub: string;
  username: string;
  'custom:tenant_id': string;
  'cognito:groups': string[];
  exp: number;
  iss: string;
  aud: string;
  token_use: string;
  email?: string;
  display_username?: string;
}

export interface APIResponse<T = any> {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

export interface ErrorResponse {
  error: string;
  message: string;
  requestId?: string;
  timestamp: string;
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Step Functions workflow types
 */
export interface ValidationResult {
  isValid: boolean;
  issues: string[];
}

export interface TaskResult {
  status: 'success' | 'failed' | 'error';
  timestamp: string;
  result?: any;
  error?: string;
}

export interface StepFunctionInput {
  policyEvent: SQSEvent;
  messageId: string;
  executionStartTime: string;
  validationResult?: ValidationResult;
  taskResults?: Record<string, TaskResult>;
}

export interface StepFunctionOutput extends StepFunctionInput {
  validationResult: ValidationResult;
  taskResults: Record<string, TaskResult>;
}

export interface UserPolicyRecord {
  PK: string; // tenantId + source + destination
  SK: string; // ruleId
  TenantID: string;
  RuleID: string;
  RuleName: string;
  Source: string;
  Destination: string;
  Action: 'block' | 'allow';
  TimeRestrictions: {
    not_between: [string, string];
    days: string[];
  };
  TrackingConfig: {
    log: boolean;
    comment: string;
  };
  PolicyID: string;
  PolicyName: string;
  Created: string;
  Updated: string;
  CreatedBy: string;
  UpdatedBy: string;
}
