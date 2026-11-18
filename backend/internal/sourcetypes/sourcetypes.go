// Package sourcetypes is the catalog of source types: generic ones (Webhook, Publish API, HTTP) and
// providers whose webhook signatures we verify natively. Each provider entry follows that provider's
// public webhook-signing documentation.
package sourcetypes

import (
	"errors"
	"net/http"
	"sort"
	"strings"
)

const (
	Webhook    = "WEBHOOK"
	PublishAPI = "PUBLISH_API"
	HTTP       = "HTTP"
)

// Field is a config value the user supplies (or we generate) for a source of this type.
type Field struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Help        string `json:"help,omitempty"`
	Placeholder string `json:"placeholder,omitempty"`
	Secret      bool   `json:"secret,omitempty"`
	Generated   bool   `json:"generated,omitempty"` // created by the server (e.g. Publish API key)
}

// Response is a reply sent instead of the default acknowledgement (URL-verification handshakes).
type Response struct {
	Status      int
	ContentType string
	Body        string
	Store       bool // also record the request
}

type Type struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Category    string   `json:"category"` // generic | provider
	Icon        string   `json:"icon"`     // simple-icons slug for providers, a UI icon name for generic types
	DocsURL     string   `json:"docs_url,omitempty"`
	Fields      []Field  `json:"fields"`
	Methods     []string `json:"methods"`             // default allowed HTTP methods
	CustomAuth  bool     `json:"custom_auth"`         // uses the generic verification options (hmac / api key / basic)
	Verifies    bool     `json:"verifies_signatures"` // signature checked natively when the secret is set

	// Verify returns nil when the request is authentic. Only called when the required config is present.
	Verify func(cfg map[string]string, r *http.Request, body []byte) error `json:"-"`
	// Handshake answers provider URL-verification requests (after Verify passed). nil = not handled.
	Handshake func(cfg map[string]string, r *http.Request, body []byte) *Response `json:"-"`
	// Requires lists config keys that must be set for Verify to run.
	Requires []string `json:"-"`
}

var (
	ErrMissingSignature = errors.New("missing signature header")
	ErrBadSignature     = errors.New("signature mismatch")
	ErrExpired          = errors.New("timestamp outside tolerance")
)

var post = []string{"POST"}

var registry = map[string]*Type{}

func register(t *Type) {
	if t.Fields == nil {
		t.Fields = []Field{}
	}

	if t.Methods == nil {
		t.Methods = post
	}

	t.Verifies = t.Verify != nil
	registry[t.ID] = t
}

// Get returns a type by ID.
func Get(id string) (*Type, bool) {
	t, ok := registry[strings.ToUpper(id)]
	return t, ok
}

// All returns the generic types first (fixed order), then providers by name.
func All() []*Type {
	order := map[string]int{Webhook: 0, PublishAPI: 1, HTTP: 2}

	out := make([]*Type, 0, len(registry))
	for _, t := range registry {
		out = append(out, t)
	}

	sort.Slice(out, func(i, j int) bool {
		oi, iok := order[out[i].ID]
		oj, jok := order[out[j].ID]

		switch {
		case iok && jok:
			return oi < oj
		case iok:
			return true
		case jok:
			return false
		}

		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})

	return out
}

// Ready reports whether every config key Verify needs is set (no secret = accept unverified).
func (t *Type) Ready(cfg map[string]string) bool {
	if t.Verify == nil {
		return false
	}

	for _, k := range t.Requires {
		if strings.TrimSpace(cfg[k]) == "" {
			return false
		}
	}

	return true
}

func init() {
	register(&Type{
		ID: Webhook, Name: "Webhook", Category: "generic", Icon: "webhook", CustomAuth: true,
		Description: "Receive webhooks from any service to a public endpoint",
		Methods:     []string{"POST", "PUT", "PATCH", "DELETE"},
	})
	register(&Type{
		ID: PublishAPI, Name: "Publish API", Category: "generic", Icon: "key",
		Description: "Send events from your own code using an authenticated API key",
		Fields: []Field{{Key: "api_key", Label: "API key", Secret: true, Generated: true,
			Help: `Send it as "Authorization: Bearer <key>" or "X-Api-Key: <key>".`}},
		Requires: []string{"api_key"},
		Verify:   verifyPublishKey,
	})
	register(&Type{
		ID: HTTP, Name: "HTTP", Category: "generic", Icon: "globe", CustomAuth: true,
		Description: "Receive requests from your customers, SDKs or devices (CORS enabled)",
		Methods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE"},
	})

	registerProviders()
}
