package sourcetypes

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // test mirrors providers that sign with SHA1
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"hash"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func sign(h func() hash.Hash, key []byte, parts ...string) []byte {
	m := hmac.New(h, key)
	for _, p := range parts {
		m.Write([]byte(p))
	}

	return m.Sum(nil)
}

func hx(b []byte) string  { return hex.EncodeToString(b) }
func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

type tc struct {
	typ  string
	cfg  map[string]string
	body string
	prep func(r *http.Request, body string)
}

func TestProviderSignatures(t *testing.T) {
	now := strconv.FormatInt(time.Now().Unix(), 10)
	whsecRaw := []byte("standard-webhooks-secret-bytes!!")
	whsec := "whsec_" + b64(whsecRaw)
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)

	cases := []tc{
		{"STRIPE", map[string]string{"webhook_secret": "whsec_s"}, `{"id":"evt_1"}`, func(r *http.Request, b string) {
			r.Header.Set("Stripe-Signature", fmt.Sprintf("t=%s,v1=%s", now, hx(sign(sha256.New, []byte("whsec_s"), now, ".", b))))
		}},
		{"GITHUB", map[string]string{"webhook_secret": "gh"}, `{"zen":"x"}`, func(r *http.Request, b string) {
			r.Header.Set("X-Hub-Signature-256", "sha256="+hx(sign(sha256.New, []byte("gh"), b)))
		}},
		{"SHOPIFY", map[string]string{"api_secret": "shp"}, `{"id":1}`, func(r *http.Request, b string) {
			r.Header.Set("X-Shopify-Hmac-Sha256", b64(sign(sha256.New, []byte("shp"), b)))
		}},
		{"PADDLE", map[string]string{"secret_key": "pdl"}, `{"event_type":"x"}`, func(r *http.Request, b string) {
			r.Header.Set("Paddle-Signature", fmt.Sprintf("ts=%s;h1=%s", now, hx(sign(sha256.New, []byte("pdl"), now, ":", b))))
		}},
		{"SLACK", map[string]string{"signing_secret": "sl"}, `{"type":"event_callback"}`, func(r *http.Request, b string) {
			r.Header.Set("X-Slack-Request-Timestamp", now)
			r.Header.Set("X-Slack-Signature", "v0="+hx(sign(sha256.New, []byte("sl"), "v0:", now, ":", b)))
		}},
		{"CLERK", map[string]string{"signing_secret": whsec}, `{"type":"user.created"}`, func(r *http.Request, b string) {
			r.Header.Set("svix-id", "msg_1")
			r.Header.Set("svix-timestamp", now)
			r.Header.Set("svix-signature", "v1,"+b64(sign(sha256.New, whsecRaw, "msg_1.", now, ".", b)))
		}},
		{"STANDARD_WEBHOOKS", map[string]string{"signing_secret": whsec}, `{"a":1}`, func(r *http.Request, b string) {
			r.Header.Set("webhook-id", "m2")
			r.Header.Set("webhook-timestamp", now)
			r.Header.Set("webhook-signature", "v1,bogus v1,"+b64(sign(sha256.New, whsecRaw, "m2.", now, ".", b)))
		}},
		{"FACEBOOK", map[string]string{"app_secret": "fb", "verify_token": "vt"}, `{"object":"page"}`, func(r *http.Request, b string) {
			r.Header.Set("X-Hub-Signature-256", "sha256="+hx(sign(sha256.New, []byte("fb"), b)))
		}},
		{"DISCORD", map[string]string{"public_key": hx(pub)}, `{"type":2}`, func(r *http.Request, b string) {
			r.Header.Set("X-Signature-Timestamp", now)
			r.Header.Set("X-Signature-Ed25519", hx(ed25519.Sign(priv, []byte(now+b))))
		}},
		{"TWITCH", map[string]string{"secret": "tw"}, `{"subscription":{}}`, func(r *http.Request, b string) {
			r.Header.Set("Twitch-Eventsub-Message-Id", "id1")
			r.Header.Set("Twitch-Eventsub-Message-Timestamp", "2026-11-18T10:00:00Z")
			r.Header.Set("Twitch-Eventsub-Message-Signature", "sha256="+hx(sign(sha256.New, []byte("tw"), "id1", "2026-11-18T10:00:00Z", b)))
		}},
		{"ZENDESK", map[string]string{"signing_secret": "zd"}, `{"t":1}`, func(r *http.Request, b string) {
			r.Header.Set("X-Zendesk-Webhook-Signature-Timestamp", "2026-11-18T10:00:00Z")
			r.Header.Set("X-Zendesk-Webhook-Signature", b64(sign(sha256.New, []byte("zd"), "2026-11-18T10:00:00Z", b)))
		}},
		{"CASHFREE", map[string]string{"secret_key": "cf"}, `{"data":{}}`, func(r *http.Request, b string) {
			r.Header.Set("x-webhook-timestamp", now)
			r.Header.Set("x-webhook-signature", b64(sign(sha256.New, []byte("cf"), now, b)))
		}},
		{"CALENDLY", map[string]string{"signing_key": "cal"}, `{"event":"x"}`, func(r *http.Request, b string) {
			r.Header.Set("Calendly-Webhook-Signature", fmt.Sprintf("t=%s,v1=%s", now, hx(sign(sha256.New, []byte("cal"), now, ".", b))))
		}},
		{"TYPEFORM", map[string]string{"webhook_secret": "tf"}, `{"form":1}`, func(r *http.Request, b string) {
			r.Header.Set("Typeform-Signature", "sha256="+b64(sign(sha256.New, []byte("tf"), b)))
		}},
		{"INTERCOM", map[string]string{"client_secret": "ic"}, `{"topic":"x"}`, func(r *http.Request, b string) {
			r.Header.Set("X-Hub-Signature", "sha1="+hx(sign(sha1.New, []byte("ic"), b)))
		}},
		{"RAZORPAY", map[string]string{"webhook_secret": "rz"}, `{"event":"payment.captured"}`, func(r *http.Request, b string) {
			r.Header.Set("X-Razorpay-Signature", hx(sign(sha256.New, []byte("rz"), b)))
		}},
		{"GITLAB", map[string]string{"secret_token": "gl"}, `{}`, func(r *http.Request, _ string) {
			r.Header.Set("X-Gitlab-Token", "gl")
		}},
		{"POSTMARK", map[string]string{"username": "u", "password": "p"}, `{}`, func(r *http.Request, _ string) {
			r.SetBasicAuth("u", "p")
		}},
		{"PUBLISH_API", map[string]string{"api_key": "ewk_abc"}, `{}`, func(r *http.Request, _ string) {
			r.Header.Set("Authorization", "Bearer ewk_abc")
		}},
	}

	// Mailgun signs fields inside the body.
	mgTok := "tok123"
	mgSig := hx(sign(sha256.New, []byte("mg"), now, mgTok))
	cases = append(cases, tc{"MAILGUN", map[string]string{"signing_key": "mg"},
		fmt.Sprintf(`{"signature":{"timestamp":"%s","token":"%s","signature":"%s"}}`, now, mgTok, mgSig), func(*http.Request, string) {}})

	for _, c := range cases {
		t.Run(c.typ, func(t *testing.T) {
			typ, ok := Get(c.typ)
			if !ok {
				t.Fatalf("unknown type")
			}

			if !typ.Ready(c.cfg) {
				t.Fatalf("not ready with cfg %v", c.cfg)
			}

			r := httptest.NewRequest(http.MethodPost, "/e/x", strings.NewReader(c.body))
			c.prep(r, c.body)

			if err := typ.Verify(c.cfg, r, []byte(c.body)); err != nil {
				t.Fatalf("valid request rejected: %v", err)
			}

			// tampered body must fail (except token/basic-auth schemes that don't sign the body)
			if c.typ == "GITLAB" || c.typ == "POSTMARK" || c.typ == "PUBLISH_API" {
				bad := map[string]string{}
				for k, v := range c.cfg {
					bad[k] = v + "x"
				}

				if typ.Verify(bad, r, []byte(c.body)) == nil {
					t.Fatal("wrong secret accepted")
				}

				return
			}

			tampered := strings.Replace(c.body, "}", `,"x":1}`, 1)
			if c.typ == "MAILGUN" {
				tampered = strings.Replace(c.body, mgTok, "evil", 1)
			}

			if typ.Verify(c.cfg, r, []byte(tampered)) == nil {
				t.Fatal("tampered body accepted")
			}
		})
	}
}

