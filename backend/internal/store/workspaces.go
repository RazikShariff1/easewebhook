package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/ids"
)

const (
	RoleOwner  = "owner"
	RoleMember = "member"

	legacyWorkspaceID = "ws_default"
)

type Workspace struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Role        string    `json:"role"`
	MemberCount int       `json:"member_count"`
	CreatedAt   time.Time `json:"created_at"`
}

type Member struct {
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	AvatarURL *string   `json:"avatar_url"`
	Role      string    `json:"role"`
	JoinedAt  time.Time `json:"joined_at"`
}

type Invite struct {
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

func validRole(r string) bool { return r == RoleOwner || r == RoleMember }

const wsSelect = `SELECT w.id, w.name, m.role,
	(SELECT count(*) FROM workspace_members x WHERE x.workspace_id = w.id), w.created_at
	FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id`

func scanWorkspace(s scanner) (*Workspace, error) {
	var w Workspace
	if err := s.Scan(&w.ID, &w.Name, &w.Role, &w.MemberCount, &w.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}

		return nil, err
	}

	return &w, nil
}

// ListWorkspaces returns the workspaces a user belongs to, oldest first.
func (s *Store) ListWorkspaces(ctx context.Context, userID string) ([]Workspace, error) {
	rows, err := s.db.QueryContext(ctx, wsSelect+` WHERE m.user_id = $1 ORDER BY w.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Workspace{}

	for rows.Next() {
		w, err := scanWorkspace(rows)
		if err != nil {
			return nil, err
		}

		out = append(out, *w)
	}

	return out, rows.Err()
}

func (s *Store) GetWorkspace(ctx context.Context, wsID, userID string) (*Workspace, error) {
	return scanWorkspace(s.db.QueryRowContext(ctx, wsSelect+` WHERE w.id = $1 AND m.user_id = $2`, wsID, userID))
}

// MemberRole returns the user's role in a workspace, or ErrNotFound if they aren't a member.
func (s *Store) MemberRole(ctx context.Context, wsID, userID string) (string, error) {
	var role string

	err := s.db.QueryRowContext(ctx, `SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,
		wsID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}

	return role, err
}

func (s *Store) CreateWorkspace(ctx context.Context, userID, name string) (*Workspace, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, apierr.BadRequest("workspace name is required")
	}

	id := ids.New("ws")

	if _, err := s.db.ExecContext(ctx, `INSERT INTO workspaces (id, name) VALUES ($1, $2)`, id, name); err != nil {
		return nil, err
	}

	if _, err := s.db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
		id, userID); err != nil {
		return nil, err
	}

	return s.GetWorkspace(ctx, id, userID)
}

func (s *Store) RenameWorkspace(ctx context.Context, wsID, userID, name string) (*Workspace, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, apierr.BadRequest("workspace name is required")
	}

	if err := execOne(ctx, s.db, `UPDATE workspaces SET name=$2, updated_at=now() WHERE id=$1`, wsID, name); err != nil {
		return nil, err
	}

	return s.GetWorkspace(ctx, wsID, userID)
}

// DeleteWorkspace removes a workspace and everything in it (sources, connections, events...).
func (s *Store) DeleteWorkspace(ctx context.Context, wsID string) error {
	return execOne(ctx, s.db, `DELETE FROM workspaces WHERE id=$1`, wsID)
}

