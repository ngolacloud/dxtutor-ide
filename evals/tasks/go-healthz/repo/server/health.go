package server

import "net/http"

// HealthHandler serves /healthz.
func HealthHandler(version string, ready func() error) http.Handler {
	return http.NotFoundHandler()
}
