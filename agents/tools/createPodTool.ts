import * as k8s from "@kubernetes/client-node";
import yaml from "yaml";
import {
  ContainerTemplateName,
  containerTemplates,
  CustomContainerConfig,
  CustomContainerConfigType,
} from "./containerTemplates";

export interface CreatePodInput {
  name:            string;
  namespace?:      string;
  template?:       ContainerTemplateName;
  customConfig?:   CustomContainerConfigType;
  dryRun?:         boolean;
}

export interface CreatePodResult {
  command?: string;
  yaml?:    string;
  output?:  string;
  pod?:     k8s.V1Pod;
  error?:   string;
}

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const coreV1Api = kc.makeApiClient(k8s.CoreV1Api);

export const createPodTool = async (
  input: CreatePodInput
): Promise<CreatePodResult> => {
  const {
    name,
    namespace = "default",
    template  = "nginx",
    customConfig,
    dryRun    = false,
  } = input;

  if (!name) {
    return { error: "`name` is required to create a Pod." };
  }

 
  let containerSpec: k8s.V1Container;
  if (template === "custom") {
    let parsed: CustomContainerConfigType;
    try {
      parsed = CustomContainerConfig.parse(customConfig!);
    } catch (err: any) {
      return { error: `Invalid custom container config: ${err.message}` };
    }
    containerSpec = {
      name:         "main",            
      image:        parsed.image,
      command:      parsed.command,
      args:         parsed.args,
      ports:        parsed.ports,
      resources:    parsed.resources,
      env:          parsed.env,
      volumeMounts: parsed.volumeMounts,
    };
  } else {
    containerSpec = { ...containerTemplates[template] };
  }
  const podSpec: k8s.V1Pod = {
    apiVersion: "v1",
    kind:       "Pod",
    metadata:   { name, namespace },
    spec:       { containers: [containerSpec] },
  };

  if (dryRun) {
    return {
      command: "kubectl apply --dry-run=client -f -",
      yaml:    yaml.stringify(podSpec),
      output:  "(dry-run) Pod manifest generated",
    };
  }

  try {
    const pod = await coreV1Api.createNamespacedPod({
      namespace: namespace,
      body: podSpec
    });
    const cmd = `kubectl get pod ${name} -n ${namespace}`;
    return {
      command: cmd,
      output:  `Pod '${name}' created in namespace '${namespace}'.`,
      pod, 
    };
  } catch (err: any) {
    return {
      error: `Failed to create Pod: ${
        err.response?.body?.message || err.message
      }`,
    };
  }
};
