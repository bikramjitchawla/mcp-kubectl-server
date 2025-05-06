import * as k8s from "@kubernetes/client-node";

export const listPodsTool = async (
  input: { namespace?: string }
): Promise<{ command: string; output: string }> => {
  const { namespace } = input;
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const listResp = namespace
    ? await coreApi.listNamespacedPod({ namespace })
    : await coreApi.listPodForAllNamespaces();
  const header = `NAMESPACE\tNAME\tPHASE`;
  const rows = listResp.items.map((p) => {
    const ns = p.metadata?.namespace ?? "<none>";
    const name = p.metadata?.name ?? "<unnamed>";
    const phase = p.status?.phase ?? "<unknown>";
    return `${ns}\t${name}\t${phase}`;
  });
  const output = [header, ...rows].join("\n");

  const command = namespace
    ? `kubectl get pods -n ${namespace}`
    : `kubectl get pods --all-namespaces`;

  return { command, output };
};
