import { execSync } from "child_process";

export const helmInfoTool = async (): Promise<Record<string, any>> => {
  try {
    const version = execSync("helm version --short", { encoding: "utf-8" }).trim();
    const releases = execSync("helm list --all-namespaces", { encoding: "utf-8" }).trim();
    const repos = execSync("helm repo list", { encoding: "utf-8" }).trim();

    return {
      helm_version: version,
      helm_repos: repos,
      helm_releases: releases,
    };
  } catch (error: any) {
    return {
      error: error.message || "❌ Failed to fetch Helm info",
    };
  }
};
