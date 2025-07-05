# Lambda Scaling and AWS Service Clients Behavior

## Overview

This document explains how AWS service clients (TokenValidator, SQSService, PolicyRepository) behave when AWS Lambda scales your functions, addressing the key question about static variable initialization across Lambda instances.

## Lambda Container Model

AWS Lambda uses a container-based execution model:

1. **Container Instance**: Each Lambda function runs in its own container instance
2. **Container Reuse**: Containers are reused across multiple invocations when possible
3. **Container Scaling**: New containers are created when concurrent executions exceed available containers
4. **Container Lifecycle**: Containers may be destroyed after periods of inactivity

## Static Variables in Lambda Containers

### Key Behavior Points

- **Per-Container Isolation**: Each Lambda container instance has its own copy of static variables
- **No Cross-Container Sharing**: Static variables are NOT shared between different container instances
- **Container Reuse Benefits**: Within the same container, static variables persist across invocations
- **Cold Start Initialization**: Each new container must initialize static variables independently

## TokenValidator Implementation

### Current Architecture

```typescript
export class TokenValidator {
  private static jwksClient: jwksClient.JwksClient | null = null;
  private static cognitoIssuer: string;
  private static userPoolId: string;

  static initialize(region?: string, userPoolId?: string): void {
    // Lazy initialization with environment variable fallback
    const finalRegion = region || process.env.AWS_REGION;
    const finalUserPoolId = userPoolId || process.env.COGNITO_USER_POOL_ID;
    
    // Skip if already initialized with same configuration
    if (this.jwksClient && this.userPoolId === finalUserPoolId) {
      return;
    }
    
    // Initialize JWKS client...
  }

  static async validateToken(event: APIGatewayProxyEvent): Promise<CognitoTokenPayload> {
    // Automatic lazy initialization
    if (!this.jwksClient) {
      this.initialize();
    }
    // ... validation logic
  }
}
```

### Scaling Behavior

#### Scenario 1: Single Container, Multiple Invocations
```
Container A:
├── Invocation 1: initialize() called → jwksClient created
├── Invocation 2: jwksClient exists → reused (fast)
├── Invocation 3: jwksClient exists → reused (fast)
└── Invocation N: jwksClient exists → reused (fast)
```

#### Scenario 2: Multiple Containers (Scaling)
```
Container A:                    Container B:
├── Invocation 1: init()       ├── Invocation 1: init() (separate)
├── Invocation 2: reuse        ├── Invocation 2: reuse
└── Invocation 3: reuse        └── Invocation 3: reuse

Container C:
├── Invocation 1: init() (separate)
├── Invocation 2: reuse
└── Invocation 3: reuse
```

## Performance Implications

### Cold Start Overhead
- **First invocation** in each container: ~100-200ms initialization overhead
- **Subsequent invocations** in same container: ~1-5ms (cached)

### Memory Usage
- Each container maintains its own JWKS cache
- Memory usage scales linearly with container count
- JWKS cache size: ~10-50KB per container

### Network Calls
- JWKS endpoint called once per container (with 10-minute cache)
- No network calls for cached keys within same container
- Rate limiting: 10 requests/minute per container

## Best Practices Implemented

### 1. Lazy Initialization
```typescript
// Automatic initialization when needed
if (!this.jwksClient) {
  this.initialize();
}
```

**Benefits:**
- No manual initialization required
- Works correctly with Lambda scaling
- Handles container reuse efficiently

### 2. Environment Variable Fallback
```typescript
const finalRegion = region || process.env.AWS_REGION;
const finalUserPoolId = userPoolId || process.env.COGNITO_USER_POOL_ID;
```

**Benefits:**
- No hardcoded configuration
- Works across all environments
- Simplifies Lambda function code

### 3. Idempotent Initialization
```typescript
// Skip if already initialized with same configuration
if (this.jwksClient && this.userPoolId === finalUserPoolId) {
  return;
}
```

**Benefits:**
- Safe to call multiple times
- Prevents unnecessary re-initialization
- Handles configuration changes

### 4. Proper Error Handling
```typescript
if (!key) {
  reject(new Error('No signing key found'));
  return;
}
```

**Benefits:**
- TypeScript null safety
- Clear error messages
- Graceful failure handling

## Monitoring and Observability

### Logging
```typescript
console.log('TokenValidator initialized for region:', finalRegion, 'userPoolId:', finalUserPoolId);
```

### Metrics to Monitor
- **Cold start frequency**: How often new containers are created
- **Initialization time**: Time spent in `initialize()` method
- **JWKS cache hit rate**: Percentage of validations using cached keys
- **Error rates**: Failed token validations

### CloudWatch Insights Queries

#### Cold Start Detection
```sql
fields @timestamp, @message
| filter @message like /TokenValidator initialized/
| stats count() by bin(5m)
```

