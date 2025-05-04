import { execSync } from "child_process";

export const getPodEventsTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const { podName, namespace = "default" } = input;

  if (!podName) {
    return { error: "Missing required parameter: podName" };
  }

  const command = `kubectl get events -n ${namespace} --field-selector involvedObject.name=${podName}`;

  try {
    const output = execSync(command, { encoding: "utf-8" }).trim();

    if (!output || output.toLowerCase().includes("no resources found")) {
      return {
        command,
        output: "",
        error: `No events found for pod '${podName}' in namespace '${namespace}'.`,
      };
    }

    return {
      command,
      output,
    };
  } catch (err: any) {
    return {
      command,
      error: `Failed to get pod events: ${err.message}`,
    };
  }
};
