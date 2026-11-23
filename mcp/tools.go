package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// kind tells the agent (and later, a gateway) how risky a tool is.
type kind int

const (
	readOnly    kind = iota // only reads data
	write                   // creates or changes data
	destructive             // deletes data or can't be undone
)

func annotations(k kind) *mcp.ToolAnnotations {
	yes, no := true, false

	switch k {
	case readOnly:
		return &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true, OpenWorldHint: &no}
	case write:
		return &mcp.ToolAnnotations{DestructiveHint: &no, OpenWorldHint: &yes}
	default:
		return &mcp.ToolAnnotations{DestructiveHint: &yes, OpenWorldHint: &yes}
	}
}

// maxResultBytes keeps one tool result from flooding the agent's context.
const maxResultBytes = 60_000

// add registers one tool. run returns API data, which is sent back to the agent as JSON text.
func add[In any](s *mcp.Server, name, description string, k kind, run func(ctx context.Context, in In) (any, error)) {
	tool := &mcp.Tool{Name: name, Description: description, Annotations: annotations(k)}

	mcp.AddTool(s, tool, func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, any, error) {
		log.Printf("tool called: %s", name) // stderr only: stdout carries MCP messages

		out, err := run(ctx, in)
		if err != nil {
			return nil, nil, err // the SDK turns this into an error result the agent can read
		}

		text, err := toText(out)
		if err != nil {
			return nil, nil, err
		}

		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil, nil
	})
}

func toText(v any) (string, error) {
	var b []byte

	switch t := v.(type) {
	case json.RawMessage:
		b = t
	case string:
		return t, nil
	default:
		var err error
		if b, err = json.Marshal(t); err != nil {
			return "", err
		}
	}

	if len(b) > maxResultBytes {
		return string(b[:maxResultBytes]) + "\n…[truncated: use filters, a smaller limit, or fetch a single item]", nil
	}

	return string(b), nil
}

// query builds URL parameters from name/value pairs, skipping empty values.
func query(pairs ...string) url.Values {
	q := url.Values{}

	for i := 0; i+1 < len(pairs); i += 2 {
		if pairs[i+1] != "" {
			q.Set(pairs[i], pairs[i+1])
		}
	}

	return q
}

func page(q url.Values, limit int, next string) url.Values {
	if limit <= 0 {
		limit = 20
	}

	q.Set("limit", strconv.Itoa(limit))

	if next != "" {
		q.Set("next", next)
	}

	return q
}

// jsonParam turns an object filter into the JSON string the API expects.
func jsonParam(v map[string]any) string {
	if len(v) == 0 {
		return ""
	}

	b, _ := json.Marshal(v)

	return string(b)
}

// bodyWithoutID sends the tool input as the request body, minus the path ID.
func bodyWithoutID(in any) (map[string]any, error) {
	b, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}

	m := map[string]any{}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}

	delete(m, "id")

	return m, nil
}

func requireID(id, prefix string) error {
	if id == "" {
		return fmt.Errorf("id is required (it starts with %q)", prefix)
	}

	return nil
}

// ---------------------------------------------------------------------------
// Inputs shared by several tools
// ---------------------------------------------------------------------------

type noInput struct{}

type idInput struct {
	ID string `json:"id" jsonschema:"the ID of the item"`
}

type nameListInput struct {
	Name   string `json:"name,omitempty" jsonschema:"filter by name (partial match)"`
	Status string `json:"status,omitempty" jsonschema:"filter by status: active or disabled"`
	Limit  int    `json:"limit,omitempty" jsonschema:"maximum results to return (default 20)"`
	Next   string `json:"next,omitempty" jsonschema:"cursor from the previous page's next field"`
}

type enabledInput struct {
	ID      string `json:"id" jsonschema:"the ID of the item"`
	Enabled bool   `json:"enabled" jsonschema:"true to enable, false to disable"`
}

