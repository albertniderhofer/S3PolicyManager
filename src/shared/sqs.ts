import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SQSEvent } from './types';
import { RequestContextManager, ContextUtils } from './context';

/**
 * SQS Service for publishing policy events
 */
export class SQSService {
  private static client: SQSClient;
  private static queueUrl: string;

  /**
   * Initialize the SQS service
   * Now supports lazy initialization from environment variables
   */
  static initialize(queueUrl?: string, region?: string): void {
    // Use provided parameters or fall back to environment variables
    const finalQueueUrl = queueUrl || process.env.SQS_QUEUE_URL;
    const finalRegion = region || process.env.AWS_REGION || 'us-east-1';
    
    if (!finalQueueUrl) {
      throw new Error('SQS Queue URL must be provided either as parameter or SQS_QUEUE_URL environment variable');
    }

    // Skip if already initialized with same configuration
    if (this.client && this.queueUrl === finalQueueUrl) {
      return;
    }

    this.queueUrl = finalQueueUrl;
    
    this.client = new SQSClient({
      region: finalRegion,
      ...(process.env.NODE_ENV === 'development' && {
        endpoint: process.env.SQS_ENDPOINT || 'http://localhost:9324'
      })
    });

    console.log('SQSService initialized for region:', finalRegion, 'queueUrl:', finalQueueUrl);
  }

  /**
   * Publish a policy event to SQS
   * Automatically initializes if not already done (lazy initialization)
   */
  static async publishPolicyEvent(
    eventType: SQSEvent['eventType'],
    policyId: string
  ): Promise<void> {
    // Lazy initialization - automatically initialize if not done yet
    if (!this.client) {
      this.initialize();
    }

    const context = RequestContextManager.getFullContext();
    
    const event: SQSEvent = {
      eventType,
      policyId,
      tenantId: context.tenantId,
      timestamp: context.timestamp,
      triggeredBy: context.username
    };

    console.log(ContextUtils.createLogEntry('INFO', 'Publishing SQS event', {
      eventType,
      policyId,
      tenantId: context.tenantId
    }));

    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(event),
      MessageAttributes: {
        eventType: {
          DataType: 'String',
          StringValue: eventType
        },
        tenantId: {
          DataType: 'String',
          StringValue: context.tenantId
        },
        policyId: {
          DataType: 'String',
          StringValue: policyId
        }
      }
    });

    try {
      const result = await this.client.send(command);
      
      console.log(ContextUtils.createLogEntry('INFO', 'Successfully published SQS event', {
        eventType,
        policyId,
        messageId: result.MessageId
      }));
    } catch (error) {
      console.error(ContextUtils.createLogEntry('ERROR', 'Failed to publish SQS event', {
        eventType,
        policyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
      throw new Error('Failed to publish policy event');
    }
  }

}
