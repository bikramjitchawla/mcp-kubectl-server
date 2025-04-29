import { runKubectlCommand } from "@/utils/kubectlUtils";

export const kubectlExplainTool = async (input: Record<string, any>) => {
  const { resource } = input;

  if (!resource) {
    throw new Error("Missing required parameter: resource");
  }

  const result = await runKubectlCommand(`kubectl explain ${resource}`);

  return {
    content: [{ type: "text", text: result }],
  };
};
