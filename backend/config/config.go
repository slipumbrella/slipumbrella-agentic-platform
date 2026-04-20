package config

import (
	"fmt"
	"log"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	ServerPort string

	DBHost      string
	DBPort      string
	DBUser      string
	DBPassword  string
	DBName      string
	JWTSecret   string
	JWTIssuer   string
	JWTAudience string
	FrontendURL string

	CookieSecure         bool
	CookieDomain         string
	AdminInitialPassword string

	AWS_ACCESS_KEY_ID     string
	AWS_SECRET_ACCESS_KEY string
	AWS_REGION            string
	R2_ENDPOINT           string
	R2_BUCKET             string
	R2_PUBLIC_BUCKET      string
	R2_PUBLIC_URL         string
	TyphoonAPIKey         string

	GRPCPort string
	GRPCHost string

	RedisHost     string
	RedisPort     string
	RedisPassword string

	JinaAPIKey          string
	OpenRouterAPIKey    string
	GoogleSAClientEmail string
}

var Cfg *Config

func LoadConfig() *Config {
	err := godotenv.Load()

	if err != nil {
		slog.Warn("Could not load .env file, using environment variables or defaults", "error", err)
	}

	// Load your configuration here
	Cfg = &Config{
		ServerPort:  getEnv("SERVER_PORT", "8080"),
		DBHost:      getEnv("DB_HOST", "localhost"),
		DBPort:      getEnv("DB_PORT", "5432"),
		DBUser:      getEnv("DB_USER", "postgres"),
		DBPassword:  requireEnv("DB_PASSWORD"), // SECURITY: No default, must be set
		DBName:      getEnv("DB_NAME", "agent_db"),
		JWTSecret:   requireSecureSecret("JWT_SECRET", 32), // SECURITY: No default, minimum 32 chars
		JWTIssuer:   getEnv("JWT_ISSUER", "egco-agent-platform"),
		JWTAudience: getEnv("JWT_AUDIENCE", "egco-agent-platform"),
		FrontendURL: getEnv("FRONTEND_URL", "http://localhost:3000"),

		CookieSecure:         getEnvBool("COOKIE_SECURE", false),
		CookieDomain:         getEnv("COOKIE_DOMAIN", ""),
		AdminInitialPassword: getEnv("ADMIN_INITIAL_PASSWORD", ""),

		AWS_ACCESS_KEY_ID:     getEnv("AWS_ACCESS_KEY_ID", ""),
		AWS_SECRET_ACCESS_KEY: getEnv("AWS_SECRET_ACCESS_KEY", ""),
		AWS_REGION:            getEnv("AWS_REGION", ""),
		R2_ENDPOINT:           getEnv("R2_ENDPOINT", ""),
		R2_BUCKET:             getEnv("R2_BUCKET", ""),
		R2_PUBLIC_BUCKET:      getEnv("R2_PUBLIC_BUCKET", ""),
		R2_PUBLIC_URL:         getEnv("R2_PUBLIC_URL", ""),
		TyphoonAPIKey:         getEnv("TYPHOON_API_KEY", ""),

		GRPCPort: getEnv("GRPC_PORT", "9000"),
		GRPCHost: getEnv("GRPC_HOST", "localhost"),

		RedisHost:     getEnv("REDIS_HOST", "localhost"),
		RedisPort:     getEnv("REDIS_PORT", "6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),

		JinaAPIKey:          getEnv("JINA_API_KEY", ""),
		OpenRouterAPIKey:    getEnv("OPENROUTER_API_KEY", ""),
		GoogleSAClientEmail: getEnv("GOOGLE_SA_CLIENT_EMAIL", ""),
	}
	if err := validateDeploymentSecurity(Cfg); err != nil {
		log.Fatalf("FATAL: invalid deployment configuration: %v", err)
	}
	return Cfg
}

func validateDeploymentSecurity(cfg *Config) error {
	frontendURL, err := url.Parse(cfg.FrontendURL)
	if err != nil || frontendURL.Scheme == "" || frontendURL.Host == "" {
		return fmt.Errorf("FRONTEND_URL must be a valid absolute URL, got %q", cfg.FrontendURL)
	}
	if frontendURL.Scheme != "http" && frontendURL.Scheme != "https" {
		return fmt.Errorf("FRONTEND_URL must use http or https, got %q", cfg.FrontendURL)
	}

	hostname := strings.ToLower(frontendURL.Hostname())
	localFrontend := isLocalFrontendHost(hostname)

	if !localFrontend && frontendURL.Scheme != "https" {
		return fmt.Errorf("FRONTEND_URL must use https for public deployments, got %q", cfg.FrontendURL)
	}

	if !localFrontend && !cfg.CookieSecure {
		return fmt.Errorf("COOKIE_SECURE must be true when FRONTEND_URL is public (%q)", cfg.FrontendURL)
	}

	if cfg.CookieSecure && localFrontend {
		slog.Warn("COOKIE_SECURE is enabled for a local FRONTEND_URL; ensure your browser accepts secure cookies on localhost or use HTTPS locally.", "frontend_url", cfg.FrontendURL)
	}

	if cfg.CookieDomain != "" {
		if err := validateCookieDomain(cfg.CookieDomain); err != nil {
			return err
		}
		if localFrontend {
			slog.Warn("COOKIE_DOMAIN is set for a local FRONTEND_URL; browser domain matching may not work on localhost.", "frontend_url", cfg.FrontendURL, "cookie_domain", cfg.CookieDomain)
		}
	}

	if !localFrontend && cfg.CookieDomain == "" {
		slog.Warn("COOKIE_DOMAIN is empty for a public deployment; cookies will be host-only. This is safe only if the browser talks directly to the backend host.", "frontend_url", cfg.FrontendURL)
	}

	return nil
}

func validateCookieDomain(cookieDomain string) error {
	trimmed := strings.TrimSpace(cookieDomain)
	if trimmed == "" {
		return fmt.Errorf("COOKIE_DOMAIN cannot be empty when set")
	}
	if trimmed != cookieDomain {
		return fmt.Errorf("COOKIE_DOMAIN must not contain leading or trailing whitespace: %q", cookieDomain)
	}
	if strings.Contains(trimmed, "://") {
		return fmt.Errorf("COOKIE_DOMAIN must be a hostname, not a URL: %q", cookieDomain)
	}
	if strings.ContainsAny(trimmed, "/?#@") {
		return fmt.Errorf("COOKIE_DOMAIN must not include path, query, or fragment: %q", cookieDomain)
	}
	if strings.Contains(trimmed, ":") {
		return fmt.Errorf("COOKIE_DOMAIN must not include a port or IPv6 literal: %q", cookieDomain)
	}

	normalized := strings.TrimPrefix(trimmed, ".")
	if normalized == "" {
		return fmt.Errorf("COOKIE_DOMAIN cannot be empty")
	}
	if strings.HasPrefix(normalized, ".") {
		return fmt.Errorf("COOKIE_DOMAIN must not contain multiple leading dots: %q", cookieDomain)
	}
	if strings.Contains(normalized, "..") {
		return fmt.Errorf("COOKIE_DOMAIN must not contain consecutive dots: %q", cookieDomain)
	}
	if strings.EqualFold(normalized, "localhost") {
		return fmt.Errorf("COOKIE_DOMAIN should not be localhost; leave it empty for local development")
	}
	if net.ParseIP(normalized) != nil {
		return fmt.Errorf("COOKIE_DOMAIN must not be an IP address: %q", cookieDomain)
	}

	return nil
}

func isLocalFrontendHost(hostname string) bool {
	switch strings.ToLower(strings.TrimSpace(hostname)) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	if strings.HasSuffix(hostname, ".localhost") {
		return true
	}
	return false
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	slog.Warn(fmt.Sprintf("ENV %v not found using default value: %v", key, defaultValue))
	return defaultValue
}

// requireEnv fails startup if the environment variable is not set
func requireEnv(key string) string {
	value, exists := os.LookupEnv(key)
	if !exists || value == "" {
		log.Fatalf("FATAL: Required environment variable %s is not set", key)
	}
	return value
}

func getEnvBool(key string, defaultValue bool) bool {
	if value, exists := os.LookupEnv(key); exists {
		return value == "true" || value == "1"
	}
	return defaultValue
}

// requireSecureSecret requires a minimum length secret for security-critical values
func requireSecureSecret(key string, minLength int) string {
	value := requireEnv(key)
	if len(value) < minLength {
		log.Fatalf("FATAL: Environment variable %s must be at least %d characters long", key, minLength)
	}
	return value
}
