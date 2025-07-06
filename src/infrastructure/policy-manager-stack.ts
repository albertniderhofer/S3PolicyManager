import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PolicyManagerStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  cognitoUserPoolId?: string;
}

export class PolicyManagerStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly userPool: cognito.IUserPool;
  public readonly table: dynamodb.Table;
  public readonly queue: sqs.Queue;
  public readonly stateMachine: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: PolicyManagerStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // DynamoDB Table for policies
    this.table = new dynamodb.Table(this, 'PolicyTable', {
      tableName: `policy-manager-${environment}`,
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: environment === 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Add GSI for querying by tenant
    this.table.addGlobalSecondaryIndex({
      indexName: 'TenantIndex',
      partitionKey: {
        name: 'TenantID',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'Created',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // DynamoDB Table for user policies (tenant-specific policies)
    const userPoliciesTable = new dynamodb.Table(this, 'UserPoliciesTable', {
      tableName: `UserPolicies-${environment}`,
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: environment === 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Add GSI for querying user policies by tenant
    userPoliciesTable.addGlobalSecondaryIndex({
      indexName: 'TenantIndex',
      partitionKey: {
        name: 'TenantID',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'Created',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Cognito User Pool (create new or use existing)
    if (props.cognitoUserPoolId) {
      this.userPool = cognito.UserPool.fromUserPoolId(
        this,
        'ExistingUserPool',
        props.cognitoUserPoolId
      );
    } else {
      this.userPool = new cognito.UserPool(this, 'PolicyManagerUserPool', {
        userPoolName: `policy-manager-${environment}`,
        selfSignUpEnabled: false,
        signInAliases: {
          email: true,
          username: true,
        },
        standardAttributes: {
          email: {
            required: true,
            mutable: true,
          },
        },
        customAttributes: {
          tenant_id: new cognito.StringAttribute({
            minLen: 1,
            maxLen: 50,
            mutable: false,
          }),
        },
        passwordPolicy: {
          minLength: 8,
          requireLowercase: true,
          requireUppercase: true,
          requireDigits: true,
          requireSymbols: true,
        },
        accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
        removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });

      // Create user groups
      new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
        userPoolId: this.userPool.userPoolId,
        groupName: 'Admin',
        description: 'Administrator group with full access',
      });

      new cognito.CfnUserPoolGroup(this, 'UserGroup', {
        userPoolId: this.userPool.userPoolId,
        groupName: 'User',
        description: 'Standard user group with limited access',
      });

      // Create User Pool Client for production authentication
      const userPoolClient = new cognito.UserPoolClient(this, 'PolicyManagerUserPoolClient', {
        userPool: this.userPool,
        userPoolClientName: `policy-manager-client-${environment}`,
        authFlows: {
          adminUserPassword: true,
          userPassword: true,
          custom: true,
          userSrp: true,
        },
        generateSecret: false, // For web/mobile apps, set to false
        preventUserExistenceErrors: true,
        refreshTokenValidity: cdk.Duration.days(30),
        accessTokenValidity: cdk.Duration.hours(1),
        idTokenValidity: cdk.Duration.hours(1),
        supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      });

      // Output the client ID for easy access
      new cdk.CfnOutput(this, 'UserPoolClientId', {
        value: userPoolClient.userPoolClientId,
        description: 'Cognito User Pool Client ID for authentication',
      });
    }

    // SQS Queue for policy events
    const dlq = new sqs.Queue(this, 'PolicyEventsDLQ', {
      queueName: `policy-events-dlq-${environment}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'PolicyEventsQueue', {
      queueName: `policy-events-${environment}`,
      visibilityTimeout: cdk.Duration.minutes(5),
      retentionPeriod: cdk.Duration.days(7),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Lambda Layer for shared code
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      layerVersionName: `policy-manager-shared-${environment}`,
      code: lambda.Code.fromAsset(path.join(__dirname, '../shared')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'Shared utilities and types for Policy Manager',
    });

    // API Handler Lambda
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      functionName: `policy-manager-api-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'api-handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas'), {
        exclude: ['user-policies-api.ts', 'validate-policy.ts', 'publish-policy.ts', 'sqs-processor.ts']
      }),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        NODE_ENV: environment,
        DYNAMODB_TABLE_NAME: this.table.tableName,
        SQS_QUEUE_URL: this.queue.queueUrl,
        COGNITO_USER_POOL_ID: this.userPool.userPoolId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to API Handler
    this.table.grantReadWriteData(apiHandler);
    this.queue.grantSendMessages(apiHandler);
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:GetUser',
        'cognito-idp:ListUsers',
        'cognito-idp:AdminGetUser',
      ],
      resources: [this.userPool.userPoolArn],
    }));

    // User Policies API Lambda
    const userPoliciesApi = new lambda.Function(this, 'UserPoliciesApi', {
      functionName: `policy-manager-user-policies-api-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'user-policies-api.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas'), {
        exclude: ['api-handler.ts', 'validate-policy.ts', 'publish-policy.ts', 'sqs-processor.ts']
      }),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        NODE_ENV: environment,
        DYNAMODB_TABLE_NAME: this.table.tableName,
        USER_POLICIES_TABLE_NAME: `UserPolicies-${environment}`,
        COGNITO_USER_POOL_ID: this.userPool.userPoolId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to User Policies API
    this.table.grantReadWriteData(userPoliciesApi);
    userPoliciesTable.grantReadWriteData(userPoliciesApi);
    userPoliciesApi.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:GetUser',
        'cognito-idp:ListUsers',
        'cognito-idp:AdminGetUser',
      ],
      resources: [this.userPool.userPoolArn],
    }));

    // Validate Policy Lambda
    const validatePolicy = new lambda.Function(this, 'ValidatePolicy', {
      functionName: `policy-manager-validate-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'validate-policy.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas'), {
        exclude: ['api-handler.ts', 'user-policies-api.ts', 'publish-policy.ts', 'sqs-processor.ts']
      }),
      layers: [sharedLayer],
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      environment: {
        NODE_ENV: environment,
        DYNAMODB_TABLE_NAME: this.table.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to Validate Policy
    this.table.grantReadWriteData(validatePolicy);

    // Publish Policy Lambda
    const publishPolicy = new lambda.Function(this, 'PublishPolicy', {
      functionName: `policy-manager-publish-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'publish-policy.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas'), {
        exclude: ['api-handler.ts', 'user-policies-api.ts', 'validate-policy.ts', 'sqs-processor.ts']
      }),
      layers: [sharedLayer],
      timeout: cdk.Duration.minutes(3),
      memorySize: 256,
      environment: {
        NODE_ENV: environment,
        DYNAMODB_TABLE_NAME: this.table.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to Publish Policy
    this.table.grantReadWriteData(publishPolicy);

    // Step Functions State Machine - Define using CDK constructs to avoid circular dependencies
    const validatePolicyTask = new sfnTasks.LambdaInvoke(this, 'ValidatePolicyTask', {
      lambdaFunction: validatePolicy,
      outputPath: '$.Payload',
    });

    const publishPolicyTask = new sfnTasks.LambdaInvoke(this, 'PublishPolicyTask', {
      lambdaFunction: publishPolicy,
      outputPath: '$.Payload',
    });

    // Define the workflow using CDK constructs
    const validationFailed = new stepfunctions.Pass(this, 'ValidationFailed', {
      parameters: {
        'status': 'VALIDATION_FAILED',
        'message': 'Policy validation failed',
        'validationIssues.$': '$.validationResult.issues',
        'error.$': '$.error'
      },
      resultPath: '$.workflowResult',
    });

    const publishFailed = new stepfunctions.Pass(this, 'PublishFailed', {
      parameters: {
        'status': 'PUBLISH_FAILED',
        'message': 'Policy publish to external systems failed',
        'publishError.$': '$.taskResults.publishPolicy.error',
        'error.$': '$.error'
      },
      resultPath: '$.workflowResult',
    });

    const workflowSucceeded = new stepfunctions.Pass(this, 'WorkflowSucceeded', {
      parameters: {
        'status': 'SUCCESS',
        'message': 'Policy workflow completed successfully'
      },
      resultPath: '$.workflowResult',
    });

    const notifyFailure = new stepfunctions.Pass(this, 'NotifyFailure', {
      parameters: {
        'notificationSent': true,
        'timestamp.$': '$$.State.EnteredTime'
      },
      resultPath: '$.notification',
    });

    // Chain the workflow
    const checkValidationResult = new stepfunctions.Choice(this, 'CheckValidationResult')
      .when(stepfunctions.Condition.booleanEquals('$.validationResult.isValid', true), publishPolicyTask)
      .otherwise(validationFailed);

    const checkPublishResult = new stepfunctions.Choice(this, 'CheckPublishResult')
      .when(stepfunctions.Condition.stringEquals('$.taskResults.publishPolicy.status', 'success'), workflowSucceeded)
      .otherwise(publishFailed);

    // Add error handling
    validatePolicyTask.addCatch(validationFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error'
    });

    publishPolicyTask.addCatch(publishFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error'
    });

    // Chain the states
    const definition = validatePolicyTask
      .next(checkValidationResult);
    
    publishPolicyTask.next(checkPublishResult);
    validationFailed.next(notifyFailure);
    publishFailed.next(notifyFailure);

    this.stateMachine = new stepfunctions.StateMachine(this, 'PolicyWorkflow', {
      stateMachineName: `policy-workflow-${environment}`,
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(15),
      logs: {
        destination: new logs.LogGroup(this, 'StateMachineLogGroup', {
          logGroupName: `/aws/stepfunctions/policy-workflow-${environment}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: stepfunctions.LogLevel.ALL,
      },
    });

    // SQS Processor Lambda
    const sqsProcessor = new lambda.Function(this, 'SqsProcessor', {
      functionName: `policy-manager-sqs-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'sqs-processor.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas'), {
        exclude: ['api-handler.ts', 'user-policies-api.ts', 'validate-policy.ts', 'publish-policy.ts']
      }),
      layers: [sharedLayer],
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        NODE_ENV: environment,
        STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant SQS processor permission to start executions
    this.stateMachine.grantStartExecution(sqsProcessor);

    // Add SQS event source to processor
    sqsProcessor.addEventSource(new SqsEventSource(this.queue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
    }));

    // API Gateway
    this.api = new apigateway.RestApi(this, 'PolicyManagerApi', {
      restApiName: `policy-manager-api-${environment}`,
      description: 'Policy Manager REST API',
      deployOptions: {
        stageName: environment,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
      cognitoUserPools: [this.userPool],
      authorizerName: 'PolicyManagerAuthorizer',
    });

    // API Gateway Integrations
    const apiIntegration = new apigateway.LambdaIntegration(apiHandler, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    const userPoliciesIntegration = new apigateway.LambdaIntegration(userPoliciesApi, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    // API Routes
    const policies = this.api.root.addResource('policies');
    
    // GET /policies - List all policies
    policies.addMethod('GET', apiIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /policies - Create new policy
    policies.addMethod('POST', apiIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Policy by ID routes
    const policyById = policies.addResource('{id}');
    
    // GET /policies/{id} - Get specific policy
    policyById.addMethod('GET', apiIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // PUT /policies/{id} - Update policy
    policyById.addMethod('PUT', apiIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // DELETE /policies/{id} - Delete policy
    policyById.addMethod('DELETE', apiIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // User Policies Routes
    const userPolicies = this.api.root.addResource('user-policies');
    
    // GET /user-policies - List user policies with tenant filtering
    userPolicies.addMethod('GET', userPoliciesIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /user-policies - Create new user policy
    userPolicies.addMethod('POST', userPoliciesIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // User Policy by ID routes
    const userPolicyById = userPolicies.addResource('{id}');
    
    // GET /user-policies/{id} - Get specific user policy
    userPolicyById.addMethod('GET', userPoliciesIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // PUT /user-policies/{id} - Update user policy
    userPolicyById.addMethod('PUT', userPoliciesIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // DELETE /user-policies/{id} - Delete user policy
    userPolicyById.addMethod('DELETE', userPoliciesIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Stack Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'Policy Manager API URL',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB Table Name',
    });

    new cdk.CfnOutput(this, 'UserPoliciesTableName', {
      value: userPoliciesTable.tableName,
      description: 'UserPolicies DynamoDB Table Name',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: this.queue.queueUrl,
      description: 'SQS Queue URL',
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      description: 'Step Functions State Machine ARN',
    });
  }

}
