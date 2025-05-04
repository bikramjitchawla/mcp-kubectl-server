import { execSync } from "child_process";

export const execCommandTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const { podName, command, namespace = "default" } = input;

  if (!podName || !command) {
    return {
      error: "Missing required parameters: podName and command.",
    };
  }

  const execCmd = `kubectl exec ${podName} -n ${namespace} -- ${command}`;

  try {
    const output = execSync(execCmd, { encoding: "utf-8" }).trim();

    if (!output) {
      return {
        command: execCmd,
        output: "",
        error: " No output returned from the command.",
      };
    }

    return {
      command: execCmd,
      output,
    };
  } catch (err: any) {
    return {
      command: execCmd,
      error: `Failed to execute command: ${err.message}`,
    };
  }
};
