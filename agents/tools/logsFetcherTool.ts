import { execSync } from "child_process";

export const logsFetcherTool = async (input: Record<string, any>) => {
  if (!input.podName) {
    throw new Error("Missing podName field.");
  }

  const namespace = input.namespace || "default";
  const command = `kubectl logs ${input.podName} -n ${namespace}`;

  try {
    const output = execSync(command).toString();
    return { output };
  } catch (error: any) {
    return { error: error.message };
  }
};
