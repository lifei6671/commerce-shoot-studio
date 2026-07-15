// Package config 用测试固化 Web SaaS 启动配置合同。
package config

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/spf13/viper"
)

func TestLoadCookieConfiguration(t *testing.T) {
	appPath := writeValidFixture(t, "cookie")

	loaded, err := Load(appPath)
	if err != nil {
		t.Fatalf("加载合法 Cookie 配置失败：%v", err)
	}

	wantWorkDir := filepath.Dir(appPath)
	if loaded.WorkDir != wantWorkDir {
		t.Fatalf("配置工作目录错误：实际为 %q，期望为 %q", loaded.WorkDir, wantWorkDir)
	}
	if loaded.MySQL.Host != "127.0.0.1" || loaded.MySQL.Port != 3306 {
		t.Fatalf("MySQL 结构化字段未正确加载：host=%q port=%d", loaded.MySQL.Host, loaded.MySQL.Port)
	}
	if got := loaded.MySQL.DSNParams["charset"]; got != "utf8mb4" {
		t.Fatalf("自定义 DSN 参数未保留：%q", got)
	}
	if got := loaded.MySQL.DSNParams["allowNativePasswords"]; got != "true" {
		t.Fatalf("自定义 DSN 参数键名大小写未原样保留：%q", got)
	}
	if loaded.Redis != nil {
		t.Fatal("Cookie 模式不应构造 Redis 配置")
	}
	if len(loaded.Session.User.AuthenticationKey) != 64 || len(loaded.Session.User.EncryptionKey) != 32 {
		t.Fatal("用户 Session 密钥未解码为约定长度")
	}
	if len(loaded.Security.VerificationCode.DerivationKey) != 32 || len(loaded.Security.VerificationCode.VerificationKey) != 32 {
		t.Fatal("验证码密钥未解码为约定长度")
	}
	if loaded.Security.TrustedProxyCIDRs == nil || len(loaded.Security.TrustedProxyCIDRs) != 0 {
		t.Fatal("显式空 trusted proxy 列表应保留为独立空列表")
	}
}

func TestLoadTrustedProxyCIDRs(t *testing.T) {
	appPath := writeValidFixture(t, "cookie")
	replaceFileText(t, appPath, "  trusted_proxy_cidrs: []\n", "  trusted_proxy_cidrs:\n    - 10.0.0.0/8\n    - 2001:db8:abcd::/48\n")

	loaded, err := Load(appPath)
	if err != nil {
		t.Fatalf("加载规范 trusted proxy CIDR 失败：%v", err)
	}

	want := []string{"10.0.0.0/8", "2001:db8:abcd::/48"}
	if len(loaded.Security.TrustedProxyCIDRs) != len(want) {
		t.Fatalf("trusted proxy CIDR 数量错误：%v", loaded.Security.TrustedProxyCIDRs)
	}
	for index, prefix := range loaded.Security.TrustedProxyCIDRs {
		if prefix.String() != want[index] {
			t.Fatalf("trusted proxy CIDR 未保序：实际=%v 期望=%v", loaded.Security.TrustedProxyCIDRs, want)
		}
	}
}

func TestLoadRejectsInvalidTrustedProxyCIDRs(t *testing.T) {
	tests := []struct {
		name        string
		replacement string
	}{
		{name: "字段缺失", replacement: ""},
		{name: "非法 CIDR", replacement: "  trusted_proxy_cidrs: [not-a-cidr]\n"},
		{name: "非规范 CIDR 文本", replacement: "  trusted_proxy_cidrs: [2001:0db8::/32]\n"},
		{name: "IPv4 host bits", replacement: "  trusted_proxy_cidrs: [10.0.0.1/8]\n"},
		{name: "IPv6 host bits", replacement: "  trusted_proxy_cidrs: [2001:db8::1/32]\n"},
		{name: "IPv4 全网", replacement: "  trusted_proxy_cidrs: [0.0.0.0/0]\n"},
		{name: "IPv6 全网", replacement: "  trusted_proxy_cidrs: [::/0]\n"},
		{name: "IPv4 mapped IPv6", replacement: "  trusted_proxy_cidrs: [::ffff:192.0.2.0/120]\n"},
		{name: "重复 CIDR", replacement: "  trusted_proxy_cidrs: [10.0.0.0/8, 10.0.0.0/8]\n"},
		{name: "空 CIDR", replacement: "  trusted_proxy_cidrs: [\"\"]\n"},
		{name: "首尾空格", replacement: "  trusted_proxy_cidrs: [\" 10.0.0.0/8\"]\n"},
		{name: "列表弱类型", replacement: "  trusted_proxy_cidrs: 10.0.0.0/8\n"},
		{name: "元素弱类型", replacement: "  trusted_proxy_cidrs: [123]\n"},
		{name: "未知字段", replacement: "  trusted_proxy_cidrs: []\n  unknown_security_field: true\n"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			appPath := writeValidFixture(t, "cookie")
			replaceFileText(t, appPath, "  trusted_proxy_cidrs: []\n", test.replacement)

			_, err := Load(appPath)
			if err == nil {
				t.Fatal("无效 trusted proxy CIDR 应快速失败")
			}
			if strings.Contains(err.Error(), "not-a-cidr") || strings.Contains(err.Error(), "2001:0db8") {
				t.Fatalf("trusted proxy 配置错误不得回显原值：%v", err)
			}
		})
	}
}

