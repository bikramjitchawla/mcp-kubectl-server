import { execSync } from "child_process";

export const scaleDeploymentTool = async (input: Record<string, any>) => {
  if (!input.deployment || typeof input.replicas !== "number") {
    throw new Error("Missing deployment name or replicas.");
  }

  const namespace = input.namespace || "default";
  const command = `kubectl scale deployment ${input.deployment} --replicas=${input.replicas} -n ${namespace}`;

  try {
    const output = execSync(command).toString();
    return { success: true, output };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};
