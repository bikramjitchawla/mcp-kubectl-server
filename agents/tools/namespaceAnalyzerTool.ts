import { execSync } from "child_process";

export const namespaceAnalyzerTool = async (input: Record<string, any>) => {
  try {
    const output = execSync("kubectl get namespaces").toString();
    const namespaces = output
      .split("\n")
      .slice(1)
      .filter(line => line.trim() !== "")
      .map(line => line.split(/\s+/)[0]);

    return {
      totalNamespaces: namespaces.length,
      namespaces
    };
  } catch (error: any) {
    return { error: error.message };
  }
};
