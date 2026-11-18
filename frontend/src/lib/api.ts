// Typed client for the EaseWebhook backend. All calls go through the Vite proxy at /api.

export interface Page<T> {
  models: T[];
  count: number;
  next?: string;
}

export interface SourceVerification {
  type: "hmac" | "api_key" | "basic_auth";
  header?: string;
  secret?: string;
  algorithm?: string;
  encoding?: string;
  prefix?: string;
  api_key?: string;
  username?: string;
  password?: string;
}

export interface Source {
  id: string;
  type: string;
  config: Record<string, string>;
  name: string;
  description: string | null;
  url: string;
  allowed_http_methods: string[];
  verification: SourceVerification | null;
  custom_response: { content_type: string; body: string } | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AuthType = "NONE" | "BEARER_TOKEN" | "BASIC_AUTH" | "API_KEY" | "EASE_SIGNATURE";

export interface Destination {
  id: string;
  type: "HTTP" | "MOCK_API" | "CLI";
  name: string;
  description: string | null;
  url: string;
  http_method: string | null;
  auth_type: AuthType;
  auth: Record<string, string> | null;
  rate_limit: number | null;
  rate_limit_period: "second" | "minute" | "hour";
  path_forwarding: boolean;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transformation {
  id: string;
  name: string;
  code: string;
  env: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface Rule {
  type: "retry" | "filter" | "transform" | "delay";
  strategy?: "linear" | "exponential";
  count?: number;
  interval?: number;
  body?: unknown;
  headers?: unknown;
  query?: unknown;
  path?: unknown;
  transformation_id?: string;
  delay?: number;
}

export interface Connection {
  id: string;
  name: string;
  full_name: string;
  description: string | null;
  source_id: string;
  destination_id: string;
  source: Source;
  destination: Destination;
  rules: Rule[];
  paused_at: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookRequest {
  id: string;
  source_id: string;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: unknown;
  content_type: string | null;
  verified: boolean | null;
  status: "ACCEPTED" | "REJECTED";
  rejection_cause: string | null;
  events_count: number;
  ignored_count: number;
  original_ip: string | null;
  ingested_at: string;
}

export type EventStatus = "QUEUED" | "SCHEDULED" | "SUCCESSFUL" | "FAILED" | "HOLD" | "CANCELLED";

export interface WebhookEvent {
  id: string;
  request_id: string;
  connection_id: string;
  source_id: string;
  destination_id: string;
  status: EventStatus;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body?: unknown;
  attempts: number;
  response_status: number | null;
  error_code: string | null;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  successful_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attempt {
  id: string;
  event_id: string;
  attempt_number: number;
  trigger: "INITIAL" | "AUTOMATIC" | "MANUAL";
  status: "SUCCESSFUL" | "FAILED";
  requested_url: string;
  http_method: string;
  request_headers?: Record<string, string>;
  response_status: number | null;
  response_headers?: Record<string, string>;
  response_body?: string | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface HistogramBucket {
  time: string;
  total: number;
  events?: number; // request histograms only
  status: Partial<Record<EventStatus, number>>;
}

export interface Stats {
  requests_24h: Record<string, number>;
  attempts_24h: Record<string, number>;
  events_by_status: Partial<Record<EventStatus, number>>;
}

export interface TransformRun {
  request: { method: string; path: string; query: string; headers: Record<string, string>; body: unknown } | null;
  console: string[];
  error: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Params = Record<string, string | number | undefined | null>;

function qs(params?: Params): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ---- session token ----
let authToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();

export function setAuthToken(t: string | null) {
  authToken = t;
}

let workspaceId: string | null = null;

// setWorkspaceId selects the workspace sent as X-Workspace-Id on every management call.
export function setWorkspaceId(id: string | null) {
  workspaceId = id;
}

// onUnauthorized registers a callback for 401s on authenticated calls; returns an unsubscribe.
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

async function request<T>(method: string, path: string, body?: unknown, params?: Params): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
  const res = await fetch(`/api${path}${qs(params)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && authToken && !path.startsWith("/auth/")) unauthorizedListeners.forEach((f) => f());
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: { data?: T; error?: { message?: string } } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, text || res.statusText);
  }
  if (!res.ok) throw new ApiError(res.status, json.error?.message ?? res.statusText);
  return json.data as T;
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>("GET", path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  del: (path: string) => request<void>("DELETE", path),
};