func TestBuildSecurityConfigCopiesTrustedProxyCIDRs(t *testing.T) {
	values := []string{"10.0.0.0/8"}
	document := securityConfigDocument{
		TrustedProxyCIDRs: &values,
		VerificationCode: verificationCodeDocument{
			DerivationKey:   sessionAuthenticationKey(0x31, 32),
			VerificationKey: sessionAuthenticationKey(0x32, 32),
		},
	}
	session := SessionConfig{
		User: SessionCookieConfig{
			AuthenticationKey: bytes.Repeat([]byte{0x11}, 64),
			EncryptionKey:     bytes.Repeat([]byte{0x12}, 32),
		},
		Admin: SessionCookieConfig{
			AuthenticationKey: bytes.Repeat([]byte{0x21}, 64),
			EncryptionKey:     bytes.Repeat([]byte{0x22}, 32),
		},
	}

	security, err := buildSecurityConfig(document, session)
	if err != nil {
		t.Fatalf("构建合法安全配置失败：%v", err)
	}
	values[0] = "192.0.2.0/24"
	if got := security.TrustedProxyCIDRs[0].String(); got != "10.0.0.0/8" {
		t.Fatalf("构造结果被文档层修改污染：%q", got)
	}
}

func TestLoadHTTPConfiguration(t *testing.T) {
	loaded, err := Load(writeValidFixture(t, "cookie"))
	if err != nil {
		t.Fatalf("加载合法 HTTP 配置失败：%v", err)
	}

	if loaded.HTTP.ReadHeaderTimeout != 5*time.Second ||
		loaded.HTTP.ReadTimeout != 30*time.Second ||
		loaded.HTTP.WriteTimeout != 5*time.Minute ||
		loaded.HTTP.IdleTimeout != 60*time.Second {
		t.Fatalf("HTTP timeout 未精确加载：%+v", loaded.HTTP)
	}
	if loaded.HTTP.MaxHeaderBytes != 32768 || loaded.HTTP.DefaultJSONBodyBytes != 1048576 {
		t.Fatalf("HTTP byte limit 未精确加载：%+v", loaded.HTTP)
	}
	wantUserOrigins := []string{
		"https://app.example.com",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"https://[2001:db8::1]:8443",
	}
	if !reflect.DeepEqual(loaded.HTTP.CORS.UserAllowedOrigins, wantUserOrigins) {
		t.Fatalf("用户端 Origin 未规范化加载：实际=%v 期望=%v", loaded.HTTP.CORS.UserAllowedOrigins, wantUserOrigins)
	}
	if !reflect.DeepEqual(loaded.HTTP.CORS.AdminAllowedOrigins, []string{"https://admin.example.com"}) {
		t.Fatalf("管理端 Origin 未独立加载：%v", loaded.HTTP.CORS.AdminAllowedOrigins)
	}
}

