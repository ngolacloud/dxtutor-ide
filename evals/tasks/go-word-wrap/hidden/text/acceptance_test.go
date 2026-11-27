package text_test

import (
	"reflect"
	"testing"

	. "example.com/task/text"
)

func TestAcceptanceWrap(t *testing.T) {
	cases := []struct {
		in    string
		width int
		want  []string
	}{
		{"the quick brown fox", 10, []string{"the quick", "brown fox"}},
		{"  a   b\n\tc ", 3, []string{"a b", "c"}},
		{"supercalifragilistic is long", 8, []string{"supercal", "ifragili", "stic is", "long"}},
		{"ação ação ação", 9, []string{"ação ação", "ação"}},
		{"", 5, nil},
		{"   ", 5, nil},
	}
	for _, c := range cases {
		got := Wrap(c.in, c.width)
		if len(got) == 0 && len(c.want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("Wrap(%q, %d) = %q, want %q", c.in, c.width, got, c.want)
		}
	}
}

func TestAcceptanceBadWidth(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("width 0 must panic")
		}
	}()
	Wrap("x", 0)
}
