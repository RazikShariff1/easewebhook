// Package models holds the API and storage types.
package models

import (
	"encoding/json"
	"time"
)

// ---- Sources ----

type SourceVerification struct {
	// Type: "hmac" | "api_key" | "basic_auth"
	Type      string `json:"type"`
	Header    string `json:"header,omitempty"`    // hmac/api_key: header carrying the signature/key
	Secret    string `json:"secret,omitempty"`    // hmac: shared secret
	Algorithm string `json:"algorithm,omitempty"` // hmac: sha256 (default) | sha1 | sha512
	Encoding  string `json:"encoding,omitempty"`  // hmac: hex (default) | base64
	Prefix    string `json:"prefix,omitempty"`    // hmac: optional prefix in header value, e.g. "sha256="
	APIKey    string `json:"api_key,omitempty"`   // api_key
	Username  string `json:"username,omitempty"`  // basic_auth
	Password  string `json:"password,omitempty"`  // basic_auth
}

type CustomResponse struct {
	ContentType string `json:"content_type"`
	Body        string `json:"body"`
}

type Source struct {
	ID             string              `json:"id"`
	WorkspaceID    string              `json:"workspace_id"`
	Type           string              `json:"type"`
	Config         map[string]string   `json:"config"`
	Name           string              `json:"name"`
	Description    *string             `json:"description"`
	URL            string              `json:"url"`
	AllowedMethods []string            `json:"allowed_http_methods"`
	Verification   *SourceVerification `json:"verification"`
	CustomResponse *CustomResponse     `json:"custom_response"`
	DisabledAt     *time.Time          `json:"disabled_at"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`

	Key string `json:"-"`
}

type SourceInput struct {
	Type           *string             `json:"type"`   // set on create; can't change later
	Config         map[string]string   `json:"config"` // per-type fields (secrets, verify tokens); merged on update
	Name           *string             `json:"name"`
	Description    *string             `json:"description"`
	AllowedMethods []string            `json:"allowed_http_methods"`
	Verification   *SourceVerification `json:"verification"`
	CustomResponse *CustomResponse     `json:"custom_response"`
}

// ---- Destinations ----

// Destination types.
const (
	DestHTTP    = "HTTP"
	DestMockAPI = "MOCK_API" // built-in endpoint that accepts everything and answers 200
	DestCLI     = "CLI"      // forward to a local machine via the CLI (not available yet)
)

type Destination struct {
	ID              string          `json:"id"`
	Type            string          `json:"type"`
	Name            string          `json:"name"`
	Description     *string         `json:"description"`
	URL             string          `json:"url"`
	HTTPMethod      *string         `json:"http_method"`
	AuthType        string          `json:"auth_type"`
	Auth            json.RawMessage `json:"auth"`
	RateLimit       *int            `json:"rate_limit"`
	RateLimitPeriod string          `json:"rate_limit_period"`
	PathForwarding  bool            `json:"path_forwarding"`
	DisabledAt      *time.Time      `json:"disabled_at"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// Destination auth types and their config shapes (stored in Destination.Auth).
const (
	AuthNone      = "NONE"
	AuthBearer    = "BEARER_TOKEN"   // {"token": "..."}
	AuthBasic     = "BASIC_AUTH"     // {"username": "...", "password": "..."}
	AuthAPIKey    = "API_KEY"        // {"key": "X-Api-Key", "api_key": "...", "to": "header"|"query"}
	AuthSignature = "EASE_SIGNATURE" // {"secret": "..."}; signs body with HMAC-SHA256 -> X-Ease-Signature
)

type DestinationAuth struct {
	Token    string `json:"token,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	Key      string `json:"key,omitempty"`
	APIKey   string `json:"api_key,omitempty"`
	To       string `json:"to,omitempty"`
	Secret   string `json:"secret,omitempty"`
}

type DestinationInput struct {
	Type            *string         `json:"type"`
	Name            *string         `json:"name"`
	Description     *string         `json:"description"`
	URL             *string         `json:"url"`
	HTTPMethod      *string         `json:"http_method"`
	AuthType        *string         `json:"auth_type"`
	Auth            json.RawMessage `json:"auth"`
	RateLimit       *int            `json:"rate_limit"`
	RateLimitPeriod *string         `json:"rate_limit_period"`
	PathForwarding  *bool           `json:"path_forwarding"`
}

// ---- Transformations ----

