package config

import "testing"

func TestValidateDeploymentSecurityAllowsLocalDevelopment(t *testing.T) {
	cfg := &Config{
		FrontendURL:  "http://localhost:3000",
		CookieSecure: false,
		CookieDomain: "",
	}

	if err := validateDeploymentSecurity(cfg); err != nil {
		t.Fatalf("expected local development config to be allowed, got error: %v", err)
	}
}

func TestValidateDeploymentSecurityAllowsPublicHttpsWithSecureCookies(t *testing.T) {
	cfg := &Config{
		FrontendURL:  "https://app.example.com",
		CookieSecure: true,
		CookieDomain: ".example.com",
	}

	if err := validateDeploymentSecurity(cfg); err != nil {
		t.Fatalf("expected public HTTPS config to be allowed, got error: %v", err)
	}
}

func TestValidateDeploymentSecurityRejectsPublicHttp(t *testing.T) {
	cfg := &Config{
		FrontendURL:  "http://app.example.com",
		CookieSecure: true,
		CookieDomain: ".example.com",
	}

	if err := validateDeploymentSecurity(cfg); err == nil {
		t.Fatal("expected public HTTP frontend URL to be rejected")
	}
}

func TestValidateDeploymentSecurityRejectsPublicInsecureCookies(t *testing.T) {
	cfg := &Config{
		FrontendURL:  "https://app.example.com",
		CookieSecure: false,
		CookieDomain: ".example.com",
	}

	if err := validateDeploymentSecurity(cfg); err == nil {
		t.Fatal("expected insecure cookie config to be rejected for public deployments")
	}
}

func TestValidateCookieDomainRejectsInvalidValues(t *testing.T) {
	for _, cookieDomain := range []string{
		"https://example.com",
		"example.com:443",
		"127.0.0.1",
		"localhost",
		" example.com ",
	} {
		if err := validateCookieDomain(cookieDomain); err == nil {
			t.Fatalf("expected COOKIE_DOMAIN %q to be rejected", cookieDomain)
		}
	}
}
