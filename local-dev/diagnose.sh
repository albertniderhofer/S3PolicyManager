#!/bin/bash

echo "🔍 Diagnosing local development environment..."
echo ""

echo "📊 Container Status:"
docker compose -f docker-compose.local.yml ps
echo ""

echo "🔗 Network Status:"
docker network ls | grep local-dev || echo "No local-dev network found"
echo ""

echo "📋 API Gateway Container Logs:"
docker logs api-gateway --tail 20 2>/dev/null || echo "API Gateway container not found or not running"
echo ""

echo "📋 API Handler Container Logs:"
docker logs api-handler --tail 20 2>/dev/null || echo "API Handler container not found or not running"
echo ""

echo "🌐 Port Check:"
echo "Checking if ports are accessible..."
curl -s http://localhost:3000/health > /dev/null && echo "✅ Port 3000 (API Gateway) - OK" || echo "❌ Port 3000 (API Gateway) - FAILED"
curl -s http://localhost:3001 > /dev/null && echo "✅ Port 3001 (API Handler) - OK" || echo "❌ Port 3001 (API Handler) - FAILED"
curl -s http://localhost:8000 > /dev/null && echo "✅ Port 8000 (DynamoDB) - OK" || echo "❌ Port 8000 (DynamoDB) - FAILED"
curl -s http://localhost:9324 > /dev/null && echo "✅ Port 9324 (SQS) - OK" || echo "❌ Port 9324 (SQS) - FAILED"
echo ""

echo "🐳 Docker Images:"
docker images | grep -E "(s3policymanager|api-gateway|lambda)" || echo "No relevant images found"
echo ""

echo "💾 Disk Space:"
df -h | head -2
echo ""

echo "🔧 Suggested Actions:"
echo "1. If containers are not running: npm run dev:rebuild"
echo "2. If ports are blocked: Check if other services are using these ports"
echo "3. If images are missing: Run docker compose build"
echo "4. Check individual container logs: docker logs <container-name>"
echo ""
