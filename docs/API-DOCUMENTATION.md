# S3 Policy Manager API Documentation

## Overview

The S3 Policy Manager provides a RESTful API for managing S3 bucket policies with multi-tenant support. All endpoints require authentication and automatically enforce tenant isolation.

## Authentication

All API endpoints require JWT authentication via Cognito. Include the JWT token in the Authorization header:

```
Authorization: Bearer <jwt-token>
```

### Development Mode
For local development, the system uses mock authentication when no Authorization header is provided. This automatically creates a mock token with Admin privileges.

### Production Mode
In production, valid Cognito JWT tokens are required. See [AUTHENTICATION.md](AUTHENTICATION.md) for detailed authentication setup.

## Base URL

- **Local Development**: `http://localhost:3000`
- **Development Environment**: `https://api-dev.your-domain.com`
- **Production Environment**: `https://api.your-domain.com`

## API Endpoints

### Health Check

#### GET /health
Check API health status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

### Policies

#### GET /policies
List all policies for the authenticated tenant.

**Query Parameters:**
- `limit` (optional): Maximum number of policies to return (default: 50)
- `offset` (optional): Number of policies to skip (default: 0)
- `status` (optional): Filter by policy status (`draft`, `published`, `deleted`)

**Response:**
```json
{
  "success": true,
  "data": {
    "policies": [
      {
        "_id": "policy-123",
        "name": "Block Social Media",
        "description": "Block social media during work hours",
        "enabled": true,
        "status": "published",
        "rules": [
          {
            "id": "rule-1",
            "name": "Block Facebook",
            "source": { "user": "john.doe" },
            "destination": { "domains": "facebook.com" },
            "time": {
              "not_between": ["09:00", "17:00"],
              "days": ["monday", "tuesday", "wednesday", "thursday", "friday"]
            },
            "action": "block",
            "track": {
              "log": true,
              "comment": "Block during work hours"
            }
          }
        ],
        "created": "2024-01-01T00:00:00.000Z",
        "updated": "2024-01-01T00:00:00.000Z",
        "createdBy": "john.doe",
        "updatedBy": "john.doe"
      }
    ],
    "count": 1,
    "total": 1
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /policies/{id}
Get a specific policy by ID.

**Path Parameters:**
- `id`: Policy ID (UUID)

**Response:**
```json
{
  "success": true,
  "data": {
    "policy": {
      "_id": "policy-123",
      "name": "Block Social Media",
      "description": "Block social media during work hours",
      "enabled": true,
      "status": "published",
      "rules": [...],
      "created": "2024-01-01T00:00:00.000Z",
      "updated": "2024-01-01T00:00:00.000Z",
      "createdBy": "john.doe",
      "updatedBy": "john.doe"
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### POST /policies
Create a new policy.

**Request Body:**
```json
{
  "name": "Block Social Media",
  "description": "Block social media during work hours",
  "enabled": true,
  "rules": [
    {
      "id": "rule-1",
      "name": "Block Facebook",
      "source": { "user": "john.doe" },
      "destination": { "domains": "facebook.com" },
      "time": {
        "not_between": ["09:00", "17:00"],
        "days": ["monday", "tuesday", "wednesday", "thursday", "friday"]
      },
      "action": "block",
      "track": {
        "log": true,
        "comment": "Block during work hours"
      }
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "policy": {
      "_id": "policy-123",
      "name": "Block Social Media",
      "description": "Block social media during work hours",
      "enabled": true,
      "status": "draft",
      "rules": [...],
      "created": "2024-01-01T00:00:00.000Z",
      "updated": "2024-01-01T00:00:00.000Z",
      "createdBy": "john.doe",
      "updatedBy": "john.doe"
    },
    "message": "Policy created successfully"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### PUT /policies/{id}
Update an existing policy.

**Path Parameters:**
- `id`: Policy ID (UUID)

**Request Body:**
```json
{
  "name": "Updated Policy Name",
  "description": "Updated description",
  "enabled": false,
  "rules": [...]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "policy": {
      "_id": "policy-123",
      "name": "Updated Policy Name",
      "description": "Updated description",
      "enabled": false,
      "status": "draft",
      "rules": [...],
      "created": "2024-01-01T00:00:00.000Z",
      "updated": "2024-01-01T12:00:00.000Z",
      "createdBy": "john.doe",
      "updatedBy": "john.doe"
    },
    "message": "Policy updated successfully"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

#### DELETE /policies/{id}
Delete a policy (soft delete).

**Path Parameters:**
- `id`: Policy ID (UUID)

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Policy deleted successfully",
    "policyId": "policy-123"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### User Policies

The User Policies API provides read-only access to tenant-specific policies with enhanced filtering and isolation. User policies are stored separately from the main policies and provide tenant-level policy visibility.

#### GET /user-policies
List all user policies for the authenticated tenant with automatic tenant filtering.

**Query Parameters:**
- `limit` (optional): Maximum number of policies to return (default: 50)
- `offset` (optional): Number of policies to skip (default: 0)
- `status` (optional): Filter by policy status (`draft`, `published`, `deleted`)

**Response:**
```json
{
  "success": true,
  "data": {
    "userPolicies": [
      {
        "PK": "TENANT#123e4567-e89b-12d3-a456-426614174000",
        "SK": "POLICY#policy-456",
        "TenantID": "123e4567-e89b-12d3-a456-426614174000",
        "PolicyName": "User Access Control",
        "RuleName": "Allow Jira Access",
        "Destination": "atlassian.net",
        "Source": "user@company.com",
        "Action": "allow",
        "TimeRestriction": {
          "not_between": ["22:00", "06:00"],
          "days": ["Mon", "Tue", "Wed", "Thu", "Fri"]
        },
        "Track": {
          "log": true,
          "comment": "Allow Jira during work hours"
        },
        "Enabled": true,
        "Status": "published",
        "Created": "2024-01-01T00:00:00.000Z",
        "Updated": "2024-01-01T00:00:00.000Z",
        "CreatedBy": "user@company.com",
        "UpdatedBy": "user@company.com"
      }
    ],
    "count": 1,
    "filters": {
      "tenantId": "123e4567-e89b-12d3-a456-426614174000"
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Policy Schema

### Policy Object
```typescript
interface Policy {
  _id: string;                    // UUID
  name: string;                   // Policy name (required)
  description?: string;           // Policy description
  enabled: boolean;               // Whether policy is active
  status: 'draft' | 'published' | 'deleted';
  rules: PolicyRule[];            // Array of policy rules
  created: string;                // ISO timestamp
  updated: string;                // ISO timestamp
  createdBy: string;              // Username
  updatedBy: string;              // Username
}
```

### Policy Rule Object
```typescript
interface PolicyRule {
  id: string;                     // Rule ID (unique within policy)
  name: string;                   // Rule name
  source: {                       // Source specification
    user?: string;                // Username or "*" for all
    group?: string;               // User group
    ip?: string;                  // IP address or CIDR
  };
  destination: {                  // Destination specification
    domains?: string;             // Domain name or pattern
    urls?: string[];              // Specific URLs
    categories?: string[];        // Content categories
  };
  time?: {                        // Time restrictions
    between?: [string, string];   // Time range (HH:MM format)
    not_between?: [string, string]; // Excluded time range
    days?: string[];              // Days of week
  };
  action: 'allow' | 'block';      // Action to take
  track?: {                       // Tracking options
    log?: boolean;                // Enable logging
    comment?: string;             // Comment for logs
  };
}
```

## Policy Workflow

When a policy is created, updated, or deleted, the following workflow is automatically triggered:

### 1. Policy Event Processing
- API Handler saves the policy to DynamoDB
- Event is published to SQS queue
- SQS Processor receives event and starts Step Functions workflow

### 2. Step Functions Workflow
```
Start → Validate Policy → Check Validation → Publish Policy → Complete
                      ↓
                 Validation Failed → End
```

### 3. Policy States
- **`draft`**: Initial state, not yet published
- **`published`**: Successfully validated and deployed
- **`deleted`**: Soft-deleted, no longer active

### 4. Workflow Steps

#### Validate Policy
- Business rule validation
- Schema validation
- Conflict detection
- Resource availability checks

#### Publish Policy
- Deploy to external systems
- Update policy status
- Send notifications
- Create audit logs

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": {
    "error": "ErrorType",
    "message": "Human readable error message",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Types

#### 400 Bad Request - ValidationError
```json
{
  "success": false,
  "error": {
    "error": "ValidationError",
    "message": "Policy name is required",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### 401 Unauthorized - UnauthorizedError
```json
{
  "success": false,
  "error": {
    "error": "UnauthorizedError",
    "message": "Invalid or expired token",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### 404 Not Found - NotFoundError
```json
{
  "success": false,
  "error": {
    "error": "NotFoundError",
    "message": "Policy not found",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### 409 Conflict - ConflictError
```json
{
  "success": false,
  "error": {
    "error": "ConflictError",
    "message": "Policy with this name already exists",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### 500 Internal Server Error - InternalError
```json
{
  "success": false,
  "error": {
    "error": "InternalError",
    "message": "Internal server error",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## Rate Limiting

API endpoints are rate limited to prevent abuse:

- **Development**: 1000 requests per minute per IP
- **Production**: 100 requests per minute per user

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## Pagination

List endpoints support pagination:

**Query Parameters:**
- `limit`: Number of items per page (max 100, default 50)
- `offset`: Number of items to skip (default 0)

**Response includes pagination info:**
```json
{
  "success": true,
  "data": {
    "policies": [...],
    "count": 50,
    "total": 150,
    "pagination": {
      "limit": 50,
      "offset": 0,
      "hasNext": true,
      "hasPrevious": false
    }
  }
}
```

## Local Testing Examples

### Using cURL

```bash
# Get all policies (development mode - no auth needed)
curl http://localhost:3000/dev/policies

# Create a policy
curl -X POST http://localhost:3000/dev/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Policy",
    "description": "A test policy",
    "enabled": true,
    "rules": [
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

# Get specific policy
curl http://localhost:3000/dev/policies/{policy-id}

# Update policy
curl -X PUT http://localhost:3000/dev/policies/{policy-id} \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Policy Name"}'

# Delete policy
curl -X DELETE http://localhost:3000/dev/policies/{policy-id}

# Get all user policies (development mode - no auth needed)
curl http://localhost:3000/dev/user-policies
```

### Using JavaScript/Node.js

```javascript
const axios = require('axios');

const apiClient = axios.create({
  baseURL: 'http://localhost:3000/dev',
  headers: {
    'Content-Type': 'application/json',
    // 'Authorization': 'Bearer <jwt-token>' // For production
  }
});

// Get all policies
const policies = await apiClient.get('/policies');
console.log(policies.data);

// Create policy
const newPolicy = await apiClient.post('/policies', {
  name: 'Test Policy',
  description: 'A test policy',
  enabled: true,
  rules: [...]
});
console.log(newPolicy.data);

// Get all user policies
const userPolicies = await apiClient.get('/user-policies');
console.log(userPolicies.data);
```

### Using Python

```python
import requests

base_url = 'http://localhost:3000/dev'
headers = {
    'Content-Type': 'application/json',
    # 'Authorization': 'Bearer <jwt-token>'  # For production
}

# Get all policies
response = requests.get(f'{base_url}/policies', headers=headers)
policies = response.json()
print(policies)

# Create policy
policy_data = {
    'name': 'Test Policy',
    'description': 'A test policy',
    'enabled': True,
    'rules': [...]
}
response = requests.post(f'{base_url}/policies', json=policy_data, headers=headers)
new_policy = response.json()
print(new_policy)

# Get all user policies
response = requests.get(f'{base_url}/user-policies', headers=headers)
user_policies = response.json()
print(user_policies)
```

## Multi-Tenancy

The API automatically enforces multi-tenant isolation:

- **Tenant Identification**: Extracted from JWT token (`custom:tenant_id`)
- **Data Isolation**: All operations scoped to user's tenant
- **Authorization**: Users can only access their tenant's data
- **Audit Trails**: All operations logged with tenant context

## Monitoring and Observability

### Request Tracing
All requests include tracing headers:
```
X-Request-ID: uuid-v4
X-Tenant-ID: tenant-uuid
X-User-ID: user-uuid
```

### Metrics
Key metrics are tracked:
- Request count by endpoint
- Response times
- Error rates
- Policy workflow success rates

### Logging
Structured logs include:
- Request/response details
- User and tenant context
- Error details and stack traces
- Performance metrics

For more information on authentication, see [AUTHENTICATION.md](AUTHENTICATION.md).
