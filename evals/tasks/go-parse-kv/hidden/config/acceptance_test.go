package config_test

import (
	"reflect"
	"testing"

	. "example.com/task/config"
)

func TestAcceptanceQuotedAndTrimmed(t *testing.T) {
	m, err := ParseKV(`host=db.local; user=app; password="p;w=d\"x"; port = 5432 ;;`)
	want := map[string]string{"host": "db.local", "user": "app", "password": `p;w=d"x`, "port": "5432"}
	if err != nil || !reflect.DeepEqual(m, want) {
		t.Fatalf("%v %v", m, err)
	}
}

func TestAcceptanceErrors(t *testing.T) {
	for _, bad := range []string{"a=1; b", "=1", `a="open`} {
		if _, err := ParseKV(bad); err == nil {
			t.Errorf("%q must fail", bad)
		}
	}
}
