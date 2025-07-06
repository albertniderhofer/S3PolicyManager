# Authentication Setup for S3 Policy Manager

## Authentication Modes

The S3 Policy Manager supports **three authentication modes**:

### 1. Mock Development Mode
- **Environment**: Local development only
- **Mode**: Mock authentication for rapid development
- **How it works**: When no Authorization header is provided, the system automatically creates a mock token with:
  - Tenant ID: `123e4567-e89b-12d3-a456-426614174000`
  - Username: `mockuser`
  - User ID: `mock-user-id`
  - Groups: `["Admin"]`

### 2. Local Cognito Development Mode
- **Environment**: Local development with Cognito Local
- **Mode**: JWT validation with local Cognito instance
- **Setup**: Cognito Local is configured with:
  - User Pool ID: `[configured in local setup]`
  - Client ID: `[configured in local setup]`
  - Test users created (see local-dev/get-auth-token.sh)

### 3. AWS Cognito Production Mode
- **Environment**: Production AWS environment
- **Mode**: Full JWT validation with AWS Cognito User Pool
- **Setup**: AWS Cognito User Pool deployed via CDK:
  - User Pool ID: Available from CDK deployment outputs
  - Region: `us-east-1`
  - Custom attribute: `tenant_id`

## How Authentication Currently Works

### Development Flow (Active)
```typescript
// In src/shared/auth.ts - TokenValidator.mockValidation()
if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
  return this.mockValidation(event);
}
```

When you make API calls without an Authorization header:
```bash
curl -X GET http://localhost:3000/dev/policies
# ✅ Works - uses mock token automatically
```

### Production Flow (Ready for Testing)
When you provide a proper JWT token:
```bash
curl -X GET http://localhost:3000/dev/policies \
  -H "Authorization: Bearer <JWT_TOKEN>"
# 🔧 Should work with proper Cognito JWT
```

## Testing Authentication

### Current Working Tests
```bash
# Test without authentication (uses mock)
curl http://localhost:3000/dev/policies

# Create policy without authentication (uses mock)
curl -X POST http://localhost:3000/dev/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Policy",
    "description": "Test policy",
    "enabled": true,
    "status": "draft",
    "rules": []
  }'
```

### Cognito Local Setup (Configured)
The system has been configured with:

**User Pool**: `local_2z3zF2el`
- Admin Group: Full access
- User Group: Limited access

**Test Users**:
- **Admin**: `admin@example.com` / `[password in script]`
- **User**: `user@example.com` / `[password in script]`
- **Tenant ID**: `[configured in local setup]`

**Client**: `[configured in local setup]`
- Supports USER_PASSWORD_AUTH flow (local compatible)
- Configured for local development

## Token Generation (Ready for Testing)

A token generation script has been created: `./local-dev/get-auth-token.sh`

```bash
# Get admin token
./local-dev/get-auth-token.sh admin

# Get user token  
./local-dev/get-auth-token.sh user

# Use custom credentials
./local-dev/get-auth-token.sh custom
```

## Authentication Architecture

### Request Flow
1. **API Gateway** receives request
2. **Lambda Handler** calls `TokenValidator.validateAndInitializeContext()`
3. **TokenValidator** checks for development mode:
   - If development: Creates mock token
   - If production: Validates JWT against Cognito
4. **RequestContextManager** initializes with user context
5. **Repository** uses tenant ID for data isolation

### Security Features
- **Multi-tenant isolation**: All data operations use tenant ID
- **Role-based access**: Admin vs User groups
- **Zero Trust**: Each Lambda validates tokens independently
- **Audit trails**: All operations logged with user context

## Environment Variables

The system uses these environment variables for authentication:

```bash
# Current settings (in docker-compose.local.yml)
NODE_ENV=development                    # Enables mock authentication
AWS_REGION=us-east-1                   # For Cognito region
COGNITO_USER_POOL_ID=local_2z3zF2el   # Cognito User Pool ID
```

## Production Authentication with AWS Cognito

