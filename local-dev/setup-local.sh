#!/bin/bash

# Local development setup script for Policy Manager

set -e

echo "🚀 Setting up Policy Manager local development environment..."

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# DynamoDB Local setup
echo "📊 Setting up DynamoDB Local..."

# Check if table already exists
if aws dynamodb describe-table --table-name policy-manager-local --endpoint-url http://localhost:8000 --region us-east-1 --no-cli-pager >/dev/null 2>&1; then
    echo "📋 Table policy-manager-local already exists, skipping creation"
else
    echo "🔨 Creating DynamoDB table..."
    # Create the main table
    aws dynamodb create-table \
        --table-name policy-manager-local \
        --attribute-definitions \
            AttributeName=PK,AttributeType=S \
            AttributeName=SK,AttributeType=S \
            AttributeName=TenantID,AttributeType=S \
            AttributeName=Created,AttributeType=S \
        --key-schema \
            AttributeName=PK,KeyType=HASH \
            AttributeName=SK,KeyType=RANGE \
        --global-secondary-indexes \
            '[
                {
                    "IndexName": "TenantID-Created-Index",
                    "KeySchema": [
                        {
                            "AttributeName": "TenantID",
                            "KeyType": "HASH"
                        },
                        {
                            "AttributeName": "Created", 
                            "KeyType": "RANGE"
                        }
                    ],
                    "Projection": {
                        "ProjectionType": "ALL"
                    },
                    "ProvisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5
                    }
                }
            ]' \
        --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
        --endpoint-url http://localhost:8000 \
        --region us-east-1 \
        --no-cli-pager
    
    echo "✅ DynamoDB table created successfully"
fi

# Check if UserPolicies table already exists
if aws dynamodb describe-table --table-name UserPolicies --endpoint-url http://localhost:8000 --region us-east-1 --no-cli-pager >/dev/null 2>&1; then
    echo "📋 Table UserPolicies already exists, skipping creation"
else
    echo "🔨 Creating UserPolicies table..."
    # Create the UserPolicies table
    aws dynamodb create-table \
        --table-name UserPolicies \
        --attribute-definitions \
            AttributeName=PK,AttributeType=S \
            AttributeName=SK,AttributeType=S \
            AttributeName=PolicyID,AttributeType=S \
            AttributeName=TenantID,AttributeType=S \
        --key-schema \
            AttributeName=PK,KeyType=HASH \
            AttributeName=SK,KeyType=RANGE \
        --global-secondary-indexes \
            '[
                {
                    "IndexName": "PolicyID-Index",
                    "KeySchema": [
                        {
                            "AttributeName": "PolicyID",
                            "KeyType": "HASH"
                        }
                    ],
                    "Projection": {
                        "ProjectionType": "ALL"
                    },
                    "ProvisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5
                    }
                },
                {
                    "IndexName": "TenantID-Index",
                    "KeySchema": [
                        {
                            "AttributeName": "TenantID",
                            "KeyType": "HASH"
                        }
                    ],
                    "Projection": {
                        "ProjectionType": "ALL"
                    },
                    "ProvisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5
                    }
                }
            ]' \
        --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
        --endpoint-url http://localhost:8000 \
        --region us-east-1 \
        --no-cli-pager
    
    echo "✅ UserPolicies table created successfully"
fi

# Check if IpCidrBlackList table already exists
if aws dynamodb describe-table --table-name IpCidrBlackList --endpoint-url http://localhost:8000 --region us-east-1 --no-cli-pager >/dev/null 2>&1; then
    echo "📋 Table IpCidrBlackList already exists, skipping creation"
