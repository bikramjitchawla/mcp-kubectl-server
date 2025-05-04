AI-Powered Kubernetes Assistant with MCP

An AI-driven Kubernetes assistant built using Model Context Protocol (MCP) that enables natural language interaction with your Kubernetes cluster. It supports dynamic tooling, safe command generation, Helm integration, and real-time AI explanations — all from a clean web UI.

🚀 Key Features

🧠 Natural Language Kubernetes Control
Convert natural language queries into safe kubectl/helm commands using Groq/OpenAI (LLM).
Auto-validates generated commands (get, describe, logs, top, etc.).
Fallback mechanism for unsupported or unsafe commands.
🔧 Tool-Based Architecture
Each Kubernetes operation is modularized as a tool, invoked dynamically via MCP based on user intent.

🛠️ Available Tools

naturalLanguageKubectl — Parse and run safe Kubernetes commands.
logsFetcher — Fetch pod logs.
rolloutChecker — Monitor deployment rollout status.
scaleDeployment — Scale deployments up/down.
namespaceAnalyzer — Analyze namespaces.
explain_kubectl_result — AI explanation of command outputs.
kubectlExplain — Explain Kubernetes object fields.
portForwardPod — Port forward from a pod to your local machine.
execCommandInPod — Execute shell commands in a pod.
getPodEvents — Get Kubernetes event history for a pod.
monitoringTool — Check pod health, node resource usage, cluster health, etc.
helmTool — Install, upgrade, or uninstall Helm charts.
createPodTool — Dynamically generate and deploy pods from templates or custom specs.
🗂 Tools are located in /tools and registered centrally in tool.ts.
🧬 Architecture

User Query (UI)
      ↓
   /api/mcp
      ↓
 +-------------+
 |  MCPServer  |
 +-------------+
     ↓       ↘
 Tool Router   LLM Agent (Groq/OpenAI)
     ↓             ↓
 Tool Handler → kubectl / helm
     ↓             ↓
   Response    (Optional AI Explanation)
      ↓
    UI Renderer
🧪 Example Prompts

General Use
"Get all pods not in running state."
"Show logs for pod nginx-deployment-abc123 in namespace default."
"Port-forward traefik pod port 80 to local port 8080."
"Explain what kubectl get namespaces shows."
Monitoring
"Check if any pods are failing their liveness probe."
"What is the current CPU and memory usage across nodes?"
"List top resource-consuming pods."