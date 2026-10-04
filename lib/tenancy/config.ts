import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const roleSchema = z.enum(['viewer', 'operator', 'admin']);
export type Role = z.infer<typeof roleSchema>;
const tenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().min(1),
  context: z.string().min(1),
  kubeconfig: z.string().min(1),
  namespaces: z.array(z.string().max(63).regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/)).min(1).max(100),
  allowNodes: z.boolean().default(false),
  allowAi: z.boolean().default(false),
  bindings: z.array(z.object({ role: roleSchema, groups: z.array(z.string()).default([]), subjects: z.array(z.string()).default([]) })).default([]),
  apiKeys: z.array(z.object({ id: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), role: roleSchema })).default([]),
  gitopsTargets: z.array(z.object({ context: z.string(), namespace: z.string(), kind: z.literal('Deployment'), name: z.string(), repository: z.string(), branch: z.string(), path: z.string() })).default([]),
  githubTokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  prometheus: z.object({ url: z.string().url(), tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional() }).optional(),
});
export type Tenant = z.infer<typeof tenantSchema>;
export function tenants(): Tenant[] {
  const file = process.env.TENANTS_CONFIG_FILE;
  if (!file) throw new Error('TENANTS_CONFIG_FILE must be configured.');
  const parsed = z.array(tenantSchema).min(1).parse(JSON.parse(readFileSync(file, 'utf8')));
  if (new Set(parsed.map(t => t.id)).size !== parsed.length) throw new Error('Duplicate tenant IDs.');
  return parsed;
}
export function roleFor(tenant: Tenant, subject: string, groups: string[]): Role | undefined {
  const roles = tenant.bindings.filter(b => b.subjects.includes(subject) || b.groups.some(g => groups.includes(g))).map(b => b.role);
  return roles.includes('admin') ? 'admin' : roles.includes('operator') ? 'operator' : roles.includes('viewer') ? 'viewer' : undefined;
}
export function hasRole(actual: Role, required: Role) {
  return ['viewer', 'operator', 'admin'].indexOf(actual) >= ['viewer', 'operator', 'admin'].indexOf(required);
}
