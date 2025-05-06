import * as k8s from "@kubernetes/client-node";

export interface LogsFetcherResult {
  command: string;
  output?: string;
  error?: string;
}

export const logsFetcherTool = async (
  input: {
    podName?: string;
    namespace?: string;
    container?: string;
    tail?: number;
    previous?: boolean;
  }
): Promise<LogsFetcherResult> => {
  const { podName, namespace = "default", container, tail, previous } = input;
  if (!podName) {
    return { command: "", error: "Missing `podName` parameter." };
  }

  const args = ["logs", podName, "-n", namespace];
  if (container)    args.push("-c", container);
  if (previous)     args.push("--previous");
  if (tail != null) args.push(`--tail=${tail}`);
  const command = `kubectl ${args.join(" ")}`;

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);

  try {
    const resp = await coreApi.readNamespacedPodLog({
      name:       podName,
      namespace:  namespace,
      container:  container,
      follow:     false,
      previous:   previous,
      tailLines:  tail,
      timestamps: false,
    });

    const output =
      typeof resp === "string"
        ? resp
        : resp;

    return { command, output };
  } catch (err: any) {
    const msg = err.response?.body?.message || err.message;
    return { command, error: `Failed to fetch logs: ${msg}` };
  }
};
