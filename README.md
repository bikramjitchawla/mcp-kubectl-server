# 🤖 AI Kubernetes MCP Assistant

This project is an **AI-driven Kubernetes assistant** built with **MCP (Model Context Protocol)** to enable natural language interaction with your Kubernetes cluster. It supports intelligent tooling, natural language commands, and real-time AI explanations — all through a clean web UI.

---

## 🚀 Features

### Natural Language Kubernetes Control
- Convert natural language queries into safe `kubectl`/`helm` commands using Groq/OpenAI LLMs.
- Safeguarded command generation (`get`, `describe`, `logs`, `top`, etc.).
- Fallback mechanism for unsupported tools.

### ⚙️ Tooling Integration
Each operation is modularized as a **tool** that MCP can dynamically call based on user request.

Supported Tools:
- `naturalLanguageKubectl` – Parse and run safe `kubectl` commands.
- `logsFetcher` – Fetch logs from pods.
- `rolloutChecker` – Check deployment rollout status.
- `scaleDeployment` – Scale deployments up/down.
- `namespaceAnalyzer` – List and analyze namespaces.
- `explain_kubectl_result` – AI-based explanation of command results.
- `kubectlExplain` – Explain Kubernetes object structure.
- `portForwardPod` – Port-forward pod traffic to your local machine.
- `execCommandInPod` – Execute command inside a pod.
- `getPodEvents` – Show recent Kubernetes events.
- `monitoringTool` – Analyze cluster and pod health, node resource usage, and liveness/readiness probes.

> Tools are located in the `/tools` directory and registered in `tool.ts`.

---

## Architecture

User Input (UI) ↓ API (/api/mcp) ↓ MCPServer ↙ ↘ Tool Registry NLP Agent (Groq/OpenAI) ↓ Tool Handler → kubectl/helm → Output ↓ Explanation (optional via AI) ↓ Result rendered on UI


---

## 🧪 Example Prompts

### General
- "Show all pods not in running state."
- "Get logs for pod `nginx-deployment-abc123` in namespace `default`."
- "Port forward from pod `traefik-xyz` on port 80 to my local port 8080."
- "Explain what `kubectl get namespaces` output means."

### Monitoring
- "Check if any pods are failing liveness probes."
- "What is the current CPU and memory usage across nodes?"
- "List top consuming pods in the cluster."

---

