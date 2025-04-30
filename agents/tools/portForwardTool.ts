import { spawn } from "child_process";

export const portForwardTool = async (input: Record<string, any>) => {
  const { podName, namespace = "default", localPort, remotePort } = input;

  const cmd = `kubectl port-forward pod/${podName} -n ${namespace} ${localPort}:${remotePort}`;
  console.log("Running port-forward:", cmd);

  const child = spawn("kubectl", [
    "port-forward",
    `pod/${podName}`,
    `${localPort}:${remotePort}`,
    "-n",
    namespace,
  ]);

  child.stdout.on("data", (data) => {
    console.log(`port-forward stdout: ${data}`);
  });

  child.stderr.on("data", (data) => {
    console.error(`port-forward stderr: ${data}`);
  });

  child.on("close", (code) => {
    console.log(`port-forward process exited with code ${code}`);
  });

  return {
    status: "started",
    message: `Port forwarding ${localPort} → ${remotePort} for pod ${podName} in namespace ${namespace}`,
    note: "This command runs in background. You must stop it manually if needed.",
  };
};
