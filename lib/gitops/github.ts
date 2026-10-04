import { currentPrincipal } from '@/lib/tenancy/context';
import { createHash } from 'node:crypto';
import { parseAllDocuments } from 'yaml';
import { z } from 'zod';
import type { FixPlan } from '@/types/investigation';
import { equal } from '@/lib/investigation/compare';

const targetSchema = z.object({ context: z.string(), namespace: z.string(), kind: z.literal('Deployment'), name: z.string(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/), branch: z.string().min(1),
  path: z.string().min(1).refine(p => !p.startsWith('/') && !p.split('/').some(s => s === '..' || s === '.') && /\.ya?ml$/.test(p)),
});
export function resolveTarget(plan: FixPlan) {
  const targets = z.array(targetSchema).parse(currentPrincipal() ? currentPrincipal()!.tenant.gitopsTargets : process.env.NODE_ENV === 'test' ? JSON.parse(process.env.GITOPS_TARGETS ?? '[]') : []);
  const matching = targets.filter(t => t.context === plan.scope.context && t.namespace === plan.resource.namespace && t.kind === plan.resource.kind && t.name === plan.resource.name);
  if (matching.length !== 1) throw new Error('Configure exactly one tenant gitopsTargets entry for this cluster, namespace, and Deployment.');
  const { repository, branch, path } = matching[0]; return { repository, branch, path };
}
async function github(repository: string, suffix: string, method = 'GET', body?: unknown) {
  const principal = currentPrincipal();
  const token = principal ? (principal.tenant.githubTokenEnv ? process.env[principal.tenant.githubTokenEnv] : undefined) : process.env.NODE_ENV === 'test' ? process.env.GITOPS_GITHUB_TOKEN : undefined;
  if (!token) throw new Error('The tenant GitHub credential is not configured.');
  const response = await fetch(`https://api.github.com/repos/${repository}/${suffix}`, {
    method, cache: 'no-store', signal: AbortSignal.timeout(15000), headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub ${method} failed (HTTP ${response.status}). Review repository permissions and branch state.`);
  return response.json();
}
const pathPart = (p: string) => p.split('/').map(encodeURIComponent).join('/');
export function patchManifest(content: string, plan: FixPlan): { content: string; diff: string } {
  const docs = parseAllDocuments(content);
  if (docs.some(d => d.errors.length)) throw new Error('GitOps manifest contains invalid YAML.');
  const matches = docs.filter(d => {
    const value = d.toJS({ maxAliasCount: 50 });
    return value?.apiVersion === 'apps/v1' && value?.kind === plan.resource.kind && value?.metadata?.name === plan.resource.name && value?.metadata?.namespace === plan.resource.namespace;
  });
  if (matches.length !== 1) throw new Error('Manifest must contain exactly one matching apps/v1 Deployment with an explicit namespace. Rendered Helm templates are not supported.');
  const doc = matches[0];
  const containers = doc.toJS({ maxAliasCount: 50 })?.spec?.template?.spec?.containers;
  if (!Array.isArray(containers)) throw new Error('Deployment containers are missing.');
  const diff: string[] = [];
  for (const op of plan.operations) {
    const indexes = containers.flatMap((c, i) => c.name === op.container ? [i] : []);
    if (indexes.length !== 1) throw new Error('Container identity is missing or ambiguous in Git.');
    const index = indexes[0];
    const raw = op.field === 'image' ? containers[index].image : containers[index].resources?.[op.field] ?? {};
    const actual = typeof raw === 'object' && raw !== null ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)])) : raw;
    if (!equal(actual, op.before)) throw new Error(`Git has drifted from the diagnosed ${op.container}/${op.field}. Run a fresh diagnosis before proposing a fix.`);
    const location = ['spec', 'template', 'spec', 'containers', index, ...(op.field === 'image' ? ['image'] : ['resources', op.field])];
    doc.setIn(location, op.after);
    diff.push(`@@ ${op.container}/${op.field} @@`, `- ${JSON.stringify(op.before)}`, `+ ${JSON.stringify(op.after)}`);
  }
  return { content: docs.map(d => d.toString()).join('---\n'), diff: diff.join('\n') };
}
export async function previewPlan(plan: FixPlan): Promise<FixPlan> {
  const target = resolveTarget(plan);
  const branch = await github(target.repository, `git/ref/heads/${pathPart(target.branch)}`);
  const file = await github(target.repository, `contents/${pathPart(target.path)}?ref=${encodeURIComponent(branch.object.sha)}`);
  if (file.type !== 'file' || file.encoding !== 'base64' || file.size > 1000000) throw new Error('Only YAML files up to 1 MB are supported.');
  const patched = patchManifest(Buffer.from(file.content, 'base64').toString('utf8'), plan);
  const digest = createHash('sha256').update(JSON.stringify({ target, base: branch.object.sha, content: patched.content, operations: plan.operations })).digest('hex');
  return { ...plan, target, preview: { baseSha: branch.object.sha, fileSha: file.sha, ...patched, digest } };
}
export async function publishPlan(plan: FixPlan, approvedDigest: string): Promise<FixPlan> {
  if (!plan.preview || !plan.target || approvedDigest !== plan.preview.digest) throw new Error('Review and approve the current preview before creating a PR.');
  if (!equal(resolveTarget(plan), plan.target)) throw new Error('Repository configuration changed. Generate a new preview.');
  const target = plan.target;
  const branch = await github(target.repository, `git/ref/heads/${pathPart(target.branch)}`);
  if (branch.object.sha !== plan.preview.baseSha) throw new Error('Base branch changed. Generate and review a fresh preview.');
  const head = `diagnostics/fix-${plan.id}`;
  // A stable branch name supports resuming a failed request without creating duplicate PRs.
  const existing = await github(target.repository, `pulls?state=all&head=${encodeURIComponent(target.repository.split('/')[0] + ':' + head)}&base=${encodeURIComponent(target.branch)}`);
  if (existing.length) {
    await assertReviewedBranch(target.repository, head, plan);
    return { ...plan, status: existing[0].merged_at ? 'merged' : existing[0].state === 'closed' ? 'closed' : 'pr-open',
    pullRequest: { number: existing[0].number, url: existing[0].html_url, branch: head, mergedAt: existing[0].merged_at ?? undefined, headSha: existing[0].head.sha } };
  }
  // Inspect existing refs instead of overwriting somebody else's branch on retry.
  const refs = await github(target.repository, `git/matching-refs/heads/${pathPart(head)}`);
  const existingRef = refs.find((r: { ref: string }) => r.ref === `refs/heads/${head}`);
  if (!existingRef) await github(target.repository, 'git/refs', 'POST', { ref: `refs/heads/${head}`, sha: plan.preview.baseSha });
  const currentFile = await github(target.repository, `contents/${pathPart(target.path)}?ref=${encodeURIComponent(head)}`);
  const alreadyPatched = Buffer.from(currentFile.content ?? '', 'base64').toString('utf8') === plan.preview.content;
  if (existingRef && existingRef.object.sha !== plan.preview.baseSha && !alreadyPatched) throw new Error('Fix branch changed unexpectedly; inspect it before retrying.');
  if (!alreadyPatched) await github(target.repository, `contents/${pathPart(target.path)}`, 'PUT', {
    message: `fix: restore observed healthy configuration for ${plan.resource.name}`, branch: head,
    sha: plan.preview.fileSha, content: Buffer.from(plan.preview.content).toString('base64'),
  });
  await assertReviewedBranch(target.repository, head, plan);
  const pr = await github(target.repository, 'pulls', 'POST', {
    title: `fix: investigate recovery of ${plan.resource.namespace}/${plan.resource.name}`, head, base: target.branch,
    body: [plan.rationale, '', `Source diagnostic: ${plan.sourceRunId}`, `Healthy baseline: ${plan.baselineRunId}`, '', 'Proposed changes:', '```diff', plan.preview.diff, '```', '', 'Verification criteria:', ...plan.successCriteria.map(c => `- ${c}`), '', 'Requires human review and merge. No Kubernetes write is performed by the diagnostics service.'].join('\n'),
  });
  return { ...plan, status: 'pr-open', pullRequest: { number: pr.number, url: pr.html_url, branch: head, headSha: pr.head.sha } };
}
export async function syncPullRequest(plan: FixPlan): Promise<FixPlan> {
  if (!plan.target || !plan.pullRequest) throw new Error('Create and merge the reviewed PR before verification.');
  const pr = await github(plan.target.repository, `pulls/${plan.pullRequest.number}`);
  if (pr.head.sha !== plan.pullRequest.headSha) throw new Error('PR content changed after proposal. Create a new plan so verification matches the reviewed fix.');
  return { ...plan, status: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'pr-open',
    pullRequest: { ...plan.pullRequest, mergedAt: pr.merged_at ?? undefined } };
}

async function assertReviewedBranch(repository: string, head: string, plan: FixPlan) {
  const file = await github(repository, `contents/${pathPart(plan.target!.path)}?ref=${encodeURIComponent(head)}`);
  if (Buffer.from(file.content ?? '', 'base64').toString('utf8') !== plan.preview!.content) throw new Error('Fix branch no longer matches the reviewed manifest.');
  const comparison = await github(repository, `compare/${plan.preview!.baseSha}...${encodeURIComponent(head)}`);
  if (comparison.commits?.length !== 1 || comparison.files?.length !== 1 || comparison.files[0].filename !== plan.target!.path || comparison.files[0].status !== 'modified')
    throw new Error('Fix branch contains changes beyond the reviewed proposal.');
}
