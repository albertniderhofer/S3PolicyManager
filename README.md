# S3 Policy Manager

A serverless AWS application for managing and deploying S3 bucket policies with multi-tenant support, built using AWS CDK, Lambda, DynamoDB, SQS, and Step Functions.

## Overview

The S3 Policy Manager follows an event-driven serverless architecture with comprehensive multi-tenant support, JWT authentication, and automated policy workflows.

### Architecture

```
API Gateway → Lambda (API Handler) → DynamoDB (Policies)
                ↓
              SQS Queue → Lambda (SQS Processor) → DynamoDB (UserPolicies)
                                ↓
                          Extract Rules & Save by
                          TenantID + Source + Destination
```

### Key Features

- ✅ **Multi-tenant architecture** with tenant isolation
- ✅ **RESTful API** with JWT authentication
- ✅ **Asynchronous policy processing** via SQS and Step Functions
- ✅ **Business rule validation** and conflict detection
- ✅ **Policy lifecycle management** (draft → published → deleted)
- ✅ **Event-driven architecture** for scalability
- ✅ **Infrastructure as Code** using AWS CDK
- ✅ **Comprehensive error handling** and audit trails

### Components

- **API Gateway**: REST API with Cognito authentication
- **Lambda Functions**: API Handler, SQS Processor, Validate Policy, Publish Policy
- **DynamoDB**: Multi-tenant policy storage with composite keys
  - **Policies Table**: Main policy storage with tenant isolation
  - **UserPolicies Table**: Individual rule storage indexed by tenant + source + destination
- **SQS**: Asynchronous event processing with dead letter queues
- **Step Functions**: Policy workflow orchestration
- **Cognito**: User authentication and authorization

### SQS Event Processing

The SQS Processor implements the following logic:

1. **Event Reception**: Receives policy events (create/update/delete) from SQS queue
2. **Policy Fetching**: Retrieves full policy data from the main Policies table using the policy ID
3. **Rule Extraction**: Extracts all rule attributes from the policy:
   - Rule ID, name, source user, destination domains
   - Action (allow/block), time restrictions, tracking configuration
   - Policy metadata (ID, name, tenant, timestamps)
4. **UserPolicies Storage**: Saves each rule as a separate record in the UserPolicies table
   - **Composite Key**: `tenantId + source + destination` (PK)
   - **Sort Key**: `ruleId` (SK)
   - **Indexed by**: TenantID and PolicyID for efficient queries

This design enables fast lookups by user and destination combinations while maintaining full audit trails and tenant isolation.

## Project Structure

```
src/
├── shared/                 # Shared utilities and types
│   ├── types.ts           # TypeScript interfaces
│   ├── validation.ts      # Input validation schemas
│   ├── context.ts         # Request context management
│   ├── auth.ts            # Authentication utilities
│   ├── repository.ts      # DynamoDB operations
│   └── sqs.ts             # SQS operations
├── lambdas/               # Lambda function handlers
│   ├── api-handler/api-handler.ts     # API Gateway handler
│   ├── sqs-processor/sqs-processor.ts   # SQS message processor
│   ├── validate-policy/validate-policy.ts # Policy validation
│   └── publish-policy/publish-policy.ts  # Policy publishing
└── infrastructure/        # CDK infrastructure code
    ├── app.ts            # CDK app entry point
    └── policy-manager-stack.ts # Main stack definition

local-dev/                 # Local development setup
├── docker-compose.local.yml # Local services
├── Dockerfile.api-handler    # API Handler Lambda container
├── Dockerfile.user-policies-api # User Policies API Lambda container
├── Dockerfile.validate-policy  # Validate Policy Lambda container
├── Dockerfile.publish-policy   # Publish Policy Lambda container
├── Dockerfile.sqs-processor    # SQS Processor Lambda container
├── setup-local.sh        # Environment setup script
├── get-auth-token.sh     # Token generation utility
└── *.js                  # Local service containers

tests/                     # Test files
├── unit/                 # Unit tests
└── integration/          # Integration tests
```