type eventFilter struct {
	Status         string         `json:"status,omitempty" jsonschema:"QUEUED, SCHEDULED, SUCCESSFUL, FAILED, HOLD or CANCELLED"`
	ConnectionID   string         `json:"connection_id,omitempty" jsonschema:"only events of this connection (web_...)"`
	SourceID       string         `json:"source_id,omitempty" jsonschema:"only events from this source (src_...)"`
	DestinationID  string         `json:"destination_id,omitempty" jsonschema:"only events to this destination (des_...)"`
	ResponseStatus string         `json:"response_status,omitempty" jsonschema:"HTTP status the destination answered, e.g. 500"`
	ErrorCode      string         `json:"error_code,omitempty" jsonschema:"delivery error code, e.g. TIMEOUT"`
	From           string         `json:"from,omitempty" jsonschema:"only events created at or after this time (RFC3339, e.g. 2026-11-23T00:00:00Z)"`
	To             string         `json:"to,omitempty" jsonschema:"only events created before this time (RFC3339)"`
	Search         string         `json:"search,omitempty" jsonschema:"free-text search"`
	Body           map[string]any `json:"body,omitempty" jsonschema:"match events whose JSON body contains this object, e.g. {\"type\":\"payment.failed\"}"`
}

func (f eventFilter) empty() bool {
	return f.Status == "" && f.ConnectionID == "" && f.SourceID == "" && f.DestinationID == "" &&
		f.ResponseStatus == "" && f.ErrorCode == "" && f.From == "" && f.To == "" && f.Search == "" && len(f.Body) == 0
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

func registerTools(s *mcp.Server, c *Client) {
	registerWorkspaceTools(s, c)
	registerSourceTools(s, c)
	registerDestinationTools(s, c)
	registerConnectionTools(s, c)
	registerTransformationTools(s, c)
	registerRequestTools(s, c)
	registerEventTools(s, c)
}

func registerWorkspaceTools(s *mcp.Server, c *Client) {
	add(s, "list_workspaces",
		"List the EaseWebhook workspaces this account belongs to, and show which one is currently in use. All other tools act on the current workspace.",
		readOnly, func(ctx context.Context, _ noInput) (any, error) {
			data, err := c.Do(ctx, http.MethodGet, "/workspaces", nil, nil)
			if err != nil {
				return nil, err
			}

			return map[string]any{"current_workspace_id": c.workspaceID, "workspaces": data}, nil
		})

	add(s, "use_workspace",
		"Switch the workspace that all other tools act on, for the rest of this session.",
		write, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "ws_"); err != nil {
				return nil, err
			}

			data, err := c.Do(ctx, http.MethodGet, "/workspaces/"+url.PathEscape(in.ID), nil, nil)
			if err != nil {
				return nil, err
			}

			c.workspaceID = in.ID

			return map[string]any{"now_using": data}, nil
		})

	add(s, "get_overview",
		"Counters for the last 24 hours across the current workspace (requests, events, failures). A good first call to check overall health.",
		readOnly, func(ctx context.Context, _ noInput) (any, error) {
			return c.Do(ctx, http.MethodGet, "/stats", nil, nil)
		})
}

// ---- Sources ----

type createSourceInput struct {
	Name               string            `json:"name" jsonschema:"unique name of the source, e.g. stripe-production"`
	Type               string            `json:"type,omitempty" jsonschema:"source type (default WEBHOOK). Providers like STRIPE, GITHUB, SHOPIFY, RAZORPAY verify signatures natively; see list_source_types. Cannot change later"`
	Description        string            `json:"description,omitempty"`
	Config             map[string]string `json:"config,omitempty" jsonschema:"type-specific settings, e.g. the provider's signing secret"`
	AllowedHTTPMethods []string          `json:"allowed_http_methods,omitempty" jsonschema:"HTTP methods accepted, e.g. [\"POST\"]"`
	Verification       map[string]any    `json:"verification,omitempty" jsonschema:"generic verification for WEBHOOK/HTTP sources (hmac, api_key or basic_auth)"`
	CustomResponse     map[string]any    `json:"custom_response,omitempty" jsonschema:"custom reply sent to the sender"`
}

type updateSourceInput struct {
	ID                 string            `json:"id" jsonschema:"source ID (src_...)"`
	Name               string            `json:"name,omitempty"`
	Description        string            `json:"description,omitempty"`
	Config             map[string]string `json:"config,omitempty" jsonschema:"merged into the existing config"`
	AllowedHTTPMethods []string          `json:"allowed_http_methods,omitempty"`
	Verification       map[string]any    `json:"verification,omitempty"`
	CustomResponse     map[string]any    `json:"custom_response,omitempty"`
}

