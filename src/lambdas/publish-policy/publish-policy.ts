import { PolicyRepository } from '../../shared/repository';
import { RequestContextManager, ContextUtils } from '../../shared/context';
import { StepFunctionInput, StepFunctionOutput } from '../../shared/types';

/**
 * Step Functions Task: Publish Policy
 * Publishes policy to external systems and updates status
 */

// Repository will auto-initialize using environment variables when first used

export const handler = async (input: StepFunctionInput): Promise<StepFunctionOutput> => {
  // Initialize context for the publish operation first
  RequestContextManager.initializeFromEvent({
    tenantId: input.policyEvent.tenantId,
    username: input.policyEvent.triggeredBy,
    requestId: `publish-${input.policyEvent.policyId}`,
    timestamp: input.policyEvent.timestamp,
    userGroups: ['Admin'] // Assume admin for system operations
  });

  const startLogEntry = ContextUtils.createLogEntry('INFO', 'Publish Policy task started', {
    policyId: input.policyEvent.policyId,
    eventType: input.policyEvent.eventType,
    messageId: input.messageId,
    executionStartTime: input.executionStartTime,
    validationPassed: input.validationResult?.isValid || false
  });
  console.log(JSON.stringify(startLogEntry));

  try {
    const { policyEvent } = input;
    
    // Use single publish function with operation type parameter
    const publishResult = await publishPolicy(policyEvent.policyId, policyEvent.eventType);

    const completionLogEntry = ContextUtils.createLogEntry('INFO', 'Policy publish completed', {
      policyId: policyEvent.policyId,
      success: publishResult.success,
      message: publishResult.message,
      newStatus: publishResult.newStatus
    });
    console.log(JSON.stringify(completionLogEntry));

    return {
      ...input,
      validationResult: input.validationResult || { isValid: true, issues: [] },
      taskResults: {
        ...input.taskResults,
        publishPolicy: {
          status: publishResult.success ? 'success' : 'failed',
          timestamp: new Date().toISOString(),
          result: publishResult
        }
      }
    };

  } catch (error) {
    const errorLogEntry = ContextUtils.createLogEntry('ERROR', 'Policy publish failed', {
      policyId: input.policyEvent.policyId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error(JSON.stringify(errorLogEntry));

    return {
      ...input,
      validationResult: input.validationResult || { isValid: true, issues: [] },
      taskResults: {
        ...input.taskResults,
        publishPolicy: {
          status: 'error',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    };
  }
};

/**
 * Unified policy publishing function
 * Handles create, update, and delete operations with a single efficient function
 */
async function publishPolicy(policyId: string, operationType: 'create' | 'update' | 'delete') {
  const publishLogEntry = ContextUtils.createLogEntry('INFO', `Starting policy ${operationType} publish`, {
    policyId,
    operationType
  });
  console.log(JSON.stringify(publishLogEntry));
  
  try {
    // Get the policy to publish
    const policy = await PolicyRepository.getPolicyById(policyId);
    
    const policyRetrievedLogEntry = ContextUtils.createLogEntry('INFO', 'Policy retrieved for publishing', {
      policyId: policy._id,
      policyName: policy.name,
      rulesCount: policy.rules.length,
      currentStatus: policy.status,
      operationType
    });
    console.log(JSON.stringify(policyRetrievedLogEntry));
    
    const simulationLogEntry = ContextUtils.createLogEntry('INFO', `Simulating external system ${operationType}`, {
      policyId: policy._id,
      policyName: policy.name,
      operationType
    });
    console.log(JSON.stringify(simulationLogEntry));
    
    // Simulate publishing to external systems
    // In a real implementation, this would:
    // 1. Transform policy to external format
    // 2. Call external APIs (firewall, proxy, etc.)
    // 3. Handle retries and error cases
    // 4. Update policy status based on results
    
    // Simulate API calls with delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Determine new status and update policy based on operation type
    let newStatus: 'published' | 'draft' | 'deleted';
    let updateData: any;
    let successMessage: string;
    let timestampField: string;
    
    switch (operationType) {
      case 'create':
        newStatus = 'published';
        updateData = {
          status: newStatus,
          updated: new Date().toISOString(),
          updatedBy: RequestContextManager.getUsername()
        };
        successMessage = 'Policy successfully published to external systems';
        timestampField = 'publishedAt';
        break;
        
      case 'update':
        // If policy was in draft, move to published; if already published, keep as published
        newStatus = policy.status === 'draft' ? 'published' : policy.status;
        updateData = {
          status: newStatus,
          updated: new Date().toISOString(),
          updatedBy: RequestContextManager.getUsername()
        };
        successMessage = 'Policy update successfully published to external systems';
        timestampField = 'publishedAt';
        break;
        
      case 'delete':
        newStatus = 'deleted';
        updateData = {
          status: newStatus,
          updated: new Date().toISOString(),
          updatedBy: RequestContextManager.getUsername()
        };
        successMessage = 'Policy deletion successfully published to external systems';
        timestampField = 'deletedAt';
        break;
        
      default:
        throw new Error(`Unknown operation type: ${operationType}`);
    }
    
    // Update policy status
    const updatedPolicy = await PolicyRepository.updatePolicy(policyId, updateData);
    
    return {
      success: true,
      message: successMessage,
      policyId,
      newStatus: updatedPolicy.status,
      [timestampField]: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`Failed to publish policy ${operationType}:`, error);
    
    // Handle failure based on operation type
    if (operationType === 'create') {
      // Update policy status to indicate publish failure
      try {
        await PolicyRepository.updatePolicy(policyId, {
          status: 'draft' as const,
          updated: new Date().toISOString(),
          updatedBy: RequestContextManager.getUsername()
        });
      } catch (updateError) {
        console.error('Failed to update policy status after publish failure:', updateError);
      }
    }
    
    return {
      success: false,
      message: `Failed to publish policy ${operationType}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      policyId,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
