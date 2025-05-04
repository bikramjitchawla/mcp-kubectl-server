import { spawn } from "child_process";

export const portForwardTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const { podName, localPort, remotePort, namespace = "default" } = input;

  if (!podName || !localPort || !remotePort) {
    return { error: "podName, localPort, and remotePort are required." };
  }

  const cmd = "kubectl";
  const args = [
    "port-forward",
    `pod/${podName}`,
    `${localPort}:${remotePort}`,
    "-n",
    namespace,
  ];

  const process = spawn(cmd, args);

  let output = "";
  let errorOutput = "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!output.includes("Forwarding from")) {
        process.kill();
        return reject({
          kubectl_command: `${cmd} ${args.join(" ")}`,
          error: "⏱️ Port-forward timed out.",
        });
      }
    }, 5000);

    process.stdout.on("data", (data) => {
      output += data.toString();
      if (output.includes("Forwarding from")) {
        clearTimeout(timeout);
        return resolve({
          kubectl_command: `${cmd} ${args.join(" ")}`,
          output: "Port-forwarding started successfully.",
          pid: process.pid,
        });
      }
    });

    process.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    process.on("error", (err) => {
      clearTimeout(timeout);
      return reject({
        kubectl_command: `${cmd} ${args.join(" ")}`,
        error: `Failed to start port-forward: ${err.message}`,
      });
    });

    process.on("close", () => {
      clearTimeout(timeout);
      if (!output.includes("Forwarding from")) {
        return reject({
          kubectl_command: `${cmd} ${args.join(" ")}`,
          error: errorOutput || "Port-forward failed to start.",
        });
      }
    });
  });
};