func registerSourceTools(s *mcp.Server, c *Client) {
	add(s, "list_sources",
		"List sources: the public URLs that receive webhooks (from Stripe, GitHub, Razorpay, any app). Each has a URL to give to the sender.",
		readOnly, func(ctx context.Context, in nameListInput) (any, error) {
			return c.Do(ctx, http.MethodGet, "/sources", page(query("name", in.Name, "status", in.Status), in.Limit, in.Next), nil)
		})

	add(s, "get_source", "Get one source (src_...), including its public URL and settings.",
		readOnly, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "src_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodGet, "/sources/"+url.PathEscape(in.ID), nil, nil)
		})

	add(s, "list_source_types",
		"List the supported source types (WEBHOOK, PUBLISH_API, HTTP and providers like STRIPE, GITHUB, SHOPIFY, RAZORPAY) and the config fields each needs.",
		readOnly, func(ctx context.Context, _ noInput) (any, error) {
			return c.Do(ctx, http.MethodGet, "/source-types", nil, nil)
		})

	add(s, "create_source",
		"Create a source: a new public URL that receives webhooks. The response includes the URL to paste into the sending app.",
		write, func(ctx context.Context, in createSourceInput) (any, error) {
			return c.Do(ctx, http.MethodPost, "/sources", nil, in)
		})

	add(s, "update_source", "Change a source's name, description, config or verification. Only the fields given are changed.",
		write, func(ctx context.Context, in updateSourceInput) (any, error) {
			if err := requireID(in.ID, "src_"); err != nil {
				return nil, err
			}

			body, err := bodyWithoutID(in)
			if err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPut, "/sources/"+url.PathEscape(in.ID), nil, body)
		})

	add(s, "set_source_enabled",
		"Enable or disable a source. A disabled source rejects incoming webhooks.",
		write, func(ctx context.Context, in enabledInput) (any, error) {
			if err := requireID(in.ID, "src_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPut, "/sources/"+url.PathEscape(in.ID)+"/"+enableWord(in.Enabled), nil, nil)
		})

	add(s, "delete_source",
		"Permanently delete a source. Its URL stops working and senders' webhooks will be lost. Confirm with the user first.",
		destructive, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "src_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodDelete, "/sources/"+url.PathEscape(in.ID), nil, nil)
		})
}

func enableWord(enabled bool) string {
	if enabled {
		return "enable"
	}

	return "disable"
}

// ---- Destinations ----

type createDestinationInput struct {
	Name            string         `json:"name" jsonschema:"unique name, e.g. orders-service"`
	URL             string         `json:"url,omitempty" jsonschema:"where events are delivered (required for HTTP destinations)"`
	Type            string         `json:"type,omitempty" jsonschema:"HTTP (default) or MOCK_API (a built-in endpoint that accepts everything, for testing)"`
	Description     string         `json:"description,omitempty"`
	HTTPMethod      string         `json:"http_method,omitempty" jsonschema:"force a method (POST, PUT...); empty keeps the original"`
	AuthType        string         `json:"auth_type,omitempty" jsonschema:"NONE, BEARER_TOKEN, BASIC_AUTH, API_KEY or EASE_SIGNATURE"`
	Auth            map[string]any `json:"auth,omitempty" jsonschema:"credentials for the auth type"`
	RateLimit       *int           `json:"rate_limit,omitempty" jsonschema:"max deliveries per rate_limit_period"`
	RateLimitPeriod string         `json:"rate_limit_period,omitempty" jsonschema:"second, minute or hour"`
	PathForwarding  *bool          `json:"path_forwarding,omitempty" jsonschema:"append the incoming sub-path to the URL (default true)"`
}

