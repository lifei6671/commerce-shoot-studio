package config

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net"
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
	MySQL    MySQLConfig
	Redis    *RedisConfig
	Session  SessionConfig
	Security SecurityConfig
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
	MySQL    mysqlConfigDocument    `mapstructure:"mysql"`
	Redis    redisConfigDocument    `mapstructure:"redis"`
	Session  sessionConfigDocument  `mapstructure:"session"`
	Security securityConfigDocument `mapstructure:"security"`
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
