import { execSync } from "child_process";

export const namespaceAnalyzerTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const command = "kubectl get namespaces";

  try {
    const output = execSync(command, { encoding: "utf-8" }).trim();

    if (!output || output.toLowerCase().includes("no resources found")) {
      return {
        command,
        output: "",
        error: "No namespaces found in the cluster.",
      };
    }

    const lines = output.split("\n").slice(1); // skip header
    const namespaces = lines
      .map(line => line.trim().split(/\s+/)[0])
      .filter(ns => !!ns);

    return {
      command,
      totalNamespaces: namespaces.length,
      namespaces,
    };
  } catch (error: any) {
    return {
      command,
      error: `Failed to fetch namespaces: ${error.message}`,
    };
  }
};
