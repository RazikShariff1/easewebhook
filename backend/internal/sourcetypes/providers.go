package sourcetypes

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha1" //nolint:gosec // several providers still sign with HMAC-SHA1
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"hash"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const tolerance = 5 * time.Minute

// ---------- helpers ----------

func mac(h func() hash.Hash, key []byte, parts ...string) []byte {
	m := hmac.New(h, key)
	for _, p := range parts {
		m.Write([]byte(p))
	}

	return m.Sum(nil)
}

func eqHex(got string, sum []byte) bool {
	g, err := hex.DecodeString(strings.TrimSpace(strings.ToLower(got)))
	return err == nil && hmac.Equal(g, sum)
}

func eqB64(got string, sum []byte) bool {
	g, err := base64.StdEncoding.DecodeString(strings.TrimSpace(got))
	return err == nil && hmac.Equal(g, sum)
}

func fresh(ts string) error {
	n, err := strconv.ParseInt(strings.TrimSpace(ts), 10, 64)
	if err != nil {
		return ErrBadSignature
	}

	if n > 1e12 { // milliseconds
		n /= 1000
	}

	d := time.Since(time.Unix(n, 0))
	if d > tolerance || d < -tolerance {
		return ErrExpired
	}

	return nil
}

// kv parses "a=1,b=2" style headers (sep "," or ";"); repeated keys are collected.
func kv(header, sep string) map[string][]string {
	out := map[string][]string{}

	for _, part := range strings.Split(header, sep) {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok {
			out[k] = append(out[k], v)
		}
	}

	return out
}

func header(r *http.Request, name string) (string, error) {
	v := r.Header.Get(name)
	if v == "" {
		return "", ErrMissingSignature
	}

	return v, nil
}

// simpleHMAC: signature header = [prefix] + encode(HMAC(secret, body)).
func simpleHMAC(name, prefix string, h func() hash.Hash, b64 bool, secretKey string) func(map[string]string, *http.Request, []byte) error {
	return func(cfg map[string]string, r *http.Request, body []byte) error {
		v, err := header(r, name)
		if err != nil {
			return err
		}

		v = strings.TrimPrefix(strings.TrimSpace(v), prefix)
		sum := mac(h, []byte(cfg[secretKey]), string(body))

		if (b64 && eqB64(v, sum)) || (!b64 && eqHex(v, sum)) {
			return nil
		}

		return ErrBadSignature
	}
}

func secretField(key, label, help string) Field {
	return Field{Key: key, Label: label, Secret: true, Help: help}
}

func provider(id, name, icon, docs string, fields []Field, verify func(map[string]string, *http.Request, []byte) error) *Type {
	req := make([]string, 0, len(fields))
	for _, f := range fields {
		req = append(req, f.Key)
	}

	return &Type{ID: id, Name: name, Category: "provider", Icon: icon, DocsURL: docs, Fields: fields, Verify: verify, Requires: req}
}

// ---------- verifiers with timestamps / special formats ----------

func verifyPublishKey(cfg map[string]string, r *http.Request, _ []byte) error {
	got := r.Header.Get("X-Api-Key")
	if b, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		got = b
	}

	if got == "" {
		return ErrMissingSignature
	}

	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(got)), []byte(cfg["api_key"])) != 1 {
		return ErrBadSignature
	}

	return nil
}

// Stripe-Signature: t=<ts>,v1=<hex>[,v1=...]; HMAC-SHA256(secret, "<ts>.<body>")
func verifyStripe(cfg map[string]string, r *http.Request, body []byte) error {
	return verifyTV(r, "Stripe-Signature", ",", "t", "v1", ".", cfg["webhook_secret"], body)
}

// Calendly-Webhook-Signature uses Stripe's format.
func verifyCalendly(cfg map[string]string, r *http.Request, body []byte) error {
	return verifyTV(r, "Calendly-Webhook-Signature", ",", "t", "v1", ".", cfg["signing_key"], body)
}

// Paddle-Signature: ts=<ts>;h1=<hex>; HMAC-SHA256(secret, "<ts>:<body>")
func verifyPaddle(cfg map[string]string, r *http.Request, body []byte) error {
	return verifyTV(r, "Paddle-Signature", ";", "ts", "h1", ":", cfg["secret_key"], body)
}

