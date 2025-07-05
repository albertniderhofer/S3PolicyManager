#!/bin/bash

echo "🔄 Rebuilding and restarting containers..."

# Stop all containers
echo "⏹️ Stopping containers..."
docker compose -f docker-compose.local.yml down

# Remove old images to force rebuild
echo "🗑️ Removing old Lambda images..."
docker rmi $(docker images | grep s3policymanager | awk '{print $3}') 2>/dev/null || echo "No old images to remove"

# Rebuild and start containers
echo "🔨 Rebuilding and starting containers..."
docker compose -f docker-compose.local.yml up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 15

# Check container status
echo "📊 Container status:"
docker compose -f docker-compose.local.yml ps

echo ""
echo "✅ Containers rebuilt and restarted!"
echo ""
echo "🧪 Test the API:"
echo "   curl http://localhost:3000/health"
echo "   curl http://localhost:3000/dev/policies"
echo ""
