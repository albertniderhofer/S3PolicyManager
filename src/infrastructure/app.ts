#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PolicyManagerStack } from './policy-manager-stack';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';
const cognitoUserPoolId = app.node.tryGetContext('cognitoUserPoolId');

// Validate environment
if (!['dev', 'staging', 'prod'].includes(environment)) {
  throw new Error(`Invalid environment: ${environment}. Must be one of: dev, staging, prod`);
}

// Create the stack
// You can customize the stack name here:
const stackName = app.node.tryGetContext('stackName') || `PolicyManagerStack-${environment}`;
new PolicyManagerStack(app, stackName, {
  environment: environment as 'dev' | 'staging' | 'prod',
  cognitoUserPoolId,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: `Policy Manager Stack for ${environment} environment`,
  tags: {
    Environment: environment,
    Project: 'PolicyManager',
    ManagedBy: 'CDK',
  },
});
