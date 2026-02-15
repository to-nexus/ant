/**
 * User and Organization Types
 */

export interface User {
  id: string;
  email: string;
  organizationId: string;
}

export interface Organization {
  id: string;
  name: string;
}

export interface UserContext {
  userId: string;
  organizationId: string;
}

