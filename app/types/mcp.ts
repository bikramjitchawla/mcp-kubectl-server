export type MCPRequest = {
  id: string;
  agent: string;
  goal: string;
  tools: string[];
  input_context: { [key: string]: any };
  output_expectation: {
    format: "markdown" | "json" | "text";
    includes: string[];
  };
};
