// Package filter implements Hookdeck-style JSON filter matching.
//
// A filter is a JSON value compared against an input value:
//   - primitives must be equal ("type": "order.created")
//   - objects match recursively; every key in the filter must match
//   - arrays in the filter: input array must contain every filter element
//     (or, if the input is a scalar, the scalar must equal one of them)
//   - operators: $eq $neq $gt $gte $lt $lte $in $nin $startsWith $endsWith
//     $exist $or $and $not
package filter

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

// Match reports whether input satisfies the filter. An empty filter matches everything.
func Match(filterRaw json.RawMessage, input any) (bool, error) {
	if len(filterRaw) == 0 || string(filterRaw) == "null" {
		return true, nil
	}

	var f any
	if err := json.Unmarshal(filterRaw, &f); err != nil {
		return false, fmt.Errorf("invalid filter JSON: %w", err)
	}

	return match(f, input), nil
}

func match(f, in any) bool {
	switch fv := f.(type) {
	case map[string]any:
		return matchObject(fv, in)
	case []any:
		return matchArray(fv, in)
	default:
		return equal(fv, in)
	}
}

func matchObject(f map[string]any, in any) bool {
	for k, v := range f {
		if strings.HasPrefix(k, "$") {
			if !matchOperator(k, v, in) {
				return false
			}

			continue
		}

		obj, ok := in.(map[string]any)
		if !ok {
			return false
		}

		child, exists := obj[k]
		if !exists {
			// allow {"field": {"$exist": false}}
			if m, ok := v.(map[string]any); ok {
				if e, ok := m["$exist"]; ok {
					if b, ok := e.(bool); ok && !b {
						continue
					}
				}
			}

			return false
		}

		if !match(v, child) {
			return false
		}
	}

	return true
}

func matchArray(f []any, in any) bool {
	if arr, ok := in.([]any); ok {
		for _, want := range f {
			found := false

			for _, have := range arr {
				if match(want, have) {
					found = true
					break
				}
			}

			if !found {
				return false
			}
		}

		return true
	}

	for _, want := range f {
		if match(want, in) {
			return true
		}
	}

	return false
}

func matchOperator(op string, arg, in any) bool {
	switch op {
	case "$eq":
		return equal(arg, in)
	case "$neq":
		return !equal(arg, in)
	case "$gt", "$gte", "$lt", "$lte":
		return compare(op, arg, in)
	case "$in":
		// filter value contained in input (string contains or array includes), or input in filter list
		switch iv := in.(type) {
		case string:
			if s, ok := arg.(string); ok {
				return strings.Contains(iv, s)
			}
		case []any:
			for _, x := range iv {
				if equal(arg, x) {
					return true
				}
			}

			return false
		}

		if list, ok := arg.([]any); ok {
			for _, x := range list {
				if equal(x, in) {
					return true
				}
			}
		}

		return false
	case "$nin":
		return !matchOperator("$in", arg, in)
	case "$startsWith":
		s, ok1 := in.(string)
		p, ok2 := arg.(string)

		return ok1 && ok2 && strings.HasPrefix(s, p)
	case "$endsWith":
		s, ok1 := in.(string)
		p, ok2 := arg.(string)

		return ok1 && ok2 && strings.HasSuffix(s, p)
	case "$exist":
		b, _ := arg.(bool)
		return (in != nil) == b
	case "$or":
		list, ok := arg.([]any)
		if !ok {
			return false
		}

		for _, x := range list {
			if match(x, in) {
				return true
			}
		}

		return false
	case "$and":
		list, ok := arg.([]any)
		if !ok {
			return false
		}

		for _, x := range list {
			if !match(x, in) {
				return false
			}
		}

		return true
	case "$not":
		return !match(arg, in)
	}

	return false
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}

	return 0, false
}

func compare(op string, arg, in any) bool {
	a, ok1 := toFloat(arg)
	b, ok2 := toFloat(in)

	if !ok1 || !ok2 {
		as, ok3 := arg.(string)
		bs, ok4 := in.(string)

		if !ok3 || !ok4 {
			return false
		}

		c := strings.Compare(bs, as)

		return cmpResult(op, c)
	}

	switch {
	case b > a:
		return cmpResult(op, 1)
	case b < a:
		return cmpResult(op, -1)
	default:
		return cmpResult(op, 0)
	}
}

func cmpResult(op string, c int) bool {
	switch op {
	case "$gt":
		return c > 0
	case "$gte":
		return c >= 0
	case "$lt":
		return c < 0
	case "$lte":
		return c <= 0
	}

	return false
}

func equal(a, b any) bool {
	if fa, ok := toFloat(a); ok {
		if fb, ok := toFloat(b); ok {
			return fa == fb
		}
	}

	return reflect.DeepEqual(a, b)
}