func TestLoadHTTPConfigurationAllowsExplicitEmptyOrigins(t *testing.T) {
	appPath := writeValidFixture(t, "cookie")
	replaceFileText(t, appPath, validUserOrigins(), "    user_allowed_origins: []\n")
	replaceFileText(t, appPath, "    admin_allowed_origins:\n      - https://admin.example.com\n", "    admin_allowed_origins: []\n")

	loaded, err := Load(appPath)
	if err != nil {
		t.Fatalf("显式空 CORS 白名单应允许加载：%v", err)
	}
	if loaded.HTTP.CORS.UserAllowedOrigins == nil || loaded.HTTP.CORS.AdminAllowedOrigins == nil ||
		len(loaded.HTTP.CORS.UserAllowedOrigins) != 0 || len(loaded.HTTP.CORS.AdminAllowedOrigins) != 0 {
		t.Fatal("显式空 CORS 白名单未被保留为独立空列表")
	}
}

func TestLoadRejectsInvalidHTTPConfiguration(t *testing.T) {
	tests := []struct {
		name   string
		before string
		after  string
	}{
		{name: "缺少 HTTP 段", before: validHTTPSection(), after: ""},
		{name: "缺少 timeout", before: "  read_timeout: 30s\n", after: ""},
		{name: "零 timeout", before: "  read_timeout: 30s\n", after: "  read_timeout: 0s\n"},
		{name: "负 timeout", before: "  idle_timeout: 60s\n", after: "  idle_timeout: -1s\n"},
		{name: "零 header limit", before: "  max_header_bytes: 32768\n", after: "  max_header_bytes: 0\n"},
		{name: "负 body limit", before: "  default_json_body_bytes: 1048576\n", after: "  default_json_body_bytes: -1\n"},
		{name: "HTTP 弱类型", before: "  max_header_bytes: 32768\n", after: "  max_header_bytes: \"32768\"\n"},
		{name: "HTTP 未知字段", before: "  read_timeout: 30s\n", after: "  unknown_http_field: true\n  read_timeout: 30s\n"},
		{name: "缺少用户 Origin 字段", before: validUserOrigins(), after: ""},
		{
			name:   "缺少管理 Origin 字段",
			before: "    admin_allowed_origins:\n      - https://admin.example.com\n",
			after:  "",
		},
		{name: "Origin 列表弱类型", before: validUserOrigins(), after: "    user_allowed_origins: https://app.example.com\n"},
		{name: "Origin 元素弱类型", before: "      - HTTPS://APP.Example.COM\n", after: "      - 123\n"},
		{name: "空 Origin", before: "      - HTTPS://APP.Example.COM\n", after: "      - \"\"\n"},
		{name: "wildcard", before: "      - HTTPS://APP.Example.COM\n", after: "      - https://*.origin-secret-marker.example\n"},
		{name: "null", before: "      - HTTPS://APP.Example.COM\n", after: "      - null\n"},
		{name: "userinfo", before: "      - HTTPS://APP.Example.COM\n", after: "      - https://user@origin-secret-marker.example\n"},
		{name: "path", before: "      - HTTPS://APP.Example.COM\n", after: "      - https://origin-secret-marker.example/path\n"},
		{name: "query", before: "      - HTTPS://APP.Example.COM\n", after: "      - https://origin-secret-marker.example?secret=1\n"},
		{name: "fragment", before: "      - HTTPS://APP.Example.COM\n", after: "      - https://origin-secret-marker.example#secret\n"},
		{name: "相对 URL", before: "      - HTTPS://APP.Example.COM\n", after: "      - origin-secret-marker.example\n"},
		{name: "非 HTTP scheme", before: "      - HTTPS://APP.Example.COM\n", after: "      - ftp://origin-secret-marker.example\n"},
		{name: "首尾空格", before: "      - HTTPS://APP.Example.COM\n", after: "      - \" https://origin-secret-marker.example\"\n"},
		{name: "尾点 host", before: "      - HTTPS://APP.Example.COM\n", after: "      - https://origin-secret-marker.example.\n"},
		{name: "非 ASCII host", before: "      - HTTPS://APP.Example.COM\n", after: "      - https://秘密.origin-secret-marker.example\n"},
		{name: "显式默认端口", before: "      - HTTPS://APP.Example.COM\n", after: "      - https://origin-secret-marker.example:443\n"},
		{
			name:   "规范化后同组重复",
			before: "      - HTTPS://APP.Example.COM\n",
			after:  "      - HTTPS://APP.Example.COM\n      - https://app.example.com\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			appPath := writeValidFixture(t, "cookie")
			replaceFileText(t, appPath, test.before, test.after)

			_, err := Load(appPath)
			if err == nil {
				t.Fatal("无效 HTTP 配置应快速失败")
			}
			if strings.Contains(err.Error(), "origin-secret-marker") || strings.Contains(err.Error(), "秘密") {
				t.Fatalf("HTTP 配置错误不得回显恶意 Origin：%v", err)
			}
		})
	}
}

