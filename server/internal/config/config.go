package config

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	sessionAuthenticationKeyLength = 64
	sessionEncryptionKeyLength     = 32
	verificationKeyLength          = 32
)

// Config 是启动阶段校验、归一化后的静态配置。
type Config struct {
	WorkDir  string
	HTTP     HTTPConfig
	MySQL    MySQLConfig
	Redis    *RedisConfig
	Session  SessionConfig
	Security SecurityConfig
}

type HTTPConfig struct {
	ReadHeaderTimeout    time.Duration
	ReadTimeout          time.Duration
	WriteTimeout         time.Duration
	IdleTimeout          time.Duration
	MaxHeaderBytes       int
	DefaultJSONBodyBytes int64
	CORS                 CORSConfig
}

type CORSConfig struct {
	UserAllowedOrigins  []string
	AdminAllowedOrigins []string
}

type MySQLConfig struct {
	Host                  string
	Port                  int
	Database              string
	Username              string
	Password              string
	TLSMode               string
	ConnectTimeout        time.Duration
	ReadTimeout           time.Duration
	WriteTimeout          time.Duration
	MaxOpenConnections    int
	MaxIdleConnections    int
	ConnectionMaxLifetime time.Duration
	DSNParams             map[string]string
}

type RedisConfig struct {
	Address        string
	Password       string
	Database       int
	TLS            bool
	KeyPrefix      string
	PoolSize       int
	ConnectTimeout time.Duration
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
}

type SessionConfig struct {
	Store string
	User  SessionCookieConfig
	Admin SessionCookieConfig
}

type SessionCookieConfig struct {
	CookieName        string
	AuthenticationKey []byte
	EncryptionKey     []byte
	IdleTTL           time.Duration
	AbsoluteTTL       time.Duration
}

type SecurityConfig struct {
	VerificationCode VerificationCodeConfig
}

type VerificationCodeConfig struct {
	DerivationKey   []byte
	VerificationKey []byte
}

type appDocument struct {
	Version  int                    `mapstructure:"version"`
	HTTP     httpConfigDocument     `mapstructure:"http"`
	MySQL    mysqlConfigDocument    `mapstructure:"mysql"`
	Redis    redisConfigDocument    `mapstructure:"redis"`
	Session  sessionConfigDocument  `mapstructure:"session"`
	Security securityConfigDocument `mapstructure:"security"`
}

type httpConfigDocument struct {
	ReadHeaderTimeout    time.Duration      `mapstructure:"read_header_timeout"`
	ReadTimeout          time.Duration      `mapstructure:"read_timeout"`
	WriteTimeout         time.Duration      `mapstructure:"write_timeout"`
	IdleTimeout          time.Duration      `mapstructure:"idle_timeout"`
	MaxHeaderBytes       int                `mapstructure:"max_header_bytes"`
	DefaultJSONBodyBytes int64              `mapstructure:"default_json_body_bytes"`
	CORS                 corsConfigDocument `mapstructure:"cors"`
}

type corsConfigDocument struct {
	UserAllowedOrigins  *[]string `mapstructure:"user_allowed_origins"`
	AdminAllowedOrigins *[]string `mapstructure:"admin_allowed_origins"`
}

type mysqlConfigDocument struct {
	Host                  string            `mapstructure:"host"`
	Port                  int               `mapstructure:"port"`
	Database              string            `mapstructure:"database"`
	Username              string            `mapstructure:"username"`
	Password              string            `mapstructure:"password"`
	TLSMode               string            `mapstructure:"tls_mode"`
	ConnectTimeout        time.Duration     `mapstructure:"connect_timeout"`
	ReadTimeout           time.Duration     `mapstructure:"read_timeout"`
	WriteTimeout          time.Duration     `mapstructure:"write_timeout"`
	MaxOpenConnections    int               `mapstructure:"max_open_connections"`
	MaxIdleConnections    int               `mapstructure:"max_idle_connections"`
	ConnectionMaxLifetime time.Duration     `mapstructure:"connection_max_lifetime"`
	DSNParams             map[string]string `mapstructure:"dsn_params"`
}

type redisConfigDocument struct {
	Address        string        `mapstructure:"address"`
	Password       string        `mapstructure:"password"`
	Database       int           `mapstructure:"database"`
	TLS            bool          `mapstructure:"tls"`
	KeyPrefix      string        `mapstructure:"key_prefix"`
	PoolSize       int           `mapstructure:"pool_size"`
	ConnectTimeout time.Duration `mapstructure:"connect_timeout"`
	ReadTimeout    time.Duration `mapstructure:"read_timeout"`
	WriteTimeout   time.Duration `mapstructure:"write_timeout"`
}

