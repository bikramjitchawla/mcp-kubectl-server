import { portForwardTool } from "./portForwardTool";
import { execCommandTool } from "./execCommandTool";
import { kubectlExplainTool } from "./kubectlExplainTool";
import { getPodEventsTool } from "./getPodEventsTool";
import { explainKubeResultTool } from "./explainKubeResultTool";
import { naturalLanguageKubectlTool } from "./naturalLanguageKubectlTool";
import { logsFetcherTool } from "./logsFetcherTool";
import { monitoringTool } from "./monitoringtool";

export const allTools = [
  {
    name: "portForwardPod",
    description: "Port forward from a pod to local machine",
    parameters: {
      podName: { type: "string", description: "Pod name", required: true },
      localPort: { type: "number", description: "Local port", required: true },
      remotePort: { type: "number", description: "Remote port inside pod", required: true },
      namespace: { type: "string", description: "Namespace", required: false },
    },
    handler: portForwardTool,
  },
  {
    name: "execCommandInPod",
    description: "Execute command inside a running pod",
    parameters: {
      podName: { type: "string", description: "Pod name", required: true },
      command: { type: "string", description: "Command to execute inside pod", required: true },
      namespace: { type: "string", description: "Namespace", required: false },
    },
    handler: execCommandTool,
  },
  {
    name: "kubectlExplain",
    description: "Explain a Kubernetes resource",
    parameters: {
      resource: { type: "string", description: "Resource to explain, e.g., pod.spec", required: true },
    },
    handler: kubectlExplainTool,
  },
  {
    name: "getPodEvents",
    description: "Get Kubernetes events for a pod",
    parameters: {
      podName: { type: "string", description: "Pod name", required: true },
      namespace: { type: "string", description: "Namespace (optional)", required: false },
    },
    handler: getPodEventsTool,
  },
  {
    name: "naturalLanguageKubectl",
    description: "Convert natural language query to kubectl/helm command",
    parameters: {
      query: { type: "string", description: "User's natural language query", required: true },
    },
    handler: naturalLanguageKubectlTool,
  },
  {
    name: "logsFetcher",
    description: "Fetch logs from a Kubernetes pod",
    parameters: {
      podName: { type: "string", description: "Pod name", required: true },
      namespace: { type: "string", description: "Namespace (optional)", required: false },
    },
    handler: logsFetcherTool,
  },
  {
    name: "explain_kubectl_result",
    description: "Explain kubectl output and suggest fixes",
    parameters: {
      kubectl_command: { type: "string", description: "Executed kubectl command", required: true },
      output: { type: "string", description: "Output from the kubectl command", required: true },
    },
    handler: explainKubeResultTool,
  },
  {
    name: "monitoringTool",
    description: "Perform monitoring operations like resource tracking, pod health, events, etc.",
    parameters: {
      type: {
        type: "string",
        description: "Monitoring type: cluster-health | resource-usage | node-capacity | events | pod-health",
        required: true,
      },
      namespace: {
        type: "string",
        description: "Namespace for the resource (optional)",
        required: false,
      },
      podName: {
        type: "string",
        description: "Pod name for health checks (required for pod-health)",
        required: false,
      },
    },
    handler: monitoringTool,
  },
];
