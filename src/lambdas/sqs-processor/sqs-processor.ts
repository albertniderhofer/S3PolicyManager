import { SQSEvent, SQSRecord } from 'aws-lambda';
import { SchemaValidator } from '../../shared/schema';
import { RequestContextManager, ContextUtils } from '../../shared/context';
import { PolicyRepository, UserPolicyRepository } from '../../shared/repository';
import { SQSEvent as PolicySQSEvent } from '../../shared/types';

/**
 * SQS Message Processor Lambda
 * Processes policy events from SQS with inline validation, publishing, and UserPolicies updates
 */

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('SQS Processor invoked:', {
    recordCount: event.Records.length,
    timestamp: new Date().toISOString()
  });

  // Process each SQS record
  const promises = event.Records.map(record => processRecord(record));
  
  try {
    await Promise.all(promises);
    console.log('Successfully processed all SQS records:', {
      recordCount: event.Records.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing SQS records:', {
      recordCount: event.Records.length,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
    throw error; // This will cause the messages to be retried or sent to DLQ
  }
};

/**
 * Process a single SQS record
 */
async function processRecord(record: SQSRecord): Promise<void> {
  // Extract tracing information from message attributes
  const traceId = record.messageAttributes?.['X-Trace-Id']?.stringValue || 
                  record.messageAttributes?.['traceId']?.stringValue || 
                  'unknown';
  const correlationId = record.messageAttributes?.['X-Correlation-Id']?.stringValue || 
                        record.messageAttributes?.['correlationId']?.stringValue || 
                        record.messageId;

  console.log('Processing SQS record:', {
    messageId: record.messageId,
    traceId,
    correlationId,
    receiptHandle: record.receiptHandle.substring(0, 20) + '...', // Truncate for logging
    timestamp: new Date().toISOString()
  });

  try {
    // Parse the message body
    const messageBody = JSON.parse(record.body);
    
    // Validate the SQS event structure
    const policyEvent = SchemaValidator.validateSQSEvent(messageBody);
    
    // Initialize context from the policy event for structured logging
    RequestContextManager.initializeFromEvent({
      tenantId: policyEvent.tenantId,
      username: policyEvent.triggeredBy,
      requestId: correlationId,
      timestamp: policyEvent.timestamp,
      userGroups: ['System']
    });

    const logEntry = ContextUtils.createLogEntry('INFO', 'Validated policy event from SQS', {
      eventType: policyEvent.eventType,
      policyId: policyEvent.policyId,
      tenantId: policyEvent.tenantId,
      traceId,
      correlationId,
      messageId: record.messageId
    });
    console.log(JSON.stringify(logEntry));

    // Process the policy event based on type
    await processPolicyEvent(policyEvent, record.messageId);
    
  } catch (error) {
    // Log error with context if available
    if (RequestContextManager.isInitialized()) {
      const errorLogEntry = ContextUtils.createLogEntry('ERROR', 'Error processing SQS record', {
        messageId: record.messageId,
        traceId,
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      console.error(JSON.stringify(errorLogEntry));
    } else {
      console.error('Error processing SQS record (context not initialized):', {
        messageId: record.messageId,
        traceId,
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        body: record.body,
        timestamp: new Date().toISOString()
      });
    }
    throw error;
  }
}

/**
 * Process the policy event with inline validation, publishing, and UserPolicies updates
 */
async function processPolicyEvent(
  policyEvent: PolicySQSEvent,
  messageId: string
): Promise<void> {
  const startLogEntry = ContextUtils.createLogEntry('INFO', 'Processing policy event with validation and publishing', {
    policyId: policyEvent.policyId,
    eventType: policyEvent.eventType,
    tenantId: policyEvent.tenantId,
    messageId
  });
  console.log(JSON.stringify(startLogEntry));

  try {
    // Step 1: Validate the policy
    const validationResult = await validatePolicy(policyEvent.policyId, policyEvent.eventType);
    
    const validationLogEntry = ContextUtils.createLogEntry('INFO', 'Policy validation completed', {
      policyId: policyEvent.policyId,
      isValid: validationResult.isValid,
      issuesCount: validationResult.issues.length,
      issues: validationResult.issues
    });
    console.log(JSON.stringify(validationLogEntry));

    // If validation fails, throw error to stop processing
    if (!validationResult.isValid) {
      throw new Error(`Policy validation failed: ${validationResult.issues.join(', ')}`);
    }

    // Step 2: Publish the policy to external systems
    const publishResult = await publishPolicy(policyEvent.policyId, policyEvent.eventType);
    
    const publishLogEntry = ContextUtils.createLogEntry('INFO', 'Policy publish completed', {
      policyId: policyEvent.policyId,
      success: publishResult.success,
      message: publishResult.message,
      newStatus: publishResult.newStatus
    });
    console.log(JSON.stringify(publishLogEntry));

    // If publishing fails, throw error to stop processing
    if (!publishResult.success) {
      throw new Error(`Policy publishing failed: ${publishResult.message}`);
    }

    // Step 3: Update UserPolicies table (only after successful validation and publishing)
    const policy = await PolicyRepository.getPolicyById(policyEvent.policyId);
    
    const policyFetchedLogEntry = ContextUtils.createLogEntry('INFO', 'Successfully fetched policy data for UserPolicies update', {
      policyId: policy._id,
      policyName: policy.name,
      rulesCount: policy.rules.length,
      eventType: policyEvent.eventType
    });
    console.log(JSON.stringify(policyFetchedLogEntry));

    // Handle different event types for UserPolicies
    switch (policyEvent.eventType) {
      case 'create':
      case 'update':
        // Save/update policy rules in UserPolicies table
        await UserPolicyRepository.savePolicyRules(
          policy,
          policyEvent.tenantId,
          policyEvent.triggeredBy
        );
        break;
        
      case 'delete':
        // Delete policy rules from UserPolicies table
        await UserPolicyRepository.deletePolicyRules(
          policyEvent.policyId,
          policyEvent.tenantId
        );
        break;
        
      default:
        throw new Error(`Unsupported event type: ${policyEvent.eventType}`);
    }
    
    const successLogEntry = ContextUtils.createLogEntry('INFO', 'Successfully processed complete policy workflow', {
      policyId: policyEvent.policyId,
      eventType: policyEvent.eventType,
      tenantId: policyEvent.tenantId,
      rulesProcessed: policy.rules.length,
      validationPassed: true,
      publishingSucceeded: true,
      userPoliciesUpdated: true
    });
    console.log(JSON.stringify(successLogEntry));
    
  } catch (error) {
    const errorLogEntry = ContextUtils.createLogEntry('ERROR', 'Failed to process policy workflow', {
      policyId: policyEvent.policyId,
      eventType: policyEvent.eventType,
      tenantId: policyEvent.tenantId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error(JSON.stringify(errorLogEntry));
    
    throw new Error(`Failed to process policy workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Inline policy validation function
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
        if (policy.status === 'deleted') {
          issues.push('Cannot update deleted policies');
        }
        break;
        
      case 'delete':
        if (policy.status === 'deleted') {
          issues.push('Policy is already deleted');
        }
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

/**
 * Inline policy publishing function
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
