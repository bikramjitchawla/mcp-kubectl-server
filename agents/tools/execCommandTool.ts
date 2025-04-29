import { runKubectlCommand } from "@/utils/kubectlUtils";

export const execCommandTool = async (input: Record<string, any>) => {
  const { podName, command, namespace = "default" } = input;

  if (!podName || !command) {
    throw new Error("Missing required parameters: podName and command");
  }

  const execCmd = `kubectl exec ${podName} -n ${namespace} -- ${command}`;
  const result = await runKubectlCommand(execCmd);

  return {
    content: [{ type: "text", text: result }],
  };
};