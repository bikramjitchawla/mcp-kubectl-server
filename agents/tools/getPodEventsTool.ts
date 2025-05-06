import { execSync } from "child_process";

export interface GetPodEventsResult {
  command: string;
  output?: string;
  error?: string;
}

export const getPodEventsTool = async (
  input: { podName?: string; namespace?: string }
): Promise<GetPodEventsResult> => {
  const { podName, namespace = "default" } = input;

  if (!podName) {
    return {
      command: "",
      error: "Missing required parameter: podName",
    };
  }

  const command = `kubectl get events -n ${namespace} --field-selector involvedObject.name=${podName}`;

  try {
    const raw = execSync(command, { encoding: "utf-8", timeout: 30_000 }).trim();

    if (!raw || raw.toLowerCase().includes("no resources found")) {
      return {
        command,
        output: "",
        error: `⚠️ No events found for pod '${podName}' in namespace '${namespace}'.`,
      };
    }

    return {
      command,
      output: raw,
    };
  } catch (err: any) {
    return {
      command,
      error: `Failed to get pod events: ${err.message}`,
    };
  }
};