func TestBuildHTTPConfigDefensivelyCopiesOrigins(t *testing.T) {
	sharedOrigins := []string{"https://app.example.com"}
	userOrigins := sharedOrigins[:]
	adminOrigins := sharedOrigins[:]
	document := httpConfigDocument{
		ReadHeaderTimeout:    5 * time.Second,
		ReadTimeout:          30 * time.Second,
		WriteTimeout:         5 * time.Minute,
		IdleTimeout:          60 * time.Second,
		MaxHeaderBytes:       32768,
		DefaultJSONBodyBytes: 1048576,
		CORS: corsConfigDocument{
			UserAllowedOrigins:  &userOrigins,
			AdminAllowedOrigins: &adminOrigins,
		},
	}

	loaded, err := buildHTTPConfig(document)
	if err != nil {
		t.Fatalf("构造合法 HTTP 配置失败：%v", err)
	}
	sharedOrigins[0] = "https://mutated.example.com"
	if loaded.CORS.UserAllowedOrigins[0] != "https://app.example.com" ||
		loaded.CORS.AdminAllowedOrigins[0] != "https://app.example.com" {
		t.Fatal("HTTP 配置保留了调用方 Origin slice")
	}
	loaded.CORS.UserAllowedOrigins[0] = "https://user-mutated.example.com"
	if loaded.CORS.AdminAllowedOrigins[0] != "https://app.example.com" {
		t.Fatal("用户端与管理端 Origin slice 共享底层数组")
	}
}

func TestLoadRedisConfiguration(t *testing.T) {
	loaded, err := Load(writeValidFixture(t, "redis"))
	if err != nil {
		t.Fatalf("加载合法 Redis 配置失败：%v", err)
	}
	if loaded.Redis == nil || loaded.Redis.Address != "127.0.0.1:6379" {
		t.Fatal("Redis 模式未加载预期单节点地址")
	}
}

func TestLoadRedisConfigurationWithoutPassword(t *testing.T) {
	appPath := writeValidFixture(t, "redis")
	replaceFileText(t, appPath, "  password: redis-password-marker\n", "  password: \"\"\n")

	loaded, err := Load(appPath)
	if err != nil {
		t.Fatalf("内网无密码 Redis 配置应允许加载：%v", err)
	}
	if loaded.Redis == nil || loaded.Redis.Password != "" {
		t.Fatal("无密码 Redis 配置未被原样保留")
	}
}

func TestLoadCookieConfigurationAllowsOmittedRedis(t *testing.T) {
	appPath := writeValidFixture(t, "cookie")
	replaceFileText(t, appPath, validRedisSection(), "")

	loaded, err := Load(appPath)
	if err != nil {
		t.Fatalf("Cookie 模式应允许省略 Redis 配置：%v", err)
	}
	if loaded.Redis != nil {
		t.Fatal("Cookie 模式不应构造 Redis 配置")
	}
}

func TestLoadDefaultConfigurationPath(t *testing.T) {
	sourceAppPath := writeValidFixture(t, "cookie")
	root := t.TempDir()
	confDir := filepath.Join(root, "conf")
	if err := os.MkdirAll(confDir, 0o700); err != nil {
		t.Fatalf("创建默认配置目录失败：%v", err)
	}
	copyFile(t, sourceAppPath, filepath.Join(confDir, "app.yaml"))

	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("读取工作目录失败：%v", err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatalf("切换测试工作目录失败：%v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(oldWorkingDir); err != nil {
			t.Errorf("恢复测试工作目录失败：%v", err)
		}
	})

	loaded, err := Load("")
	if err != nil {
		t.Fatalf("加载默认 conf/app.yaml 失败：%v", err)
	}
	wantWorkDir, err := filepath.EvalSymlinks(confDir)
	if err != nil {
		t.Fatalf("解析默认配置工作目录失败：%v", err)
	}
	if loaded.WorkDir != wantWorkDir {
		t.Fatalf("默认配置工作目录错误：实际为 %q，期望为 %q", loaded.WorkDir, wantWorkDir)
	}
}

