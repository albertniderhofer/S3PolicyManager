import { z } from 'zod';

// Policy Rule Schema
export const PolicyRuleSchema = z.object({
  id: z.string().min(1, 'Rule ID is required'),
  name: z.string().min(1, 'Rule name is required'),
  source: z.object({
    user: z.string().email('Valid email address required for user')
  }),
  destination: z.object({
    domains: z.string().min(1, 'Destination domains/ARN is required')
  }),
  time: z.object({
    not_between: z.tuple([
      z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format, use HH:MM'),
      z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format, use HH:MM')
    ]),
    days: z.array(z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']))
      .min(1, 'At least one day must be specified')
  }),
  action: z.enum(['block', 'allow'], {
    errorMap: () => ({ message: 'Action must be either "block" or "allow"' })
  }),
  track: z.object({
    log: z.boolean(),
    comment: z.string().optional().default('')
  })
});

// Main Policy Schema
export const PolicySchema = z.object({
  _id: z.string().uuid('Policy ID must be a valid UUID'),
  name: z.string()
    .min(1, 'Policy name is required')
    .max(100, 'Policy name must be less than 100 characters'),
  description: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .default(''),
  enabled: z.boolean().default(true),
  created: z.string().datetime('Invalid datetime format for created field'),
  updated: z.string().datetime('Invalid datetime format for updated field'),
  createdBy: z.string().min(1, 'Created by field is required'),
  updatedBy: z.string().min(1, 'Updated by field is required'),
  status: z.enum(['draft', 'published', 'deleted'], {
    errorMap: () => ({ message: 'Status must be draft, published, or deleted' })
  }).default('draft'),
  rules: z.array(PolicyRuleSchema)
    .min(1, 'At least one rule is required')
    .max(10, 'Maximum 10 rules allowed per policy')
});

// Policy Creation Schema (without _id, created, updated fields)
export const PolicyCreateSchema = PolicySchema.omit({
  _id: true,
  created: true,
  updated: true,
  createdBy: true,
  updatedBy: true
});

// Policy Update Schema (partial, without _id, created, createdBy)
export const PolicyUpdateSchema = PolicySchema.omit({
  _id: true,
  created: true,
  createdBy: true,
  updatedBy: true
}).partial().extend({
  updated: z.string().datetime('Invalid datetime format for updated field')
});

// SQS Event Schema
export const SQSEventSchema = z.object({
  eventType: z.enum(['create', 'update', 'delete']),
  policyId: z.string().uuid('Policy ID must be a valid UUID'),
  tenantId: z.string().uuid('Tenant ID must be a valid UUID'),
  timestamp: z.string().datetime('Invalid datetime format for timestamp'),
  triggeredBy: z.string().min(1, 'Triggered by field is required')
});

// Request Context Schema
export const RequestContextSchema = z.object({
  tenantId: z.string().uuid('Tenant ID must be a valid UUID'),
  userId: z.string().min(1, 'User ID is required'),
  username: z.string().min(1, 'Username is required'),
  groups: z.array(z.string()),
  requestId: z.string().min(1, 'Request ID is required'),
  timestamp: z.string().datetime('Invalid datetime format for timestamp')
});

// Validation helper functions
export class SchemaValidator {
  static validatePolicy(data: unknown): z.infer<typeof PolicySchema> {
    try {
      return PolicySchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        throw new Error(`Policy validation failed: ${errorMessages}`);
      }
      throw error;
    }
  }

  static validatePolicyCreate(data: unknown): z.infer<typeof PolicyCreateSchema> {
    try {
      return PolicyCreateSchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        throw new Error(`Policy creation validation failed: ${errorMessages}`);
      }
      throw error;
    }
  }

  static validatePolicyUpdate(data: unknown): z.infer<typeof PolicyUpdateSchema> {
    try {
      return PolicyUpdateSchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        throw new Error(`Policy update validation failed: ${errorMessages}`);
      }
      throw error;
    }
  }

  static validateSQSEvent(data: unknown): z.infer<typeof SQSEventSchema> {
    try {
      return SQSEventSchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        throw new Error(`SQS event validation failed: ${errorMessages}`);
      }
      throw error;
    }
  }

  static validateRequestContext(data: unknown): z.infer<typeof RequestContextSchema> {
    try {
      return RequestContextSchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        throw new Error(`Request context validation failed: ${errorMessages}`);
      }
      throw error;
    }
  }
}

// Type exports for use in other files
export type PolicyType = z.infer<typeof PolicySchema>;
export type PolicyCreateType = z.infer<typeof PolicyCreateSchema>;
export type PolicyUpdateType = z.infer<typeof PolicyUpdateSchema>;
export type PolicyRuleType = z.infer<typeof PolicyRuleSchema>;
export type SQSEventType = z.infer<typeof SQSEventSchema>;
export type RequestContextType = z.infer<typeof RequestContextSchema>;
