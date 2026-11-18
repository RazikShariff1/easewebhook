package handlers

import (
	"net/http"

	"gofr.dev/pkg/gofr"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/auth"
	"github.com/zopping/easewebhook/backend/internal/store"
)

// Workspace routes take the workspace from the path and check membership themselves;
// every other management route gets it from the X-Workspace-Id header via the auth middleware.
func (a *API) registerWorkspaces(app *gofr.App) {
	app.GET("/workspaces", a.listWorkspaces)
	app.POST("/workspaces", a.createWorkspace)
	app.GET("/workspaces/{id}", a.getWorkspace)
	app.PUT("/workspaces/{id}", a.renameWorkspace)
	app.DELETE("/workspaces/{id}", a.deleteWorkspace)
	app.GET("/workspaces/{id}/members", a.listMembers)
	app.POST("/workspaces/{id}/members", a.addMember)
	app.PUT("/workspaces/{id}/members/{user_id}", a.updateMember)
	app.DELETE("/workspaces/{id}/members/{user_id}", a.removeMember)
	app.DELETE("/workspaces/{id}/invites/{email}", a.deleteInvite)
}

var errOwnerOnly = apierr.Error{Status: http.StatusForbidden, Message: "only workspace owners can do this"}

func raw(c *gofr.Context) *store.Store { return store.New(c.SQL) }

// member checks the caller belongs to the path's workspace and returns their role.
func member(c *gofr.Context) (wsID, role string, err error) {
	wsID = c.PathParam("id")

	role, err = raw(c).MemberRole(c, wsID, auth.UserID(c))
	if err != nil {
		return "", "", mapErr(err, "workspace", wsID)
	}

	return wsID, role, nil
}

func owner(c *gofr.Context) (string, error) {
	wsID, role, err := member(c)
	if err != nil {
		return "", err
	}

	if role != store.RoleOwner {
		return "", errOwnerOnly
	}

	return wsID, nil
}

func (a *API) listWorkspaces(c *gofr.Context) (any, error) {
	return raw(c).ListWorkspaces(c, auth.UserID(c))
}

type nameInput struct {
	Name string `json:"name"`
}

func (a *API) createWorkspace(c *gofr.Context) (any, error) {
	var in nameInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	return raw(c).CreateWorkspace(c, auth.UserID(c), in.Name)
}

func (a *API) getWorkspace(c *gofr.Context) (any, error) {
	wsID, _, err := member(c)
	if err != nil {
		return nil, err
	}

	return raw(c).GetWorkspace(c, wsID, auth.UserID(c))
}

func (a *API) renameWorkspace(c *gofr.Context) (any, error) {
	wsID, err := owner(c)
	if err != nil {
		return nil, err
	}

	var in nameInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	return raw(c).RenameWorkspace(c, wsID, auth.UserID(c), in.Name)
}

func (a *API) deleteWorkspace(c *gofr.Context) (any, error) {
	wsID, err := owner(c)
	if err != nil {
		return nil, err
	}

	return nil, raw(c).DeleteWorkspace(c, wsID)
}

func (a *API) listMembers(c *gofr.Context) (any, error) {
	wsID, _, err := member(c)
	if err != nil {
		return nil, err
	}

	members, invites, err := raw(c).ListMembers(c, wsID)
	if err != nil {
		return nil, err
	}

	return map[string]any{"members": members, "invites": invites}, nil
}

type memberInput struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (a *API) addMember(c *gofr.Context) (any, error) {
	wsID, err := owner(c)
	if err != nil {
		return nil, err
	}

	var in memberInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	status, err := raw(c).AddMember(c, wsID, in.Email, in.Role, auth.UserID(c))
	if err != nil {
		return nil, err
	}

	return map[string]string{"status": status}, nil
}

func (a *API) updateMember(c *gofr.Context) (any, error) {
	wsID, err := owner(c)
	if err != nil {
		return nil, err
	}

	var in memberInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	uid := c.PathParam("user_id")

	return nil, mapErr(raw(c).UpdateMemberRole(c, wsID, uid, in.Role), "member", uid)
}

// removeMember: owners can remove anyone; any member can remove themselves (leave).
func (a *API) removeMember(c *gofr.Context) (any, error) {
	wsID, role, err := member(c)
	if err != nil {
		return nil, err
	}

	uid := c.PathParam("user_id")
	if uid != auth.UserID(c) && role != store.RoleOwner {
		return nil, errOwnerOnly
	}

	deleted, err := raw(c).RemoveMember(c, wsID, uid)
	if err != nil {
		return nil, mapErr(err, "member", uid)
	}

	return map[string]bool{"workspace_deleted": deleted}, nil
}

func (a *API) deleteInvite(c *gofr.Context) (any, error) {
	wsID, err := owner(c)
	if err != nil {
		return nil, err
	}

	email := c.PathParam("email")

	return nil, mapErr(raw(c).DeleteInvite(c, wsID, email), "invite", email)
}
