import { execSync } from "child_process";

export const rolloutCheckerTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const { deployment, namespace = "default" } = input;

  if (!deployment) {
    return { error: "Missing 'deployment' field." };
  }

  const command = `kubectl rollout status deployment/${deployment} -n ${namespace}`;

  try {
    const output = execSync(command, { encoding: "utf-8" }).trim();

    if (!output || output.toLowerCase().includes("not found")) {
      return {
        command,
        output: "",
        error: `Deployment '${deployment}' not found in namespace '${namespace}'.`,
      };
    }

    return { command, output };
  } catch (error: any) {
    return {
      command,
      error: `Command failed: ${error.message}`,
    };
  }
};
