package config

import "testing"

func TestSimple(t *testing.T) {
	m, err := ParseKV("a=1;b=2")
	if err != nil || m["a"] != "1" || m["b"] != "2" {
		t.Fatal(m, err)
	}
}
