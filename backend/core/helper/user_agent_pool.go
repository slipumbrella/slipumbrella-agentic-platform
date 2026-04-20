package helper

import (
	"math/rand"
	"time"
)

type UserAgentProfile struct {
	Name  string
	Value string
}

var scrapeUserAgentPool = []UserAgentProfile{
	{
		Name:  "chrome_windows",
		Value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
	},
	{
		Name:  "chrome_macos",
		Value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
	},
	{
		Name:  "firefox_windows",
		Value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
	},
	{
		Name:  "safari_macos",
		Value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
	},
	{
		Name:  "openai_searchbot",
		Value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot",
	},
	{
		Name:  "gpt_bot",
		Value: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.3; +https://openai.com/gptbot",
	},
	{
		Name:  "chatgpt_user_bot",
		Value: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
	},
}

func RandomizedUserAgentProfiles() []UserAgentProfile {
	profiles := make([]UserAgentProfile, 0, len(scrapeUserAgentPool)+1)
	profiles = append(profiles, scrapeUserAgentPool...)
	profiles = append(profiles, UserAgentProfile{Name: "none", Value: ""})

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	rng.Shuffle(len(profiles), func(i, j int) {
		profiles[i], profiles[j] = profiles[j], profiles[i]
	})
	return profiles
}