### Prerequisites
- AWS CLI configured with appropriate permissions
- User Pool ID: Available from CDK deployment outputs
- User Pool Client ID: Available from CDK deployment outputs or AWS Console
- AWS Region: `us-east-1`

### Step 1: Get User Pool and Client Details

Get the User Pool and Client details from your CDK deployment:

```bash
# Get User Pool ID from CDK outputs
aws cloudformation describe-stacks \
  --stack-name PolicyManagerStack-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text \
  --region us-east-1

# List User Pool Clients to get Client ID
aws cognito-idp list-user-pool-clients \
  --user-pool-id <YOUR_USER_POOL_ID> \
  --region us-east-1
```

The User Pool Client is configured with:
- **Auth Flows**: ALLOW_ADMIN_USER_PASSWORD_AUTH, ALLOW_USER_PASSWORD_AUTH, ALLOW_USER_SRP_AUTH, ALLOW_REFRESH_TOKEN_AUTH
- **Token Validity**: 
  - Access Token: 1 hour
  - ID Token: 1 hour  
  - Refresh Token: 30 days

**Note**: If you need to create additional clients, you can use:

```bash
# Create additional app client (optional)
aws cognito-idp create-user-pool-client \
  --user-pool-id <YOUR_USER_POOL_ID> \
  --client-name "PolicyManagerClient-Additional" \
  --explicit-auth-flows ADMIN_NO_SRP_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --region us-east-1
```

### Step 2: Create Users and Set Passwords

```bash
# Create a new user
aws cognito-idp admin-create-user \
  --user-pool-id <YOUR_USER_POOL_ID> \
  --username "<YOUR_USERNAME>" \
  --user-attributes Name=email,Value=<YOUR_EMAIL> Name=custom:tenant_id,Value=<YOUR_TENANT_ID> \
  --temporary-password "<TEMP_PASSWORD>" \
  --message-action SUPPRESS \
  --region us-east-1

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id <YOUR_USER_POOL_ID> \
  --username "<YOUR_USERNAME>" \
  --password "<YOUR_SECURE_PASSWORD>" \
  --permanent \
  --region us-east-1

# Add user to Admin group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <YOUR_USER_POOL_ID> \
  --username "<YOUR_USERNAME>" \
  --group-name Admin \
  --region us-east-1
```

### Step 3: Obtain Bearer Token

#### Method 1: Using AWS CLI (Recommended for Testing)

```bash
# Authenticate and get tokens
aws cognito-idp admin-initiate-auth \
  --user-pool-id <YOUR_USER_POOL_ID> \
  --client-id <YOUR_CLIENT_ID> \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=<YOUR_USERNAME>,PASSWORD=<YOUR_PASSWORD> \
  --region us-east-1
```

This returns a JSON response with:
- `AccessToken` - Use this as your Bearer token
- `IdToken` - Contains user information
- `RefreshToken` - Use to refresh expired tokens

#### Method 2: Using cURL (Direct API Call)

```bash
# Get bearer token via direct API call
curl -X POST https://cognito-idp.us-east-1.amazonaws.com/ \
  -H "Content-Type: application/x-amz-json-1.1" \
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.AdminInitiateAuth" \
  -d '{
    "UserPoolId": "<YOUR_USER_POOL_ID>",
    "ClientId": "<YOUR_CLIENT_ID>",
    "AuthFlow": "ADMIN_NO_SRP_AUTH",
    "AuthParameters": {
      "USERNAME": "<YOUR_USERNAME>",
      "PASSWORD": "<YOUR_PASSWORD>"
    }
  }'
```

#### Method 3: Using Node.js/JavaScript

```javascript
const { CognitoIdentityProviderClient, AdminInitiateAuthCommand } = require("@aws-sdk/client-cognito-identity-provider");

const client = new CognitoIdentityProviderClient({ region: "us-east-1" });

async function getAuthToken(username, password) {
  const command = new AdminInitiateAuthCommand({
    UserPoolId: "<YOUR_USER_POOL_ID>",
    ClientId: "<YOUR_CLIENT_ID>",
    AuthFlow: "ADMIN_NO_SRP_AUTH",
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  });

  try {
    const response = await client.send(command);
    return response.AuthenticationResult.AccessToken;
  } catch (error) {
    console.error("Authentication failed:", error);
    throw error;
  }
}

// Usage
getAuthToken("<YOUR_USERNAME>", "<YOUR_PASSWORD>")
  .then(token => console.log("Bearer Token:", token));
```