func TestStripeRejectsOldTimestamp(t *testing.T) {
	old := strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10)
	body := `{"id":"evt"}`
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	r.Header.Set("Stripe-Signature", fmt.Sprintf("t=%s,v1=%s", old, hx(sign(sha256.New, []byte("k"), old, ".", body))))

	typ, _ := Get("STRIPE")
	if err := typ.Verify(map[string]string{"webhook_secret": "k"}, r, []byte(body)); err != ErrExpired {
		t.Fatalf("want ErrExpired, got %v", err)
	}
}

func TestHandshakes(t *testing.T) {
	fb, _ := Get("FACEBOOK")
	r := httptest.NewRequest(http.MethodGet, "/e/x?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345", nil)

	if resp := fb.Handshake(map[string]string{"verify_token": "vt"}, r, nil); resp == nil || resp.Body != "12345" || resp.Status != 200 {
		t.Fatalf("facebook challenge: %+v", resp)
	}

	if resp := fb.Handshake(map[string]string{"verify_token": "other"}, r, nil); resp == nil || resp.Status != 403 {
		t.Fatalf("facebook wrong token should 403: %+v", resp)
	}

	sl, _ := Get("SLACK")
	if resp := sl.Handshake(nil, r, []byte(`{"type":"url_verification","challenge":"abc"}`)); resp == nil || !strings.Contains(resp.Body, `"abc"`) {
		t.Fatalf("slack challenge: %+v", resp)
	}

	dc, _ := Get("DISCORD")
	if resp := dc.Handshake(nil, r, []byte(`{"type":1}`)); resp == nil || resp.Body != `{"type":1}` {
		t.Fatalf("discord ping: %+v", resp)
	}
}

func TestCatalogOrder(t *testing.T) {
	all := All()
	if all[0].ID != Webhook || all[1].ID != PublishAPI || all[2].ID != HTTP {
		t.Fatalf("generic types must come first, got %s %s %s", all[0].ID, all[1].ID, all[2].ID)
	}

	for _, ty := range all {
		if ty.Category == "provider" && (ty.Verify == nil || len(ty.Requires) == 0) {
			t.Errorf("%s: provider without verification", ty.ID)
		}
	}
}
