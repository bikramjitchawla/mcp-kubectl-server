// tools/monitoringTool.ts

import { execSync } from "child_process";

export const monitoringTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const { type, namespace, podName, container, tail, previous } = input;

  switch (type) {
    case "cluster-health":
      return runCommand("kubectl get componentstatuses");

    case "resource-usage":
      return runCommand(
        namespace ? `kubectl top pod -n ${namespace}` : "kubectl top pods --all-namespaces"
      );

    case "node-capacity":
      return runCommand("kubectl describe nodes");

    case "events":
      return runCommand(
        namespace ? `kubectl get events -n ${namespace}` : "kubectl get events --all-namespaces"
      );

    case "pod-health":
      if (!podName) return error("Missing podName for pod-health check");
      return runCommand(
        namespace
          ? `kubectl describe pod ${podName} -n ${namespace}`
          : `kubectl describe pod ${podName}`
      );

    case "pod-logs":
      if (!podName) return error("Missing podName for logs");
      return getPodLogs({ podName, namespace, container, tail, previous });

    default:
      return error(`Unsupported monitoring type: ${type}`);
  }
};

function runCommand(cmd: string): Record<string, any> {
  try {
    const output = execSync(cmd, { encoding: "utf-8" });
    return { kubectl_command: cmd, output };
  } catch (err: any) {
    return { kubectl_command: cmd, error: err.message };
  }
}

function getPodLogs({
  podName,
  namespace,
  container,
  tail,
  previous,
}: {
  podName: string;
  namespace?: string;
  container?: string;
  tail?: number;
  previous?: boolean;
}): Record<string, any> {
  const args = ["kubectl", "logs"];
  if (namespace) args.push("-n", namespace);
  if (container) args.push("-c", container);
  if (tail) args.push("--tail", String(tail));
  if (previous) args.push("-p");
  args.push(podName);

  const cmd = args.join(" ");
  try {
    const output = execSync(cmd, { encoding: "utf-8" });
    return { kubectl_command: cmd, output };
  } catch (err: any) {
    return { kubectl_command: cmd, error: err.message };
  }
}

function error(msg: string): Record<string, any> {
  return { error: `❌ ${msg}` };
}