func TestLoadExplicitPathDoesNotFallbackToDefault(t *testing.T) {
	defaultAppPath := writeValidFixture(t, "cookie")
	root := t.TempDir()
	confDir := filepath.Join(root, "conf")
	if err := os.MkdirAll(confDir, 0o700); err != nil {
		t.Fatalf("创建默认配置目录失败：%v", err)
	}
	copyFile(t, defaultAppPath, filepath.Join(confDir, "app.yaml"))

	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("读取工作目录失败：%v", err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatalf("切换测试工作目录失败：%v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(oldWorkingDir); err != nil {
			t.Errorf("恢复测试工作目录失败：%v", err)
		}
	})

	if _, err := Load(filepath.Join(root, "missing", "app.yaml")); err == nil {
		t.Fatal("显式配置失败时不得回退到可用的默认配置")
	}
}

func TestLoadRejectsInvalidConfiguration(t *testing.T) {
	tests := []struct {
		name   string
		store  string
		before string
		after  string
	}{
		{
			name:   "未知字段",
			store:  "cookie",
			before: "  dsn_params:\n",
			after:  "  unexpected_field: true\n  dsn_params:\n",
		},
		{
			name:   "追加第二个 YAML 文档",
			store:  "cookie",
			before: validSecuritySection(),
			after:  validSecuritySection() + "---\nignored: true\n",
		},
		{
			name:   "大小写重复字段",
			store:  "cookie",
			before: "  host: 127.0.0.1\n",
			after:  "  host: 127.0.0.1\n  HOST: other.example.com\n",
		},
		{
			name:   "禁止弱类型端口转换",
			store:  "cookie",
			before: "  port: 3306\n",
			after:  "  port: \"3306\"\n",
		},
		{
			name:   "大小写不敏感的保留 DSN 参数",
			store:  "cookie",
			before: "    charset: utf8mb4\n",
			after:  "    charset: utf8mb4\n    PARSETIME: \"false\"\n",
		},
		{
			name:   "重复的 DSN 参数",
			store:  "cookie",
			before: "    charset: utf8mb4\n",
			after:  "    charset: utf8mb4\n    charset: utf8\n",
		},
		{
			name:   "去空格后重复的 DSN 参数",
			store:  "cookie",
			before: "    charset: utf8mb4\n",
			after:  "    charset: utf8mb4\n    \" charset \": utf8\n",
		},
		{
			name:   "MySQL 密码为空",
			store:  "cookie",
			before: "  password: mysql-password-marker\n",
			after:  "  password: \"\"\n",
		},
		{
			name:   "MySQL 密码类型错误不泄漏值",
			store:  "cookie",
			before: "  password: mysql-password-marker\n",
			after:  "  password: [mysql-password-marker]\n",
		},
		{
			name:   "Redis 模式缺少配置块",
			store:  "redis",
			before: validRedisSection(),
			after:  "",
		},
		{
			name:   "密钥不是合法 Base64",
			store:  "cookie",
			before: sessionAuthenticationKey(0x11, 64),
			after:  "session-secret-marker",
		},
		{
			name:   "密钥解码长度错误",
			store:  "cookie",
			before: sessionAuthenticationKey(0x11, 64),
			after:  sessionAuthenticationKey(0x11, 32),
		},
		{
			name:   "Session Store 枚举无效",
			store:  "cookie",
			before: "  store: cookie\n",
			after:  "  store: sentinel\n",
		},
		{
			name:   "管理端 TTL 不短于用户端",
			store:  "cookie",
			before: "    idle_ttl: 1h\n",
			after:  "    idle_ttl: 24h\n",
		},
		{
			name:   "验证码密钥复用 Session 密钥",
			store:  "cookie",
			before: sessionAuthenticationKey(0x31, 32),
			after:  sessionAuthenticationKey(0x12, 32),
		},
		{
			name:   "Redis 地址不是单节点 host port",
			store:  "redis",
			before: "  address: 127.0.0.1:6379\n",
			after:  "  address: redis-node\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			appPath := writeValidFixture(t, test.store)
			replaceFileText(t, appPath, test.before, test.after)

			_, err := Load(appPath)
			if err == nil {
				t.Fatal("无效配置应快速失败")
			}
			for _, marker := range []string{"session-secret-marker", "mysql-password-marker"} {
				if strings.Contains(err.Error(), marker) {
					t.Fatalf("错误信息泄漏凭据 marker：%v", err)
				}
			}
		})
	}
}

