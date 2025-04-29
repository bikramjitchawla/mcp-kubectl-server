import { execSync } from "child_process";

export const rolloutCheckerTool = async (input: Record<string, any>) => {
  if (!input.deployment) {
    throw new Error("Missing deployment field.");
  }

  const namespace = input.namespace || "default";
  const command = `kubectl rollout status deployment/${input.deployment} -n ${namespace}`;

  try {
    const output = execSync(command).toString();
    return { output };
  } catch (error: any) {
    return { error: error.message };
  }
};