type updateDestinationInput struct {
	ID              string         `json:"id" jsonschema:"destination ID (des_...)"`
	Name            string         `json:"name,omitempty"`
	URL             string         `json:"url,omitempty"`
	Description     string         `json:"description,omitempty"`
	HTTPMethod      string         `json:"http_method,omitempty"`
	AuthType        string         `json:"auth_type,omitempty" jsonschema:"NONE, BEARER_TOKEN, BASIC_AUTH, API_KEY or EASE_SIGNATURE"`
	Auth            map[string]any `json:"auth,omitempty"`
	RateLimit       *int           `json:"rate_limit,omitempty"`
	RateLimitPeriod string         `json:"rate_limit_period,omitempty" jsonschema:"second, minute or hour"`
	PathForwarding  *bool          `json:"path_forwarding,omitempty"`
}

func registerDestinationTools(s *mcp.Server, c *Client) {
	add(s, "list_destinations", "List destinations: the endpoints EaseWebhook delivers events to.",
		readOnly, func(ctx context.Context, in nameListInput) (any, error) {
			return c.Do(ctx, http.MethodGet, "/destinations", page(query("name", in.Name, "status", in.Status), in.Limit, in.Next), nil)
		})

	add(s, "get_destination", "Get one destination (des_...) with its URL, auth type and rate limit.",
		readOnly, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "des_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodGet, "/destinations/"+url.PathEscape(in.ID), nil, nil)
		})

	add(s, "create_destination", "Create a destination: an endpoint that events will be delivered to.",
		write, func(ctx context.Context, in createDestinationInput) (any, error) {
			return c.Do(ctx, http.MethodPost, "/destinations", nil, in)
		})

	add(s, "update_destination", "Change a destination's URL, auth, rate limit or other settings. Only the fields given are changed.",
		write, func(ctx context.Context, in updateDestinationInput) (any, error) {
			if err := requireID(in.ID, "des_"); err != nil {
				return nil, err
			}

			body, err := bodyWithoutID(in)
			if err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPut, "/destinations/"+url.PathEscape(in.ID), nil, body)
		})

	add(s, "set_destination_enabled",
		"Enable or disable a destination. While disabled, its events are held; enabling it releases and delivers them.",
		write, func(ctx context.Context, in enabledInput) (any, error) {
			if err := requireID(in.ID, "des_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPut, "/destinations/"+url.PathEscape(in.ID)+"/"+enableWord(in.Enabled), nil, nil)
		})

	add(s, "delete_destination", "Permanently delete a destination. Confirm with the user first.",
		destructive, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "des_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodDelete, "/destinations/"+url.PathEscape(in.ID), nil, nil)
		})
}

// ---- Connections ----

const rulesHelp = `Rules run in order. Examples: ` +
	`{"type":"filter","body":{"type":{"$eq":"payment.failed"}}} (operators: $eq $neq $gt $gte $lt $lte $in $nin $startsWith $endsWith $exist $or $and $not), ` +
	`{"type":"transform","transformation_id":"trs_..."}, ` +
	`{"type":"retry","strategy":"exponential","count":5,"interval":60000} (interval in ms), ` +
	`{"type":"delay","delay":5000} (ms).`

type connectionListInput struct {
	Name          string `json:"name,omitempty" jsonschema:"filter by name"`
	SourceID      string `json:"source_id,omitempty" jsonschema:"only connections from this source"`
	DestinationID string `json:"destination_id,omitempty" jsonschema:"only connections to this destination"`
	Status        string `json:"status,omitempty" jsonschema:"active, paused or disabled"`
	Limit         int    `json:"limit,omitempty" jsonschema:"maximum results (default 20)"`
	Next          string `json:"next,omitempty" jsonschema:"cursor from the previous page"`
}

type createConnectionInput struct {
	Name          string           `json:"name" jsonschema:"name of the connection"`
	Description   string           `json:"description,omitempty"`
	SourceID      string           `json:"source_id,omitempty" jsonschema:"existing source (src_...); or give source instead"`
	DestinationID string           `json:"destination_id,omitempty" jsonschema:"existing destination (des_...); or give destination instead"`
	Source        map[string]any   `json:"source,omitempty" jsonschema:"create or reuse a source by name inline, e.g. {\"name\":\"stripe\",\"type\":\"STRIPE\"}"`
	Destination   map[string]any   `json:"destination,omitempty" jsonschema:"create or reuse a destination by name inline, e.g. {\"name\":\"api\",\"url\":\"https://...\"}"`
	Rules         []map[string]any `json:"rules,omitempty" jsonschema:"ordered rules (filter, transform, retry, delay)"`
}