func (s *Store) ListMembers(ctx context.Context, wsID string) ([]Member, []Invite, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT u.id, u.email, u.name, u.avatar_url, m.role, m.created_at
		FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1
		ORDER BY m.role = 'owner' DESC, m.created_at`, wsID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	members := []Member{}

	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Email, &m.Name, &m.AvatarURL, &m.Role, &m.JoinedAt); err != nil {
			return nil, nil, err
		}

		members = append(members, m)
	}

	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	irows, err := s.db.QueryContext(ctx, `SELECT email, role, created_at FROM workspace_invites
		WHERE workspace_id = $1 ORDER BY created_at`, wsID)
	if err != nil {
		return nil, nil, err
	}
	defer irows.Close()

	invites := []Invite{}

	for irows.Next() {
		var i Invite
		if err := irows.Scan(&i.Email, &i.Role, &i.CreatedAt); err != nil {
			return nil, nil, err
		}

		invites = append(invites, i)
	}

	return members, invites, irows.Err()
}

// AddMember adds an existing user by email, or records an invite that is accepted when they sign up.
// Returns "added" or "invited".
func (s *Store) AddMember(ctx context.Context, wsID, email, role, invitedBy string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") {
		return "", apierr.BadRequest("enter a valid email address")
	}

	if role == "" {
		role = RoleMember
	}

	if !validRole(role) {
		return "", apierr.BadRequest("role must be owner or member")
	}

	var userID string

	err := s.db.QueryRowContext(ctx, `SELECT id FROM users WHERE email=$1`, email).Scan(&userID)

	switch {
	case errors.Is(err, sql.ErrNoRows):
		_, err = s.db.ExecContext(ctx, `INSERT INTO workspace_invites (workspace_id, email, role, invited_by)
			VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role`,
			wsID, email, role, invitedBy)

		return "invited", err
	case err != nil:
		return "", err
	}

	if _, err := s.MemberRole(ctx, wsID, userID); err == nil {
		return "", apierr.Conflict("%s is already a member", email)
	}

	_, err = s.db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)`,
		wsID, userID, role)

	return "added", err
}

func (s *Store) countOwners(ctx context.Context, wsID string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM workspace_members WHERE workspace_id=$1 AND role='owner'`, wsID).Scan(&n)

	return n, err
}

func (s *Store) UpdateMemberRole(ctx context.Context, wsID, userID, role string) error {
	if !validRole(role) {
		return apierr.BadRequest("role must be owner or member")
	}

	cur, err := s.MemberRole(ctx, wsID, userID)
	if err != nil {
		return err
	}

	if cur == RoleOwner && role != RoleOwner {
		if n, err := s.countOwners(ctx, wsID); err != nil {
			return err
		} else if n <= 1 {
			return apierr.Conflict("a workspace needs at least one owner — make someone else an owner first")
		}
	}

	_, err = s.db.ExecContext(ctx, `UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2`, wsID, userID, role)

	return err
}

// RemoveMember removes a member (or lets a member leave). The last owner can't leave while others remain;
// if they are the only member, the workspace is deleted.
func (s *Store) RemoveMember(ctx context.Context, wsID, userID string) (deleted bool, err error) {
	role, err := s.MemberRole(ctx, wsID, userID)
	if err != nil {
		return false, err
	}

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM workspace_members WHERE workspace_id=$1`, wsID).Scan(&total); err != nil {
		return false, err
	}

	if total == 1 {
		return true, s.DeleteWorkspace(ctx, wsID)
	}

	if role == RoleOwner {
		if n, err := s.countOwners(ctx, wsID); err != nil {
			return false, err
		} else if n <= 1 {
			return false, apierr.Conflict("the last owner can't leave — make someone else an owner first")
		}
	}

	return false, execOne(ctx, s.db, `DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, wsID, userID)
}

func (s *Store) DeleteInvite(ctx context.Context, wsID, email string) error {
	return execOne(ctx, s.db, `DELETE FROM workspace_invites WHERE workspace_id=$1 AND email=$2`,
		wsID, strings.ToLower(strings.TrimSpace(email)))
}

// OnboardUser runs at every sign-in: it accepts pending invites, hands the pre-workspaces "Default"
// workspace to the first user if nobody owns it, and makes sure the user has at least one workspace.
func (s *Store) OnboardUser(ctx context.Context, userID, email, name string) error {
	email = strings.ToLower(email)

	if _, err := s.db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role)
		SELECT workspace_id, $1, role FROM workspace_invites WHERE email = $2
		ON CONFLICT DO NOTHING`, userID, email); err != nil {
		return err
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM workspace_invites WHERE email = $1`, email); err != nil {
		return err
	}

	if _, err := s.db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role)
		SELECT id, $1, 'owner' FROM workspaces w WHERE w.id = $2
		AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id)`, userID, legacyWorkspaceID); err != nil {
		return err
	}

	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM workspace_members WHERE user_id=$1`, userID).Scan(&n); err != nil {
		return err
	}

	if n > 0 {
		return nil
	}

	label := strings.TrimSpace(name)
	if label == "" {
		label = strings.Split(email, "@")[0]
	}

	_, err := s.CreateWorkspace(ctx, userID, label+"'s workspace")

	return err
}
