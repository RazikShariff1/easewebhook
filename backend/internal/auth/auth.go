// Package auth handles users, email/password and Google sign-in, and JWT sessions.
package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/ids"
)

const (
	userPrefix = "usr"
	sessionTTL = 7 * 24 * time.Hour
)

type User struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	Name        string     `json:"name"`
	AvatarURL   *string    `json:"avatar_url"`
	HasPassword bool       `json:"has_password"`
	HasGoogle   bool       `json:"has_google"`
	CreatedAt   time.Time  `json:"created_at"`
	LastLoginAt *time.Time `json:"last_login_at"`

	passwordHash *string
}

// Session is returned by every successful sign-in.
type Session struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	User      *User     `json:"user"`
}

type DB interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type Service struct {
	Secret         []byte
	GoogleClientID string
	HTTP           *http.Client
	MockURL        string // built-in Mock API destination, advertised to the frontend

	// MemberRole reports a user's role in a workspace (error if not a member).
	MemberRole func(ctx context.Context, workspaceID, userID string) (string, error)
	// Onboard runs on every sign-in: accept invites, ensure the user has a workspace.
	Onboard func(ctx context.Context, userID, email, name string) error
	// Pool, when set, is used for user queries instead of GoFr's connection (see store.OpenPool).
	Pool DB
}

func (s *Service) db(fallback DB) DB {
	if s.Pool != nil {
		return s.Pool
	}

	return fallback
}

var errUnauthorized = apierr.Error{Status: http.StatusUnauthorized, Message: "invalid email or password"}

const userCols = `id, email, name, avatar_url, password_hash, google_sub IS NOT NULL, created_at, last_login_at`

func scanUser(r *sql.Row) (*User, error) {
	var u User
	if err := r.Scan(&u.ID, &u.Email, &u.Name, &u.AvatarURL, &u.passwordHash, &u.HasGoogle, &u.CreatedAt, &u.LastLoginAt); err != nil {
		return nil, err
	}

	u.HasPassword = u.passwordHash != nil

	return &u, nil
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

// Signup creates an email/password account.
func (s *Service) Signup(ctx context.Context, db DB, name, email, password string) (*Session, error) {
	email = normEmail(email)
	name = strings.TrimSpace(name)

	if !strings.Contains(email, "@") || len(email) < 5 {
		return nil, apierr.BadRequest("enter a valid email address")
	}

	if len(password) < 8 {
		return nil, apierr.BadRequest("password must be at least 8 characters")
	}

	if name == "" {
		name = strings.Split(email, "@")[0]
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	u, err := scanUser(db.QueryRowContext(ctx, `INSERT INTO users (id, email, name, password_hash, last_login_at)
		VALUES ($1,$2,$3,$4,now()) RETURNING `+userCols, ids.New(userPrefix), email, name, string(hash)))
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return nil, apierr.Conflict("an account with this email already exists — log in instead")
		}

		return nil, err
	}

	return s.start(ctx, u)
}