type updateConnectionInput struct {
	ID          string           `json:"id" jsonschema:"connection ID (web_...)"`
	Name        string           `json:"name,omitempty"`
	Description string           `json:"description,omitempty"`
	Rules       []map[string]any `json:"rules,omitempty" jsonschema:"replaces all rules"`
}

type connectionStateInput struct {
	ID     string `json:"id" jsonschema:"connection ID (web_...)"`
	Action string `json:"action" jsonschema:"pause (hold new events), unpause (deliver held events), disable (drop new events) or enable"`
}

func registerConnectionTools(s *mcp.Server, c *Client) {
	add(s, "list_connections",
		"List connections: routes from a source to a destination, with their rules (filter, transform, retry, delay).",
		readOnly, func(ctx context.Context, in connectionListInput) (any, error) {
			q := query("name", in.Name, "source_id", in.SourceID, "destination_id", in.DestinationID, "status", in.Status)
			return c.Do(ctx, http.MethodGet, "/connections", page(q, in.Limit, in.Next), nil)
		})

	add(s, "get_connection", "Get one connection (web_...) with its source, destination and rules.",
		readOnly, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "web_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodGet, "/connections/"+url.PathEscape(in.ID), nil, nil)
		})

	add(s, "create_connection",
		"Connect a source to a destination so its webhooks get delivered there. "+rulesHelp,
		write, func(ctx context.Context, in createConnectionInput) (any, error) {
			return c.Do(ctx, http.MethodPost, "/connections", nil, in)
		})

	add(s, "update_connection", "Rename a connection or replace its rules. "+rulesHelp,
		write, func(ctx context.Context, in updateConnectionInput) (any, error) {
			if err := requireID(in.ID, "web_"); err != nil {
				return nil, err
			}

			body, err := bodyWithoutID(in)
			if err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPut, "/connections/"+url.PathEscape(in.ID), nil, body)
		})

	add(s, "set_connection_state", "Pause, unpause, disable or enable a connection.",
		write, func(ctx context.Context, in connectionStateInput) (any, error) {
			if err := requireID(in.ID, "web_"); err != nil {
				return nil, err
			}

			switch in.Action {
			case "pause", "unpause", "disable", "enable":
			default:
				return nil, errors.New("action must be pause, unpause, disable or enable")
			}

			return c.Do(ctx, http.MethodPut, "/connections/"+url.PathEscape(in.ID)+"/"+in.Action, nil, nil)
		})

	add(s, "delete_connection", "Permanently delete a connection. Webhooks from its source will no longer reach its destination. Confirm with the user first.",
		destructive, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "web_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodDelete, "/connections/"+url.PathEscape(in.ID), nil, nil)
		})
}

// ---- Transformations ----

const transformHelp = `Code is JavaScript: addHandler("transform", (request, context) => { /* change request.body, request.headers, request.path, request.query */ return request; }). Env values are available as process.env.NAME.`

type transformationInput struct {
	Name string            `json:"name" jsonschema:"name of the transformation"`
	Code string            `json:"code" jsonschema:"the JavaScript code"`
	Env  map[string]string `json:"env,omitempty" jsonschema:"environment values for process.env"`
}

type updateTransformationInput struct {
	ID   string            `json:"id" jsonschema:"transformation ID (trs_...)"`
	Name string            `json:"name,omitempty"`
	Code string            `json:"code,omitempty"`
	Env  map[string]string `json:"env,omitempty"`
}

type testTransformationInput struct {
	Code             string            `json:"code,omitempty" jsonschema:"code to test; or give transformation_id"`
	TransformationID string            `json:"transformation_id,omitempty" jsonschema:"test a saved transformation (trs_...)"`
	Env              map[string]string `json:"env,omitempty"`
	RequestID        string            `json:"request_id,omitempty" jsonschema:"run it on a real past request (req_...)"`
	EventID          string            `json:"event_id,omitempty" jsonschema:"run it on a real past event (evt_...)"`
	Request          map[string]any    `json:"request,omitempty" jsonschema:"or a sample: {method, path, query, headers, body}"`
}

