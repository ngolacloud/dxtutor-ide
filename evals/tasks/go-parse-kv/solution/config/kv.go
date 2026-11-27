package config

import (
	"fmt"
	"strings"
)

// ParseKV parses `k=v; k2="quoted; value"`.
func ParseKV(s string) (map[string]string, error) {
	out := map[string]string{}
	r := []rune(s)
	i := 0
	for i < len(r) {
		// key
		start := i
		for i < len(r) && r[i] != '=' && r[i] != ';' {
			i++
		}
		key := strings.TrimSpace(string(r[start:i]))
		if i >= len(r) || r[i] == ';' {
			if key != "" {
				return nil, fmt.Errorf("pair without '=': %q", key)
			}
			i++
			continue
		}
		if key == "" {
			return nil, fmt.Errorf("empty key")
		}
		i++ // '='
		for i < len(r) && (r[i] == ' ' || r[i] == '\t') {
			i++
		}
		var val strings.Builder
		if i < len(r) && r[i] == '"' {
			i++
			closed := false
			for i < len(r) {
				if r[i] == '\\' && i+1 < len(r) && r[i+1] == '"' {
					val.WriteRune('"')
					i += 2
					continue
				}
				if r[i] == '"' {
					closed = true
					i++
					break
				}
				val.WriteRune(r[i])
				i++
			}
			if !closed {
				return nil, fmt.Errorf("unterminated quote in %q", key)
			}
			for i < len(r) && r[i] != ';' {
				i++
			}
		} else {
			start := i
			for i < len(r) && r[i] != ';' {
				i++
			}
			val.WriteString(strings.TrimSpace(string(r[start:i])))
		}
		out[key] = val.String()
		i++ // ';'
	}
	return out, nil
}
