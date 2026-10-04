import type { FixPlan } from '@/types/investigation';
import { getRecord, records } from '@/lib/store/disk';
import { currentPrincipal } from '@/lib/tenancy/context';
function visible(plan: FixPlan) {
  const tenant = currentPrincipal()?.tenant;
  return !tenant || (plan.scope.context === tenant.context && tenant.namespaces.includes(plan.resource.namespace ?? ''));
}
export function getPlan(id: string): FixPlan | undefined {
  const plan = getRecord<FixPlan>('fixes', id);
  return plan && visible(plan) ? plan : undefined;
}
export function listPlans(): FixPlan[] { return records<FixPlan>('fixes').filter(visible); }
