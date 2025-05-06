import { portForwardTool } from "./portForwardTool";
import { execCommandTool } from "./execCommandTool";
import { getPodEventsTool } from "./getPodEventsTool";
import { explainKubeResultTool } from "./explainKubeResultTool";
import { naturalLanguageKubectlTool } from "./naturalLanguageKubectlTool";
import { logsFetcherTool } from "./logsFetcherTool";
import { monitoringTool } from "./monitoringtool";
import { namespaceAnalyzerTool } from "./namespaceAnalyzerTool";
import { scaleDeploymentTool } from "./scaleDeploymentTool";
import { helmTool } from "./helmtool";
import { createPodTool } from "./createPodTool";
import { listPodsTool } from "./listallpod";

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
    name: "execCommandTool",
    description: "Execute a shell command inside a running Kubernetes pod.",
    parameters: {
      podName: {
        type: "string",
        description: "The name of the pod.",
        required: true,
      },
      command: {
        type: "string",
        description: "The shell command to run inside the pod.",
        required: true,
      },
      namespace: {
        type: "string",
        description: "The namespace of the pod (optional, defaults to 'default').",
        required: false,
      },
    },
    handler: execCommandTool,
  },
  {
    name: "listPodsTool",
    description:
      "List pods across all namespaces, or within a specific namespace",
    parameters: {
      namespace: {
        type: "string",
        description: "Optional namespace to filter (omit for all namespaces)",
        required: false,
      },
    },
    handler: listPodsTool,
  },  
  {
    name: "getPodEventsTool",
    description: "Fetch Kubernetes events for a specific pod",
    parameters: {
      podName: {
        type: "string",
        description: "Pod name to fetch events for",
        required: true,
      },
      namespace: {
        type: "string",
        description: "Namespace of the pod (defaults to 'default')",
        required: false,
      },
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
    description:
      "Perform monitoring operations: cluster-health, resource-usage, node-capacity, events, pod-health, pod-logs",
    parameters: {
      type: {
        type: "string",
        description:
          "One of: cluster-health | resource-usage | node-capacity | events | pod-health | pod-logs",
        required: true,
      },
      namespace: {
        type: "string",
        description: "Optional namespace for the resource",
        required: false,
      },
      podName: {
        type: "string",
        description: "Pod name (required for pod-health and pod-logs)",
        required: false,
      },
      container: {
        type: "string",
        description: "Container name inside the pod (optional for pod-logs)",
        required: false,
      },
      tail: {
        type: "number",
        description: "Number of log lines to show (optional for pod-logs)",
        required: false,
      },
      previous: {
        type: "boolean",
        description:
          "Whether to fetch previous container logs (optional for pod-logs)",
        required: false,
      },
    },
    handler: monitoringTool,
  },
  {
    name: "helmTool",
    description: "Install, upgrade, or uninstall a Helm release",
    parameters: {
      operation: {
        type: "string",
        description: "install | upgrade | uninstall",
        required: true,
      },
      name: {
        type: "string",
        description: "Release name",
        required: true,
      },
      chart: {
        type: "string",
        description: "Chart to deploy (required for install/upgrade)",
        required: false,
      },
      repo: {
        type: "string",
        description: "Chart repo URL (optional)",
        required: false,
      },
      namespace: {
        type: "string",
        description: "Kubernetes namespace",
        required: true,
      },
      values: {
        type: "object",
        description: "Values overrides as JSON object",
        required: false,
      },
    },
    handler: helmTool,
  },
  {
    name: "createPodTool",
    description: "...",
    parameters: {
      name:        { type: "string", required: true, description: "Pod name" },
      namespace:   { type: "string", required: false, description: "Namespace" },
      template:    { type: "string", required: false, description: "Container template: ubuntu|nginx|busybox|alpine|custom" },
      customConfig:{ type: "object", required: false, description: "Full V1Container spec if template=custom" },
      dryRun:      { type: "boolean", required: false, description: "Dry-run: emit YAML only" },
    },
    handler: createPodTool,
  },
  {
    name: "namespaceAnalyzerTool",
    description: "List all namespaces and report their count",
    parameters: {},
    handler: namespaceAnalyzerTool,
  },
  
  
  {
    name: "scaleDeploymentTool",
    description: "Scale a Kubernetes deployment to a specific number of replicas.",
    parameters: {
      deployment: {
        type: "string",
        description: "Deployment name",
        required: true,
      },
      replicas: {
        type: "number",
        description: "Number of replicas to scale to",
        required: true,
      },
      namespace: {
        type: "string",
        description: "Namespace of the deployment (optional)",
        required: false,
      },
    },
    handler: scaleDeploymentTool,
  },
  
];