type sessionConfigDocument struct {
	Store string                `mapstructure:"store"`
	User  sessionCookieDocument `mapstructure:"user"`
	Admin sessionCookieDocument `mapstructure:"admin"`
}

type sessionCookieDocument struct {
	CookieName        string        `mapstructure:"cookie_name"`
	AuthenticationKey string        `mapstructure:"authentication_key"`
	EncryptionKey     string        `mapstructure:"encryption_key"`
	IdleTTL           time.Duration `mapstructure:"idle_ttl"`
	AbsoluteTTL       time.Duration `mapstructure:"absolute_ttl"`
}

type securityConfigDocument struct {
	VerificationCode verificationCodeDocument `mapstructure:"verification_code"`
}

type verificationCodeDocument struct {
	DerivationKey   string `mapstructure:"derivation_key"`
	VerificationKey string `mapstructure:"verification_key"`
}

var reservedDSNParameters = map[string]struct{}{
	"tls":          {},
	"timeout":      {},
	"readtimeout":  {},
	"writetimeout": {},
	"parsetime":    {},
	"loc":          {},
	"user":         {},
	"username":     {},
	"password":     {},
	"passwd":       {},
	"protocol":     {},
	"network":      {},
	"net":          {},
	"address":      {},
	"addr":         {},
	"host":         {},
	"port":         {},
	"database":     {},
	"dbname":       {},
}

func buildHTTPConfig(document httpConfigDocument) (HTTPConfig, error) {
	if document.ReadHeaderTimeout <= 0 || document.ReadTimeout <= 0 ||
		document.WriteTimeout <= 0 || document.IdleTimeout <= 0 {
		return HTTPConfig{}, fmt.Errorf("http timeout 必须为正数")
	}
	if document.MaxHeaderBytes <= 0 || document.DefaultJSONBodyBytes <= 0 {
		return HTTPConfig{}, fmt.Errorf("http 请求大小限制必须为正数")
	}
	if document.CORS.UserAllowedOrigins == nil || document.CORS.AdminAllowedOrigins == nil {
		return HTTPConfig{}, fmt.Errorf("http.cors 必须显式配置用户端和管理端 Origin 列表")
	}
	userOrigins, err := normalizeAllowedOrigins("http.cors.user_allowed_origins", *document.CORS.UserAllowedOrigins)
	if err != nil {
		return HTTPConfig{}, err
	}
	adminOrigins, err := normalizeAllowedOrigins("http.cors.admin_allowed_origins", *document.CORS.AdminAllowedOrigins)
	if err != nil {
		return HTTPConfig{}, err
	}
	return HTTPConfig{
		ReadHeaderTimeout:    document.ReadHeaderTimeout,
		ReadTimeout:          document.ReadTimeout,
		WriteTimeout:         document.WriteTimeout,
		IdleTimeout:          document.IdleTimeout,
		MaxHeaderBytes:       document.MaxHeaderBytes,
		DefaultJSONBodyBytes: document.DefaultJSONBodyBytes,
		CORS: CORSConfig{
			UserAllowedOrigins:  userOrigins,
			AdminAllowedOrigins: adminOrigins,
		},
	}, nil
}

