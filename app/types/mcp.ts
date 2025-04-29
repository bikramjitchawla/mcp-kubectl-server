export type ToolParameter = {
  type: string;
  description: string;
  required: boolean;
};

export type ToolHandler = (input: Record<string, any>) => Promise<Record<string, any>>;

export type Tool = {
  description: string;
  parameters: Record<string, ToolParameter>;
  handler: ToolHandler;
};