## Prerequisites

- **Node.js 18+**
- **AWS CLI** configured with appropriate permissions
- **AWS CDK CLI** installed (`npm install -g aws-cdk`)
- **Docker** (for local development)
- **jq** (for JSON processing in scripts)

---

## 🚀 Local Development

### Quick Start

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd S3PolicyManager
   npm install
   ```

2. **Start Local Environment**
   ```bash
   # Start all local AWS services
   docker compose -f docker-compose.local.yml up -d
   ```

3. **⚠️ REQUIRED: Initialize Environment**
   ```bash
   # This step is MANDATORY before making any API calls
   # Creates DynamoDB tables, SQS queues, Cognito users, and sample data
   ./local-dev/setup-local.sh
   ```
   
   **❌ Without running setup-local.sh, all API calls will fail!**

4. **Test the API**
   ```bash
   # Health check
   curl http://localhost:3000/health
   
   # Get policies (uses mock authentication)
   curl http://localhost:3000/dev/policies
   
   # Create a policy
   curl -X POST http://localhost:3000/dev/policies \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test Policy",
       "description": "A test policy",
       "enabled": true,
       "rules": "rules": [
      {
        "id": "rule-1",
        "name": "Allow Example",
        "source": {"user": "test@email.com"},
        "destination": {"domains": "example.com"},
        "time": {
                            "not_between": [
                                "22:00",
                                "06:00"
                            ],
                            "days": [
                                "Mon",
                                "Tue",
                                "Wed",
                                "Thu",
                                "Fri"
                            ]
                        },
        "action": "allow",
        "track": {"log": true}
      }
    ]
     }'
   ```

### Local Services

| Service | URL | Description |
|---------|-----|-------------|
| **API Gateway** | http://localhost:3000 | Main API endpoint |
| **DynamoDB** | http://localhost:8000 | Local DynamoDB |
| **SQS** | http://localhost:9324 | Local SQS (ElasticMQ) |
| **Cognito** | http://localhost:9229 | Local Cognito |
| **Step Functions** | http://localhost:8083 | Local Step Functions |
| **Lambda Functions** | http://localhost:3001-3004 | Direct Lambda access |

### Authentication in Development

The system supports **dual authentication modes**:

#### Development Mode (Default)
- **No authentication required** for API calls
- Automatically creates mock tokens with Admin privileges
- Uses tenant ID: `123e4567-e89b-12d3-a456-426614174000`

#### Production Mode (Cognito JWT)
- **Full JWT validation** with Cognito Local
- Test users available:
  - **Admin**: `admin@example.com` / `AdminPass123!`
  - **User**: `user@example.com` / `UserPass123!`

```bash
# Generate JWT tokens for testing
./local-dev/get-auth-token.sh admin
./local-dev/get-auth-token.sh user

# Use token in API calls
curl -H "Authorization: Bearer <jwt-token>" http://localhost:3000/dev/policies
```

### Development Workflow

1. **Environment Management**
   ```bash
   # Start services
   docker compose -f docker-compose.local.yml up -d
   
   # View logs
   docker compose -f docker-compose.local.yml logs -f
   
   # Restart services
   docker compose -f docker-compose.local.yml restart
   
   # Stop services
   docker compose -f docker-compose.local.yml down
   ```

2. **Database Operations**
   ```bash
   # View DynamoDB data
   aws dynamodb scan --table-name policy-manager-local \
     --endpoint-url http://localhost:8000 --region us-east-1
   
   # View SQS queues
   aws sqs list-queues --endpoint-url http://localhost:9324 --region us-east-1
   ```

3. **Testing and Debugging**
   ```bash
   # Run unit tests
   npm test
   
   # Run integration tests against local services
   npm run test:integration
   
   # Check service health
   curl http://localhost:3000/health
   ```

### Local Development Scripts

```bash
# Complete environment setup
./local-dev/setup-local.sh

