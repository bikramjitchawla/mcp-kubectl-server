export interface MCPRequest {
    id: string; 
    agent: string;
    goal: string;
    memory: Record<string, any>;
    tools: string[];
    input_context: Record<string, any>;
    output_expectation: {
      format: string;
      includes: string[];
    };
  }
  