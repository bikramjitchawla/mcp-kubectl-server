// src/tools/naturalLanguageKubectlTool.ts
import * as k8s from "@kubernetes/client-node";
import { MCPAgentRunner } from "@/agents/MCPAgentRunner";
import { allTools } from "./tool";
import { createPodTool } from "./createPodTool";

const agentRunner = new MCPAgentRunner();
type Tool = typeof allTools[number];

export interface NLPResult {
  command?: string;
  output?: string;
  yaml?:   string;
  pod?:    any;
  error?:  string;
}

export const naturalLanguageKubectlTool = async (
  input: { query?: string }
): Promise<NLPResult> => {
  const rawQuery = input.query?.trim() ?? "";
  console.log("[MCP] Received query:", rawQuery);
  if (!rawQuery) {
    return { error: "Missing `query` parameter." };
  }
  const query = rawQuery.toLowerCase();

  // ── 0) Early create-pod fallback ────────────────────────────────────────────
  if (/^(create|run)\s+pod\b/i.test(rawQuery)) {
    console.log("[MCP] Early createPod fallback");
    const nameMatch = rawQuery.match(/pod\s+([\w-]+)/i);
    const name = nameMatch?.[1];
    if (!name) {
      return { error: "Could not extract Pod name from query." };
    }
    const tplMatch = rawQuery.match(/\b(ubuntu|nginx|busybox|alpine|custom)\b/i);
    const template = (tplMatch?.[1].toLowerCase() as any) || "nginx";
    const nsMatch = rawQuery.match(/in\s+(?:the\s+)?([\w-]+)(?:\s+namespace)?/i);
    const namespace = nsMatch?.[1] ?? "default";
    const dryRun = /\b(dry[- ]?run)\b/i.test(rawQuery);

    return await createPodTool({ name, template, namespace, dryRun });
  }

  // ── 1) Gather pods for context ───────────────────────────────────────────────
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  let podNames: string[] = [];
  try {
    const podList = await coreApi.listPodForAllNamespaces();
    podNames = podList.items.map(p => p.metadata?.name!).filter(Boolean);
  } catch {
    /* ignore */
  }
  // ── 2) Build LLM prompt ───────────────────────────────────────────────────────
  const toolsDescription = allTools
    .map(t => {
      const paramsDesc = Object.entries(t.parameters)
        .map(([n, s]) => `${n} (${s.type}${s.required ? ", required" : ""})`)
        .join("; ");
      return `• ${t.name}: ${paramsDesc}`;
    })
    .join("\n");

  const prompt = `
You are a Kubernetes CLI expert.
Available tools:
${toolsDescription}

Current pods: ${podNames.join(", ") || "none"}

User wants to call exactly ONE tool.
Respond with valid JSON only:

{
  "tool": "<one of the tool names above>",
  "params": { /* tool-specific parameters */ }
}

No extra text.

User query: "${rawQuery}"
`.trim();

  console.log("[MCP] Sending prompt to AI");
  let parsed: { tool: string; params: Record<string, any> };
  try {
    const aiRaw = await agentRunner.runAgentPrompt(prompt, "llama-3.1-8b-instant");
    const match = aiRaw.match(/{[\s\S]*\}$/);
    if (!match) throw new Error("No JSON found");
    parsed = JSON.parse(match[0]);
    console.log("[MCP] Parsed JSON:", parsed);
  } catch (err: any) {
    console.error("[MCP] JSON parse error:", err);
    return { error: `Could not parse AI response: ${err.message}` };
  }

  // ── 3) Fallback: logs-tail (last N lines) ────────────────────────────────────
  const logsMatch = rawQuery.match(
    /logs?\s+([\w-]+)\s+(?:tail|last)?\s*(\d+)\s*lines?/i
  );
  if (logsMatch) {
    console.log("[MCP] Logs-tail fallback:", logsMatch[1], logsMatch[2]);
    const podName = logsMatch[1];
    const tail = parseInt(logsMatch[2], 10);
    const ns = rawQuery.match(/in\s+(?:the\s+)?([\w-]+)(?:\s+namespace)?/i)?.[1] || "default";
    parsed.tool = "monitoringTool";
    parsed.params = { type: "pod-logs", podName, namespace: ns, tail };
  }

  // ── 4) Fallback: resource-usage / top pods ───────────────────────────────────
  if (
    /\b(top\s+pods|cpu\s+and\s+memory|memory\s+usage|resource-usage|usage)\b/i.test(rawQuery)
  ) {
    console.log("[MCP] Resource-usage fallback");
    const ns = rawQuery.match(/in\s+(?:the\s+)?([\w-]+)(?:\s+namespace)?/i)?.[1];
    parsed.tool = "monitoringTool";
    parsed.params = { type: "resource-usage", namespace: ns };
  }

  // ── 5) Fallback: list pods ─────────────────────────────────────────────────────
  if (/^(get|list)\s+(all\s+)?pods?(\s|$)/.test(query)) {
    console.log("[MCP] Pods fallback");
    parsed.tool = "listPodsTool";
    parsed.params = {};
    const m = rawQuery.match(/in\s+(?:the\s+)?([\w-]+)(?:\s+namespace)?/i);
    if (m) parsed.params.namespace = m[1];
  }

  // ── 6) Fallback: cluster-health ───────────────────────────────────────────────
  if (/cluster\s*health/i.test(rawQuery) || /component\s*status(es)?/i.test(rawQuery)) {
    console.log("[MCP] Cluster-health fallback");
    parsed.tool = "monitoringTool";
    parsed.params = { type: "cluster-health" };
  }

  // ── 7) Fallback: node-capacity ────────────────────────────────────────────────
  if (
    /node\s*(capacity|capacities|resources)?/i.test(rawQuery) ||
    /cpu\s*and\s*memory\s*capacity/i.test(rawQuery)
  ) {
    console.log("[MCP] Node-capacity fallback");
    parsed.tool = "monitoringTool";
    parsed.params = { type: "node-capacity" };
  }

  // ── 8) Fallback: list namespaces ──────────────────────────────────────────────
  if (/^(get|list)\s+(all\s+)?namespaces?(\s|$)/i.test(query)) {
    console.log("[MCP] Namespaces fallback");
    parsed.tool = "namespaceAnalyzerTool";
    parsed.params = {};
  }

  // ── 9) Dispatch to the chosen tool ────────────────────────────────────────────
  const tool: Tool | undefined = allTools.find(t => t.name === parsed.tool);
  if (!tool) {
    console.error("[MCP] Unknown tool:", parsed.tool);
    return { error: `Unknown tool "${parsed.tool}".` };
  }
  console.log(`[MCP] Invoking ${tool.name}`, parsed.params);

  try {
    const result = await (tool.handler as any)(parsed.params);
    return { ...result };
  } catch (err: any) {
    console.error(`[MCP] Tool error:`, err);
    return { error: `Execution failed: ${err.message}` };
  }
};
