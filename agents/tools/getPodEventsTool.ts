import { runKubectlCommand } from "@/utils/kubectlUtils";

export const getPodEventsTool = async (input: Record<string, any>) => {
  const { podName, namespace = "default" } = input;

  if (!podName) {
    throw new Error("Missing required parameter: podName");
  }

  const result = await runKubectlCommand(
    `kubectl get events -n ${namespace} --field-selector involvedObject.name=${podName}`
  );

  return {
    content: [{ type: "text", text: result }],
  };
};