# Generate authentication tokens
./local-dev/get-auth-token.sh admin

# Rebuild Lambda containers (after code changes)
./local-dev/rebuild-containers.sh
```

### Lambda Layers Simulation

The S3 Policy Manager uses **AWS Lambda Layers** in production for shared code optimization. Here's how layers are simulated locally:

#### **Production (AWS) Lambda Layers:**
```typescript
// In CDK Stack (policy-manager-stack.ts)
const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
  layerVersionName: `policy-manager-shared-${environment}`,
  code: lambda.Code.fromAsset(path.join(__dirname, '../shared')),
  compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
  description: 'Shared utilities and types for Policy Manager',
});

// Each Lambda function uses the layer
const apiHandler = new lambda.Function(this, 'ApiHandler', {
  layers: [sharedLayer],  // ← Layer attached here
  code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas')),
  // ... other config
});
```

#### **Local Development Layer Simulation:**
In local development, layers are simulated by **including all code directly in each Lambda container**:

```dockerfile
# Example: local-dev/Dockerfile.api-handler
FROM public.ecr.aws/lambda/nodejs:18

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy ALL source code (simulates layer + function code)
COPY src/shared/ ./src/shared/           # ← Shared code (layer simulation)
COPY src/lambdas/api-handler/ ./src/lambdas/api-handler/  # ← Function-specific code
COPY tsconfig.json ./

# Build TypeScript (includes shared + lambda code)
RUN npm run build

# Set handler for specific Lambda function
ENV _HANDLER=dist/lambdas/api-handler/api-handler.handler
```

#### **Layer Content Structure:**

**Production Layer (`/opt/nodejs/`):**
```
/opt/nodejs/
├── src/shared/
│   ├── types.ts          # TypeScript interfaces
│   ├── validation.ts     # Input validation schemas  
│   ├── context.ts        # Request context management
│   ├── auth.ts           # Authentication utilities
│   ├── repository.ts     # DynamoDB operations
│   └── sqs.ts            # SQS operations
└── node_modules/         # Layer dependencies
```

**Local Simulation (in each container):**
```
/var/task/
├── dist/
│   ├── shared/           # ← Same shared code, built locally
│   │   ├── types.js
│   │   ├── validation.js
│   │   ├── context.js
│   │   ├── auth.js
│   │   ├── repository.js
│   │   └── sqs.js
│   └── lambdas/          # Function-specific code
│       ├── api-handler.js
│       ├── sqs-processor.js
│       ├── validate-policy.js
│       └── publish-policy.js
└── node_modules/         # All dependencies
```

#### **Import Resolution:**

**Production (with layers):**
```typescript
// Lambda functions import from layer
import { PolicyRepository } from '/opt/nodejs/src/shared/repository';
import { RequestContext } from '/opt/nodejs/src/shared/types';
```

**Local Development:**
```typescript
// Same imports work due to relative path resolution
import { PolicyRepository } from '../shared/repository';
import { RequestContext } from '../shared/types';
```

#### **Benefits of This Approach:**

✅ **Code Consistency**: Same imports work in both environments  
✅ **Layer Simulation**: Shared code behavior matches production  
✅ **Development Speed**: No need to build/deploy layers locally  
✅ **Debugging**: Full source code available in each container  
✅ **Hot Reloading**: Changes rebuild quickly without layer complexity  

#### **Layer Optimization in Production:**

- **Shared Layer**: Contains common utilities, types, and dependencies
- **Reduced Bundle Size**: Each Lambda only contains function-specific code
- **Faster Cold Starts**: Shared code cached across function instances
- **Version Management**: Layer versions ensure consistency across deployments

#### **Local vs Production Comparison:**

| Aspect | Local Development | Production (AWS) |
|--------|------------------|------------------|
| **Shared Code** | Bundled in each container | Separate Lambda Layer |
| **Dependencies** | Full node_modules per container | Optimized layer + function deps |
| **Bundle Size** | Larger (includes everything) | Smaller (layer + function code) |
| **Cold Start** | Container startup time | Layer caching + function init |
| **Updates** | Rebuild containers | Deploy layer + functions |
| **Debugging** | Full source in container | Layer + function separation |

This approach ensures that local development closely mirrors production behavior while maintaining development efficiency.

### Troubleshooting Local Development

**Services not starting:**
- Check Docker is running
- Verify ports 3000-3004, 8000, 8083, 9229, 9324 are available
- Run `docker compose logs` to check for errors

**API calls failing:**
- **⚠️ FIRST: Ensure you ran `./local-dev/setup-local.sh`** - This is the most common cause of API failures
- Verify services are running: `docker ps`
- Check API Gateway logs: `docker logs api-gateway`
- Ensure local setup script completed successfully

**Authentication issues:**
- For development mode, no auth headers needed
- For production mode, generate tokens with `./local-dev/get-auth-token.sh`
- Check [AUTHENTICATION.md](AUTHENTICATION.md) for detailed setup

---

## ☁️ AWS Deployment

### Prerequisites for Deployment

1. **AWS CLI Configuration**
   ```bash
   aws configure
   # Ensure you have appropriate permissions for:
   # - Lambda, API Gateway, DynamoDB, SQS, Step Functions
   # - Cognito, CloudWatch, IAM
   ```

2. **CDK Bootstrap** (first time only)
   ```bash
   cdk bootstrap
   ```

### Environment Configuration

The application supports multiple deployment environments with different configurations:

| Environment | Purpose | Configuration |
|-------------|---------|---------------|
| **Development** | Development testing | Single-AZ, pay-per-request, basic monitoring |
| **Staging** | Pre-production testing | Multi-AZ, performance monitoring, load testing |
| **Production** | Live environment | Multi-AZ, enhanced monitoring, backup, VPC |

### Deployment Commands

#### Development Environment
```bash
# Deploy development stack
cdk deploy --context environment=dev

