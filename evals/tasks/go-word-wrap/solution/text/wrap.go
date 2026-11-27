package text

import "strings"

// Wrap breaks text into lines of at most width runes.
func Wrap(text string, width int) []string {
	if width < 1 {
		panic("width must be at least 1")
	}
	var lines []string
	var cur []rune
	for _, w := range strings.Fields(text) {
		r := []rune(w)
		for len(r) > width {
			if len(cur) > 0 {
				lines = append(lines, string(cur))
				cur = nil
			}
			lines = append(lines, string(r[:width]))
			r = r[width:]
		}
		if len(r) == 0 {
			continue
		}
		if len(cur) == 0 {
			cur = r
		} else if len(cur)+1+len(r) <= width {
			cur = append(append(cur, ' '), r...)
		} else {
			lines = append(lines, string(cur))
			cur = r
		}
	}
	if len(cur) > 0 {
		lines = append(lines, string(cur))
	}
	return lines
}
