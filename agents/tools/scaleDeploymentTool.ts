import * as k8s from "@kubernetes/client-node";

export interface ScaleDeploymentResult {
  command: string;
  success: boolean;
  replicas?: number;
  output?: string;
  error?: string;
}

export const scaleDeploymentTool = async (
  input: {
    deployment?: string;
    replicas?: number;
    namespace?: string;
  }
): Promise<ScaleDeploymentResult> => {
  const { deployment, replicas, namespace = "default" } = input;

  // Validate
  if (!deployment || typeof replicas !== "number") {
    return {
      command: "",
      success: false,
      error: "Missing `deployment` name or invalid `replicas` count.",
    };
  }

  const command = `kubectl scale deployment ${deployment} --replicas=${replicas} -n ${namespace}`;

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);

  try {
    const currentScale = await appsApi.readNamespacedDeploymentScale({
      name:      deployment,
      namespace: namespace,
    });

    currentScale.spec = currentScale.spec || {};
    currentScale.spec.replicas = replicas;

    const updatedScale = await appsApi.replaceNamespacedDeploymentScale({
      name:      deployment,
      namespace: namespace,
      body:      currentScale,
    });

    const newCount = updatedScale.spec?.replicas ?? replicas;
    const msg = `Deployment '${deployment}' scaled to ${newCount} replicas.`;

    return {
      command,
      success: true,
      replicas: newCount,
      output: msg,
    };
  } catch (err: any) {
    const apiMsg = err.response?.body?.message || err.message;
    return {
      command,
      success: false,
      error: `Scaling failed: ${apiMsg}`,
    };
  }
};
