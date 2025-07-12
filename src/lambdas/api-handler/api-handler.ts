import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TokenValidator } from '../../shared/auth';
import { PolicyRepository, UserPolicyRepository } from '../../shared/repository';
import { SQSService } from '../../shared/sqs';
import { SchemaValidator } from '../../shared/schema';
import { RequestContextManager } from '../../shared/context';
import { 
  APIResponse, 
  ErrorResponse, 
  UnauthorizedError, 
  ValidationError, 
  NotFoundError, 
  ConflictError 
} from '../../shared/types';

/**
 * Main API Gateway Lambda Handler
 * Handles all CRUD operations for policies with proper authentication and validation
 */

// Services will auto-initialize using environment variables when first used

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {

  let context: RequestContextManager;
  let contextIsInitialized: boolean = false;


  // Extract tracing headers from the event (headers are normalized to lowercase)
  const correlationId = event.headers['x-correlation-id'] || event.headers['X-Correlation-Id'] || event.requestContext.requestId;
  
  console.log('API Handler invoked:', {
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters,
    requestId: event.requestContext.requestId,
    correlationId,
    userAgent: event.headers['user-agent'] || event.headers['User-Agent'],
    sourceIp: event.requestContext.identity?.sourceIp
  });

  try {
    // Validate token and initialize context with tracing headers
    context = await TokenValidator.validateAndInitializeContextWithTracing(event, correlationId);
    contextIsInitialized = true;

    // Log with structured context after authentication
    const logEntry = context.createLogEntry('INFO', 'Request authenticated and routed', {
      httpMethod: event.httpMethod,
      path: event.path,
      pathParameters: event.pathParameters
    });
    console.log(JSON.stringify(logEntry));

    // Route the request
    const result = await routeRequest(context, event);
    
    return createSuccessResponse(result);
  } catch (error) {
      console.error('API Handler error (context not initialized):', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        requestId: event.requestContext.requestId,
        correlationId,
        httpMethod: event.httpMethod,
        path: event.path
      });
    
    return createErrorResponse(error);
  }
};

/**
 * Route requests based on HTTP method and path
 */
async function routeRequest(context: RequestContextManager, event: APIGatewayProxyEvent): Promise<any> {
  const { httpMethod, path, pathParameters } = event;
  const policyId = pathParameters?.id;

  // Check if this is a user-policies request
  if (path === '/user-policies' || path.startsWith('/user-policies/')) {
    console.log('ROUTING: Going to user-policies route');
    return await routeUserPoliciesRequest(context, event);
  }

  console.log('ROUTING: Going to regular policies route');

  // Handle regular policies routes
  switch (httpMethod) {
    case 'GET':
      if (policyId) {
        return await getPolicyById(context, policyId);
      } else {
        return await getAllPolicies(context);
      }

    case 'POST':
      return await createPolicy(context, event.body);

    case 'PUT':
      if (!policyId) {
        throw new ValidationError('Policy ID is required for updates');
      }
      return await updatePolicy(context, policyId, event.body);

    case 'DELETE':
      if (!policyId) {
        throw new ValidationError('Policy ID is required for deletion');
      }
      return await deletePolicy(context, policyId);

    default:
      throw new ValidationError(`HTTP method ${httpMethod} not supported`);
  }
}

/**
 * Route user-policies requests
 */
async function routeUserPoliciesRequest(context: RequestContextManager, event: APIGatewayProxyEvent): Promise<any> {
  const { httpMethod, path } = event;

  switch (httpMethod) {
    case 'GET':
        return await getAllUserPolicies(context);
    default:
      throw new ValidationError(`HTTP method ${httpMethod} not supported for user-policies`);
  }
}

/**
 * Get all policies for the current tenant
 */
async function getAllPolicies(context: RequestContextManager) {
  const logEntry = context.createLogEntry('INFO', 'Getting all policies for tenant');
  console.log(JSON.stringify(logEntry));
  
  const policies = await PolicyRepository.getAllPolicies(context);
  
  const resultLogEntry = context.createLogEntry('INFO', 'Retrieved policies successfully', {
    policyCount: policies.length
  });
  console.log(JSON.stringify(resultLogEntry));
  
  return {
    policies,
    count: policies.length
  };
}

/**
 * Get all user policies for the current tenant
 */
async function getAllUserPolicies(context: RequestContextManager) {
  const logEntry = context.createLogEntry('INFO', 'Getting all user policies for tenant');
  console.log(JSON.stringify(logEntry));
  
  const tenantId = context.getRequestContext().tenantId;
  const userPolicies = await UserPolicyRepository.getAllUserPolicies(context, tenantId);
  
  const resultLogEntry = context.createLogEntry('INFO', 'Retrieved user policies successfully', {
    userPolicyCount: userPolicies.length
  });
  console.log(JSON.stringify(resultLogEntry));
  
  return {
    policies: userPolicies,
    count: userPolicies.length
  };
}

/**
 * Get a specific policy by ID
 */
