import { runKubectlCommand } from "@/utils/kubectlUtils";

export const portForwardTool = async (input: Record<string, any>) => {
  const { podName, localPort, remotePort, namespace = "default" } = input;

  if (!podName || !localPort || !remotePort) {
    throw new Error("Missing required parameters: podName, localPort, remotePort");
  }

  const command = `kubectl port-forward pod/${podName} ${localPort}:${remotePort} -n ${namespace}`;
  const result = await runKubectlCommand(command);

  return {
    content: [{ type: "text", text: `Started port-forward: ${localPort} -> ${remotePort}` }],
    details: result,
  };
};