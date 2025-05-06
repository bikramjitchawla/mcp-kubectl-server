import { execSync } from "child_process";

export interface NamespaceAnalyzerResult {
  command: string;
  output?: string;
  namespaces?: string[];
  totalNamespaces?: number;
  error?: string;
}

export const namespaceAnalyzerTool = async (
  input: Record<string, any>
): Promise<NamespaceAnalyzerResult> => {
  const command = "kubectl get namespaces";

  try {
    const raw = execSync(command, { encoding: "utf-8", timeout: 30_000 }).trim();
    if (!raw) {
      return {
        command,
        output: "",
        error: "⚠️ No namespaces found in the cluster.",
      };
    }
    const lines = raw.split("\n");
    const header = lines[0];
    const rows = lines.slice(1);
    const namespaces = rows
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((ns) => !!ns);

    return {
      command,
      output: raw,            
      namespaces,                
      totalNamespaces: namespaces.length,
    };
  } catch (err: any) {
    return {
      command,
      error: `Failed to fetch namespaces: ${err.message}`,
    };
  }
};
