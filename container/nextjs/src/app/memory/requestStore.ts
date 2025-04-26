import { MCPRequest } from "@/app/types/mcp";

const pendingRequests: MCPRequest[] = [];

export const RequestStore = {
  add(request: MCPRequest) {
    pendingRequests.push(request);
  },
  getAll() {
    return pendingRequests;
  },
  remove(id: string) {
    const idx = pendingRequests.findIndex(req => req.id === id);
    if (idx !== -1) pendingRequests.splice(idx, 1);
  },
  find(id: string) {
    return pendingRequests.find(req => req.id === id);
  }
}
