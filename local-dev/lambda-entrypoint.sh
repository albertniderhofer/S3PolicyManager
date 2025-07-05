#!/bin/bash

# Check if we're running in AWS Lambda environment
if [ -z "${AWS_LAMBDA_RUNTIME_API}" ]; then
    # Local development - use Lambda Runtime Interface Emulator
    exec /usr/bin/aws-lambda-rie /var/runtime/bootstrap
else
    # AWS Lambda environment - use normal runtime
    exec /var/runtime/bootstrap
fi
