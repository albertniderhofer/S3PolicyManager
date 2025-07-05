# Authentication Setup for S3 Policy Manager

## Current Authentication Status

The S3 Policy Manager currently supports **two authentication modes**:

### 1. Development Mode (Currently Active)
- **Status**: ✅ Working
- **Mode**: Mock authentication for local development
- **How it works**: When no Authorization header is provided, the system automatically creates a mock token with:
  - Tenant ID: `123e4567-e89b-12d3-a456-426614174000`
  - Username: `mockuser`
  - User ID: `mock-user-id`
  - Groups: `["Admin"]`

### 2. Production Mode (Cognito JWT)
- **Status**: 🔧 Configured but needs testing
- **Mode**: Full JWT validation with Cognito Local
- **Setup**: Cognito Local is configured with:
  - User Pool ID: `local_2z3zF2el`
  - Client ID: `ey9gpoc5g4xpm4pl5z1rnn7bh`
  - Test users created (admin@example.com, user@example.com)

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
- **Admin**: `admin@example.com` / `AdminPass123!`
- **User**: `user@example.com` / `UserPass123!`
- **Tenant ID**: `123e4567-e89b-12d3-a456-426614174000`

**Client**: `ey9gpoc5g4xpm4pl5z1rnn7bh`
- Supports ADMIN_NO_SRP_AUTH flow
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

## Next Steps for Full Cognito Integration

1. **Test Token Generation**: Debug the Cognito Local token generation
2. **Verify JWT Validation**: Test with actual JWT tokens
3. **Production Configuration**: Set up real Cognito for production
4. **Integration Tests**: Create automated tests for both modes

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
