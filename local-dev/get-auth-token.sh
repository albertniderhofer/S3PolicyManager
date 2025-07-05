#!/bin/bash

# Script to get authentication tokens from Cognito Local for testing

set -e

COGNITO_ENDPOINT="http://localhost:9229"
REGION="us-east-1"
USER_POOL_ID="local_2z3zF2el"
CLIENT_ID="ey9gpoc5g4xpm4pl5z1rnn7bh"

# Function to get auth token using direct HTTP call
get_token() {
    local username=$1
    local password=$2
    
    echo "🔐 Getting authentication token for $username..."
    
    # Create the request payload using InitiateAuth instead of AdminInitiateAuth
    local payload=$(cat <<EOF
{
    "AuthFlow": "USER_PASSWORD_AUTH",
    "ClientId": "$CLIENT_ID",
    "AuthParameters": {
        "USERNAME": "$username",
        "PASSWORD": "$password"
    }
}
EOF
)
    
    # Make direct HTTP request to Cognito Local using InitiateAuth
    RESPONSE=$(curl -s -X POST "$COGNITO_ENDPOINT/" \
        -H "Content-Type: application/x-amz-json-1.1" \
        -H "X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth" \
        -d "$payload")
    
    # Check if response contains AuthenticationResult
    if echo "$RESPONSE" | jq -e '.AuthenticationResult' > /dev/null 2>&1; then
        ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.AuthenticationResult.AccessToken')
        ID_TOKEN=$(echo "$RESPONSE" | jq -r '.AuthenticationResult.IdToken')
        REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.AuthenticationResult.RefreshToken')
        
        echo "✅ Authentication successful!"
        echo ""
        echo "🎫 Access Token (use this for API calls):"
        echo "$ACCESS_TOKEN"
        echo ""
        echo "🆔 ID Token:"
        echo "$ID_TOKEN"
        echo ""
        echo "🔄 Refresh Token:"
        echo "$REFRESH_TOKEN"
        echo ""
        echo "📋 Example API call:"
        echo "curl -X GET http://localhost:3000/dev/policies \\"
        echo "  -H \"Authorization: Bearer $ACCESS_TOKEN\""
        echo ""
        
        return 0
    else
        echo "❌ Authentication failed for $username"
        echo "Response: $RESPONSE"
        return 1
    fi
}

# Function to get auth token using AWS CLI (fallback)
get_token_aws_cli() {
    local username=$1
    local password=$2
    
    echo "🔐 Trying AWS CLI method for $username..."
    
    # Set fake AWS credentials for local use
    export AWS_ACCESS_KEY_ID="fake"
    export AWS_SECRET_ACCESS_KEY="fake"
    
    # Authenticate user and get tokens
    RESPONSE=$(timeout 10 aws cognito-idp admin-initiate-auth \
        --user-pool-id "$USER_POOL_ID" \
        --client-id "$CLIENT_ID" \
        --auth-flow ADMIN_NO_SRP_AUTH \
        --auth-parameters USERNAME="$username",PASSWORD="$password" \
        --endpoint-url "$COGNITO_ENDPOINT" \
        --region "$REGION" \
        --no-cli-pager 2>/dev/null)
    
    if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
        ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.AuthenticationResult.AccessToken')
        ID_TOKEN=$(echo "$RESPONSE" | jq -r '.AuthenticationResult.IdToken')
        REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.AuthenticationResult.RefreshToken')
        
        echo "✅ Authentication successful!"
        echo ""
        echo "🎫 Access Token (use this for API calls):"
        echo "$ACCESS_TOKEN"
        echo ""
        echo "🆔 ID Token:"
        echo "$ID_TOKEN"
        echo ""
        echo "🔄 Refresh Token:"
        echo "$REFRESH_TOKEN"
        echo ""
        echo "📋 Example API call:"
        echo "curl -X GET http://localhost:3000/dev/policies \\"
        echo "  -H \"Authorization: Bearer $ACCESS_TOKEN\""
        echo ""
        
        return 0
    else
        echo "❌ AWS CLI authentication failed for $username"
        return 1
    fi
}

# Function to test API with token
test_api() {
    local token=$1
    
    echo "🧪 Testing API with token..."
    
    RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        -X GET http://localhost:3000/dev/policies \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json")
    
    HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d')
    
    if [ "$HTTP_STATUS" = "200" ]; then
        echo "✅ API call successful!"
        echo "Response: $BODY" | jq .
    else
        echo "❌ API call failed with status: $HTTP_STATUS"
        echo "Response: $BODY"
    fi
}

# Main script
echo "🚀 Cognito Local Token Generator"
echo "================================"
echo ""

if [ "$#" -eq 0 ]; then
    echo "Usage: $0 [admin|user|custom]"
    echo ""
    echo "Options:"
    echo "  admin   - Get token for admin@example.com"
    echo "  user    - Get token for user@example.com"
    echo "  custom  - Provide custom username and password"
    echo ""
    echo "Available test users:"
    echo "  • admin@example.com / AdminPass123!"
    echo "  • user@example.com / UserPass123!"
    exit 1
fi

case "$1" in
    "admin")
        get_token "admin@example.com" "AdminPass123!"
        ;;
    "user")
        get_token "user@example.com" "UserPass123!"
        ;;
    "custom")
        read -p "Enter username: " USERNAME
        read -s -p "Enter password: " PASSWORD
        echo ""
        get_token "$USERNAME" "$PASSWORD"
        ;;
    *)
        echo "❌ Invalid option: $1"
        echo "Use: admin, user, or custom"
        exit 1
        ;;
esac