func normalizeAllowedOrigins(field string, origins []string) ([]string, error) {
	normalized := make([]string, 0, len(origins))
	seen := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		value, ok := normalizeOrigin(origin)
		if !ok {
			return nil, fmt.Errorf("%s 包含无效 Origin", field)
		}
		if _, duplicate := seen[value]; duplicate {
			return nil, fmt.Errorf("%s 包含重复 Origin", field)
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized, nil
}

func normalizeOrigin(origin string) (string, bool) {
	if origin == "" || strings.TrimSpace(origin) != origin ||
		strings.ContainsAny(origin, " \t\r\n") || strings.Contains(origin, "*") ||
		strings.EqualFold(origin, "null") {
		return "", false
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Opaque != "" || parsed.User != nil || parsed.Host == "" ||
		parsed.Path != "" || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery ||
		parsed.Fragment != "" || parsed.RawFragment != "" || strings.HasSuffix(parsed.Host, ":") {
		return "", false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "" || strings.HasSuffix(hostname, ".") || !validOriginHostname(hostname) {
		return "", false
	}
	if ip := net.ParseIP(hostname); ip != nil {
		hostname = ip.String()
	}
	port := parsed.Port()
	if port != "" {
		portNumber, err := strconv.Atoi(port)
		if err != nil || portNumber <= 0 || portNumber > 65535 || strconv.Itoa(portNumber) != port ||
			scheme == "http" && portNumber == 80 || scheme == "https" && portNumber == 443 {
			return "", false
		}
	}
	host := hostname
	if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	if port != "" {
		host = net.JoinHostPort(hostname, port)
	}
	return scheme + "://" + host, true
}

func validOriginHostname(hostname string) bool {
	if net.ParseIP(hostname) != nil {
		return true
	}
	if len(hostname) > 253 {
		return false
	}
	for _, label := range strings.Split(hostname, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for index := range len(label) {
			char := label[index]
			if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-' {
				continue
			}
			return false
		}
	}
	return true
}

func buildMySQLConfig(document mysqlConfigDocument) (MySQLConfig, error) {
	if strings.TrimSpace(document.Host) == "" || document.Port <= 0 || document.Port > 65535 {
		return MySQLConfig{}, fmt.Errorf("mysql.host 或 mysql.port 无效")
	}
	if strings.TrimSpace(document.Database) == "" || strings.TrimSpace(document.Username) == "" || document.Password == "" {
		return MySQLConfig{}, fmt.Errorf("mysql 数据库名或凭据不能为空")
	}
	switch document.TLSMode {
	case "false", "true", "skip-verify", "preferred":
	default:
		return MySQLConfig{}, fmt.Errorf("mysql.tls_mode 无效")
	}
	if document.ConnectTimeout <= 0 || document.ReadTimeout <= 0 || document.WriteTimeout <= 0 {
		return MySQLConfig{}, fmt.Errorf("mysql 超时必须为正数")
	}
	if document.MaxOpenConnections <= 0 || document.MaxIdleConnections < 0 || document.MaxIdleConnections > document.MaxOpenConnections {
		return MySQLConfig{}, fmt.Errorf("mysql 连接池配置无效")
	}
	if document.ConnectionMaxLifetime <= 0 {
		return MySQLConfig{}, fmt.Errorf("mysql.connection_max_lifetime 必须为正数")
	}
	params := make(map[string]string, len(document.DSNParams))
	normalizedKeys := make(map[string]struct{}, len(document.DSNParams))
	for key, value := range document.DSNParams {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			return MySQLConfig{}, fmt.Errorf("mysql.dsn_params 包含空参数名")
		}
		normalizedKey := strings.ToLower(trimmedKey)
		if _, reserved := reservedDSNParameters[normalizedKey]; reserved {
			return MySQLConfig{}, fmt.Errorf("mysql.dsn_params.%s 是保留参数", trimmedKey)
		}
		if _, duplicate := normalizedKeys[normalizedKey]; duplicate {
			return MySQLConfig{}, fmt.Errorf("mysql.dsn_params 包含重复参数")
		}
		normalizedKeys[normalizedKey] = struct{}{}
		params[trimmedKey] = value
	}
	return MySQLConfig{
		Host: document.Host, Port: document.Port, Database: document.Database,
		Username: document.Username, Password: document.Password, TLSMode: document.TLSMode,
		ConnectTimeout: document.ConnectTimeout, ReadTimeout: document.ReadTimeout,
		WriteTimeout: document.WriteTimeout, MaxOpenConnections: document.MaxOpenConnections,
		MaxIdleConnections:    document.MaxIdleConnections,
		ConnectionMaxLifetime: document.ConnectionMaxLifetime, DSNParams: params,
	}, nil
}

func buildSessionConfig(document sessionConfigDocument) (SessionConfig, error) {
	if document.Store != "cookie" && document.Store != "redis" {
		return SessionConfig{}, fmt.Errorf("session.store 只支持 cookie 或 redis")
	}
	user, err := buildSessionCookieConfig("session.user", document.User)
	if err != nil {
		return SessionConfig{}, err
	}
	admin, err := buildSessionCookieConfig("session.admin", document.Admin)
	if err != nil {
		return SessionConfig{}, err
	}
	if user.CookieName == admin.CookieName {
		return SessionConfig{}, fmt.Errorf("用户端与管理端 cookie_name 必须不同")
	}
	if admin.IdleTTL >= user.IdleTTL || admin.AbsoluteTTL >= user.AbsoluteTTL {
		return SessionConfig{}, fmt.Errorf("管理端 Session 有效期必须短于用户端")
	}
	if bytes.Equal(user.AuthenticationKey, admin.AuthenticationKey) || bytes.Equal(user.EncryptionKey, admin.EncryptionKey) {
		return SessionConfig{}, fmt.Errorf("用户端与管理端 Session 密钥必须独立")
	}
	return SessionConfig{Store: document.Store, User: user, Admin: admin}, nil
}

func buildSessionCookieConfig(field string, document sessionCookieDocument) (SessionCookieConfig, error) {
	if strings.TrimSpace(document.CookieName) == "" {
		return SessionCookieConfig{}, fmt.Errorf("%s.cookie_name 不能为空", field)
	}
	authenticationKey, err := decodeBase64Key(field+".authentication_key", document.AuthenticationKey, sessionAuthenticationKeyLength)
	if err != nil {
		return SessionCookieConfig{}, err
	}
	encryptionKey, err := decodeBase64Key(field+".encryption_key", document.EncryptionKey, sessionEncryptionKeyLength)
	if err != nil {
		return SessionCookieConfig{}, err
	}
	if document.IdleTTL <= 0 || document.AbsoluteTTL <= 0 || document.IdleTTL > document.AbsoluteTTL {
		return SessionCookieConfig{}, fmt.Errorf("%s 有效期配置无效", field)
	}
	return SessionCookieConfig{
		CookieName: document.CookieName, AuthenticationKey: authenticationKey,
		EncryptionKey: encryptionKey, IdleTTL: document.IdleTTL, AbsoluteTTL: document.AbsoluteTTL,
	}, nil
}

func buildRedisConfig(document redisConfigDocument) (RedisConfig, error) {
	if strings.TrimSpace(document.Address) == "" {
		return RedisConfig{}, fmt.Errorf("redis.address 不能为空")
	}
	host, portText, err := net.SplitHostPort(document.Address)
	if err != nil || strings.TrimSpace(host) == "" {
		return RedisConfig{}, fmt.Errorf("redis.address 必须是单节点 host:port")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 || port > 65535 {
		return RedisConfig{}, fmt.Errorf("redis.address 端口无效")
	}
	if document.Database < 0 || document.PoolSize <= 0 {
		return RedisConfig{}, fmt.Errorf("redis database 或 pool_size 无效")
	}
	if strings.TrimSpace(document.KeyPrefix) == "" {
		return RedisConfig{}, fmt.Errorf("redis.key_prefix 不能为空")
	}
	if document.ConnectTimeout <= 0 || document.ReadTimeout <= 0 || document.WriteTimeout <= 0 {
		return RedisConfig{}, fmt.Errorf("redis 超时必须为正数")
	}
	return RedisConfig{
		Address: document.Address, Password: document.Password, Database: document.Database,
		TLS: document.TLS, KeyPrefix: document.KeyPrefix, PoolSize: document.PoolSize,
		ConnectTimeout: document.ConnectTimeout, ReadTimeout: document.ReadTimeout,
		WriteTimeout: document.WriteTimeout,
	}, nil
}

func buildSecurityConfig(document securityConfigDocument, session SessionConfig) (SecurityConfig, error) {
	derivationKey, err := decodeBase64Key("security.verification_code.derivation_key", document.VerificationCode.DerivationKey, verificationKeyLength)
	if err != nil {
		return SecurityConfig{}, err
	}
	verificationKey, err := decodeBase64Key("security.verification_code.verification_key", document.VerificationCode.VerificationKey, verificationKeyLength)
	if err != nil {
		return SecurityConfig{}, err
	}
	keys := [][]byte{
		session.User.AuthenticationKey, session.User.EncryptionKey,
		session.Admin.AuthenticationKey, session.Admin.EncryptionKey,
		derivationKey, verificationKey,
	}
	for index := range keys {
		for other := index + 1; other < len(keys); other++ {
			if bytes.Equal(keys[index], keys[other]) {
				return SecurityConfig{}, fmt.Errorf("启动密钥必须彼此独立")
			}
		}
	}
	return SecurityConfig{VerificationCode: VerificationCodeConfig{
		DerivationKey: derivationKey, VerificationKey: verificationKey,
	}}, nil
}

func decodeBase64Key(field, encoded string, expectedLength int) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(decoded) != expectedLength {
		return nil, fmt.Errorf("%s 必须是解码后 %d 字节的标准 Base64", field, expectedLength)
	}
	return decoded, nil
}