func registerTransformationTools(s *mcp.Server, c *Client) {
	add(s, "list_transformations", "List transformations: JavaScript snippets that rewrite webhooks before delivery.",
		readOnly, func(ctx context.Context, in nameListInput) (any, error) {
			return c.Do(ctx, http.MethodGet, "/transformations", page(query("name", in.Name), in.Limit, in.Next), nil)
		})

	add(s, "get_transformation", "Get one transformation (trs_...) including its code.",
		readOnly, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "trs_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodGet, "/transformations/"+url.PathEscape(in.ID), nil, nil)
		})

	add(s, "test_transformation",
		"Run transformation code on a sample or a real past request/event and show the output, without saving or delivering anything. "+transformHelp,
		readOnly, func(ctx context.Context, in testTransformationInput) (any, error) {
			return c.Do(ctx, http.MethodPost, "/transformations/run", nil, in)
		})

	add(s, "create_transformation", "Create a transformation. Test it first with test_transformation. "+transformHelp,
		write, func(ctx context.Context, in transformationInput) (any, error) {
			return c.Do(ctx, http.MethodPost, "/transformations", nil, in)
		})

	add(s, "update_transformation", "Change a transformation's name, code or env. "+transformHelp,
		write, func(ctx context.Context, in updateTransformationInput) (any, error) {
			if err := requireID(in.ID, "trs_"); err != nil {
				return nil, err
			}

			body, err := bodyWithoutID(in)
			if err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPut, "/transformations/"+url.PathEscape(in.ID), nil, body)
		})

	add(s, "delete_transformation", "Permanently delete a transformation. Confirm with the user first.",
		destructive, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "trs_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodDelete, "/transformations/"+url.PathEscape(in.ID), nil, nil)
		})
}

// ---- Requests ----

type requestListInput struct {
	SourceID string         `json:"source_id,omitempty" jsonschema:"only requests to this source (src_...)"`
	Status   string         `json:"status,omitempty" jsonschema:"ACCEPTED or REJECTED"`
	Cause    string         `json:"cause,omitempty" jsonschema:"rejection cause, e.g. a failed signature check"`
	Method   string         `json:"method,omitempty" jsonschema:"HTTP method, e.g. POST"`
	From     string         `json:"from,omitempty" jsonschema:"at or after this time (RFC3339)"`
	To       string         `json:"to,omitempty" jsonschema:"before this time (RFC3339)"`
	Search   string         `json:"search,omitempty" jsonschema:"free-text search"`
	Body     map[string]any `json:"body,omitempty" jsonschema:"match requests whose JSON body contains this object"`
	Limit    int            `json:"limit,omitempty" jsonschema:"maximum results (default 20)"`
	Next     string         `json:"next,omitempty" jsonschema:"cursor from the previous page"`
}

func registerRequestTools(s *mcp.Server, c *Client) {
	add(s, "list_requests",
		"List requests: every raw HTTP call received on a source, accepted or rejected (e.g. bad signature). Use this to check whether a sender's webhook arrived at all.",
		readOnly, func(ctx context.Context, in requestListInput) (any, error) {
			q := query("source_id", in.SourceID, "status", in.Status, "cause", in.Cause, "method", in.Method,
				"from", in.From, "to", in.To, "search", in.Search, "body", jsonParam(in.Body))
			return c.Do(ctx, http.MethodGet, "/requests", page(q, in.Limit, in.Next), nil)
		})

	add(s, "get_request",
		"Get one request (req_...) with its headers and body, plus the events it produced (one per connection).",
		readOnly, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "req_"); err != nil {
				return nil, err
			}

			req, err := c.Do(ctx, http.MethodGet, "/requests/"+url.PathEscape(in.ID), nil, nil)
			if err != nil {
				return nil, err
			}

			events, err := c.Do(ctx, http.MethodGet, "/requests/"+url.PathEscape(in.ID)+"/events", nil, nil)
			if err != nil {
				return nil, err
			}

			return map[string]any{"request": req, "events": events}, nil
		})

	add(s, "retry_request",
		"Route a rejected request again through its connections, creating new events that will be delivered. Use after fixing the reason it was rejected.",
		write, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "req_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPost, "/requests/"+url.PathEscape(in.ID)+"/retry", nil, nil)
		})
}

