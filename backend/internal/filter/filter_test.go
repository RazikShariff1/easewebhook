package filter

import (
	"encoding/json"
	"testing"
)

func TestMatch(t *testing.T) {
	var body any
	_ = json.Unmarshal([]byte(`{"type":"order.created","amount":120,"tags":["a","b"],"customer":{"email":"x@zopping.com"}}`), &body)

	cases := []struct {
		f    string
		want bool
	}{
		{``, true},
		{`{"type":"order.created"}`, true},
		{`{"type":"order.updated"}`, false},
		{`{"amount":{"$gte":100}}`, true},
		{`{"amount":{"$lt":100}}`, false},
		{`{"tags":["a"]}`, true},
		{`{"tags":["z"]}`, false},
		{`{"type":["order.created","order.updated"]}`, true},
		{`{"customer":{"email":{"$endsWith":"@zopping.com"}}}`, true},
		{`{"missing":{"$exist":false}}`, true},
		{`{"$or":[{"type":"x"},{"amount":120}]}`, true},
		{`{"type":{"$not":{"$startsWith":"order."}}}`, false},
	}

	for _, c := range cases {
		got, err := Match(json.RawMessage(c.f), body)
		if err != nil || got != c.want {
			t.Errorf("filter %s: got %v (err %v), want %v", c.f, got, err, c.want)
		}
	}
}