async function getPolicyById(context: RequestContextManager, policyId: string) {
  const logEntry = context.createLogEntry('INFO', 'Getting policy by ID', {
    policyId
  });
  console.log(JSON.stringify(logEntry));
  
  const policy = await PolicyRepository.getPolicyById(context, policyId);
  
  const resultLogEntry = context.createLogEntry('INFO', 'Retrieved policy successfully', {
    policyId,
    policyName: policy.name,
    policyStatus: policy.status
  });
  console.log(JSON.stringify(resultLogEntry));
  
  return { policy };
}

/**
 * Create a new policy
 */
async function createPolicy(context: RequestContextManager, requestBody: string | null) {
  if (!requestBody) {
    throw new ValidationError('Request body is required');
  }

  const logEntry = context.createLogEntry('INFO', 'Creating new policy');
  console.log(JSON.stringify(logEntry));
  
  let policyData;
  try {
    policyData = JSON.parse(requestBody);
  } catch (error) {
    const errorLogEntry = context.createLogEntry('ERROR', 'Invalid JSON in request body', {
      error: error instanceof Error ? error.message : String(error)
    });
    console.error(JSON.stringify(errorLogEntry));
    throw new ValidationError('Invalid JSON in request body');
  }

  // Validate the policy data
  const validatedData = SchemaValidator.validatePolicyCreate(policyData);
  
  const validationLogEntry = context.createLogEntry('INFO', 'Policy data validated successfully', {
    policyName: validatedData.name,
    rulesCount: validatedData.rules?.length || 0
  });
  console.log(JSON.stringify(validationLogEntry));
  
  // Create the policy
  const policy = await PolicyRepository.createPolicy(context, validatedData);
  
  // Publish create event to SQS
  await SQSService.publishPolicyEvent(context, 'create', policy._id);
  
  const successLogEntry = context.createLogEntry('INFO', 'Policy created and event published', {
    policyId: policy._id,
    policyName: policy.name,
    policyStatus: policy.status
  });
  console.log(JSON.stringify(successLogEntry));
  
  return { 
    policy,
    message: 'Policy created successfully'
  };
}

/**
 * Update an existing policy
 */
async function updatePolicy(context: RequestContextManager, policyId: string, requestBody: string | null) {
  if (!requestBody) {
    throw new ValidationError('Request body is required');
  }

  const logEntry = context.createLogEntry('INFO', 'Updating policy', {
    policyId
  });
  console.log(JSON.stringify(logEntry));
  
  let updateData;
  try {
    updateData = JSON.parse(requestBody);
  } catch (error) {
    const errorLogEntry = context.createLogEntry('ERROR', 'Invalid JSON in request body', {
      policyId,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error(JSON.stringify(errorLogEntry));
    throw new ValidationError('Invalid JSON in request body');
  }

  // Validate the update data
  const validatedData = SchemaValidator.validatePolicyUpdate(updateData);
  
  const validationLogEntry = context.createLogEntry('INFO', 'Policy update data validated successfully', {
    policyId,
    updatedFields: Object.keys(validatedData)
  });
  console.log(JSON.stringify(validationLogEntry));
  
  // Update the policy
  const policy = await PolicyRepository.updatePolicy(context, policyId, validatedData);
  
  // Publish update event to SQS
  await SQSService.publishPolicyEvent(context, 'update', policyId);
  
  const successLogEntry = context.createLogEntry('INFO', 'Policy updated and event published', {
    policyId,
    policyName: policy.name,
    policyStatus: policy.status
  });
  console.log(JSON.stringify(successLogEntry));
  
  return { 
    policy,
    message: 'Policy updated successfully'
  };
}

/**
 * Delete a policy
 */
async function deletePolicy(context: RequestContextManager, policyId: string) {
  const logEntry = context.createLogEntry('INFO', 'Deleting policy', {
    policyId
  });
  console.log(JSON.stringify(logEntry));
  
  // Delete the policy (soft delete)
  await PolicyRepository.deletePolicy(context, policyId);
  
  // Publish delete event to SQS
  await SQSService.publishPolicyEvent(context, 'delete', policyId);
  
  const successLogEntry = context.createLogEntry('INFO', 'Policy deleted and event published', {
    policyId
  });
  console.log(JSON.stringify(successLogEntry));
  
  return { 
    message: 'Policy deleted successfully',
    policyId
  };
}

/**
 * Create a successful API response
 */
function createSuccessResponse(data: any): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify({
      success: true,
      data,
      timestamp: new Date().toISOString()
    })
  };
}

/**
 * Create an error API response
 */
function createErrorResponse(error: unknown): APIGatewayProxyResult {
  let statusCode = 500;
  let errorMessage = 'Internal server error';
  let errorType = 'InternalError';

  if (error instanceof UnauthorizedError) {
    statusCode = 401;
    errorMessage = error.message;
    errorType = 'UnauthorizedError';
  } else if (error instanceof ValidationError) {
    statusCode = 400;
    errorMessage = error.message;
    errorType = 'ValidationError';
  } else if (error instanceof NotFoundError) {
    statusCode = 404;
    errorMessage = error.message;
    errorType = 'NotFoundError';
  } else if (error instanceof ConflictError) {
    statusCode = 409;
    errorMessage = error.message;
    errorType = 'ConflictError';
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  const errorResponse: ErrorResponse = {
    error: errorType,
    message: errorMessage,
    timestamp: new Date().toISOString()
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify({
      success: false,
      error: errorResponse
    })
  };
}
