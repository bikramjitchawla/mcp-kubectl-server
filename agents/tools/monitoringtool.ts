import { execSync } from "child_process";

export interface MonitoringResult {
  command: string;
  output?: string;
  error?: string;
}

export const monitoringTool = async (
  input: {
    type:
      | "cluster-health"
      | "resource-usage"
      | "node-capacity"
      | "events"
      | "pod-health"
      | "pod-logs";
    namespace?: string;
    podName?: string;
    container?: string;
    tail?: number;
    previous?: boolean;
  }
): Promise<MonitoringResult> => {
  console.log("➡️ monitoringTool input:", input);
  const { type, namespace, podName, container, tail, previous } = input;

  let cmd = "";
  switch (type) {
    case "cluster-health":
      cmd = "kubectl get componentstatuses";
      break;

    case "resource-usage":
      cmd = namespace
        ? `kubectl top pods -n ${namespace}`
        : "kubectl top pods --all-namespaces";
      break;

    case "node-capacity":
      cmd = "kubectl describe nodes";
      break;

    case "events":
      cmd = namespace
        ? `kubectl get events -n ${namespace}`
        : "kubectl get events --all-namespaces";
      break;

    case "pod-health":
      if (!podName) {
        console.error("pod-health missing podName");
        return { command: "", error: "podName is required for pod-health." };
      }
      cmd = `kubectl describe pod ${podName}` +
            (namespace ? ` -n ${namespace}` : "");
      break;

    case "pod-logs":
      if (!podName) {
        console.error("pod-logs missing podName");
        return { command: "", error: "podName is required for pod-logs." };
      }
      cmd = `kubectl logs ${podName}` +
            (namespace ? ` -n ${namespace}` : "") +
            (container ? ` -c ${container}` : "") +
            (previous  ? " --previous"       : "") +
            (tail != null ? ` --tail=${tail}` : "");
      break;

    default:
      console.error("Unsupported monitoring type:", type);
      return {
        command: "",
        error: `Unsupported monitoring type: '${type}'.`,
      };
  }

  console.log("🔧 running command:", cmd);
  try {
    const raw = execSync(cmd, { encoding: "utf-8" });
    console.log("raw output:", raw.replace(/\n/g, "\\n"));
    const output = raw.trim();
    if (!output) {
      console.warn("⚠️ empty output for:", cmd);
      return { command: cmd, output: "", error: `No results for: ${cmd}` };
    }
    return { command: cmd, output };
  } catch (err: any) {
    console.error("execSync failed:", err);
    const msg = err.message ?? String(err);
    return { command: cmd, error: `Command failed: ${msg}` };
  }
};
