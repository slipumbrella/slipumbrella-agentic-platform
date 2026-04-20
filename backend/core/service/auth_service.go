package service

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"
	"unicode"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	loginMaxFailures    = 5
	loginLockoutTTL     = 15 * time.Minute
	tokenBlacklistTTL   = 8 * time.Hour
	refreshGracePeriod  = 24 * time.Hour
)

type AuthService struct {
	userRepo    repository.UserRepository
	redisRepo   repository.RedisRepository
	jwtSecret   string
	jwtIssuer   string
	jwtAudience string
}

func NewAuthService(userRepo repository.UserRepository, redisRepo repository.RedisRepository, secret, issuer, audience string) *AuthService {
	return &AuthService{
		userRepo:    userRepo,
		redisRepo:   redisRepo,
		jwtSecret:   secret,
		jwtIssuer:   issuer,
		jwtAudience: audience,
	}
}

// validatePasswordStrength requires at least one uppercase letter, one lowercase letter, and one digit.
func validatePasswordStrength(password string) error {
	var hasUpper, hasLower, hasDigit bool
	for _, c := range password {
		switch {
		case unicode.IsUpper(c):
			hasUpper = true
		case unicode.IsLower(c):
			hasLower = true
		case unicode.IsDigit(c):
			hasDigit = true
		}
	}
	if !hasUpper || !hasLower || !hasDigit {
		return errors.New("password must contain at least one uppercase letter, one lowercase letter, and one digit")
	}
	return nil
}

// Signup: Create User
func (s *AuthService) Signup(ctx context.Context, username, email, password, role string, mustResetPassword bool) (*model.User, error) {
	// 0. Check for duplicates
	if existing, _ := s.userRepo.FindByUsername(ctx, username); existing != nil && existing.ID != uuid.Nil {
		return nil, errors.New("username already exists")
	}
	if existing, _ := s.userRepo.FindByEmail(ctx, email); existing != nil && existing.ID != uuid.Nil {
		return nil, errors.New("email already exists")
	}

	// 1. Validate password strength
	if err := validatePasswordStrength(password); err != nil {
		return nil, err
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	// 2. Setup the User
	user := &model.User{
		ID:                uuid.New(),
		Username:          username,
		Email:             email,
		Password:          string(hashed),
		Role:              role,
		MustResetPassword: mustResetPassword,
		IsActive:          true,
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, err
	}

	return user, nil
}

func (s *AuthService) IsUserActive(ctx context.Context, userID uuid.UUID) (bool, error) {
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return false, err
	}
	return user.IsActive, nil
}

func (s *AuthService) IsAdmin(ctx context.Context, userID uuid.UUID) (bool, error) {
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return false, err
	}
	return user.Role == "admin" && user.IsActive, nil
}

// lockoutKey returns the Redis key for login failure tracking.
func lockoutKey(email string) string {
	return fmt.Sprintf("lockout:%s", email)
}

// checkLoginLockout returns an error if the account is currently locked out.
func (s *AuthService) checkLoginLockout(ctx context.Context, email string) error {
	if s.redisRepo == nil {
		return nil
	}
	data, err := s.redisRepo.Get(ctx, lockoutKey(email))
	if err != nil || data == nil {
		return nil
	}
	count, _ := strconv.Atoi(string(data))
	if count >= loginMaxFailures {
		return errors.New("account is temporarily locked due to too many failed login attempts, please try again in 15 minutes")
	}
	return nil
}

// recordLoginFailure increments the failure counter, resetting the lockout TTL.
func (s *AuthService) recordLoginFailure(ctx context.Context, email string) {
	if s.redisRepo == nil {
		return
	}
	key := lockoutKey(email)
	data, _ := s.redisRepo.Get(ctx, key)
	count := 0
	if data != nil {
		count, _ = strconv.Atoi(string(data))
	}
	count++
	_ = s.redisRepo.Set(ctx, key, []byte(strconv.Itoa(count)), loginLockoutTTL)
}

