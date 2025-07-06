import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TokenValidator } from '../../shared/auth';
import { UserPolicyRepository } from '../../shared/repository';
import { RequestContextManager, ContextUtils } from '../../shared/context';
import { 
  APIResponse, 
  ErrorResponse, 
  UnauthorizedError, 
  ValidationError, 
  NotFoundError 
} from '../../shared/types';

/**
 * User Policies API Lambda Handler
 * Handles read-only operations for the UserPolicies table
 */

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Extract tracing headers from the event
  const traceId = event.headers['x-trace-id'] || event.headers['X-Trace-Id'];
  const correlationId = event.headers['x-correlation-id'] || event.headers['X-Correlation-Id'] || event.requestContext.requestId;
  
  console.log('User Policies API Handler invoked:', {
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters,
    queryStringParameters: event.queryStringParameters,
    requestId: event.requestContext.requestId,
    traceId,
    correlationId,
    userAgent: event.headers['user-agent'] || event.headers['User-Agent'],
    sourceIp: event.requestContext.identity?.sourceIp
  });

  try {
    // Validate token and initialize context with tracing headers
    await TokenValidator.validateAndInitializeContextWithTracing(event);

    // Log with structured context after authentication
    const logEntry = ContextUtils.createLogEntry('INFO', 'User Policies API request authenticated and routed', {
      httpMethod: event.httpMethod,
      path: event.path,
      pathParameters: event.pathParameters,
      queryStringParameters: event.queryStringParameters
    });
    console.log(JSON.stringify(logEntry));

    // Route the request
    const result = await routeRequest(event);
    
    return createSuccessResponse(result);
  } catch (error) {
    // Log error with full context if available
    if (RequestContextManager.isInitialized()) {
      const errorLogEntry = ContextUtils.createLogEntry('ERROR', 'User Policies API Handler error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        traceId,
        correlationId,
        httpMethod: event.httpMethod,
        path: event.path
      });
      console.error(JSON.stringify(errorLogEntry));
    } else {
      console.error('User Policies API Handler error (context not initialized):', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        requestId: event.requestContext.requestId,
        traceId,
        correlationId,
        httpMethod: event.httpMethod,
        path: event.path
      });
    }
    return createErrorResponse(error);
  }
};

/**
 * Route requests based on HTTP method and path
 */
async function routeRequest(event: APIGatewayProxyEvent): Promise<any> {
  const { httpMethod, path, queryStringParameters } = event;

  // Only allow GET requests for this read-only API
  if (httpMethod !== 'GET') {
    throw new ValidationError(`HTTP method ${httpMethod} not supported. This API only supports GET requests.`);
  }

  // Parse query parameters
  const userEmail = queryStringParameters?.user;
  const domain = queryStringParameters?.domain;

  // Route based on query parameters
  if (userEmail && domain) {
    // Get policies for specific user and domain
    return await getUserPoliciesByUserAndDomain(userEmail, domain);
  } else if (userEmail) {
    // Get all policies for a specific user
    return await getUserPoliciesByUser(userEmail);
  } else if (domain) {
    // Get all policies for a specific domain
    return await getUserPoliciesByDomain(domain);
  } else {
    // Get all user policies for the tenant
    return await getAllUserPolicies();
  }
}

/**
 * Get all user policies for the current tenant
 */
async function getAllUserPolicies() {
  const tenantId = RequestContextManager.getTenantId();
  
  const logEntry = ContextUtils.createLogEntry('INFO', 'Getting all user policies for tenant');
  console.log(JSON.stringify(logEntry));
  
  const userPolicies = await UserPolicyRepository.getAllUserPolicies(tenantId);
  
  const resultLogEntry = ContextUtils.createLogEntry('INFO', 'Retrieved all user policies successfully', {
    count: userPolicies.length
  });
  console.log(JSON.stringify(resultLogEntry));
  
  return {
    userPolicies,
    count: userPolicies.length,
    filters: {
      tenantId
    }
  };
}

/**
 * Get user policies for a specific user
 */
async function getUserPoliciesByUser(userEmail: string) {
  const tenantId = RequestContextManager.getTenantId();
  
  const logEntry = ContextUtils.createLogEntry('INFO', 'Getting user policies by user email', {
    userEmail
  });
  console.log(JSON.stringify(logEntry));
  
  const userPolicies = await UserPolicyRepository.getUserPolicies(userEmail, tenantId);
  
  const resultLogEntry = ContextUtils.createLogEntry('INFO', 'Retrieved user policies by user successfully', {
    userEmail,
    count: userPolicies.length
  });
  console.log(JSON.stringify(resultLogEntry));
  
  return {
    userPolicies,
    count: userPolicies.length,
    filters: {
      tenantId,
      userEmail
    }
  };
}

/**
 * Get user policies for a specific domain
 */
async function getUserPoliciesByDomain(domain: string) {
  const tenantId = RequestContextManager.getTenantId();
  
  const logEntry = ContextUtils.createLogEntry('INFO', 'Getting user policies by domain', {
    domain
  });
  console.log(JSON.stringify(logEntry));
  
  const userPolicies = await UserPolicyRepository.getUserPoliciesByDomain(domain, tenantId);
  
  const resultLogEntry = ContextUtils.createLogEntry('INFO', 'Retrieved user policies by domain successfully', {
    domain,
    count: userPolicies.length
  });
  console.log(JSON.stringify(resultLogEntry));
  
  return {
    userPolicies,
    count: userPolicies.length,
    filters: {
      tenantId,
      domain
    }
  };
}

/**
 * Get user policies for a specific user and domain combination
 */
async function getUserPoliciesByUserAndDomain(userEmail: string, domain: string) {
  const tenantId = RequestContextManager.getTenantId();
  
  const logEntry = ContextUtils.createLogEntry('INFO', 'Getting user policies by user and domain', {
    userEmail,
    domain
  });
  console.log(JSON.stringify(logEntry));
  
  // Get user policies and filter by domain
  const allUserPolicies = await UserPolicyRepository.getUserPolicies(userEmail, tenantId);
  const filteredPolicies = allUserPolicies.filter(policy => policy.Destination === domain);
  
  const resultLogEntry = ContextUtils.createLogEntry('INFO', 'Retrieved user policies by user and domain successfully', {
    userEmail,
    domain,
    count: filteredPolicies.length
  });
  console.log(JSON.stringify(resultLogEntry));
  
  return {
    userPolicies: filteredPolicies,
    count: filteredPolicies.length,
    filters: {
      tenantId,
      userEmail,
      domain
    }
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
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
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
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
    },
    body: JSON.stringify({
      success: false,
      error: errorResponse
    })
  };
}
