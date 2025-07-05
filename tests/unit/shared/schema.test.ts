import { SchemaValidator } from '../../../src/shared/schema';
import { Policy, PolicyRule, SQSEvent } from '../../../src/shared/types';

describe('SchemaValidator', () => {
  describe('validatePolicyCreate', () => {
    it('should validate a valid policy creation request', () => {
      const validPolicy = {
        name: 'Test Policy',
        description: 'A test policy',
        enabled: true,
        rules: [
          {
            id: 'rule-1',
            name: 'Block Social Media',
            source: { user: 'john.doe' },
            destination: { domains: 'facebook.com,twitter.com' },
            time: {
              not_between: ['09:00', '17:00'] as [string, string],
              days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
            },
            action: 'block' as const,
            track: {
              log: true,
              comment: 'Block social media during work hours'
            }
          }
        ]
      };

      expect(() => SchemaValidator.validatePolicyCreate(validPolicy)).not.toThrow();
    });

    it('should throw error for invalid policy creation request', () => {
      const invalidPolicy = {
        name: '', // Empty name should fail
        description: 'A test policy',
        enabled: true,
        rules: []
      };

      expect(() => SchemaValidator.validatePolicyCreate(invalidPolicy)).toThrow();
    });
  });

  describe('validatePolicyUpdate', () => {
    it('should validate a valid policy update request', () => {
      const validUpdate = {
        name: 'Updated Policy Name',
        description: 'Updated description',
        enabled: false
      };

      expect(() => SchemaValidator.validatePolicyUpdate(validUpdate)).not.toThrow();
    });

    it('should allow partial updates', () => {
      const partialUpdate = {
        enabled: false
      };

      expect(() => SchemaValidator.validatePolicyUpdate(partialUpdate)).not.toThrow();
    });
  });

  describe('validateSQSEvent', () => {
    it('should validate a valid SQS event', () => {
      const validEvent: SQSEvent = {
        eventType: 'create',
        policyId: 'policy-123',
        tenantId: 'tenant-456',
        timestamp: new Date().toISOString(),
        triggeredBy: 'john.doe'
      };

      expect(() => SchemaValidator.validateSQSEvent(validEvent)).not.toThrow();
    });

    it('should throw error for invalid event type', () => {
      const invalidEvent = {
        eventType: 'invalid',
        policyId: 'policy-123',
        tenantId: 'tenant-456',
        timestamp: new Date().toISOString(),
        triggeredBy: 'john.doe'
      };

      expect(() => SchemaValidator.validateSQSEvent(invalidEvent)).toThrow();
    });

    it('should throw error for missing required fields', () => {
      const invalidEvent = {
        eventType: 'create',
        // Missing policyId
        tenantId: 'tenant-456',
        timestamp: new Date().toISOString(),
        triggeredBy: 'john.doe'
      };

      expect(() => SchemaValidator.validateSQSEvent(invalidEvent)).toThrow();
    });
  });
});
