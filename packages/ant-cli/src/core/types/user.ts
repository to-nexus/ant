/**
 * User and Organization Types
 */

import type { OrganizationKind } from '@ant/shared';

export interface User {
  id: string;
  email: string;
  organizationId: string;
}

export interface Organization {
  id: string;
  name: string;
  /** Org kind discriminator — see `@ant/shared` OrganizationKind. */
  kind?: OrganizationKind;
}

export interface UserContext {
  userId: string;
  organizationId: string;
  /**
   * Active org kind — lets route handlers dispatch kind-specific business
   * logic without re-deriving from the org id. Populated by
   * `extractUserContext`.
   */
  organizationKind?: OrganizationKind;
}

