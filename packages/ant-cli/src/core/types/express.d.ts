/**
 * Express Request type extensions
 * 
 * This file extends the Express Request interface to include
 * user authentication context (for Cloud Mode).
 * 
 * By using declaration merging, we avoid redundant RequestWithUser interfaces
 * scattered across multiple files.
 */

declare global {
  namespace Express {
    interface Request {
      /**
       * User context (attached by auth middleware in Cloud Mode)
       */
      user?: {
        id: string;
        email: string;
        organizationId: string;
      };
      
      /**
       * Organization context (attached by auth middleware in Cloud Mode)
       */
      organization?: {
        id: string;
        name: string;
        kind?: import('@ant/shared').OrganizationKind;
      };
    }
  }
}

// This export is required for TypeScript to treat this as a module
export {};

