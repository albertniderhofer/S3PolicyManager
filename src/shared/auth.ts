import { APIGatewayProxyEvent } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { CognitoTokenPayload, UnauthorizedError } from './types';
import { RequestContextManager } from './context';

/**
 * JWT Token Validator with Zero Trust approach
 * Validates tokens independently in each Lambda function
 */
export class TokenValidator {
  private static jwksClient: jwksClient.JwksClient | null = null;
  private static cognitoIssuer: string;
  private static userPoolId: string;

  /**
   * Initialize the token validator with Cognito configuration
   * Now supports lazy initialization from environment variables
   */
  static initialize(region?: string, userPoolId?: string): void {
    // Use provided parameters or fall back to environment variables
    const finalRegion = region || process.env.AWS_REGION;
    const finalUserPoolId = userPoolId || process.env.COGNITO_USER_POOL_ID;
    
    if (!finalRegion || !finalUserPoolId) {
      throw new Error('Region and User Pool ID must be provided either as parameters or environment variables');
    }

    // Skip if already initialized with same configuration
    if (this.jwksClient && this.userPoolId === finalUserPoolId) {
      return;
    }

    this.userPoolId = finalUserPoolId;
    this.cognitoIssuer = `https://cognito-idp.${finalRegion}.amazonaws.com/${finalUserPoolId}`;
    
    this.jwksClient = jwksClient({
      jwksUri: `${this.cognitoIssuer}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 600000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10
    });

    console.log('TokenValidator initialized for region:', finalRegion, 'userPoolId:', finalUserPoolId);
  }

  /**
   * Extract JWT token from API Gateway event
   */
  static extractToken(event: APIGatewayProxyEvent): string {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    
    if (!authHeader) {
      throw new UnauthorizedError('Authorization header missing');
    }

    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
    if (!tokenMatch) {
      throw new UnauthorizedError('Invalid authorization header format. Expected: Bearer <token>');
    }

    return tokenMatch[1];
  }

  /**
   * Validate JWT token and return decoded payload
   * Automatically initializes if not already done (lazy initialization)
   */
  static async validateToken(event: APIGatewayProxyEvent): Promise<CognitoTokenPayload> {
    try {
      // For local development, use mock validation
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        return this.mockValidation(event);
      }

      // Lazy initialization - automatically initialize if not done yet
      if (!this.jwksClient) {
        this.initialize();
      }

      const token = this.extractToken(event);
      const decodedToken = await this.verifyJWT(token);
      
      // Validate token claims
      this.validateTokenClaims(decodedToken);
      
      // Validate admin group membership
      if (!decodedToken['cognito:groups']?.includes('Admin')) {
        throw new UnauthorizedError('Admin access required');
      }

      return decodedToken;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      console.error('Token validation error:', error);
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  /**
   * Verify JWT signature and decode payload
   */
  private static async verifyJWT(token: string): Promise<CognitoTokenPayload> {
    return new Promise((resolve, reject) => {
      // Decode header to get key ID
      const decodedHeader = jwt.decode(token, { complete: true });
      if (!decodedHeader || typeof decodedHeader === 'string') {
        reject(new Error('Invalid token format'));
        return;
      }

      const kid = decodedHeader.header.kid;
      if (!kid) {
        reject(new Error('Token missing key ID'));
        return;
      }

      // Get signing key
      this.jwksClient!.getSigningKey(kid, (err, key) => {
        if (err) {
          reject(new Error(`Failed to get signing key: ${err.message}`));
          return;
        }

        if (!key) {
          reject(new Error('No signing key found'));
          return;
        }

        const signingKey = key.getPublicKey();

        // Verify token
        jwt.verify(token, signingKey, {
          issuer: this.cognitoIssuer,
          algorithms: ['RS256']
        }, (verifyErr, decoded) => {
          if (verifyErr) {
            reject(new Error(`Token verification failed: ${verifyErr.message}`));
            return;
          }

          resolve(decoded as CognitoTokenPayload);
        });
      });
    });
  }

  /**
   * Validate token claims
   */
  private static validateTokenClaims(token: CognitoTokenPayload): void {
    const now = Math.floor(Date.now() / 1000);

    // Check expiration
    if (token.exp <= now) {
      throw new UnauthorizedError('Token has expired');
    }

    // Check token use
    if (token.token_use !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Check required custom attributes
    if (!token['custom:tenant_id']) {
      throw new UnauthorizedError('Token missing tenant ID');
    }

    // Validate tenant ID format (should be UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token['custom:tenant_id'])) {
      throw new UnauthorizedError('Invalid tenant ID format');
    }
  }

  /**
   * Mock validation for local development and testing
   */
  private static mockValidation(event: APIGatewayProxyEvent): CognitoTokenPayload {
    try {
      const token = this.extractToken(event);
      
      // For testing, decode without verification
      const decoded = jwt.decode(token) as CognitoTokenPayload;
      
      if (!decoded) {
        throw new Error('Invalid mock token');
      }

      // For Cognito Local, access tokens might not have custom:tenant_id
      // but we can provide a default tenant ID for local development
      if (!decoded['custom:tenant_id']) {
        console.log('Access token missing custom:tenant_id, using default for local development');
        decoded['custom:tenant_id'] = '123e4567-e89b-12d3-a456-426614174000';
      }

      // Ensure required fields exist
      if (!decoded.sub || !decoded.username) {
        throw new Error('Mock token missing required fields (sub, username)');
      }

      // For Cognito Local, the username might be the user ID, try to get email from cognito:username
      // If username looks like a UUID, it's probably the user ID, so we'll use it as-is
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.username);
      if (isUUID) {
        // For local development, we'll map known user IDs to display names
        const userIdToDisplayName: { [key: string]: string } = {
          '9d0483e1-6790-44ac-904f-d2ed877239c9': 'Admin User',
          'dfa9b5d7-2447-49fa-8eb6-09bfa790fd71': 'Regular User'
        };
        
        // Create a display username from the mapped name if available
        const displayName = userIdToDisplayName[decoded.username];
        if (displayName) {
          // Override the username with the display name for better readability
          decoded.username = displayName;
          decoded.display_username = displayName;
        }
      }

      return decoded;
    } catch (error) {
      // If token extraction fails in dev mode, create a default mock token
      console.warn('Using default mock token for development:', error);
      return {
        sub: 'mock-user-id',
        username: 'mockuser',
        'custom:tenant_id': '123e4567-e89b-12d3-a456-426614174000',
        'cognito:groups': ['Admin'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'mock-issuer',
        aud: 'mock-audience',
        token_use: 'access'
      };
    }
  }

  /**
   * Validate token and initialize context with tracing headers
   */
  static async validateAndInitializeContextWithTracing(event: APIGatewayProxyEvent, correlationId: string): Promise<RequestContextManager> {
    
    // Validate the token first
    const payload = await this.validateToken(event);
    
    let request: CognitoTokenPayload = {
      'custom:tenant_id': payload['custom:tenant_id'],
      sub: payload.sub,
      username: payload.username,
      exp: payload.exp,
      iss: payload.iss,
      token_use: payload.token_use,
      aud: payload.aud,
      'cognito:groups': payload['cognito:groups'] || []
    }

    return new RequestContextManager(request, correlationId);
  }
}

/**
 * Mock token generator for testing
 */
export class MockTokenGenerator {
  /**
   * Generate a mock JWT token for testing
   */
  static generateAdminToken(
    tenantId: string = '123e4567-e89b-12d3-a456-426614174000',
    username: string = 'testuser',
    userId: string = 'test-user-id'
  ): string {
    const payload: CognitoTokenPayload = {
      sub: userId,
      username: username,
      'custom:tenant_id': tenantId,
      'cognito:groups': ['Admin'],
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      iss: 'test-issuer',
      aud: 'test-audience',
      token_use: 'access'
    };

    return jwt.sign(payload, 'test-secret-key');
  }

  /**
   * Generate a mock token for non-admin user
   */
  static generateUserToken(
    tenantId: string = '123e4567-e89b-12d3-a456-426614174000',
    username: string = 'regularuser',
    userId: string = 'regular-user-id'
  ): string {
    const payload: CognitoTokenPayload = {
      sub: userId,
      username: username,
      'custom:tenant_id': tenantId,
      'cognito:groups': ['User'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'test-issuer',
      aud: 'test-audience',
      token_use: 'access'
    };

    return jwt.sign(payload, 'test-secret-key');
  }

  /**
   * Generate an expired token for testing
   */
  static generateExpiredToken(
    tenantId: string = '123e4567-e89b-12d3-a456-426614174000',
    username: string = 'expireduser'
  ): string {
    const payload: CognitoTokenPayload = {
      sub: 'expired-user-id',
      username: username,
      'custom:tenant_id': tenantId,
      'cognito:groups': ['Admin'],
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      iss: 'test-issuer',
      aud: 'test-audience',
      token_use: 'access'
    };

    return jwt.sign(payload, 'test-secret-key');
  }
}

/**
 * User display name helper functions
 */
export class UserDisplayHelper {
  /**
   * Map user IDs to display names for local development
   * In production, this would query a user service or directory
   */
  private static userIdToDisplayName: { [key: string]: string } = {
    '9d0483e1-6790-44ac-904f-d2ed877239c9': 'admin@example.com',
    'dfa9b5d7-2447-49fa-8eb6-09bfa790fd71': 'user@example.com'
  };

  /**
   * Get display name for a user ID
   * Returns the display name if available, otherwise returns the original user ID
   */
  static getUserDisplayName(userId: string): string {
    // For local development and when NODE_ENV is not set, use the mapping
    // In production, this would make a call to a user service
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (!isProduction) {
      // Use mapping for local development
      const displayName = this.userIdToDisplayName[userId];
      if (displayName) {
        console.log(`UserDisplayHelper: Mapping ${userId} to ${displayName}`);
        return displayName;
      }
    }
    
    // Return the user ID as-is if no mapping found or in production
    return userId;
  }

  /**
   * Transform user IDs to display names in an object
   * Useful for transforming createdBy/updatedBy fields in policies
   */
  static transformUserFields<T extends Record<string, any>>(
    obj: T,
    fieldsToTransform: (keyof T)[] = ['createdBy', 'updatedBy']
  ): T {
    const transformed = { ...obj };
    
    for (const field of fieldsToTransform) {
      if (transformed[field] && typeof transformed[field] === 'string') {
        transformed[field] = this.getUserDisplayName(transformed[field] as string) as T[keyof T];
      }
    }
    
    return transformed;
  }
}