func verifyTV(r *http.Request, name, sep, tsKey, sigKey, join, secret string, body []byte) error {
	v, err := header(r, name)
	if err != nil {
		return err
	}

	p := kv(v, sep)
	if len(p[tsKey]) == 0 || len(p[sigKey]) == 0 {
		return ErrBadSignature
	}

	ts := p[tsKey][0]
	sum := mac(sha256.New, []byte(secret), ts, join, string(body))

	for _, s := range p[sigKey] {
		if eqHex(s, sum) {
			return fresh(ts)
		}
	}

	return ErrBadSignature
}

// Slack: X-Slack-Signature: v0=hex(HMAC-SHA256(secret, "v0:<ts>:<body>")), X-Slack-Request-Timestamp
func verifySlack(cfg map[string]string, r *http.Request, body []byte) error {
	sig, err := header(r, "X-Slack-Signature")
	if err != nil {
		return err
	}

	ts := r.Header.Get("X-Slack-Request-Timestamp")
	if !eqHex(strings.TrimPrefix(sig, "v0="), mac(sha256.New, []byte(cfg["signing_secret"]), "v0:", ts, ":", string(body))) {
		return ErrBadSignature
	}

	return fresh(ts)
}

// Standard Webhooks / Svix: webhook-id, webhook-timestamp, webhook-signature: "v1,<b64> v1,<b64>";
// key = base64-decoded secret after "whsec_"; HMAC-SHA256(key, "<id>.<ts>.<body>").
func verifyStandard(cfg map[string]string, r *http.Request, body []byte) error {
	get := func(n string) string {
		if v := r.Header.Get("webhook-" + n); v != "" {
			return v
		}

		return r.Header.Get("svix-" + n)
	}

	id, ts, sigs := get("id"), get("timestamp"), get("signature")
	if sigs == "" {
		return ErrMissingSignature
	}

	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(strings.TrimSpace(cfg["signing_secret"]), "whsec_"))
	if err != nil {
		return ErrBadSignature
	}

	sum := mac(sha256.New, key, id, ".", ts, ".", string(body))

	for _, s := range strings.Fields(sigs) {
		if v, ok := strings.CutPrefix(s, "v1,"); ok && eqB64(v, sum) {
			return fresh(ts)
		}
	}

	return ErrBadSignature
}

// Zendesk: X-Zendesk-Webhook-Signature = b64(HMAC-SHA256(secret, ts + body)), ts in ...-Timestamp.
func verifyZendesk(cfg map[string]string, r *http.Request, body []byte) error {
	sig, err := header(r, "X-Zendesk-Webhook-Signature")
	if err != nil {
		return err
	}

	ts := r.Header.Get("X-Zendesk-Webhook-Signature-Timestamp")
	if !eqB64(sig, mac(sha256.New, []byte(cfg["signing_secret"]), ts, string(body))) {
		return ErrBadSignature
	}

	return nil
}

// Cashfree: x-webhook-signature = b64(HMAC-SHA256(secret, ts + body)), x-webhook-timestamp.
func verifyCashfree(cfg map[string]string, r *http.Request, body []byte) error {
	sig, err := header(r, "x-webhook-signature")
	if err != nil {
		return err
	}

	ts := r.Header.Get("x-webhook-timestamp")
	if !eqB64(sig, mac(sha256.New, []byte(cfg["secret_key"]), ts, string(body))) {
		return ErrBadSignature
	}

	return nil
}

// Twitch EventSub: Twitch-Eventsub-Message-Signature: sha256=hex(HMAC(secret, id + ts + body)).
func verifyTwitch(cfg map[string]string, r *http.Request, body []byte) error {
	sig, err := header(r, "Twitch-Eventsub-Message-Signature")
	if err != nil {
		return err
	}

	id := r.Header.Get("Twitch-Eventsub-Message-Id")
	ts := r.Header.Get("Twitch-Eventsub-Message-Timestamp")

	if !eqHex(strings.TrimPrefix(sig, "sha256="), mac(sha256.New, []byte(cfg["secret"]), id, ts, string(body))) {
		return ErrBadSignature
	}

	return nil
}

// Discord interactions: Ed25519 over timestamp + body with the application public key.
func verifyDiscord(cfg map[string]string, r *http.Request, body []byte) error {
	sig, err := header(r, "X-Signature-Ed25519")
	if err != nil {
		return err
	}

	pub, err1 := hex.DecodeString(strings.TrimSpace(cfg["public_key"]))
	s, err2 := hex.DecodeString(sig)

	if err1 != nil || err2 != nil || len(pub) != ed25519.PublicKeySize {
		return ErrBadSignature
	}

	msg := append([]byte(r.Header.Get("X-Signature-Timestamp")), body...)
	if !ed25519.Verify(pub, msg, s) {
		return ErrBadSignature
	}

	return nil
}