// ---- Events and attempts ----

type eventListInput struct {
	eventFilter
	RequestID   string `json:"request_id,omitempty" jsonschema:"only events from this request (req_...)"`
	IncludeData bool   `json:"include_data,omitempty" jsonschema:"include each event's headers and body (bigger response)"`
	Limit       int    `json:"limit,omitempty" jsonschema:"maximum results (default 20)"`
	Next        string `json:"next,omitempty" jsonschema:"cursor from the previous page"`
}

type bulkInput struct {
	Query eventFilter `json:"query" jsonschema:"which events to act on; at least one filter is required"`
}

func registerEventTools(s *mcp.Server, c *Client) {
	add(s, "list_events",
		"List events: one delivery of a webhook to a destination, with its status (QUEUED, SCHEDULED, SUCCESSFUL, FAILED, HOLD, CANCELLED). Use this to find failed deliveries and why they failed.",
		readOnly, func(ctx context.Context, in eventListInput) (any, error) {
			f := in.eventFilter
			q := query("status", f.Status, "connection_id", f.ConnectionID, "source_id", f.SourceID,
				"destination_id", f.DestinationID, "request_id", in.RequestID, "response_status", f.ResponseStatus,
				"error_code", f.ErrorCode, "from", f.From, "to", f.To, "search", f.Search, "body", jsonParam(f.Body))

			if in.IncludeData {
				q.Set("include", "data")
			}

			return c.Do(ctx, http.MethodGet, "/events", page(q, in.Limit, in.Next), nil)
		})

	add(s, "get_event",
		"Get one event (evt_...) with its payload and every delivery attempt (status code, response body, error). Use this to explain why a delivery failed.",
		readOnly, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "evt_"); err != nil {
				return nil, err
			}

			event, err := c.Do(ctx, http.MethodGet, "/events/"+url.PathEscape(in.ID), nil, nil)
			if err != nil {
				return nil, err
			}

			attempts, err := c.Do(ctx, http.MethodGet, "/events/"+url.PathEscape(in.ID)+"/attempts", nil, nil)
			if err != nil {
				return nil, err
			}

			return map[string]any{"event": event, "attempts": attempts}, nil
		})

	add(s, "get_attempt", "Get one delivery attempt (atm_...) with the full request sent and response received.",
		readOnly, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "atm_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodGet, "/attempts/"+url.PathEscape(in.ID), nil, nil)
		})

	add(s, "retry_event",
		"Deliver one event (evt_...) to its destination again, right now. This re-sends the webhook to the user's server.",
		write, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "evt_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPost, "/events/"+url.PathEscape(in.ID)+"/retry", nil, nil)
		})

	add(s, "cancel_event", "Cancel a pending event (evt_...) so it is never delivered.",
		destructive, func(ctx context.Context, in idInput) (any, error) {
			if err := requireID(in.ID, "evt_"); err != nil {
				return nil, err
			}

			return c.Do(ctx, http.MethodPost, "/events/"+url.PathEscape(in.ID)+"/cancel", nil, nil)
		})

	add(s, "bulk_retry_events",
		"Re-deliver every event matching a filter, e.g. all FAILED events of one destination since this morning. Can re-send many webhooks: check the count with list_events and confirm with the user first.",
		write, func(ctx context.Context, in bulkInput) (any, error) {
			if in.Query.empty() {
				return nil, errors.New("give at least one filter in query, so this can't retry every event by accident")
			}

			return c.Do(ctx, http.MethodPost, "/bulk/events/retry", nil, in)
		})

	add(s, "bulk_cancel_events",
		"Cancel every pending event matching a filter so none of them are delivered. Confirm with the user first.",
		destructive, func(ctx context.Context, in bulkInput) (any, error) {
			if in.Query.empty() {
				return nil, errors.New("give at least one filter in query, so this can't cancel every event by accident")
			}

			return c.Do(ctx, http.MethodPost, "/bulk/events/cancel", nil, in)
		})
}
