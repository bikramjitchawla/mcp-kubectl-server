// tools/monitoringTool.ts

import { execSync } from "child_process";

export const monitoringTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const { type, namespace, podName } = input;

  let command = "";

  switch (type) {
    case "cluster-health":
      command = "kubectl get componentstatuses";
      break;

    case "resource-usage":
      command = namespace
        ? `kubectl top pod -n ${namespace}`
        : "kubectl top pods --all-namespaces";
      break;

    case "node-capacity":
      command = "kubectl describe nodes";
      break;

    case "events":
      command = namespace
        ? `kubectl get events -n ${namespace}`
        : "kubectl get events --all-namespaces";
      break;

    case "pod-health":
      if (!podName) {
        return { error: "Missing podName for pod-health check" };
      }
      command = namespace
        ? `kubectl describe pod ${podName} -n ${namespace}`
        : `kubectl describe pod ${podName}`;
      break;

    default:
      return { error: `Unsupported monitoring type: ${type}` };
  }

  try {
    const output = execSync(command).toString();
    return {
      kubectl_command: command,
      output,
    };
  } catch (err: any) {
    return {
      kubectl_command: command,
      error: err.message,
    };
  }
};
