// The EaseWebhook MCP tool catalog, shared by the dashboard AI agents page and the landing page.

export type Kind = "read" | "write" | "destructive";
export type Tool = { name: string; kind: Kind; does: string };

export const TOOLS: { area: string; tools: Tool[] }[] = [
  {
    area: "Workspace",
    tools: [
      { name: "get_overview", kind: "read", does: "24h counts of requests, events and failures" },
      { name: "list_workspaces", kind: "read", does: "Your workspaces, and which one the key uses" },
    ],
  },
  {
    area: "Sources",
    tools: [
      { name: "list_sources", kind: "read", does: "Webhook URLs and their settings" },
      { name: "get_source", kind: "read", does: "One source, with its public URL" },
      { name: "list_source_types", kind: "read", does: "Stripe, GitHub, Razorpay and 30 more" },
      { name: "create_source", kind: "write", does: "New public URL for a sender" },
      { name: "update_source", kind: "write", does: "Rename, config, verification" },
      { name: "set_source_enabled", kind: "write", does: "Turn a source on or off" },
      { name: "delete_source", kind: "destructive", does: "Remove a source and its URL" },
    ],
  },
  {
    area: "Destinations",
    tools: [
      { name: "list_destinations", kind: "read", does: "Where events are delivered" },
      { name: "get_destination", kind: "read", does: "URL, auth type, rate limit" },
      { name: "create_destination", kind: "write", does: "New endpoint to deliver to" },
      { name: "update_destination", kind: "write", does: "Change URL, auth or rate limit" },
      { name: "set_destination_enabled", kind: "write", does: "Hold or release deliveries" },
      { name: "delete_destination", kind: "destructive", does: "Remove a destination" },
    ],
  },
  {
    area: "Connections",
    tools: [
      { name: "list_connections", kind: "read", does: "Source → destination routes and rules" },
      { name: "get_connection", kind: "read", does: "One route with its rules" },
      { name: "create_connection", kind: "write", does: "Route a source to a destination" },
      { name: "update_connection", kind: "write", does: "Rename or replace rules" },
      { name: "set_connection_state", kind: "write", does: "Pause, unpause, enable, disable" },
      { name: "delete_connection", kind: "destructive", does: "Remove a route" },
    ],
  },
  {
    area: "Transformations",
    tools: [
      { name: "list_transformations", kind: "read", does: "JavaScript payload rewriters" },
      { name: "get_transformation", kind: "read", does: "One transformation's code" },
      { name: "test_transformation", kind: "read", does: "Dry-run code on a real event" },
      { name: "create_transformation", kind: "write", does: "Save new transformation code" },
      { name: "update_transformation", kind: "write", does: "Change code or env" },
      { name: "delete_transformation", kind: "destructive", does: "Remove a transformation" },
    ],
  },
  {
    area: "Requests",
    tools: [
      { name: "list_requests", kind: "read", does: "Every call received, accepted or rejected" },
      { name: "get_request", kind: "read", does: "Headers, body and resulting events" },
      { name: "retry_request", kind: "write", does: "Re-route a rejected request" },
    ],
  },
  {
    area: "Events",
    tools: [
      { name: "list_events", kind: "read", does: "Deliveries by status, destination, time" },
      { name: "get_event", kind: "read", does: "Payload plus every delivery attempt" },
      { name: "get_attempt", kind: "read", does: "Full request sent and response received" },
      { name: "retry_event", kind: "write", does: "Re-send one event now" },
      { name: "bulk_retry_events", kind: "write", does: "Re-send all events matching a filter" },
      { name: "cancel_event", kind: "destructive", does: "Stop a pending delivery" },
      { name: "bulk_cancel_events", kind: "destructive", does: "Stop all matching pending deliveries" },
    ],
  },
];

export const ALL_TOOLS = TOOLS.flatMap((g) => g.tools);
