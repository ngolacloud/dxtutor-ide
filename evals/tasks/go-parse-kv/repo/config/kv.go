package config

import "strings"

// ParseKV parses `k=v; k2=v2`.
func ParseKV(s string) (map[string]string, error) {
	out := map[string]string{}
	for _, p := range strings.Split(s, ";") {
		kv := strings.SplitN(p, "=", 2)
		if len(kv) == 2 {
			out[kv[0]] = kv[1]
		}
	}
	return out, nil
}
