package server_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	. "example.com/task/server"
)

func acceptanceDo(h http.Handler, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	return w
}

func TestAcceptanceHealthy(t *testing.T) {
	w := acceptanceDo(HealthHandler("1.4.2", func() error { return nil }), "GET", "/healthz")
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %q", w.Code, w.Header().Get("Content-Type"))
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body["status"] != "ok" || body["version"] != "1.4.2" {
		t.Fatalf("%v %v", err, body)
	}
}

func TestAcceptanceUnavailable(t *testing.T) {
	w := acceptanceDo(HealthHandler("1", func() error { return errors.New("db down") }), "GET", "/healthz")
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 503 || body["status"] != "unavailable" || body["error"] != "db down" {
		t.Fatalf("%d %v", w.Code, body)
	}
}

func TestAcceptanceMethodAndPath(t *testing.T) {
	h := HealthHandler("1", func() error { return nil })
	if w := acceptanceDo(h, "POST", "/healthz"); w.Code != 405 || w.Header().Get("Allow") != "GET" {
		t.Fatalf("%d %q", w.Code, w.Header().Get("Allow"))
	}
	if w := acceptanceDo(h, "GET", "/other"); w.Code != 404 {
		t.Fatal(w.Code)
	}
}
