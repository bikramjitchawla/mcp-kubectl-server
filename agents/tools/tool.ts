import { portForwardTool } from "./portForwardTool";
import { execCommandTool } from "./execCommandTool";
import { kubectlExplainTool } from "./kubectlExplainTool";
import { getPodEventsTool } from "./getPodEventsTool";
import { explainKubeResultTool } from "./explainKubeResultTool";
import { naturalLanguageKubectlTool } from "./naturalLanguageKubectlTool";
import { logsFetcherTool } from "./logsFetcherTool";
import { monitoringTool } from "./monitoringtool";
import { helmInfoTool } from "./helmtool";
import { rolloutCheckerTool } from "./rolloutCheckerTool";
import { namespaceAnalyzerTool } from "./namespaceAnalyzerTool";
import { scaleDeploymentTool } from "./scaleDeploymentTool";

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
    name: "kubectlExplain",
    description: "Explain a Kubernetes resource",
    parameters: {
      resource: { type: "string", description: "Resource to explain, e.g., pod.spec", required: true },
    },
    handler: kubectlExplainTool,
  },
  {
    name: "getPodEventsTool",
    description: "Get Kubernetes events related to a specific pod.",
    parameters: {
      podName: {
        type: "string",
        description: "The name of the pod.",
        required: true,
      },
      namespace: {
        type: "string",
        description: "The namespace of the pod (default is 'default').",
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
    description: "Perform monitoring operations like resource tracking, pod health, events, etc.",
    parameters: {
      type: {
        type: "string",
        description: "Monitoring type: cluster-health | resource-usage | node-capacity | events | pod-health | pod-logs",
        required: true,
      },
      namespace: {
        type: "string",
        description: "Namespace for the resource (optional)",
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
        description: "Number of log lines to show (optional)",
        required: false,
      },
      previous: {
        type: "boolean",
        description: "Get logs from previous container instance (optional)",
        required: false,
      },
    },
    handler: monitoringTool,
  },
  {
    name: "helmInfoTool",
    description: "Show Helm version, repositories, and deployed releases across all namespaces.",
    parameters: {},
    handler: helmInfoTool,
  },
  {
    name: "rolloutCheckerTool",
    description: "Check rollout status of a Kubernetes deployment.",
    parameters: {
      deployment: {
        type: "string",
        description: "Deployment name",
        required: true,
      },
      namespace: {
        type: "string",
        description: "Namespace of the deployment (optional)",
        required: false,
      },
    },
    handler: rolloutCheckerTool,
  },
  {
    name: "namespaceAnalyzerTool",
    description: "List and count all namespaces in the Kubernetes cluster.",
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
  }
];