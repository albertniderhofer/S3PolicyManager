import { SQSEvent, SQSRecord } from 'aws-lambda';
import { SchemaValidator } from '../../shared/schema';
import { RequestContextManager } from '../../shared/context';
import { PolicyRepository, UserPolicyRepository } from '../../shared/repository';
import { SQSEvent as PolicySQSEvent } from '../../shared/types';
import { CidrUtils } from '../../shared/cidr';
import { PolicyUtils } from './policy-utils';
import { CidrManager } from './cidr-manager';

/**
 * SQS Message Processor Lambda
 * Processes policy events from SQS with inline validation, publishing, and UserPolicies updates
 */

//dynamically initialized CIDR manager cached for all tenants on level of container using static vars
var cidrManager: CidrManager;

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
  let context: RequestContextManager;
  let contextIsInitialized: boolean = false;

  try {
    // Parse the message body
    const messageBody = JSON.parse(record.body);
    
    // Validate the SQS event structure
    const policyEvent = SchemaValidator.validateSQSEvent(messageBody);

    console.log('Processing SQS record:', {
    messageId: record.messageId,
    correlationId : policyEvent.correlationId,
    receiptHandle: record.receiptHandle.substring(0, 20) + '...', // Truncate for logging
    timestamp: new Date().toISOString()
  });

    // Initialize context from the policy event for structured logging
    context =  new RequestContextManager(policyEvent, policyEvent.correlationId);
    contextIsInitialized = true;

    const logEntry = context.createLogEntry('INFO', 'Validated policy event from SQS', {
      eventType: policyEvent.eventType,
      policyId: policyEvent.policyId,
      messageId: record.messageId
    });
    console.log(JSON.stringify(logEntry));

    // Process the policy event based on type
    await processPolicyEvent(context, policyEvent, record.messageId);
    
  } catch (error) {
    // Log error ,context might be not available
    console.log('Processing SQS record:', {
      messageId: record.messageId,
      error: error,
      timestamp: new Date().toISOString()
  });
    throw error;
  }
}

/**
 * Process the policy event with inline validation, publishing, and UserPolicies updates
 */