func TestLoadPathErrorsDoNotExposeAbsolutePaths(t *testing.T) {
	missingRoot := filepath.Join(t.TempDir(), "config-path-secret-marker")
	_, err := Load(filepath.Join(missingRoot, "app.yaml"))
	if err == nil {
		t.Fatal("缺失启动配置应失败")
	}
	if strings.Contains(err.Error(), missingRoot) || strings.Contains(err.Error(), "config-path-secret-marker") {
		t.Fatalf("启动配置错误不应暴露绝对路径：%v", err)
	}
}

func TestLoadDoesNotReadEnvironment(t *testing.T) {
	t.Setenv("MYSQL_HOST", "environment-override-marker")
	t.Setenv("COMMERCE_SHOOT_STUDIO_MYSQL_HOST", "environment-override-marker")

	loaded, err := Load(writeValidFixture(t, "cookie"))
	if err != nil {
		t.Fatalf("加载配置失败：%v", err)
	}
	if loaded.MySQL.Host != "127.0.0.1" {
		t.Fatalf("环境变量不应覆盖 YAML：%q", loaded.MySQL.Host)
	}
}

func TestLoadDoesNotReadGlobalViperState(t *testing.T) {
	viper.Set("mysql.host", "global-viper-marker")
	t.Cleanup(viper.Reset)

	loaded, err := Load(writeValidFixture(t, "cookie"))
	if err != nil {
		t.Fatalf("加载配置失败：%v", err)
	}
	if loaded.MySQL.Host != "127.0.0.1" {
		t.Fatalf("全局 Viper 状态不应污染独立配置：%q", loaded.MySQL.Host)
	}
}

func TestRepositoryExampleIsCompleteStrictYAMLWithoutCredentials(t *testing.T) {
	examplePath := filepath.Join("..", "..", "conf", "app.yaml.example")
	var app appDocument
	if err := decodeYAMLFile(examplePath, &app); err != nil {
		t.Fatalf("仓库配置示例不是合法严格 YAML：%v", err)
	}
	if app.Version != 1 || app.MySQL.Host == "" || app.Redis.Address == "" || app.Session.Store == "" {
		t.Fatal("仓库配置示例未包含完整启动配置字段")
	}
	if app.HTTP.ReadHeaderTimeout != 5*time.Second || app.HTTP.ReadTimeout != 30*time.Second ||
		app.HTTP.WriteTimeout != 5*time.Minute || app.HTTP.IdleTimeout != 60*time.Second ||
		app.HTTP.MaxHeaderBytes != 32768 || app.HTTP.DefaultJSONBodyBytes != 1048576 ||
		app.HTTP.CORS.UserAllowedOrigins == nil || app.HTTP.CORS.AdminAllowedOrigins == nil {
		t.Fatal("仓库配置示例未包含完整 HTTP/CORS 字段和精确推荐值")
	}
	if app.MySQL.Username != "" || app.MySQL.Password != "" || app.Redis.Password != "" {
		t.Fatal("仓库配置示例不得包含数据库部署凭据")
	}
	if app.Session.User.AuthenticationKey != "" || app.Session.User.EncryptionKey != "" ||
		app.Session.Admin.AuthenticationKey != "" || app.Session.Admin.EncryptionKey != "" {
		t.Fatal("仓库配置示例不得包含 Session 部署密钥")
	}
	if app.Security.VerificationCode.DerivationKey != "" || app.Security.VerificationCode.VerificationKey != "" {
		t.Fatal("仓库配置示例不得包含验证码部署密钥")
	}
	content, err := os.ReadFile(examplePath)
	if err != nil {
		t.Fatalf("读取仓库配置示例失败：%v", err)
	}
	for _, marker := range []string{
		"复制本文件", "HTTP Server 配置", "用户端允许的同站跨 Origin 白名单",
		"管理端允许的同站跨 Origin 白名单", "MySQL 配置", "Redis 配置", "Session 配置", "验证码安全配置",
		"可信代理出口网段", "真实 Ingress/LB", "必须覆盖而不是追加 X-Forwarded-For",
	} {
		if !bytes.Contains(content, []byte(marker)) {
			t.Fatalf("仓库配置示例缺少字段说明：%s", marker)
		}
	}
	if _, err := Load(examplePath); err == nil {
		t.Fatal("未填入启动凭据的仓库配置示例不得通过启动校验")
	}
}