// Login checks email/password.
func (s *Service) Login(ctx context.Context, db DB, email, password string) (*Session, error) {
	u, err := scanUser(db.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE email=$1`, normEmail(email)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errUnauthorized
	}

	if err != nil {
		return nil, err
	}

	if u.passwordHash == nil {
		return nil, apierr.Error{Status: http.StatusUnauthorized, Message: "this account uses Google sign-in — continue with Google"}
	}

	if bcrypt.CompareHashAndPassword([]byte(*u.passwordHash), []byte(password)) != nil {
		return nil, errUnauthorized
	}

	_, _ = db.ExecContext(ctx, `UPDATE users SET last_login_at=now() WHERE id=$1`, u.ID)

	return s.start(ctx, u)
}

type googleClaims struct {
	Aud           string `json:"aud"`
	Iss           string `json:"iss"`
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	Exp           string `json:"exp"`
}

// Google signs in (or signs up) with a Google Identity Services ID token.
// The token is verified by Google's tokeninfo endpoint and must be issued for our client ID.
func (s *Service) Google(ctx context.Context, db DB, credential string) (*Session, error) {
	if s.GoogleClientID == "" {
		return nil, apierr.Error{Status: http.StatusServiceUnavailable, Message: "Google sign-in is not configured (GOOGLE_CLIENT_ID)"}
	}

	if credential == "" {
		return nil, apierr.BadRequest("credential is required")
	}

	c, err := s.verifyGoogle(ctx, credential)
	if err != nil {
		return nil, err
	}

	email := normEmail(c.Email)

	// Existing account by Google subject, else link by verified email, else create.
	u, err := scanUser(db.QueryRowContext(ctx, `UPDATE users SET last_login_at=now(),
			avatar_url=COALESCE(NULLIF($2,''), avatar_url)
		WHERE google_sub=$1 RETURNING `+userCols, c.Sub, c.Picture))
	if errors.Is(err, sql.ErrNoRows) {
		u, err = scanUser(db.QueryRowContext(ctx, `UPDATE users SET google_sub=$1, last_login_at=now(),
				avatar_url=COALESCE(avatar_url, NULLIF($3,'')), name=CASE WHEN name='' THEN $4 ELSE name END
			WHERE email=$2 RETURNING `+userCols, c.Sub, email, c.Picture, c.Name))
	}

	if errors.Is(err, sql.ErrNoRows) {
		name := c.Name
		if name == "" {
			name = strings.Split(email, "@")[0]
		}

		u, err = scanUser(db.QueryRowContext(ctx, `INSERT INTO users (id, email, name, avatar_url, google_sub, last_login_at)
			VALUES ($1,$2,$3,NULLIF($4,''),$5,now()) RETURNING `+userCols, ids.New(userPrefix), email, name, c.Picture, c.Sub))
	}

	if err != nil {
		return nil, err
	}

	return s.start(ctx, u)
}

// start onboards the user (invites, first workspace) and issues a session.
func (s *Service) start(ctx context.Context, u *User) (*Session, error) {
	if s.Onboard != nil {
		if err := s.Onboard(ctx, u.ID, u.Email, u.Name); err != nil {
			return nil, fmt.Errorf("setting up workspace: %w", err)
		}
	}

	return s.issue(u)
}

func (s *Service) verifyGoogle(ctx context.Context, credential string) (*googleClaims, error) {
	invalid := apierr.Error{Status: http.StatusUnauthorized, Message: "Google sign-in failed — please try again"}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://oauth2.googleapis.com/tokeninfo?id_token="+url.QueryEscape(credential), http.NoBody)
	if err != nil {
		return nil, err
	}

	client := s.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("contacting Google: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, invalid
	}

	var c googleClaims
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		return nil, invalid
	}

	if c.Aud != s.GoogleClientID ||
		(c.Iss != "accounts.google.com" && c.Iss != "https://accounts.google.com") ||
		c.Sub == "" || c.Email == "" {
		return nil, invalid
	}

	if c.EmailVerified != "true" {
		return nil, apierr.Error{Status: http.StatusUnauthorized, Message: "your Google email address is not verified"}
	}

	return &c, nil
}

// Me loads the user for a verified token subject.
func (s *Service) Me(ctx context.Context, db DB, userID string) (*User, error) {
	u, err := scanUser(db.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE id=$1`, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apierr.Error{Status: http.StatusUnauthorized, Message: "session expired — log in again"}
	}

	return u, err
}

func (s *Service) issue(u *User) (*Session, error) {
	exp := time.Now().Add(sessionTTL)

	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   u.ID,
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(exp),
		Issuer:    "easewebhook",
	}).SignedString(s.Secret)
	if err != nil {
		return nil, err
	}

	return &Session{Token: tok, ExpiresAt: exp, User: u}, nil
}

// Verify parses a session token and returns the user ID.
func (s *Service) Verify(token string) (string, error) {
	claims := &jwt.RegisteredClaims{}

	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}

		return s.Secret, nil
	}, jwt.WithIssuer("easewebhook"), jwt.WithExpirationRequired())
	if err != nil {
		return "", err
	}

	return claims.Subject, nil
}
