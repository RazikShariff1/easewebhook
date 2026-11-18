package auth

import (
	"strings"
	"sync"
	"time"
)

// memberTTL bounds how long a confirmed membership is trusted without asking the database again.
// The middleware checks membership on every workspace-scoped request; caching it saves one database
// round trip per API call. Changes made through this instance call ForgetWorkspace right away.
const memberTTL = 30 * time.Second

var members = struct {
	sync.Mutex
	m map[string]time.Time // "ws|uid" -> expiry
}{m: map[string]time.Time{}}

func memberCached(ws, uid string) bool {
	members.Lock()
	defer members.Unlock()

	exp, ok := members.m[ws+"|"+uid]
	if ok && time.Now().Before(exp) {
		return true
	}

	delete(members.m, ws+"|"+uid)

	return false
}

func rememberMember(ws, uid string) {
	members.Lock()
	defer members.Unlock()

	if len(members.m) > 10_000 { // bound memory; entries are cheap to rebuild
		members.m = map[string]time.Time{}
	}

	members.m[ws+"|"+uid] = time.Now().Add(memberTTL)
}

// ForgetWorkspace drops cached memberships for a workspace (call after removing a member,
// changing roles or deleting the workspace).
func ForgetWorkspace(ws string) {
	members.Lock()
	defer members.Unlock()

	for k := range members.m {
		if strings.HasPrefix(k, ws+"|") {
			delete(members.m, k)
		}
	}
}
