// Package transform runs user JavaScript transformations (Hookdeck-compatible API):
//
//	addHandler("transform", (request, context) => {
//	  request.headers["x-extra"] = "1";
//	  request.body.event_type = "purchases";
//	  return request;
//	});
//
// request = {headers, body, query, path, method}. context = {connection: {...}}.
// process.env exposes the transformation's env map. console.log output is captured.
package transform

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/dop251/goja"
)

const timeout = 1 * time.Second

type Request struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Query   string            `json:"query"`
	Headers map[string]string `json:"headers"`
	Body    any               `json:"body"`
}

type Result struct {
	Request *Request `json:"request"`
	Logs    []string `json:"console"`
}

var errNoHandler = errors.New(`transformation must call addHandler("transform", fn)`)

// Run executes code against req and returns the transformed request.
func Run(code string, env map[string]string, req *Request, context map[string]any) (*Result, error) {
	vm := goja.New()
	vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))

	timer := time.AfterFunc(timeout, func() { vm.Interrupt("transformation timed out") })
	defer timer.Stop()

	var (
		handler goja.Callable
		logs    []string
	)

	_ = vm.Set("addHandler", func(name string, fn goja.Value) {
		if name != "transform" {
			return
		}

		if cb, ok := goja.AssertFunction(fn); ok {
			handler = cb
		}
	})

	logFn := func(call goja.FunctionCall) goja.Value {
		parts := make([]any, 0, len(call.Arguments))
		for _, a := range call.Arguments {
			parts = append(parts, a.Export())
		}

		b, _ := json.Marshal(parts)
		logs = append(logs, string(b))

		return goja.Undefined()
	}

	console := vm.NewObject()
	for _, n := range []string{"log", "info", "warn", "error", "debug"} {
		_ = console.Set(n, logFn)
	}

	_ = vm.Set("console", console)

	if env == nil {
		env = map[string]string{}
	}

	_ = vm.Set("process", map[string]any{"env": env})

	if _, err := vm.RunString(code); err != nil {
		return &Result{Logs: logs}, fmt.Errorf("script error: %w", err)
	}

	if handler == nil {
		return &Result{Logs: logs}, errNoHandler
	}

	// Round-trip through JSON so the script sees plain JS objects.
	reqJSON, _ := json.Marshal(req)

	var reqObj any
	_ = json.Unmarshal(reqJSON, &reqObj)

	out, err := handler(goja.Undefined(), vm.ToValue(reqObj), vm.ToValue(context))
	if err != nil {
		return &Result{Logs: logs}, fmt.Errorf("handler error: %w", err)
	}

	if out == nil || goja.IsUndefined(out) || goja.IsNull(out) {
		return &Result{Logs: logs}, errors.New("transform handler must return the request object")
	}

	outJSON, err := json.Marshal(out.Export())
	if err != nil {
		return &Result{Logs: logs}, fmt.Errorf("invalid return value: %w", err)
	}

	var res Request
	if err := json.Unmarshal(outJSON, &res); err != nil {
		return &Result{Logs: logs}, fmt.Errorf("invalid return value: %w", err)
	}

	if res.Headers == nil {
		res.Headers = map[string]string{}
	}

	if res.Method == "" {
		res.Method = req.Method
	}

	return &Result{Request: &res, Logs: logs}, nil
}