# Deploy with specific parameters
cdk deploy --context environment=dev \
  --parameters cognitoUserPoolId=your-pool-id \
  --parameters domainName=api-dev.your-domain.com
```

#### Staging Environment
```bash
# Deploy staging stack
cdk deploy --context environment=staging

# Deploy with approval for security changes
cdk deploy --context environment=staging --require-approval security-changes
```

#### Production Environment
```bash
# Deploy production stack with all safeguards
cdk deploy --context environment=prod \
  --require-approval security-changes \
  --parameters enableBackup=true \
  --parameters enableVpc=true
```

### Environment Variables

Configure these environment variables for deployment:

```bash
# Required
export AWS_REGION=us-east-1
export ENVIRONMENT=dev|staging|prod

# Optional
export DOMAIN_NAME=your-domain.com
export COGNITO_USER_POOL_ID=your-pool-id
export ENABLE_VPC=true
export ENABLE_BACKUP=true
```

### Post-Deployment Setup

1. **Configure Cognito User Pool**
   ```bash
   # Create user pool (if not using existing)
   aws cognito-idp create-user-pool --pool-name policy-manager-${ENVIRONMENT}
   
   # Create user pool client
   aws cognito-idp create-user-pool-client \
     --user-pool-id <pool-id> \
     --client-name policy-manager-client
   ```

2. **Create Initial Admin User**
   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id <pool-id> \
     --username admin@your-domain.com \
     --user-attributes Name=email,Value=admin@your-domain.com \
     --temporary-password <yourstrongpassword>
   ```

3. **Test Deployment**
   ```bash
   # Get API Gateway URL from CDK output
   API_URL=$(aws cloudformation describe-stacks \
     --stack-name PolicyManagerStack-${ENVIRONMENT} \
     --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
     --output text)
   
   # Test health endpoint
   curl ${API_URL}/health
   ```

### Monitoring and Observability