// Mailgun: signature fields inside the JSON body; hex(HMAC-SHA256(key, timestamp + token)).
func verifyMailgun(cfg map[string]string, _ *http.Request, body []byte) error {
	var p struct {
		Signature struct {
			Timestamp string `json:"timestamp"`
			Token     string `json:"token"`
			Signature string `json:"signature"`
		} `json:"signature"`
	}

	if json.Unmarshal(body, &p) != nil || p.Signature.Signature == "" {
		return ErrMissingSignature
	}

	if !eqHex(p.Signature.Signature, mac(sha256.New, []byte(cfg["signing_key"]), p.Signature.Timestamp, p.Signature.Token)) {
		return ErrBadSignature
	}

	return fresh(p.Signature.Timestamp)
}

// Meta (Facebook, Instagram, WhatsApp): X-Hub-Signature-256 on POST; GET is the subscription handshake.
func verifyMeta(cfg map[string]string, r *http.Request, body []byte) error {
	if r.Method == http.MethodGet {
		return nil // checked by the handshake via verify_token
	}

	return simpleHMAC("X-Hub-Signature-256", "sha256=", sha256.New, false, "app_secret")(cfg, r, body)
}

func tokenHeader(name, key string) func(map[string]string, *http.Request, []byte) error {
	return func(cfg map[string]string, r *http.Request, _ []byte) error {
		v, err := header(r, name)
		if err != nil {
			return err
		}

		if subtle.ConstantTimeCompare([]byte(v), []byte(cfg[key])) != 1 {
			return ErrBadSignature
		}

		return nil
	}
}

func basicAuth(cfg map[string]string, r *http.Request, _ []byte) error {
	u, p, ok := r.BasicAuth()
	if !ok {
		return ErrMissingSignature
	}

	if subtle.ConstantTimeCompare([]byte(u), []byte(cfg["username"])) != 1 ||
		subtle.ConstantTimeCompare([]byte(p), []byte(cfg["password"])) != 1 {
		return ErrBadSignature
	}

	return nil
}

// ---------- handshakes ----------

func metaHandshake(cfg map[string]string, r *http.Request, _ []byte) *Response {
	if r.Method != http.MethodGet || r.URL.Query().Get("hub.mode") != "subscribe" {
		return nil
	}

	q := r.URL.Query()
	if cfg["verify_token"] == "" || subtle.ConstantTimeCompare([]byte(q.Get("hub.verify_token")), []byte(cfg["verify_token"])) != 1 {
		return &Response{Status: http.StatusForbidden, ContentType: "text/plain", Body: "verify token mismatch"}
	}

	return &Response{Status: http.StatusOK, ContentType: "text/plain", Body: q.Get("hub.challenge")}
}

func slackHandshake(_ map[string]string, _ *http.Request, body []byte) *Response {
	var p struct{ Type, Challenge string }
	if json.Unmarshal(body, &p) == nil && p.Type == "url_verification" {
		b, _ := json.Marshal(map[string]string{"challenge": p.Challenge})
		return &Response{Status: http.StatusOK, ContentType: "application/json", Body: string(b)}
	}

	return nil
}

func discordHandshake(_ map[string]string, _ *http.Request, body []byte) *Response {
	var p struct{ Type int }
	if json.Unmarshal(body, &p) == nil && p.Type == 1 { // PING
		return &Response{Status: http.StatusOK, ContentType: "application/json", Body: `{"type":1}`}
	}

	return nil
}

func twitchHandshake(_ map[string]string, r *http.Request, body []byte) *Response {
	if r.Header.Get("Twitch-Eventsub-Message-Type") != "webhook_callback_verification" {
		return nil
	}

	var p struct{ Challenge string }
	_ = json.Unmarshal(body, &p)

	return &Response{Status: http.StatusOK, ContentType: "text/plain", Body: p.Challenge}
}

// ---------- catalog ----------

