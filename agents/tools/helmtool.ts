import { execSync } from "child_process";

export const helmInfoTool = async (): Promise<Record<string, any>> => {
  const results: Record<string, any> = {};

  try {
    const versionCmd = "helm version --short";
    results.helm_version = execSync(versionCmd, { encoding: "utf-8" }).trim();
    results.helm_version_command = versionCmd;
  } catch (err: any) {
    results.helm_version = "Failed to get Helm version";
    results.helm_version_error = err.message;
  }

  try {
    const repoCmd = "helm repo list";
    const output = execSync(repoCmd, { encoding: "utf-8" }).trim();
    results.helm_repos = output || "No Helm repositories found.";
    results.helm_repos_command = repoCmd;
  } catch (err: any) {
    results.helm_repos = "Failed to get Helm repositories.";
    results.helm_repos_error = err.message;
  }

  try {
    const updateCmd = "helm repo update";
    results.helm_repo_update = execSync(updateCmd, { encoding: "utf-8" }).trim();
    results.helm_repo_update_command = updateCmd;
  } catch (err: any) {
    results.helm_repo_update = "Could not update Helm repositories.";
    results.helm_repo_update_error = err.message;
  }

  try {
    const releasesCmd = "helm list --all-namespaces";
    const output = execSync(releasesCmd, { encoding: "utf-8" }).trim();
    results.helm_releases = output || "No Helm releases found.";
    results.helm_releases_command = releasesCmd;
  } catch (err: any) {
    results.helm_releases = "Failed to list Helm releases.";
    results.helm_releases_error = err.message;
  }

  return results;
};