#### CloudWatch Dashboards
- **API Metrics**: Request count, latency, error rates
- **Lambda Metrics**: Duration, memory usage, error rates
- **DynamoDB Metrics**: Read/write capacity, throttling
- **Step Functions**: Execution success/failure rates

#### Alarms and Notifications
```bash
# Set up SNS topic for alerts
aws sns create-topic --name policy-manager-alerts-${ENVIRONMENT}

# Subscribe to alerts
aws sns subscribe \
  --topic-arn arn:aws:sns:${AWS_REGION}:${ACCOUNT_ID}:policy-manager-alerts-${ENVIRONMENT} \
  --protocol email \
  --notification-endpoint your-email@domain.com
```

#### Log Aggregation
- All Lambda functions log to CloudWatch Logs
- Structured logging with correlation IDs
- X-Ray tracing enabled for distributed tracing

### Security Configuration

#### IAM Roles and Policies
- **Lambda Execution Role**: Minimal permissions for each function
- **API Gateway Role**: CloudWatch logging permissions
- **Step Functions Role**: Lambda invocation permissions

#### Network Security (Production)
```bash
# Deploy with VPC configuration
cdk deploy --context environment=prod \
  --parameters enableVpc=true \
  --parameters vpcId=vpc-xxxxxxxx \
  --parameters privateSubnetIds=subnet-xxxxxxxx,subnet-yyyyyyyy
```

#### Data Encryption
- **DynamoDB**: Encryption at rest with AWS managed keys
- **SQS**: Server-side encryption enabled
- **Lambda**: Environment variables encrypted with KMS

### Backup and Disaster Recovery

#### DynamoDB Backup
```bash
# Enable point-in-time recovery
aws dynamodb put-backup-policy \
  --table-name PolicyManager-${ENVIRONMENT} \
  --backup-policy BackupEnabled=true
```

#### Cross-Region Replication (Production)
```bash
# Deploy to secondary region
cdk deploy --context environment=prod \
  --context region=us-west-2 \
  --parameters enableCrossRegionReplication=true
```

### Cost Optimization

#### Development Environment
- Pay-per-request DynamoDB billing
- Lambda provisioned concurrency disabled
- CloudWatch log retention: 7 days

#### Production Environment
- DynamoDB provisioned billing with auto-scaling
- Lambda provisioned concurrency for critical functions
- CloudWatch log retention: 30 days
- Reserved capacity for predictable workloads

### Deployment Troubleshooting

**CDK Deployment Fails:**
```bash
# Check CDK version
cdk --version

# Clear CDK cache
rm -rf cdk.out/

# Deploy with verbose logging
cdk deploy --verbose
```

**Lambda Function Errors:**
```bash
# Check function logs
aws logs tail /aws/lambda/PolicyManager-ApiHandler-${ENVIRONMENT}

# Check function configuration
aws lambda get-function --function-name PolicyManager-ApiHandler-${ENVIRONMENT}
```

**API Gateway Issues:**
```bash
# Check API Gateway logs
aws logs tail /aws/apigateway/PolicyManagerApi-${ENVIRONMENT}

# Test API Gateway directly
aws apigateway test-invoke-method \
  --rest-api-id <api-id> \
  --resource-id <resource-id> \
  --http-method GET
```

---

## 📚 Documentation

- **[API Documentation](API-DOCUMENTATION.md)** - Complete API reference with examples
- **[Authentication Guide](AUTHENTICATION.md)** - Authentication setup and configuration
- **[Architecture Guide](docs/ARCHITECTURE.md)** - Detailed system architecture
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Advanced deployment scenarios

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
# Local integration tests
npm run test:integration

# AWS integration tests
npm run test:integration:aws
```

### Load Testing
```bash
# Install artillery
npm install -g artillery

# Run load tests
artillery run tests/load/api-load-test.yml
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: Create an issue in the GitHub repository
- **Documentation**: Check the `/docs` folder for detailed guides
- **Logs**: Review CloudWatch logs for debugging
- **Community**: Join our Discord server for community support