### Step 4: Use Bearer Token with API

Once you have the bearer token, use it to authenticate API requests:

```bash
# Example API call with bearer token
curl -X GET <YOUR_API_GATEWAY_URL>/policies \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json"

# Create a policy with authentication
curl -X POST <YOUR_API_GATEWAY_URL>/policies \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Policy",
    "description": "Policy created with proper authentication",
    "enabled": true,
    "status": "draft",
    "rules": []
  }'
```

### Token Refresh

Access tokens expire (typically after 1 hour). Use the refresh token to get new tokens:

```bash
# Refresh expired token
aws cognito-idp admin-initiate-auth \
  --user-pool-id <YOUR_USER_POOL_ID> \
  --client-id <YOUR_CLIENT_ID> \
  --auth-flow REFRESH_TOKEN_AUTH \
  --auth-parameters REFRESH_TOKEN=<YOUR_REFRESH_TOKEN> \
  --region us-east-1
```

### Production Environment Variables

For production deployment, ensure these environment variables are set:

```bash
NODE_ENV=production                     # Disables mock authentication
AWS_REGION=us-east-1                   # AWS region
COGNITO_USER_POOL_ID=<YOUR_USER_POOL_ID>  # Production User Pool ID
```

### Security Best Practices

1. **Never hardcode credentials** - Use environment variables or AWS Secrets Manager
2. **Use HTTPS only** - All API calls must use HTTPS in production
3. **Implement token refresh** - Handle token expiration gracefully
4. **Validate tenant isolation** - Ensure users can only access their tenant's data
5. **Monitor authentication** - Set up CloudWatch alarms for failed authentications
6. **Use least privilege** - Grant minimal required permissions to users

### Troubleshooting Production Authentication

#### Common Issues:

1. **"User does not exist"**
   ```bash
   # Check if user exists
   aws cognito-idp admin-get-user \
     --user-pool-id <YOUR_USER_POOL_ID> \
     --username <YOUR_USERNAME> \
     --region us-east-1
   ```

2. **"User is not confirmed"**
   ```bash
   # Confirm user manually
   aws cognito-idp admin-confirm-sign-up \
     --user-pool-id <YOUR_USER_POOL_ID> \
     --username <YOUR_USERNAME> \
     --region us-east-1
   ```

3. **"Invalid authentication flow"**
   - Ensure your app client has `ADMIN_NO_SRP_AUTH` enabled
   - Check that the client ID is correct

4. **"Access denied" on API calls**
   - Verify the bearer token is valid and not expired
   - Check that the user has the correct group membership
   - Ensure the `tenant_id` custom attribute is set

### Next Steps for Full Cognito Integration

1. **Create App Client**: Set up a proper app client with required auth flows
2. **User Management**: Create users and assign them to appropriate groups
3. **Test Token Generation**: Verify token generation works with your client
4. **Integration Tests**: Create automated tests for production authentication
5. **Monitoring**: Set up CloudWatch monitoring for authentication events

## Troubleshooting

### Mock Authentication Not Working
- Check `NODE_ENV=development` is set
- Verify Lambda environment variables
- Check console logs for authentication errors

### Cognito Authentication Issues
- Verify Cognito Local is running on port 9229
- Check User Pool and Client IDs match
- Ensure users are in CONFIRMED status
- Test with AWS CLI commands first

### API Access Denied
- Check tenant ID matches in token and data
- Verify user has required group membership
- Check RequestContextManager initialization

## Security Considerations

### Development Mode
- ⚠️ **Never use in production**
- Mock tokens bypass all security
- All requests get Admin privileges
- No actual user validation

### Production Mode
- ✅ Full JWT validation
- ✅ Tenant isolation enforced
- ✅ Role-based access control
- ✅ Token expiration handling
- ✅ Audit trail logging
