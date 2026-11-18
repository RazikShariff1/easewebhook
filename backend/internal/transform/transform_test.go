package transform

import "testing"

func TestRun(t *testing.T) {
	code := `addHandler("transform", (req, ctx) => {
		req.headers["x-env"] = process.env.REGION;
		req.body.event_type = "purchases";
		console.log("hi", req.body.id);
		return req;
	});`

	res, err := Run(code, map[string]string{"REGION": "in"}, &Request{Method: "POST", Headers: map[string]string{}, Body: map[string]any{"id": 7}}, nil)
	if err != nil {
		t.Fatal(err)
	}

	b := res.Request.Body.(map[string]any)
	if b["event_type"] != "purchases" || res.Request.Headers["x-env"] != "in" || len(res.Logs) != 1 {
		t.Fatalf("unexpected result: %+v logs=%v", res.Request, res.Logs)
	}
}

func TestTimeout(t *testing.T) {
	_, err := Run(`addHandler("transform", (r) => { while(true){} })`, nil, &Request{}, nil)
	if err == nil {
		t.Fatal("expected timeout error")
	}
}