#### Token Validation Performance
```sql
fields @timestamp, @duration
| filter @type = "REPORT"
| stats avg(@duration), max(@duration), min(@duration) by bin(5m)
```

## Troubleshooting

### Common Issues

#### 1. Environment Variables Missing
**Error:** `Region and User Pool ID must be provided`
**Solution:** Ensure `AWS_REGION` and `COGNITO_USER_POOL_ID` are set

#### 2. JWKS Endpoint Unreachable
**Error:** `Failed to get signing key`
**Solution:** Check network connectivity and Cognito configuration

#### 3. High Cold Start Latency
**Symptoms:** Slow first requests in new containers
**Solutions:**
- Use provisioned concurrency for critical functions
- Implement connection pooling
- Consider pre-warming strategies

### Performance Optimization

#### 1. Provisioned Concurrency
```yaml
# serverless.yml
functions:
  api:
    provisionedConcurrency: 5  # Keep 5 warm containers
```

#### 2. Connection Reuse
```typescript
// Already implemented in jwks-rsa client
cache: true,
cacheMaxAge: 600000, // 10 minutes
```

#### 3. Memory Allocation
```yaml
# Increase memory for faster initialization
memorySize: 512  # MB
```

## Security Considerations

### 1. Token Validation Independence
- Each container validates tokens independently
- No shared state between containers
- Zero-trust approach maintained

### 2. JWKS Key Rotation
- Automatic key refresh every 10 minutes
- Graceful handling of key rotation
- No manual intervention required

### 3. Rate Limiting
- Built-in rate limiting: 10 requests/minute per container
- Prevents JWKS endpoint abuse
- Scales with container count

## AWS Service Clients Overview

All AWS service clients in this application follow the same Lambda scaling patterns:

### SQSService
```typescript
export class SQSService {
  private static client: SQSClient;
  private static queueUrl: string;

  static async publishPolicyEvent(eventType, policyId): Promise<void> {
    // Lazy initialization
    if (!this.client) {
      this.initialize();
    }
    // ... SQS operations
  }
}
```

**Scaling Behavior:**
- Each container maintains its own SQS client connection pool
- Connection pooling benefits within same container
- ~50-100ms initialization overhead per container
- Environment variable fallback: `SQS_QUEUE_URL`, `AWS_REGION`

### PolicyRepository
```typescript
export class PolicyRepository {
  private static client: DynamoDBDocumentClient;
  private static tableName: string;

  static async getAllPolicies(): Promise<Policy[]> {
    // Lazy initialization
    if (!this.client) {
      this.initialize();
    }
    // ... DynamoDB operations
  }
}
```

**Scaling Behavior:**
- Each container maintains its own DynamoDB client
- Connection pooling and request batching within container
- ~30-80ms initialization overhead per container
- Environment variable fallback: `DYNAMODB_TABLE_NAME`, `AWS_REGION`

## Universal Scaling Patterns

### 1. Per-Container Isolation
All service clients follow the same isolation pattern:
- **Static variables are per-container**, not global
- **Each container initializes independently**
- **No shared state between containers**

### 2. Lazy Initialization
All clients implement automatic initialization:
```typescript
if (!this.client) {
  this.initialize();
}
```

### 3. Environment Variable Configuration
All clients support environment-based configuration:
- `AWS_REGION` - AWS region
- `COGNITO_USER_POOL_ID` - Cognito configuration
- `SQS_QUEUE_URL` - SQS queue URL
- `DYNAMODB_TABLE_NAME` - DynamoDB table name

### 4. Idempotent Initialization
All clients prevent unnecessary re-initialization:
```typescript
if (this.client && this.configValue === newConfigValue) {
  return; // Already initialized
}
```

## Performance Characteristics by Service

| Service | Cold Start | Memory Usage | Network Calls |
|---------|------------|--------------|---------------|
| TokenValidator | 100-200ms | 10-50KB | JWKS (10min cache) |
| SQSService | 50-100ms | 5-20KB | Per message |
| PolicyRepository | 30-80ms | 10-30KB | Per operation |

## Monitoring All Services

### CloudWatch Insights Queries

#### Service Initialization Tracking
```sql
fields @timestamp, @message
| filter @message like /initialized/
| stats count() by service, bin(5m)
```

#### Performance by Service
```sql
fields @timestamp, @duration, @message
| filter @type = "REPORT"
| stats avg(@duration) by service, bin(5m)
```

## Conclusion

All AWS service clients (TokenValidator, SQSService, PolicyRepository) are designed to handle Lambda scaling gracefully:

1. **Automatic lazy initialization** ensures each container is properly configured
2. **Environment variable fallback** eliminates configuration complexity
3. **Connection pooling and caching** optimize performance within containers
4. **Independent operation** maintains security and isolation across all containers
5. **Consistent patterns** make the codebase maintainable and predictable

This unified approach provides optimal balance between performance, security, and operational simplicity across the entire serverless application.