else
    echo "🔨 Creating IpCidrBlackList table..."
    # Create the IpCidrBlackList table
    aws dynamodb create-table \
        --table-name IpCidrBlackList \
        --attribute-definitions \
            AttributeName=PK,AttributeType=S \
            AttributeName=SK,AttributeType=S \
            AttributeName=TenantID,AttributeType=S \
            AttributeName=Created,AttributeType=S \
        --key-schema \
            AttributeName=PK,KeyType=HASH \
            AttributeName=SK,KeyType=RANGE \
        --global-secondary-indexes \
            '[
                {
                    "IndexName": "TenantID-Created-Index",
                    "KeySchema": [
                        {
                            "AttributeName": "TenantID",
                            "KeyType": "HASH"
                        },
                        {
                            "AttributeName": "Created", 
                            "KeyType": "RANGE"
                        }
                    ],
                    "Projection": {
                        "ProjectionType": "ALL"
                    },
                    "ProvisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5
                    }
                }
            ]' \
        --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
        --endpoint-url http://localhost:8000 \
        --region us-east-1 \
        --no-cli-pager
    
    echo "✅ IpCidrBlackList table created successfully"
fi

# SQS Local setup
echo "📨 Setting up SQS Local..."

# Create queues using AWS CLI (ElasticMQ supports AWS CLI commands)
aws sqs create-queue \
    --queue-name policy-events-local \
    --endpoint-url http://localhost:9324 \
    --region us-east-1 \
    --no-cli-pager \
    || echo "Queue might already exist"

aws sqs create-queue \
    --queue-name policy-events-dlq-local \
    --endpoint-url http://localhost:9324 \
    --region us-east-1 \
    --no-cli-pager \
    || echo "DLQ might already exist"

# Verify queues were created
echo "📋 Available queues:"
aws sqs list-queues \
    --endpoint-url http://localhost:9324 \
    --region us-east-1 \
    --no-cli-pager \
    || echo "Could not list queues"

echo "✅ SQS queues verified"

# Cognito Local setup
echo "🔐 Setting up Cognito Local..."

# Wait for Cognito Local to be ready
echo "⏳ Waiting for Cognito Local to start..."
sleep 5

# Create User Pool
echo "🔨 Creating Cognito User Pool..."
USER_POOL_RESPONSE=$(aws cognito-idp create-user-pool \
    --pool-name "policy-manager-local" \
    --policies '{
        "PasswordPolicy": {
            "MinimumLength": 8,
            "RequireUppercase": false,
            "RequireLowercase": false,
            "RequireNumbers": false,
            "RequireSymbols": false
        }
    }' \
    --auto-verified-attributes email \
    --username-attributes email \
    --schema '[
        {
            "Name": "email",
            "AttributeDataType": "String",
            "Required": true,
            "Mutable": true
        },
        {
            "Name": "tenant_id",
            "AttributeDataType": "String",
            "Required": false,
            "Mutable": true
        }
    ]' \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "User pool might already exist")

# Extract User Pool ID (if creation was successful)
USER_POOL_ID=$(echo "$USER_POOL_RESPONSE" | jq -r '.UserPool.Id // "us-east-1_123456789"')
echo "📋 User Pool ID: $USER_POOL_ID"

# Create User Pool Client
echo "🔨 Creating User Pool Client..."
CLIENT_RESPONSE=$(aws cognito-idp create-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-name "policy-manager-client" \
    --generate-secret \
    --explicit-auth-flows ADMIN_NO_SRP_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "Client might already exist")

CLIENT_ID=$(echo "$CLIENT_RESPONSE" | jq -r '.UserPoolClient.ClientId // "test-client-id"')
echo "📋 Client ID: $CLIENT_ID"

# Create User Pool Groups
echo "🔨 Creating User Pool Groups..."
aws cognito-idp create-group \
    --group-name "Admin" \
    --user-pool-id "$USER_POOL_ID" \
    --description "Administrator group with full access" \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "Admin group might already exist"

aws cognito-idp create-group \
    --group-name "User" \
    --user-pool-id "$USER_POOL_ID" \
    --description "Regular user group with limited access" \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "User group might already exist"

# Create test users
echo "🔨 Creating test users..."

# Admin user
aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "admin@example.com" \
    --user-attributes \
        Name=email,Value=admin@example.com \
        Name=email_verified,Value=true \
        Name=custom:tenant_id,Value=123e4567-e89b-12d3-a456-426614174000 \
    --temporary-password "TempPass123!" \
    --message-action SUPPRESS \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "Admin user might already exist"

