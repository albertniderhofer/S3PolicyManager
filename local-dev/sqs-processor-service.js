const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const express = require('express');

// Import the compiled SQS processor handler
const { handler: sqsHandler } = require('./dist/lambdas/sqs-processor/sqs-processor.js');

// Configuration
const QUEUE_URL = process.env.SQS_QUEUE_URL || 'http://sqs-local:9324/000000000000/policy-events-local';
const POLL_INTERVAL = parseInt(process.env.SQS_POLL_INTERVAL) || 5000; // 5 seconds
const MAX_MESSAGES = parseInt(process.env.SQS_MAX_MESSAGES) || 10;
const VISIBILITY_TIMEOUT = parseInt(process.env.SQS_VISIBILITY_TIMEOUT) || 30;
const WAIT_TIME_SECONDS = parseInt(process.env.SQS_WAIT_TIME_SECONDS) || 20; // Long polling

// Initialize SQS client
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.SQS_ENDPOINT || 'http://sqs-local:9324',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

// Health check server
const app = express();
const port = 3002;

let isHealthy = true;
let lastPollTime = new Date();
let processedMessages = 0;
let errorCount = 0;

app.get('/health', (req, res) => {
  const timeSinceLastPoll = Date.now() - lastPollTime.getTime();
  const isPollingHealthy = timeSinceLastPoll < (WAIT_TIME_SECONDS * 1000 + POLL_INTERVAL * 2); // Allow for long polling + buffer
  
  res.json({
    status: isHealthy && isPollingHealthy ? 'healthy' : 'unhealthy',
    service: 'sqs-processor',
    lastPollTime: lastPollTime.toISOString(),
    timeSinceLastPoll: timeSinceLastPoll,
    processedMessages,
    errorCount,
    queueUrl: QUEUE_URL,
    pollInterval: POLL_INTERVAL,
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`SQS Processor health server listening on port ${port}`);
});

// Main SQS polling function
async function pollSQS() {
  console.log('Starting SQS processor service...', {
    queueUrl: QUEUE_URL,
    pollInterval: POLL_INTERVAL,
    maxMessages: MAX_MESSAGES,
    visibilityTimeout: VISIBILITY_TIMEOUT,
    waitTimeSeconds: WAIT_TIME_SECONDS,
    timestamp: new Date().toISOString()
  });

  while (true) {
    try {
      lastPollTime = new Date();
      
      // Receive messages from SQS
      const command = new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: MAX_MESSAGES,
        VisibilityTimeoutSeconds: VISIBILITY_TIMEOUT,
        WaitTimeSeconds: WAIT_TIME_SECONDS, // Long polling
        MessageAttributeNames: ['All']
      });

      const result = await sqsClient.send(command);
      
      if (result.Messages && result.Messages.length > 0) {
        console.log(`Received ${result.Messages.length} messages from SQS`, {
          queueUrl: QUEUE_URL,
          messageCount: result.Messages.length,
          timestamp: new Date().toISOString()
        });

        // Process messages using the Lambda handler
        const sqsEvent = {
          Records: result.Messages.map(message => ({
            messageId: message.MessageId,
            receiptHandle: message.ReceiptHandle,
            body: message.Body,
            attributes: message.Attributes || {},
            messageAttributes: message.MessageAttributes || {},
            md5OfBody: message.MD5OfBody,
            eventSource: 'aws:sqs',
            eventSourceARN: `arn:aws:sqs:${process.env.AWS_REGION}:000000000000:policy-events-local`,
            awsRegion: process.env.AWS_REGION || 'us-east-1'
          }))
        };

        try {
          // Process messages using the Lambda handler
          await sqsHandler(sqsEvent);
          
          // Delete processed messages from queue
          const deletePromises = result.Messages.map(message => 
            sqsClient.send(new DeleteMessageCommand({
              QueueUrl: QUEUE_URL,
              ReceiptHandle: message.ReceiptHandle
            }))
          );
          
          await Promise.all(deletePromises);
          
          processedMessages += result.Messages.length;
          console.log(`Successfully processed and deleted ${result.Messages.length} messages`, {
            totalProcessed: processedMessages,
            timestamp: new Date().toISOString()
          });
          
        } catch (processingError) {
          errorCount++;
          console.error('Error processing SQS messages:', {
            error: processingError instanceof Error ? processingError.message : String(processingError),
            stack: processingError instanceof Error ? processingError.stack : undefined,
            messageCount: result.Messages.length,
            errorCount,
            timestamp: new Date().toISOString()
          });
          
          // Don't delete messages on processing error - they will become visible again
          // and can be retried or sent to DLQ based on SQS configuration
        }
      } else {
        // No messages received - this is normal with long polling
        console.log('No messages received from SQS (normal with long polling)', {
          queueUrl: QUEUE_URL,
          timestamp: new Date().toISOString()
        });
      }
      
      isHealthy = true;
      
    } catch (error) {
      errorCount++;
      isHealthy = false;
      console.error('Error polling SQS:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        queueUrl: QUEUE_URL,
        errorCount,
        timestamp: new Date().toISOString()
      });
      
      // Wait before retrying on error
      await new Promise(resolve => setTimeout(resolve, Math.min(POLL_INTERVAL, 10000)));
    }
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  isHealthy = false;
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  isHealthy = false;
  process.exit(0);
});

// Start the SQS polling service
pollSQS().catch(error => {
  console.error('Fatal error in SQS processor:', error);
  process.exit(1);
});
