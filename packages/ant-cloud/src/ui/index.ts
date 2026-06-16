/**
 * @ant/cloud UI entry — the cloud FE registrar (OSS / cloud split, P2).
 *
 * Side-effecting module: wires the cloud-only store slice (billing) and the
 * cloud UI surfaces (navbar credit menu, billing panels, recharge CTA,
 * create-team modal, onboarding screen) into ant-ui's optional-slice + slot
 * registries. `main.tsx` imports this ONLY behind `VITE_INCLUDE_CLOUD`, so an
 * OSS build (flag unset) dead-code-eliminates the whole graph reachable here.
 *
 * The registry/slot infrastructure (`registerOptionalSlice` / `registerSlot`)
 * stays in ant-ui (`@/...`); the cloud components live in this package
 * (`@cloud/...`). Replaces the monolith-phase in-tree registrar that used to
 * live at ant-ui `presentation/extensions/registerCloudInTree.ts`.
 *
 * Ordering contract: this module's STATIC imports must not reach the store
 * (`@/domain/store`), or the store would be created before
 * `registerOptionalSlice` runs. The slot components are loaded via
 * `React.lazy` (dynamic import), so the only eager dependency is the billing
 * slice creator — whose import chain (selectors/auth, http/api/billing,
 * domain/async) is store-free.
 */

import { lazy } from 'react';
import { registerOptionalSlice } from '@/domain/store/registry';
import { registerSlot } from '@/presentation/extensions/slots';
import { createBillingSlice } from '@cloud/domain/store/slices/billingSlice';

registerOptionalSlice(createBillingSlice);

registerSlot(
  'navbar.credit',
  lazy(() => import('@cloud/presentation/components/billing/NavbarCreditMenu').then((m) => ({ default: m.NavbarCreditMenu }))),
);
registerSlot(
  'chat.rechargeCta',
  lazy(() => import('@cloud/presentation/components/billing/CreditRechargeCTA').then((m) => ({ default: m.CreditRechargeCTA }))),
);
registerSlot(
  'mainPanel.billing',
  lazy(() => import('@cloud/presentation/components/billing/BillingCenterPanel').then((m) => ({ default: m.BillingCenterPanel }))),
);
registerSlot(
  'accountConfig.billing',
  lazy(() => import('@cloud/presentation/components/billing/BillingUsageSection').then((m) => ({ default: m.BillingUsageSection }))),
);
registerSlot(
  'auth.createTeamModal',
  lazy(() => import('@cloud/presentation/components/auth/CreateTeamModal').then((m) => ({ default: m.CreateTeamModal }))),
);
registerSlot(
  'auth.onboarding',
  lazy(() => import('@cloud/presentation/components/auth/OrganizationOnboardingScreen').then((m) => ({ default: m.OrganizationOnboardingScreen }))),
);
