import { SQSEvent, SQSRecord } from 'aws-lambda';
import { SchemaValidator } from '../../shared/schema';
import { RequestContextManager, ContextUtils } from '../../shared/context';
import { PolicyRepository, UserPolicyRepository } from '../../shared/repository';
import { SQSEvent as PolicySQSEvent } from '../../shared/types';

/**
 * SQS Message Processor Lambda
 * Processes policy events from SQS and saves rule data to UserPolicies table
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
 * Process the policy event and save rules to UserPolicies table
 */
async function processPolicyEvent(
  policyEvent: PolicySQSEvent,
  messageId: string
): Promise<void> {
  const startLogEntry = ContextUtils.createLogEntry('INFO', 'Processing policy event', {
    policyId: policyEvent.policyId,
    eventType: policyEvent.eventType,
    tenantId: policyEvent.tenantId,
    messageId
  });
  console.log(JSON.stringify(startLogEntry));

  try {
    // Fetch the full policy data from DynamoDB
    const policy = await PolicyRepository.getPolicyById(policyEvent.policyId);
    
    const policyFetchedLogEntry = ContextUtils.createLogEntry('INFO', 'Successfully fetched policy data', {
      policyId: policy._id,
      policyName: policy.name,
      rulesCount: policy.rules.length,
      eventType: policyEvent.eventType
    });
    console.log(JSON.stringify(policyFetchedLogEntry));

    // Handle different event types
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
    
    const successLogEntry = ContextUtils.createLogEntry('INFO', 'Successfully processed policy event', {
      policyId: policyEvent.policyId,
      eventType: policyEvent.eventType,
      tenantId: policyEvent.tenantId,
      rulesProcessed: policy.rules.length
    });
    console.log(JSON.stringify(successLogEntry));
    
  } catch (error) {
    const errorLogEntry = ContextUtils.createLogEntry('ERROR', 'Failed to process policy event', {
      policyId: policyEvent.policyId,
      eventType: policyEvent.eventType,
      tenantId: policyEvent.tenantId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error(JSON.stringify(errorLogEntry));
    
    throw new Error(`Failed to process policy event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