async function processPolicyEvent(context: RequestContextManager ,policyEvent: PolicySQSEvent, messageId: string): Promise<void> {
  const startLogEntry = context.createLogEntry('INFO', 'Processing policy event with validation and publishing', {
    policyId: policyEvent.policyId,
    eventType: policyEvent.eventType,
    messageId
  });
  console.log(JSON.stringify(startLogEntry));

  try {
    // Step 0: Check source IP against CIDR blacklist (if available)
    const sourceIpCheckResult = await checkSourceIpBlacklist(context, policyEvent, messageId);
    if (sourceIpCheckResult.isBlacklisted) {
      const blacklistLogEntry = context.createLogEntry('WARN', 'Policy event blocked due to blacklisted source IP', {
        policyId: policyEvent.policyId,
        eventType: policyEvent.eventType,
        sourceIp: sourceIpCheckResult.sourceIp,
        matchedCidr: sourceIpCheckResult.matchedCidr,
        messageId
      });
      console.log(JSON.stringify(blacklistLogEntry));
      
      // Return early - do not process the policy event
      return;
    }

    // Step 1: Validate the policy
    const validationResult = await PolicyUtils.validatePolicy(context, policyEvent.policyId, policyEvent.eventType);
    
    const validationLogEntry = context.createLogEntry('INFO', 'Policy validation completed', {
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
    const publishResult = await PolicyUtils.publishPolicy(context, policyEvent.policyId, policyEvent.eventType);

    const publishLogEntry = context.createLogEntry('INFO', 'Policy publish completed', {
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
    const userPolicyUpdateResult = await PolicyUtils.userPolicyUpdate(context, policyEvent.policyId, policyEvent.eventType);

      const userPolicyLogEntry = context.createLogEntry('INFO', 'User policy update completed', {
      policyId: policyEvent.policyId,
      success: userPolicyUpdateResult.success,
      message: userPolicyUpdateResult.message,
    });
    console.log(JSON.stringify(publishLogEntry));


    const successLogEntry = context.createLogEntry('INFO', 'Successfully processed complete policy workflow', {
      policyId: policyEvent.policyId,
      eventType: policyEvent.eventType,
      tenantId: policyEvent.tenantId,
      validationPassed: true,
      publishingSucceeded: true,
      userPoliciesUpdated: true
    });
    console.log(JSON.stringify(successLogEntry));
    
  } catch (error) {
    const errorLogEntry = context.createLogEntry('ERROR', 'Failed to process policy workflow', {
      policyId: policyEvent.policyId,
      eventType: policyEvent.eventType,
      tenantId: policyEvent.tenantId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error(JSON.stringify(errorLogEntry));
    
    throw new Error(`Failed to process policy workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  /**
 * Check source IP against CIDR blacklist
 */
async function checkSourceIpBlacklist(context: RequestContextManager, policyEvent: PolicySQSEvent, messageId: string): Promise<{
    isBlacklisted: boolean;
    sourceIp?: string;
    matchedCidr?: string;
}> {
    const checkLogEntry = context.createLogEntry('INFO', 'Checking source IP against CIDR blacklist', {
        policyId: policyEvent.policyId,
        eventType: policyEvent.eventType,
        messageId
    });
    console.log(JSON.stringify(checkLogEntry));

    try {
        // Extract source IPs from policy rules
        const sourceIps = await extractSourceIpsFromPolicy(context, policyEvent);

        if (sourceIps.length === 0) {
            const noIpLogEntry = context.createLogEntry('INFO', 'No source IPs found in policy rules, skipping blacklist check', {
                policyId: policyEvent.policyId,
                eventType: policyEvent.eventType,
                messageId
            });
            console.log(JSON.stringify(noIpLogEntry));

            return { isBlacklisted: false };
        }

        // Check each IP against blacklist using cider manager
        let ciderManager: CidrManager = new CidrManager();
        for (const sourceIp of sourceIps) {
            const isBlacklisted = await ciderManager.isIpBlacklisted(context.getEventContext().tenantId, sourceIp);

            if (isBlacklisted) {
                // Find which CIDR matched
                const cidrList = await ciderManager.getCidrBlacklist(context.getEventContext().tenantId);
                const matchedCidr = CidrUtils.findMatchingCidr(sourceIp, cidrList);

                return {
                    isBlacklisted: true,
                    sourceIp,
                    matchedCidr
                };
            }
        }

        const allowedLogEntry = context.createLogEntry('INFO', 'No source IPs are blacklisted, proceeding with policy processing', {
            policyId: policyEvent.policyId,
            sourceIps,
            messageId
        });
        console.log(JSON.stringify(allowedLogEntry));

        return {
            isBlacklisted: false,
            sourceIp: sourceIps[0] // Return first IP for logging purposes
        };

    } catch (error) {
        const errorLogEntry = context.createLogEntry('WARN', 'Error checking source IP blacklist, continuing without check', {
            policyId: policyEvent.policyId,
            eventType: policyEvent.eventType,
            error: error instanceof Error ? error.message : 'Unknown error',
            messageId
        });
        console.log(JSON.stringify(errorLogEntry));

        // Continue processing on error as per requirement
        return { isBlacklisted: false };
    }

    /**
     * Extract source IP addresses from policy rules
     * Returns all unique IP addresses found in the policy's rules
     */
    async function extractSourceIpsFromPolicy(context: RequestContextManager, policyEvent: PolicySQSEvent): Promise<string[]> {
        try {
            // Get the policy to extract IPs from its rules
            const policy = await PolicyRepository.getPolicyById(context, policyEvent.policyId);

            const sourceIps: string[] = [];

            // Extract IPs from all policy rules
            if (policy.rules && Array.isArray(policy.rules)) {
                for (const rule of policy.rules) {
                    if (rule.source && rule.source.ip) {
                        // Validate IP format before adding
                        if (isValidIpAddress(rule.source.ip)) {
                            sourceIps.push(rule.source.ip);
                        } else {
                            console.warn(`Invalid IP address format in rule ${rule.id}: ${rule.source.ip}`, {
                                policyId: policyEvent.policyId,
                                ruleId: rule.id,
                                ruleName: rule.name,
                                invalidIp: rule.source.ip
                            });
                        }
                    }
                }
            }

            // Return unique IPs only
            const uniqueIps = [...new Set(sourceIps)];

            const extractionLogEntry = context.createLogEntry('INFO', 'Extracted source IPs from policy rules', {
                policyId: policyEvent.policyId,
                totalRules: policy.rules?.length || 0,
                rulesWithIp: sourceIps.length,
                uniqueIps: uniqueIps.length,
                extractedIps: uniqueIps
            });
            console.log(JSON.stringify(extractionLogEntry));

            return uniqueIps;

        } catch (error) {
            console.error(`Failed to extract source IPs from policy ${policyEvent.policyId}:`, {
                error: error instanceof Error ? error.message : 'Unknown error',
                policyId: policyEvent.policyId
            });
            return [];
        }
    }


    /**
     * Validate IP address format using CidrUtils
     */
    function isValidIpAddress(ip: string): boolean {
        return CidrUtils.isValidIpAddress(ip);
    }
}

}

