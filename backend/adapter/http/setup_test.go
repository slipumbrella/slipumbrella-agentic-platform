package adapter

import (
	"os"
	"testing"

	"capstone-prog/config"
)

// TestMain initializes a zero-value config so that handler code that
// references config.Cfg (e.g. GoogleSAClientEmail) does not panic during tests.
func TestMain(m *testing.M) {
	if config.Cfg == nil {
		config.Cfg = &config.Config{}
	}
	os.Exit(m.Run())
}
