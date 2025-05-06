import { spawn } from "child_process";

export interface PortForwardResult {
  kubectl_command: string;
  output?: string;
  pid?: number;
  error?: string;
}

export const portForwardTool = async (
  input: {
    podName?: string;
    localPort?: number;
    remotePort?: number;
    namespace?: string;
  }
): Promise<PortForwardResult> => {
  const { podName, localPort, remotePort, namespace = "default" } = input;

  if (!podName || localPort == null || remotePort == null) {
    return {
      kubectl_command: "",
      error: "podName, localPort, and remotePort are required.",
    };
  }

  const cmd = "kubectl";
  const args = [
    "port-forward",
    "-n",
    namespace,
    `pod/${podName}`,
    `${localPort}:${remotePort}`,
  ];
  const kubectl_command = `${cmd} ${args.join(" ")}`;

  const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";

  return new Promise<PortForwardResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject({
        kubectl_command,
        error: "⏱️ Port-forward timed out.",
      });
    }, 5000);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes("Forwarding from")) {
        clearTimeout(timeout);
        resolve({
          kubectl_command,
          output: "Port-forwarding started successfully.",
          pid: proc.pid,
        });
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject({
        kubectl_command,
        error: `Failed to start port-forward: ${err.message}`,
      });
    });

    proc.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (!stdout.includes("Forwarding from")) {
        reject({
          kubectl_command,
          error: stderr || "Port-forward failed to start.",
        });
      }
    });
  });
};
