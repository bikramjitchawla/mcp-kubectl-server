import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import yaml from "yaml";

// Common helper
const execHelm = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 60000 }).trim();
  } catch (err: any) {
    throw new Error(`Helm command failed: ${err.message}`);
  }
};

const writeValues = (name: string, values: Record<string, any>): string => {
  const filename = `${name}-values.yaml`;
  writeFileSync(filename, yaml.stringify(values));
  return filename;
};

export const helmTool = async (
  input: Record<string, any>
): Promise<Record<string, any>> => {
  const { operation, name, chart, repo, namespace, values } = input;

  if (!operation || !name || !namespace) {
    return { error: "Required: operation, name, and namespace" };
  }

  try {
    // Add repo if given
    if (repo && chart) {
      const repoName = chart.split("/")[0];
      execHelm(`helm repo add ${repoName} ${repo}`);
      execHelm(`helm repo update`);
    }

    let cmd = "";
    let valuesFile = "";

    switch (operation) {
      case "install":
        if (!chart) return { error: "Chart is required for install" };
        cmd = `helm install ${name} ${chart} -n ${namespace} --create-namespace`;
        break;

      case "upgrade":
        if (!chart) return { error: "Chart is required for upgrade" };
        cmd = `helm upgrade ${name} ${chart} -n ${namespace}`;
        break;

      case "uninstall":
        cmd = `helm uninstall ${name} -n ${namespace}`;
        break;

      default:
        return { error: ` Unsupported operation: ${operation}` };
    }

    // Add -f <values.yaml> if applicable
    if ((operation === "install" || operation === "upgrade") && values) {
      valuesFile = writeValues(name, values);
      cmd += ` -f ${valuesFile}`;
    }

    const output = execHelm(cmd);

    // Clean up values.yaml
    if (valuesFile) unlinkSync(valuesFile);

    return {
      command: cmd,
      status: `${operation}ed`,
      output,
      message: `Successfully ${operation}ed ${name}`,
    };
  } catch (err: any) {
    return {
      error: err.message,
    };
  }
};