# Set permanent password for admin
aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --username "admin@example.com" \
    --password "AdminPass123!" \
    --permanent \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "Admin password might already be set"

# Add admin to Admin group
aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" \
    --username "admin@example.com" \
    --group-name "Admin" \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "Admin might already be in group"

# Regular user
aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "user@example.com" \
    --user-attributes \
        Name=email,Value=user@example.com \
        Name=email_verified,Value=true \
        Name=custom:tenant_id,Value=123e4567-e89b-12d3-a456-426614174000 \
    --temporary-password "TempPass123!" \
    --message-action SUPPRESS \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "Regular user might already exist"

# Set permanent password for user
aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --username "user@example.com" \
    --password "UserPass123!" \
    --permanent \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "User password might already be set"

# Add user to User group
aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" \
    --username "user@example.com" \
    --group-name "User" \
    --endpoint-url http://localhost:9229 \
    --region us-east-1 \
    --no-cli-pager 2>/dev/null || echo "User might already be in group"

echo "✅ Cognito Local setup complete!"
echo "📋 Test Users Created:"
echo "   • Admin: admin@example.com / AdminPass123!"
echo "   • User:  user@example.com / UserPass123!"
echo "   • Tenant ID: 123e4567-e89b-12d3-a456-426614174000"


# Insert sample data
echo "📝 Inserting sample data..."

# Always insert/update sample policy (overwrite if exists)
echo "🔨 Inserting sample policy..."
aws dynamodb put-item \
    --table-name policy-manager-local \
    --item '{
        "PK": {"S": "TENANT#demo"},
        "SK": {"S": "POLICY#sample-policy-1"},
        "TenantID": {"S": "demo"},
        "PolicyID": {"S": "sample-policy-1"},
        "PolicyContent": {"S": "{\"_id\":\"sample-policy-1\",\"name\":\"Sample Web Policy\",\"description\":\"Allow access to common websites\",\"enabled\":true,\"status\":\"draft\",\"rules\":[{\"id\":\"rule-1\",\"name\":\"Allow Google\",\"source\":{\"user\":\"*\"},\"destination\":{\"domains\":\"google.com\"},\"time\":{\"not_between\":[\"22:00\",\"06:00\"],\"days\":[\"monday\",\"tuesday\",\"wednesday\",\"thursday\",\"friday\"]},\"action\":\"allow\",\"track\":{\"log\":true,\"comment\":\"Standard web access\"}}],\"created\":\"2024-01-01T00:00:00Z\",\"updated\":\"2024-01-01T00:00:00Z\",\"createdBy\":\"admin\",\"updatedBy\":\"admin\"}"},
        "State": {"S": "created"},
        "Created": {"S": "2024-01-01T00:00:00Z"},
        "Updated": {"S": "2024-01-01T00:00:00Z"},
        "CreatedBy": {"S": "admin"},
        "UpdatedBy": {"S": "admin"}
    }' \
    --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    --no-cli-pager

echo "✅ Sample policy inserted"

# Always insert/update sample CIDR data (overwrite if exists)
echo "🔨 Inserting sample CIDR blacklist data..."

# Generate UUIDs and timestamp for the CIDR records
CIDR_ID_1=$(uuidgen | tr '[:upper:]' '[:lower:]')
CIDR_ID_2=$(uuidgen | tr '[:upper:]' '[:lower:]')
CIDR_ID_3=$(uuidgen | tr '[:upper:]' '[:lower:]')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# First CIDR record: 192.168.1.0/23 (covers 192.168.1.0 - 192.168.2.255)
aws dynamodb put-item \
    --table-name IpCidrBlackList \
    --item '{
        "PK": {"S": "TENANT#123e4567-e89b-12d3-a456-426614174000"},
        "SK": {"S": "CIDR#192.168.1.0/23"},
        "TenantID": {"S": "123e4567-e89b-12d3-a456-426614174000"},
        "CidrContent": {"S": "{\"_id\":\"'$CIDR_ID_1'\",\"cidr\":\"192.168.1.0/23\",\"description\":\"Internal network range 1\",\"created\":\"'$TIMESTAMP'\",\"updated\":\"'$TIMESTAMP'\",\"createdBy\":\"admin@example.com\",\"updatedBy\":\"admin@example.com\"}"},
        "Created": {"S": "'$TIMESTAMP'"},
        "Updated": {"S": "'$TIMESTAMP'"},
        "CreatedBy": {"S": "admin@example.com"},
        "UpdatedBy": {"S": "admin@example.com"}
    }' \
    --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    --no-cli-pager

