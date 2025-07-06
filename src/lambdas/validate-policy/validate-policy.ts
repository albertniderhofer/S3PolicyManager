import { PolicyRepository } from '../../shared/repository';
import { RequestContextManager, ContextUtils } from '../../shared/context';
import { StepFunctionInput, StepFunctionOutput } from '../../shared/types';

/**
 * Step Functions Task: Validate Policy
 * Validates policy data and business rules
 */

// Repository will auto-initialize using environment variables when first used

export const handler = async (input: StepFunctionInput): Promise<StepFunctionOutput> => {
  // Initialize context for the validation first
  RequestContextManager.initializeFromEvent({
    tenantId: input.policyEvent.tenantId,
    username: input.policyEvent.triggeredBy,
    requestId: `validate-${input.policyEvent.policyId}`,
    timestamp: input.policyEvent.timestamp,
    userGroups: ['Admin'] // Assume admin for system operations
  });

  const startLogEntry = ContextUtils.createLogEntry('INFO', 'Validate Policy task started', {
    policyId: input.policyEvent.policyId,
    eventType: input.policyEvent.eventType,
    messageId: input.messageId,
    executionStartTime: input.executionStartTime
  });
  console.log(JSON.stringify(startLogEntry));

  try {
    const { policyEvent } = input;
    
    // Use single validation function with operation type parameter
    const validationResult = await validatePolicy(policyEvent.policyId, policyEvent.eventType);

    const completionLogEntry = ContextUtils.createLogEntry('INFO', 'Policy validation completed', {
      policyId: policyEvent.policyId,
      isValid: validationResult.isValid,
      issuesCount: validationResult.issues.length,
      issues: validationResult.issues
    });
    console.log(JSON.stringify(completionLogEntry));

    return {
      ...input,
      validationResult,
      taskResults: {
        ...input.taskResults,
        validatePolicy: {
          status: validationResult.isValid ? 'success' : 'failed',
          timestamp: new Date().toISOString(),
          result: validationResult
        }
      }
    };

  } catch (error) {
    const errorLogEntry = ContextUtils.createLogEntry('ERROR', 'Policy validation failed', {
      policyId: input.policyEvent.policyId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error(JSON.stringify(errorLogEntry));

    return {
      ...input,
      validationResult: {
        isValid: false,
        issues: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      },
      taskResults: {
        ...input.taskResults,
        validatePolicy: {
          status: 'error',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    };
  }
};

/**
 * Unified policy validation function
 * Handles create, update, and delete operations with a single efficient function
 */
async function validatePolicy(policyId: string, operationType: 'create' | 'update' | 'delete') {
  const validationLogEntry = ContextUtils.createLogEntry('INFO', `Starting policy ${operationType} validation`, {
    policyId,
    operationType
  });
  console.log(JSON.stringify(validationLogEntry));
  
  const issues: string[] = [];
  
  try {
    // Get the policy to validate
    const policy = await PolicyRepository.getPolicyById(policyId);
    
    const policyRetrievedLogEntry = ContextUtils.createLogEntry('INFO', 'Policy retrieved for validation', {
      policyId,
      policyName: policy.name,
      policyStatus: policy.status,
      rulesCount: policy.rules?.length || 0
    });
    console.log(JSON.stringify(policyRetrievedLogEntry));
    
    // Content validations only for create and update operations
    // Delete operations only need to check if deletion is allowed
    if (operationType === 'create' || operationType === 'update') {
      // Basic policy validations
      if (!policy.name || policy.name.trim().length === 0) {
        issues.push('Policy name is required');
      }
      
      if (!policy.description || policy.description.trim().length === 0) {
        issues.push('Policy description is required');
      }
      
      if (!policy.rules || policy.rules.length === 0) {
        issues.push('Policy must have at least one rule');
      }
      
      // Validate policy rules structure
      if (policy.rules && Array.isArray(policy.rules)) {
        policy.rules.forEach((rule, index) => {
          if (!rule.id || rule.id.trim().length === 0) {
            issues.push(`Rule ${index + 1}: ID is required`);
          }
          
          if (!rule.name || rule.name.trim().length === 0) {
            issues.push(`Rule ${index + 1}: Name is required`);
          }
          
          if (!rule.action || !['allow', 'block'].includes(rule.action)) {
            issues.push(`Rule ${index + 1}: Action must be 'allow' or 'block'`);
          }
          
          if (!rule.source || !rule.source.user) {
            issues.push(`Rule ${index + 1}: Source user is required`);
          }
          
          if (!rule.destination || !rule.destination.domains) {
            issues.push(`Rule ${index + 1}: Destination domains are required`);
          }
        });
      }
      
      // Check for duplicate policy names (business rule)
      const allPolicies = await PolicyRepository.getAllPolicies();
      const duplicateName = allPolicies.find(p => 
        p._id !== policyId && 
        p.name.toLowerCase() === policy.name.toLowerCase()
      );
      
      if (duplicateName) {
        issues.push(`Policy name '${policy.name}' already exists`);
      }
    }
    
    // Operation-specific validations
    switch (operationType) {
      case 'update':
        // Additional update-specific validations
        if (policy.status === 'deleted') {
          issues.push('Cannot update deleted policies');
        }
        break;
        
      case 'delete':
        // For delete operations, only check if deletion is allowed
        // No content validation needed - just policy ID existence (already verified by getPolicyById)
        
        // Business rule: Cannot delete already deleted policies
        if (policy.status === 'deleted') {
          issues.push('Policy is already deleted');
        }
        
        // Add more business rules as needed
        // For example: check if policy is referenced by other resources
        // Note: Unlike create/update, we don't validate policy content for deletion
        break;
        
      case 'create':
        // Create-specific validations can be added here if needed
        break;
        
      default:
        issues.push(`Unknown operation type: ${operationType}`);
    }
    
  } catch (error) {
    issues.push(`Failed to retrieve policy for validation: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}
