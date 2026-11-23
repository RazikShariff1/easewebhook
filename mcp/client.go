package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client calls the EaseWebhook management API on behalf of the agent.
type Client struct {
	baseURL     string
	token       string
	workspaceID string
	http        *http.Client
}

func NewClient(baseURL, token, workspaceID string) *Client {
	return &Client{
		baseURL:     strings.TrimRight(baseURL, "/"),
		token:       token,
		workspaceID: workspaceID,
		http:        &http.Client{Timeout: 30 * time.Second},
	}
}

// Do sends one API call and returns the "data" part of the response.
// query and body may be nil.
func (c *Client) Do(ctx context.Context, method, path string, query url.Values, body any) (json.RawMessage, error) {
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}

		reader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")

	if c.workspaceID != "" {
		req.Header.Set("X-Workspace-Id", c.workspaceID)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach EaseWebhook at %s: %w", c.baseURL, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("EaseWebhook API %s %s returned %d: %s", method, path, resp.StatusCode, apiErrorMessage(raw))
	}

	if len(raw) == 0 || resp.StatusCode == http.StatusNoContent {
		return json.RawMessage(`{"ok":true}`), nil
	}

	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil && len(envelope.Data) > 0 {
		return envelope.Data, nil
	}

	return raw, nil
}

// apiErrorMessage pulls the human-readable message out of a GoFr error body.
func apiErrorMessage(raw []byte) string {
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &e) == nil && e.Error.Message != "" {
		return e.Error.Message
	}

	return strings.TrimSpace(string(raw))
}

// pickWorkspace chooses the first workspace the user belongs to, for when none is configured.
func (c *Client) pickWorkspace(ctx context.Context) error {
	data, err := c.Do(ctx, http.MethodGet, "/workspaces", nil, nil)
	if err != nil {
		return err
	}

	var list []struct {
		ID string `json:"id"`
	}

	// /workspaces may return a plain list or a {models: [...]} page.
	if json.Unmarshal(data, &list) != nil {
		var page struct {
			Models []struct {
				ID string `json:"id"`
			} `json:"models"`
		}
		if err := json.Unmarshal(data, &page); err != nil {
			return fmt.Errorf("unexpected /workspaces response: %w", err)
		}

		for _, m := range page.Models {
			list = append(list, struct {
				ID string `json:"id"`
			}{m.ID})
		}
	}

	if len(list) == 0 {
		return fmt.Errorf("this account has no workspaces")
	}

	c.workspaceID = list[0].ID

	return nil
}
