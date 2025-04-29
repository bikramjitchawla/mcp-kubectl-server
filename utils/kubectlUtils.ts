import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function runKubectlCommand(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr) {
      console.warn("kubectl stderr:", stderr);
    }
    return stdout.trim();
  } catch (error: any) {
    console.error("kubectl execution error:", error);
    throw new Error(`kubectl command failed: ${error.message}`);
  }
}