type Transformation struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Code      string            `json:"code"`
	Env       map[string]string `json:"env"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

type TransformationInput struct {
	Name *string           `json:"name"`
	Code *string           `json:"code"`
	Env  map[string]string `json:"env"`
}

// ---- Connections ----

// Rule is one entry in a connection's rule list. Type selects which fields apply.
type Rule struct {
	Type string `json:"type"` // retry | filter | transform | delay

	// retry
	Strategy string `json:"strategy,omitempty"` // linear | exponential
	Count    int    `json:"count,omitempty"`
	Interval int    `json:"interval,omitempty"` // ms

	// filter
	Body    json.RawMessage `json:"body,omitempty"`
	Headers json.RawMessage `json:"headers,omitempty"`
	Query   json.RawMessage `json:"query,omitempty"`
	Path    json.RawMessage `json:"path,omitempty"`

	// transform
	TransformationID string `json:"transformation_id,omitempty"`

	// delay
	Delay int `json:"delay,omitempty"` // ms
}

type Connection struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	FullName      string       `json:"full_name"`
	Description   *string      `json:"description"`
	SourceID      string       `json:"source_id"`
	DestinationID string       `json:"destination_id"`
	Source        *Source      `json:"source,omitempty"`
	Destination   *Destination `json:"destination,omitempty"`
	Rules         []Rule       `json:"rules"`
	PausedAt      *time.Time   `json:"paused_at"`
	DisabledAt    *time.Time   `json:"disabled_at"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

type ConnectionInput struct {
	Name          *string           `json:"name"`
	Description   *string           `json:"description"`
	SourceID      *string           `json:"source_id"`
	DestinationID *string           `json:"destination_id"`
	Source        *SourceInput      `json:"source"`      // create/reuse a source by name inline
	Destination   *DestinationInput `json:"destination"` // create/reuse a destination by name inline
	Rules         []Rule            `json:"rules"`
}

// ---- Requests / Events / Attempts ----

type Request struct {
	ID             string            `json:"id"`
	SourceID       string            `json:"source_id"`
	Method         string            `json:"method"`
	Path           string            `json:"path"`
	Query          string            `json:"query"`
	Headers        map[string]string `json:"headers"`
	Body           any               `json:"body"`
	ContentType    *string           `json:"content_type"`
	Verified       *bool             `json:"verified"`
	Status         string            `json:"status"`
	RejectionCause *string           `json:"rejection_cause"`
	EventsCount    int               `json:"events_count"`
	IgnoredCount   int               `json:"ignored_count"`
	OriginalIP     *string           `json:"original_ip"`
	IngestedAt     time.Time         `json:"ingested_at"`
}

const (
	EventQueued     = "QUEUED"
	EventScheduled  = "SCHEDULED"
	EventSuccessful = "SUCCESSFUL"
	EventFailed     = "FAILED"
	EventHold       = "HOLD"
	EventCancelled  = "CANCELLED"
)

type Event struct {
	ID             string            `json:"id"`
	RequestID      string            `json:"request_id"`
	ConnectionID   string            `json:"connection_id"`
	SourceID       string            `json:"source_id"`
	DestinationID  string            `json:"destination_id"`
	Status         string            `json:"status"`
	Method         string            `json:"method"`
	Path           string            `json:"path"`
	Query          string            `json:"query"`
	Headers        map[string]string `json:"headers"`
	Body           any               `json:"body,omitempty"`
	Attempts       int               `json:"attempts"`
	ResponseStatus *int              `json:"response_status"`
	ErrorCode      *string           `json:"error_code"`
	LastAttemptAt  *time.Time        `json:"last_attempt_at"`
	NextAttemptAt  *time.Time        `json:"next_attempt_at"`
	SuccessfulAt   *time.Time        `json:"successful_at"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`

	RawBody *string `json:"-"`
}

type Attempt struct {
	ID              string            `json:"id"`
	EventID         string            `json:"event_id"`
	AttemptNumber   int               `json:"attempt_number"`
	Trigger         string            `json:"trigger"`
	Status          string            `json:"status"`
	RequestedURL    string            `json:"requested_url"`
	HTTPMethod      string            `json:"http_method"`
	RequestHeaders  map[string]string `json:"request_headers,omitempty"`
	ResponseStatus  *int              `json:"response_status"`
	ResponseHeaders map[string]string `json:"response_headers,omitempty"`
	ResponseBody    *string           `json:"response_body,omitempty"`
	ErrorCode       *string           `json:"error_code"`
	ErrorMessage    *string           `json:"error_message"`
	DurationMS      *int              `json:"duration_ms"`
	CreatedAt       time.Time         `json:"created_at"`
}

// Page is the envelope for list endpoints.
type Page[T any] struct {
	Models     []T     `json:"models"`
	Count      int     `json:"count"`
	NextCursor *string `json:"next,omitempty"`
}