# Second CIDR record: 192.10.1.0/23 (covers 192.10.1.0 - 192.10.2.255)
aws dynamodb put-item \
    --table-name IpCidrBlackList \
    --item '{
        "PK": {"S": "TENANT#123e4567-e89b-12d3-a456-426614174000"},
        "SK": {"S": "CIDR#192.10.1.0/23"},
        "TenantID": {"S": "123e4567-e89b-12d3-a456-426614174000"},
        "CidrContent": {"S": "{\"_id\":\"'$CIDR_ID_2'\",\"cidr\":\"192.10.1.0/23\",\"description\":\"Internal network range 2\",\"created\":\"'$TIMESTAMP'\",\"updated\":\"'$TIMESTAMP'\",\"createdBy\":\"admin@example.com\",\"updatedBy\":\"admin@example.com\"}"},
        "Created": {"S": "'$TIMESTAMP'"},
        "Updated": {"S": "'$TIMESTAMP'"},
        "CreatedBy": {"S": "admin@example.com"},
        "UpdatedBy": {"S": "admin@example.com"}
    }' \
    --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    --no-cli-pager

# Third CIDR record: 10.0.0.0/8 (covers 10.0.0.0 - 10.255.255.255)
aws dynamodb put-item \
    --table-name IpCidrBlackList \
    --item '{
        "PK": {"S": "TENANT#123e4567-e89b-12d3-a456-426614174000"},
        "SK": {"S": "CIDR#10.0.0.0/8"},
        "TenantID": {"S": "123e4567-e89b-12d3-a456-426614174000"},
        "CidrContent": {"S": "{\"_id\":\"'$CIDR_ID_3'\",\"cidr\":\"10.0.0.0/8\",\"description\":\"Private network range (Class A)\",\"created\":\"'$TIMESTAMP'\",\"updated\":\"'$TIMESTAMP'\",\"createdBy\":\"admin@example.com\",\"updatedBy\":\"admin@example.com\"}"},
        "Created": {"S": "'$TIMESTAMP'"},
        "Updated": {"S": "'$TIMESTAMP'"},
        "CreatedBy": {"S": "admin@example.com"},
        "UpdatedBy": {"S": "admin@example.com"}
    }' \
    --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    --no-cli-pager

echo "✅ Sample CIDR blacklist data inserted"
echo "📋 CIDR Records Created:"
echo "   • 192.168.1.0/23 (ID: $CIDR_ID_1) - Internal network range 1"
echo "   • 192.10.1.0/23 (ID: $CIDR_ID_2) - Internal network range 2"
echo "   • 10.0.0.0/8 (ID: $CIDR_ID_3) - Private network range (Class A)"

echo ""
echo "🎉 Local development environment setup complete!"
echo ""
echo "📋 Service URLs:"
echo "   • API Gateway:      http://localhost:3000"
echo "   • API Handler:      http://localhost:3001"
echo "   • SQS Processor:    http://localhost:3002"
echo "   • Validate Policy:  http://localhost:3003"
echo "   • Publish Policy:   http://localhost:3004"
echo "   • DynamoDB:         http://localhost:8000"
echo "   • SQS:              http://localhost:9324"
echo "   • Cognito:          http://localhost:9229"
echo ""
echo "🧪 Test the API:"
echo "   curl http://localhost:3000/health"
echo "   curl http://localhost:3000/dev/policies"
echo ""
echo "🔍 View DynamoDB data:"
echo "   aws dynamodb scan --table-name policy-manager-local --endpoint-url http://localhost:8000 --region us-east-1"
echo ""
