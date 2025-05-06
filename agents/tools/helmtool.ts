import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import * as os from "os";
import * as path from "path";
import yaml from "yaml";
const defaultRepoUrls: Record<string,string> = {
  bitnami: "https://charts.bitnami.com/bitnami",
};

export interface HelmToolInput {
  /**
   * install: install a new release
   * upgrade: upgrade an existing release
   * uninstall: remove a release
   * list: list releases
   */
  operation: "install" | "upgrade" | "uninstall" | "list";
  name:      string;
  chart?:    string;
  repo?:     string;
  namespace: string;
  values?:   Record<string, any>;
}

export interface HelmToolResult {
  command: string;
  output?: string;
  error?:  string;
  status?: string;
}

const execHelm = (cmd: string): string => {
  return execSync(cmd, { encoding: "utf-8", timeout: 60_000 }).trim();
};

export const helmTool = async (
  input: HelmToolInput
): Promise<HelmToolResult> => {
  const { operation, name, chart, repo, namespace, values } = input;

  if (operation === "list") {
    const cmd = namespace
      ? `helm list -n ${namespace}`
      : `helm list --all-namespaces`;
    try {
      const output = execHelm(cmd);
      return { command: cmd, output };
    } catch (err: any) {
      return { command: cmd, error: `Helm list failed: ${err.message}` };
    }
  }
  if (!operation || !name || !namespace) {
    return {
      command: "",
      error: "`operation`, `name`, and `namespace` are required.",
    };
  }
  if ((operation === "install" || operation === "upgrade") && !chart) {
    return {
      command: "",
      error: `\`chart\` is required for \`${operation}\`.`,
    };
  }
  try {
    if (repo) {
      const repoName = repo.replace(/[^a-z0-9]/gi, "") || "repo";
      execHelm(`helm repo add ${repoName} ${repo}`);
      execHelm(`helm repo update`);
    } else if (chart && chart.includes("/")) {
      const prefix = chart.split("/")[0];
      const url = defaultRepoUrls[prefix];
      if (url) {
        execHelm(`helm repo add ${prefix} ${url}`);
        execHelm(`helm repo update`);
      }
    }
  } catch (err: any) {
    return {
      command: "",
      error: `Failed to add/update Helm repo: ${err.message}`,
    };
  }

  let cmd = "";
  switch (operation) {
    case "install":
      cmd = `helm install ${name} ${chart} -n ${namespace} --create-namespace`;
      break;
    case "upgrade":
      cmd = `helm upgrade ${name} ${chart} -n ${namespace}`;
      break;
    case "uninstall":
      cmd = `helm uninstall ${name} -n ${namespace}`;
      break;
  }

  let valuesFile = "";
  try {
    if ((operation === "install" || operation === "upgrade") && values) {
      const tmp = os.tmpdir();
      valuesFile = path.join(tmp, `${name}-values-${Date.now()}.yaml`);
      writeFileSync(valuesFile, yaml.stringify(values), "utf-8");
      cmd += ` -f ${valuesFile}`;
    }
    const output = execHelm(cmd);
    const statusMap: Record<string,string> = {
      install:   "installed",
      upgrade:   "upgraded",
      uninstall: "uninstalled",
    };
    const status = statusMap[operation] || operation;

    return {
      command: cmd,
      output,
      status: `Release '${name}' ${status} successfully.`,
    };
  } catch (err: any) {
    return {
      command: cmd,
      error: `Helm ${operation} failed: ${err.message}`,
    };
  } finally {
    if (valuesFile) {
      try { unlinkSync(valuesFile); } catch {}
    }
  }
};
