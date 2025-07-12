import { RequestContextManager } from '../../shared/context';
import { PolicyRepository, UserPolicyRepository } from '../../shared/repository';


export class PolicyUtils {

    /**
     * Policy validation function
     */
    static async validatePolicy(context:RequestContextManager, policyId: string, operationType: 'create' | 'update' | 'delete') {
        const validationLogEntry = context.createLogEntry('INFO', `Starting policy ${operationType} validation`, {
            policyId,
            operationType
        });
        console.log(JSON.stringify(validationLogEntry));
        
        const issues: string[] = [];
        
        try {
            // Get the policy to validate
            const policy = await PolicyRepository.getPolicyById(context, policyId);
            
            const policyRetrievedLogEntry = context.createLogEntry('INFO', 'Policy retrieved for validation', {
            policyId,
            policyName: policy.name,
            policyStatus: policy.status,
            rulesCount: policy.rules?.length || 0
            });
            console.log(JSON.stringify(policyRetrievedLogEntry));
            
            // Content validations only for create and update operations
            if (operationType === 'create' || operationType === 'update') {
            // Basic policy validations
            if (!policy.name || policy.name.trim().length === 0) {
                issues.push('Policy name is required');
            }
            
            if (!policy.description || policy.description.trim().length === 0) {
                issues.push('Policy description is required');
            }
            
            if (!policy.rules || policy.rules.length === 0) {
                issues.push('Policy must have at least one rule');
            }
            
            // Validate policy rules structure
            if (policy.rules && Array.isArray(policy.rules)) {
                policy.rules.forEach((rule, index) => {
                if (!rule.id || rule.id.trim().length === 0) {
                    issues.push(`Rule ${index + 1}: ID is required`);
                }
                
                if (!rule.name || rule.name.trim().length === 0) {
                    issues.push(`Rule ${index + 1}: Name is required`);
                }
                
                if (!rule.action || !['allow', 'block'].includes(rule.action)) {
                    issues.push(`Rule ${index + 1}: Action must be 'allow' or 'block'`);
                }
                
                if (!rule.source || (!rule.source.user && !rule.source.ip)) {
                    issues.push(`Rule ${index + 1}: Either source user or IP address is required`);
                }
                
                if (!rule.destination || !rule.destination.domains) {
                    issues.push(`Rule ${index + 1}: Destination domains are required`);
                }
                });
            }
            
            // Check for duplicate policy names (business rule)
            const allPolicies = await PolicyRepository.getAllPolicies(context);
            const duplicateName = allPolicies.find(p => 
                p._id !== policyId && 
                p.name.toLowerCase() === policy.name.toLowerCase()
            );
            
            if (duplicateName) {
                issues.push(`Policy name '${policy.name}' already exists`);
            }
            }
            
            // Operation-specific validations
            switch (operationType) {
            case 'update':
                if (policy.status === 'deleted') {
                issues.push('Cannot update deleted policies');
                }
                break;
                
            case 'delete':
                if (policy.status === 'deleted') {
                issues.push('Policy is already deleted');
                }
                break;
                
            case 'create':
                // Create-specific validations can be added here if needed
                break;
                
            default:
                issues.push(`Unknown operation type: ${operationType}`);
            }
            
        } catch (error) {
            issues.push(`Failed to retrieve policy for validation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        return {
            isValid: issues.length === 0,
            issues
        };
    }

    /**
     * Policy publishing function
     */
    static async publishPolicy(context:RequestContextManager, policyId: string, operationType: 'create' | 'update' | 'delete') {
        const publishLogEntry = context.createLogEntry('INFO', `Starting policy ${operationType} publish`, {
            policyId,
            operationType
        });
        console.log(JSON.stringify(publishLogEntry));
        
        try {
            // Get the policy to publish
            const policy = await PolicyRepository.getPolicyById(context, policyId);
            
            const policyRetrievedLogEntry = context.createLogEntry('INFO', 'Policy retrieved for publishing', {
            policyId: policy._id,
            policyName: policy.name,
            rulesCount: policy.rules.length,
            currentStatus: policy.status,
            operationType
            });
            console.log(JSON.stringify(policyRetrievedLogEntry));
            
            const simulationLogEntry = context.createLogEntry('INFO', `Simulating external system ${operationType}`, {
            policyId: policy._id,
            policyName: policy.name,
            operationType
            });
            console.log(JSON.stringify(simulationLogEntry));
            
            // Simulate publishing to external systems
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Determine new status and update policy based on operation type
            let newStatus: 'published' | 'draft' | 'deleted';
            let updateData: any;
            let successMessage: string;
            let timestampField: string;
            
            switch (operationType) {
            case 'create':
                newStatus = 'published';
                updateData = {
                status: newStatus,
                updated: new Date().toISOString(),
                updatedBy: context.getEventContext().triggeredBy
                };
                successMessage = 'Policy successfully published to external systems';
                timestampField = 'publishedAt';
                break;
                
            case 'update':
                newStatus = policy.status === 'draft' ? 'published' : policy.status;
                updateData = {
                status: newStatus,
                updated: new Date().toISOString(),
                updatedBy: context.getEventContext().triggeredBy
                };
                successMessage = 'Policy update successfully published to external systems';
                timestampField = 'publishedAt';
                break;
                
            case 'delete':
                newStatus = 'deleted';
                updateData = {
                status: newStatus,
                updated: new Date().toISOString(),
                updatedBy: context.getEventContext().triggeredBy
                };
                successMessage = 'Policy deletion successfully published to external systems';
                timestampField = 'deletedAt';
                break;
                
            default:
                throw new Error(`Unknown operation type: ${operationType}`);
            }
            
            // Update policy status
            const updatedPolicy = await PolicyRepository.updatePolicy(context, policyId, updateData);
            
            return {
                success: true,
                message: successMessage,
                policyId,
                newStatus: updatedPolicy.status,
                [timestampField]: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`Failed to publish policy ${operationType}:`, error);
            
            // Handle failure based on operation type
            if (operationType === 'create') {
            try {
                await PolicyRepository.updatePolicy(context, policyId, {
                status: 'draft' as const,
                updated: new Date().toISOString(),
                updatedBy: context.getEventContext().triggeredBy
                });
            } catch (updateError) {
                console.error('Failed to update policy status after publish failure:', updateError);
                }
            }
            
            return {
            success: false,
            message: `Failed to publish policy ${operationType}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            policyId,
            error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }


    /**
     * User oolicy update function
     */
    static async userPolicyUpdate(context:RequestContextManager, policyId: string, operationType: 'create' | 'update' | 'delete') {
        
        try {
            const policy = await PolicyRepository.getPolicyById(context, policyId);
                
            const policyFetchedLogEntry = context.createLogEntry('INFO', 'Successfully fetched policy data for UserPolicies update', {
                policyId: policy._id,
                policyName: policy.name,
                rulesCount: policy.rules.length,
                eventType: operationType
            });
            console.log(JSON.stringify(policyFetchedLogEntry));
        
            // Handle different event types for UserPolicies
            switch (operationType) {
                case 'create':
                case 'update':
                // Save/update policy rules in UserPolicies table
                await UserPolicyRepository.savePolicyRules(
                    context, 
                    policy,
                    context.getEventContext().tenantId,
                    context.getEventContext().triggeredBy
                );
                break;
                
                case 'delete':
                // Delete policy rules from UserPolicies table
                await UserPolicyRepository.deletePolicyRules(
                    context, 
                    policyId,
                    context.getEventContext().tenantId
                );
                break;
                
                default:
                throw new Error(`Unsupported event type: ${operationType}`);
            }
            return {
                success: true,
                message: 'User policy updated successfully'
            };
        } catch (error) {
            console.error(`Failed to update user policy ${operationType}:`, error);
            
            return {
                success: false,
                message: `Failed to publish policy ${operationType}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                policyId,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }

    }
}