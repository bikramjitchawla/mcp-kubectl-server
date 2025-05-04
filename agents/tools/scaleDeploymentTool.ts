import { execSync } from "child_process";

export const scaleDeploymentTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const { deployment, replicas, namespace = "default" } = input;

  if (!deployment || typeof replicas !== "number") {
    return { error: "Missing deployment name or invalid replicas." };
  }

  const command = `kubectl scale deployment ${deployment} --replicas=${replicas} -n ${namespace}`;

  try {
    const output = execSync(command, { encoding: "utf-8" }).trim();

    if (!output || output.toLowerCase().includes("not found")) {
      return {
        command,
        success: false,
        output: "",
        error: `Deployment '${deployment}' not found in namespace '${namespace}'.`,
      };
    }

    return {
      command,
      success: true,
      output,
    };
  } catch (error: any) {
    return {
      command,
      success: false,
      error: `Scaling failed: ${error.message}`,
    };
  }
};
