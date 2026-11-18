// Package apierr defines HTTP errors with readable messages that GoFr maps to status codes.
package apierr

import (
	"fmt"
	"net/http"
)

type Error struct {
	Status  int
	Message string
}

func (e Error) Error() string   { return e.Message }
func (e Error) StatusCode() int { return e.Status }

func BadRequest(format string, a ...any) error {
	return Error{Status: http.StatusBadRequest, Message: fmt.Sprintf(format, a...)}
}

func NotFound(entity, id string) error {
	return Error{Status: http.StatusNotFound, Message: fmt.Sprintf("%s %q not found", entity, id)}
}

func Conflict(format string, a ...any) error {
	return Error{Status: http.StatusConflict, Message: fmt.Sprintf(format, a...)}
}