func writeValidFixture(t *testing.T, store string) string {
	t.Helper()
	root := t.TempDir()
	appPath := filepath.Join(root, "app.yaml")
	writeFile(t, appPath, validAppDocument(store))
	return appPath
}

func validAppDocument(store string) string {
	return "version: 1\n" +
		validHTTPSection() +
		validMySQLSection() +
		validRedisSection() +
		validSessionSection(store) +
		validSecuritySection()
}

func validHTTPSection() string {
	return "http:\n" +
		"  read_header_timeout: 5s\n" +
		"  read_timeout: 30s\n" +
		"  write_timeout: 5m\n" +
		"  idle_timeout: 60s\n" +
		"  max_header_bytes: 32768\n" +
		"  default_json_body_bytes: 1048576\n" +
		"  cors:\n" +
		validUserOrigins() +
		"    admin_allowed_origins:\n" +
		"      - https://admin.example.com\n"
}

func validUserOrigins() string {
	return "    user_allowed_origins:\n" +
		"      - HTTPS://APP.Example.COM\n" +
		"      - http://localhost:5173\n" +
		"      - http://127.0.0.1:5173\n" +
		"      - https://[2001:db8::1]:8443\n"
}

func validMySQLSection() string {
	return "mysql:\n" +
		"  host: 127.0.0.1\n" +
		"  port: 3306\n" +
		"  database: commerce_shoot_studio\n" +
		"  username: commerce_shoot_studio\n" +
		"  password: mysql-password-marker\n" +
		"  tls_mode: \"false\"\n" +
		"  connect_timeout: 5s\n" +
		"  read_timeout: 10s\n" +
		"  write_timeout: 10s\n" +
		"  max_open_connections: 20\n" +
		"  max_idle_connections: 10\n" +
		"  connection_max_lifetime: 30m\n" +
		"  dsn_params:\n" +
		"    charset: utf8mb4\n" +
		"    allowNativePasswords: \"true\"\n"
}

func validRedisSection() string {
	return "redis:\n" +
		"  address: 127.0.0.1:6379\n" +
		"  password: redis-password-marker\n" +
		"  database: 0\n" +
		"  tls: false\n" +
		"  key_prefix: \"commerce-shoot-studio:\"\n" +
		"  pool_size: 10\n" +
		"  connect_timeout: 3s\n" +
		"  read_timeout: 3s\n" +
		"  write_timeout: 3s\n"
}

func validSessionSection(store string) string {
	return "session:\n" +
		"  store: " + store + "\n" +
		"  user:\n" +
		"    cookie_name: commerce_shoot_user\n" +
		"    authentication_key: " + sessionAuthenticationKey(0x11, 64) + "\n" +
		"    encryption_key: " + sessionAuthenticationKey(0x12, 32) + "\n" +
		"    idle_ttl: 24h\n" +
		"    absolute_ttl: 168h\n" +
		"  admin:\n" +
		"    cookie_name: commerce_shoot_admin\n" +
		"    authentication_key: " + sessionAuthenticationKey(0x21, 64) + "\n" +
		"    encryption_key: " + sessionAuthenticationKey(0x22, 32) + "\n" +
		"    idle_ttl: 1h\n" +
		"    absolute_ttl: 8h\n"
}

func validSecuritySection() string {
	return "security:\n" +
		"  trusted_proxy_cidrs: []\n" +
		"  verification_code:\n" +
		"    derivation_key: " + sessionAuthenticationKey(0x31, 32) + "\n" +
		"    verification_key: " + sessionAuthenticationKey(0x32, 32) + "\n"
}

func sessionAuthenticationKey(value byte, size int) string {
	return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{value}, size))
}

func replaceFileText(t *testing.T, path, before, after string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取测试配置失败：%v", err)
	}
	updated := strings.Replace(string(content), before, after, 1)
	if updated == string(content) {
		t.Fatalf("测试未找到待替换内容 %q", before)
	}
	writeFile(t, path, updated)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("创建测试目录失败：%v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("写入测试配置失败：%v", err)
	}
}

func copyFile(t *testing.T, source, destination string) {
	t.Helper()
	content, err := os.ReadFile(source)
	if err != nil {
		t.Fatalf("读取源配置失败：%v", err)
	}
	writeFile(t, destination, string(content))
}