func registerProviders() {
	ws := func(label string) []Field { return []Field{secretField("webhook_secret", label, "")} }

	add := func(t *Type, mutate ...func(*Type)) {
		for _, m := range mutate {
			m(t)
		}

		register(t)
	}

	metaFields := []Field{
		secretField("app_secret", "App secret", "Meta app dashboard → App settings → Basic."),
		{Key: "verify_token", Label: "Verify token", Help: "Any string; enter the same value in Meta's webhook setup."},
	}
	withHandshake := func(h func(map[string]string, *http.Request, []byte) *Response, methods ...string) func(*Type) {
		return func(t *Type) {
			t.Handshake = h
			if len(methods) > 0 {
				t.Methods = methods
			}
		}
	}
	notRequired := func(keys ...string) func(*Type) { // fields that don't gate signature checks
		return func(t *Type) {
			out := t.Requires[:0]

			for _, k := range t.Requires {
				skip := false

				for _, x := range keys {
					skip = skip || k == x
				}

				if !skip {
					out = append(out, k)
				}
			}

			t.Requires = out
		}
	}

	add(provider("STRIPE", "Stripe", "stripe", "https://docs.stripe.com/webhooks#verify-events",
		[]Field{secretField("webhook_secret", "Signing secret", "Starts with whsec_ — Developers → Webhooks → endpoint.")}, verifyStripe))
	add(provider("GITHUB", "GitHub", "github", "https://docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries",
		ws("Webhook secret"), simpleHMAC("X-Hub-Signature-256", "sha256=", sha256.New, false, "webhook_secret")))
	add(provider("SHOPIFY", "Shopify", "shopify", "https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-2-validate-the-origin-of-your-webhook-to-ensure-its-coming-from-shopify",
		[]Field{secretField("api_secret", "Client secret", "App's client secret (or the webhook signing key shown under Notifications).")},
		simpleHMAC("X-Shopify-Hmac-Sha256", "", sha256.New, true, "api_secret")))
	add(provider("PADDLE", "Paddle", "paddle", "https://developer.paddle.com/webhooks/signature-verification",
		[]Field{secretField("secret_key", "Secret key", "Notification destination's secret key (pdl_ntfset_...).")}, verifyPaddle))
	add(provider("RAZORPAY", "Razorpay", "razorpay", "https://razorpay.com/docs/webhooks/validate-test/",
		ws("Webhook secret"), simpleHMAC("X-Razorpay-Signature", "", sha256.New, false, "webhook_secret")))
	add(provider("CASHFREE", "Cashfree", "cashfree", "https://www.cashfree.com/docs/payments/online/webhooks/signature-verification",
		[]Field{secretField("secret_key", "Client secret", "")}, verifyCashfree))
	add(provider("FACEBOOK", "Facebook", "facebook", "https://developers.facebook.com/docs/graph-api/webhooks/getting-started",
		metaFields, verifyMeta), withHandshake(metaHandshake, "GET", "POST"), notRequired("verify_token"))
	add(provider("INSTAGRAM", "Instagram", "instagram", "https://developers.facebook.com/docs/instagram-platform/webhooks",
		metaFields, verifyMeta), withHandshake(metaHandshake, "GET", "POST"), notRequired("verify_token"))
	add(provider("WHATSAPP", "WhatsApp", "whatsapp", "https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks",
		metaFields, verifyMeta), withHandshake(metaHandshake, "GET", "POST"), notRequired("verify_token"))
	add(provider("SLACK", "Slack", "slack", "https://api.slack.com/authentication/verifying-requests-from-slack",
		[]Field{secretField("signing_secret", "Signing secret", "App → Basic Information → App Credentials.")}, verifySlack),
		withHandshake(slackHandshake))
	add(provider("DISCORD", "Discord", "discord", "https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint-validating-security-request-headers",
		[]Field{{Key: "public_key", Label: "Application public key", Help: "Hex key from the Developer Portal → General Information."}}, verifyDiscord),
		withHandshake(discordHandshake))
	add(provider("TWITCH", "Twitch", "twitch", "https://dev.twitch.tv/docs/eventsub/handling-webhook-events/#verifying-the-event-message",
		[]Field{secretField("secret", "Subscription secret", "The secret you passed when creating the EventSub subscription.")}, verifyTwitch),
		withHandshake(twitchHandshake))
	add(provider("CLERK", "Clerk", "clerk", "https://clerk.com/docs/webhooks/sync-data",
		[]Field{secretField("signing_secret", "Signing secret", "Starts with whsec_.")}, verifyStandard))
	add(provider("RESEND", "Resend", "resend", "https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests",
		[]Field{secretField("signing_secret", "Signing secret", "Starts with whsec_.")}, verifyStandard))
	add(provider("STANDARD_WEBHOOKS", "Standard Webhooks / Svix", "svix", "https://www.standardwebhooks.com/",
		[]Field{secretField("signing_secret", "Signing secret", "Starts with whsec_. Works for any sender using Svix or the Standard Webhooks spec.")}, verifyStandard))
	add(provider("ZENDESK", "Zendesk", "zendesk", "https://developer.zendesk.com/documentation/webhooks/verifying/",
		[]Field{secretField("signing_secret", "Signing secret", "")}, verifyZendesk))
	add(provider("TYPEFORM", "Typeform", "typeform", "https://www.typeform.com/developers/webhooks/secure-your-webhooks/",
		ws("Secret"), simpleHMAC("Typeform-Signature", "sha256=", sha256.New, true, "webhook_secret")))
	add(provider("SEGMENT", "Segment", "segment", "https://segment.com/docs/connections/destinations/catalog/webhooks/#authentication",
		[]Field{secretField("shared_secret", "Shared secret", "")}, simpleHMAC("X-Signature", "", sha1.New, false, "shared_secret")))
	add(provider("LINEAR", "Linear", "linear", "https://linear.app/developers/webhooks#securing-webhooks",
		ws("Signing secret"), simpleHMAC("Linear-Signature", "", sha256.New, false, "webhook_secret")))
	add(provider("GITLAB", "GitLab", "gitlab", "https://docs.gitlab.com/user/project/integrations/webhooks/#validate-requests-with-a-secret-token",
		[]Field{secretField("secret_token", "Secret token", "")}, tokenHeader("X-Gitlab-Token", "secret_token")))
	add(provider("BITBUCKET", "Bitbucket", "bitbucket", "https://support.atlassian.com/bitbucket-cloud/docs/manage-webhooks/#Secure-webhooks",
		ws("Secret"), simpleHMAC("X-Hub-Signature", "sha256=", sha256.New, false, "webhook_secret")))
	add(provider("WOOCOMMERCE", "WooCommerce", "woocommerce", "https://woocommerce.com/document/webhooks/",
		ws("Secret"), simpleHMAC("X-WC-Webhook-Signature", "", sha256.New, true, "webhook_secret")))
	add(provider("MAILGUN", "Mailgun", "mailgun", "https://documentation.mailgun.com/docs/mailgun/user-manual/tracking-messages/#securing-webhooks",
		[]Field{secretField("signing_key", "HTTP webhook signing key", "")}, verifyMailgun))
	add(provider("INTERCOM", "Intercom", "intercom", "https://developers.intercom.com/docs/webhooks/setting-up-webhooks#signed-notifications",
		[]Field{secretField("client_secret", "Client secret", "")}, simpleHMAC("X-Hub-Signature", "sha1=", sha1.New, false, "client_secret")))
	add(provider("CALENDLY", "Calendly", "calendly", "https://developer.calendly.com/api-docs/4c305798a61d3-webhook-signatures",
		[]Field{secretField("signing_key", "Signing key", "")}, verifyCalendly))
	add(provider("VERCEL", "Vercel", "vercel", "https://vercel.com/docs/webhooks/webhooks-api#securing-webhooks",
		ws("Secret"), simpleHMAC("x-vercel-signature", "", sha1.New, false, "webhook_secret")))
	add(provider("SENTRY", "Sentry", "sentry", "https://docs.sentry.io/organization/integrations/integration-platform/webhooks/#sentry-hook-signature",
		[]Field{secretField("client_secret", "Client secret", "")}, simpleHMAC("Sentry-Hook-Signature", "", sha256.New, false, "client_secret")))
	add(provider("CALCOM", "Cal.com", "caldotcom", "https://cal.com/docs/developing/guides/automation/webhooks#adding-a-custom-payload-template",
		ws("Secret"), simpleHMAC("X-Cal-Signature-256", "", sha256.New, false, "webhook_secret")))
	add(provider("POSTMARK", "Postmark", "postmark", "https://postmarkapp.com/support/article/1188-is-there-a-way-to-secure-webhooks",
		[]Field{{Key: "username", Label: "Basic auth username"}, secretField("password", "Basic auth password", "Put both in the webhook URL as https://user:pass@...")}, basicAuth))
	add(provider("PIPEDRIVE", "Pipedrive", "pipedrive", "https://pipedrive.readme.io/docs/guide-for-webhooks",
		[]Field{{Key: "username", Label: "HTTP auth username"}, secretField("password", "HTTP auth password", "")}, basicAuth))
}
