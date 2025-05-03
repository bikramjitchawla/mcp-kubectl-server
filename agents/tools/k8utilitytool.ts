// tools/k8utilitytool.ts
import { execSync } from "child_process";

export const k8sUtilityTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const {
    operation,
    namespace = "default",
    resourceName,
    command,
    resourceType,
    context,
    revision,
    containerName,
  } = input;

  try {
    let cmd = "";

    switch (operation) {
      case "execInContainer": {
        if (!resourceName) return { error: "❌ Missing pod name." };
        const safeCommand = command?.trim() || "ls /";
        cmd = `kubectl exec -n ${namespace} ${resourceName}`;
        if (containerName) cmd += ` -c ${containerName}`;
        cmd += ` -- ${safeCommand}`;
        break;
      }

      case "getOrManageConfigMapOrSecret": {
        if (!resourceType || !resourceName) return { error: "❌ Missing resourceType or resourceName." };
        cmd = `kubectl get ${resourceType} ${resourceName} -n ${namespace} -o yaml`;
        break;
      }

      case "rollbackDeployment": {
        if (!resourceName) return { error: "❌ Missing deployment name." };
        cmd = `kubectl rollout undo deployment/${resourceName} -n ${namespace}`;
        if (revision) cmd += ` --to-revision=${revision}`;
        break;
      }

      case "manageIngressOrNetworkPolicy": {
        if (!resourceType) return { error: "❌ Missing resourceType." };
        cmd = `kubectl get ${resourceType} -n ${namespace} -o wide`;
        break;
      }

      case "switchContext": {
        if (!context) return { error: "❌ Missing context name." };
        cmd = `kubectl config use-context ${context}`;
        break;
      }

      default:
        return { error: `❌ Unsupported operation: ${operation}` };
    }

    const output = execSync(cmd, { encoding: "utf-8" });
    return { command: cmd, output: output.trim() };
  } catch (err: any) {
    return { error: err.message || "❌ Command failed." };
  }
};
