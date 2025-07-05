const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const API_HANDLER_URL = process.env.API_HANDLER_URL || 'http://api-handler:8080';
const USER_POLICIES_API_URL = process.env.USER_POLICIES_API_URL || 'http://user-policies-api:8080';

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Proxy all API requests to the appropriate Lambda function
app.all('/dev/*', async (req, res) => {
  console.log('=== API GATEWAY REQUEST START ===');
  console.log('Original path:', req.path);
  console.log('Method:', req.method);
  
  try {
    // Remove '/dev' prefix from path
    const path = req.path.replace('/dev', '');
    console.log('Processed path:', path);
    
    // Determine which service to route to
    let targetUrl = API_HANDLER_URL;
    
    // Route user-policies requests to the dedicated service
    console.log('Checking if path contains user-policies:', path.includes('user-policies'));
    if (path.includes('user-policies')) {
      console.log('*** ROUTING TO USER-POLICIES-API ***');
      targetUrl = USER_POLICIES_API_URL;
    } else {
      console.log('*** ROUTING TO MAIN API-HANDLER ***');
    }
    
    console.log('Target URL:', targetUrl);
    
    // Extract path parameters (e.g., /policies/{id} -> {id: "value"})
    const pathParameters = {};
    const pathSegments = path.split('/').filter(segment => segment);
    
    // Simple path parameter extraction for common patterns
    if (pathSegments.length === 2 && (pathSegments[0] === 'policies' || pathSegments[0] === 'user-policies')) {
      pathParameters.id = pathSegments[1];
    }
    
    // Normalize headers to lowercase (as API Gateway does)
    const normalizedHeaders = {};
    const multiValueHeaders = {};
    Object.keys(req.headers).forEach(key => {
      const lowerKey = key.toLowerCase();
      normalizedHeaders[lowerKey] = req.headers[key];
      multiValueHeaders[lowerKey] = Array.isArray(req.headers[key]) ? req.headers[key] : [req.headers[key]];
    });
    
    // Handle query string parameters
    const queryStringParameters = Object.keys(req.query).length > 0 ? req.query : null;
    const multiValueQueryStringParameters = {};
    if (queryStringParameters) {
      Object.keys(req.query).forEach(key => {
        multiValueQueryStringParameters[key] = Array.isArray(req.query[key]) ? req.query[key] : [req.query[key]];
      });
    }
    
    // Create Lambda event object conforming to APIGatewayProxyEvent
    const lambdaEvent = {
      resource: path,
      path: path,
      httpMethod: req.method,
      headers: normalizedHeaders,
      multiValueHeaders: multiValueHeaders,
      queryStringParameters: queryStringParameters,
      multiValueQueryStringParameters: Object.keys(multiValueQueryStringParameters).length > 0 ? multiValueQueryStringParameters : null,
      pathParameters: Object.keys(pathParameters).length > 0 ? pathParameters : null,
      stageVariables: null,
      requestContext: {
        resourceId: 'local',
        resourcePath: path,
        httpMethod: req.method,
        requestId: `local-${Date.now()}`,
        path: `/dev${path}`,
        accountId: '123456789012',
        apiId: 'local-api',
        stage: 'dev',
        requestTimeEpoch: Date.now(),
        requestTime: new Date().toISOString(),
        identity: {
          cognitoIdentityPoolId: null,
          accountId: null,
          cognitoIdentityId: null,
          caller: null,
          sourceIp: req.ip || req.connection.remoteAddress || '127.0.0.1',
          principalOrgId: null,
          accessKey: null,
          cognitoAuthenticationType: null,
          cognitoAuthenticationProvider: null,
          userArn: null,
          userAgent: req.get('User-Agent') || '',
          user: null
        },
        protocol: 'HTTP/1.1',
        requestTimeEpoch: Date.now()
      },
      body: req.body ? JSON.stringify(req.body) : null,
      isBase64Encoded: false
    };

    console.log(`[${new Date().toISOString()}] ${req.method} ${path} -> ${targetUrl}`);
    console.log(`ROUTING DEBUG: path=${path}, targetUrl=${targetUrl}`);
    console.log('Lambda Event:', JSON.stringify(lambdaEvent, null, 2));

    // Invoke Lambda function
    const response = await axios.post(`${targetUrl}/2015-03-31/functions/function/invocations`, lambdaEvent, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const lambdaResponse = response.data;
    console.log('Lambda Response:', JSON.stringify(lambdaResponse, null, 2));

    // Handle Lambda response
    if (lambdaResponse.errorMessage) {
      console.error('Lambda Error:', lambdaResponse.errorMessage);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: lambdaResponse.errorMessage
      });
    }

    // Parse Lambda response
    const statusCode = lambdaResponse.statusCode || 200;
    const headers = lambdaResponse.headers || {};
    const body = lambdaResponse.body;

    // Set response headers
    Object.keys(headers).forEach(key => {
      res.set(key, headers[key]);
    });

    // Send response
    res.status(statusCode);
    
    if (typeof body === 'string') {
      try {
        const parsedBody = JSON.parse(body);
        res.json(parsedBody);
      } catch (e) {
        res.send(body);
      }
    } else {
      res.json(body);
    }

  } catch (error) {
    console.error('API Gateway Error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Lambda function is not available'
      });
    } else if (error.code === 'ETIMEDOUT') {
      res.status(504).json({
        error: 'Gateway Timeout',
        message: 'Lambda function timed out'
      });
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: error.message
      });
    }
  }
});

// Catch all other routes
app.all('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal Server Error',
    message: error.message
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Gateway server running on port ${PORT}`);
  console.log(`Proxying requests to: ${API_HANDLER_URL}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API Base URL: http://localhost:${PORT}/dev`);
});