// clearLoginFailure removes the lockout counter after a successful login.
func (s *AuthService) clearLoginFailure(ctx context.Context, email string) {
	if s.redisRepo == nil {
		return
	}
	// Overwrite with "0" and a very short TTL to effectively clear it.
	_ = s.redisRepo.Set(ctx, lockoutKey(email), []byte("0"), time.Second)
}

func (s *AuthService) Login(ctx context.Context, email, password string) (string, *model.User, error) {
	// 1. Check lockout before hitting the database
	if err := s.checkLoginLockout(ctx, email); err != nil {
		return "", nil, err
	}

	user, err := s.userRepo.FindByEmail(ctx, email)
	if err != nil {
		s.recordLoginFailure(ctx, email)
		return "", nil, errors.New("invalid credentials")
	}

	if !user.IsActive {
		return "", nil, errors.New("account is not active")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		s.recordLoginFailure(ctx, email)
		return "", nil, errors.New("invalid credentials")
	}

	// 2. Clear failure counter on success
	s.clearLoginFailure(ctx, email)

	// 3. Update Last Login
	now := time.Now()
	user.LastLogin = &now
	if err := s.userRepo.Update(ctx, user); err != nil {
		return "", nil, err
	}

	// 4. Issue JWT
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": user.ID,
		"iss": s.jwtIssuer,
		"aud": s.jwtAudience,
		"jti": uuid.New().String(),
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(8 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString([]byte(s.jwtSecret))
	return tokenString, user, err
}

// BlacklistToken adds a JWT's JTI to the Redis blacklist so it cannot be reused after logout.
func (s *AuthService) BlacklistToken(ctx context.Context, tokenString string) error {
	if s.redisRepo == nil {
		return nil
	}
	// Parse without validation to extract JTI — we just need the claim, not full validation.
	token, _, err := new(jwt.Parser).ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil || token == nil {
		return nil // best-effort; don't fail logout
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil
	}
	jti, _ := claims["jti"].(string)
	if jti == "" {
		return nil
	}
	return s.redisRepo.Set(ctx, "blacklist:"+jti, []byte("1"), tokenBlacklistTTL)
}

// IsTokenBlacklisted returns true if the given JTI has been blacklisted.
func (s *AuthService) IsTokenBlacklisted(ctx context.Context, jti string) bool {
	if s.redisRepo == nil || jti == "" {
		return false
	}
	data, err := s.redisRepo.Get(ctx, "blacklist:"+jti)
	return err == nil && data != nil
}

func (s *AuthService) RefreshToken(ctx context.Context, oldTokenString string) (string, error) {
	// 1. Parse the token — validate signature even if expired.
	token, err := jwt.Parse(oldTokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(s.jwtSecret), nil
	})

	// 2. Handle parsing errors
	if err != nil {
		if !errors.Is(err, jwt.ErrTokenExpired) {
			return "", errors.New("invalid token")
		}
	}

	if token == nil {
		return "", errors.New("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid claims")
	}

	// 3. Enforce a grace period: only allow refresh within 24h of token issuance.
	if iatVal, ok := claims["iat"].(float64); ok {
		iat := time.Unix(int64(iatVal), 0)
		if time.Since(iat) > refreshGracePeriod {
			return "", errors.New("token is too old to refresh, please log in again")
		}
	}

	// 4. Reject blacklisted tokens (i.e., tokens from sessions that have been logged out).
	jti, _ := claims["jti"].(string)
	if s.IsTokenBlacklisted(ctx, jti) {
		return "", errors.New("token has been revoked")
	}

	userIDStr, _ := claims["sub"].(string)
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return "", errors.New("invalid user id in token")
	}

	// 4. Verify user is still active
	isActive, err := s.IsUserActive(ctx, userID)
	if err != nil || !isActive {
		return "", errors.New("user is not active")
	}

	// 5. Issue new token
	newToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID,
		"iss": s.jwtIssuer,
		"aud": s.jwtAudience,
		"jti": uuid.New().String(),
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(8 * time.Hour).Unix(),
	})

	return newToken.SignedString([]byte(s.jwtSecret))
}

func (s *AuthService) GetProfile(ctx context.Context, userID uuid.UUID) (*model.User, error) {
	return s.userRepo.FindByID(ctx, userID)
}
