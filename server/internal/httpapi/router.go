// Package httpapi 提供 Web SaaS 服务的 Gin HTTP 边界。
package httpapi

import (
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net/netip"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

const (
	userAPIPrefix  = "/api/v1"
	adminAPIPrefix = "/api/admin/v1"
)

// RouteKey 唯一标识一个允许覆盖默认请求体上限的已注册路由。
type RouteKey struct {
	Method   string
	Template string
}

// Options 定义 Router 构造时冻结的 HTTP 边界策略。
type Options struct {
	Logger              *slog.Logger
	DefaultBodyBytes    int64
	BodyLimitOverrides  map[RouteKey]int64
	UserAllowedOrigins  []string
	AdminAllowedOrigins []string
	TrustedProxyCIDRs   []netip.Prefix
	RegisterRoutes      func(user, admin *gin.RouterGroup)
}

type runtime struct {
	logger             *slog.Logger
	defaultBodyBytes   int64
	bodyLimitOverrides map[RouteKey]int64
	requestIDs         *requestIDIssuer
	trustedProxyCIDRs  []netip.Prefix
	cors               *corsPolicy
	security           *securityPolicy
}

// New 使用 gin.New 构造不含生产业务路由的 HTTP Router。
func New(options Options) (*gin.Engine, error) {
	return newWithEntropy(options, rand.Reader)
}

func newWithEntropy(options Options, entropy io.Reader) (*gin.Engine, error) {
	if options.Logger == nil {
		return nil, fmt.Errorf("httpapi logger 不能为空")
	}
	if options.DefaultBodyBytes <= 0 {
		return nil, fmt.Errorf("默认请求体上限必须为正数")
	}
	if err := validateBodyLimitOverrides(options.BodyLimitOverrides); err != nil {
		return nil, err
	}

	corsPolicy, err := newCORSPolicy(options.UserAllowedOrigins, options.AdminAllowedOrigins)
	if err != nil {
		return nil, err
	}
	securityPolicy, err := newSecurityPolicy(corsPolicy)
	if err != nil {
		return nil, err
	}
	requestIDs, err := newRequestIDIssuer(entropy)
	if err != nil {
		return nil, err
	}
	trustedProxyCIDRs, trustedProxyCIDRStrings, err := cloneTrustedProxyCIDRs(options.TrustedProxyCIDRs)
	if err != nil {
		return nil, err
	}
	runtime := &runtime{
		logger:             options.Logger,
		defaultBodyBytes:   options.DefaultBodyBytes,
		bodyLimitOverrides: cloneBodyLimitOverrides(options.BodyLimitOverrides),
		requestIDs:         requestIDs,
		trustedProxyCIDRs:  trustedProxyCIDRs,
		cors:               corsPolicy,
		security:           securityPolicy,
	}

	engine := gin.New()
	engine.ForwardedByClientIP = false
	engine.RemoteIPHeaders = nil
	engine.TrustedPlatform = ""
	engine.AppEngine = false
	if err := engine.SetTrustedProxies(trustedProxyCIDRStrings); err != nil {
		return nil, fmt.Errorf("Gin trusted proxy 配置失败")
	}
	// API 未匹配必须进入统一 404 合同，不能由 Gin 自动生成 301/307。
	engine.RedirectTrailingSlash = false
	engine.Use(runtime.completionMiddleware())
	engine.Use(runtime.recoveryMiddleware())
	engine.Use(runtime.proxyMiddleware())
	engine.Use(runtime.corsMiddleware())
	engine.Use(runtime.crossOriginProtectionMiddleware())
	engine.Use(runtime.methodGuard())
	engine.Use(runtime.bodyLimitMiddleware())
	user := engine.Group(userAPIPrefix)
	admin := engine.Group(adminAPIPrefix)
	if options.RegisterRoutes != nil {
		options.RegisterRoutes(user, admin)
	}
	if err := validateRegisteredRoutes(engine, runtime.bodyLimitOverrides); err != nil {
		return nil, err
	}
	engine.NoRoute(func(context *gin.Context) {
		response.WriteError(context, apperror.ErrNotFound)
	})
	return engine, nil
}

func cloneBodyLimitOverrides(source map[RouteKey]int64) map[RouteKey]int64 {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[RouteKey]int64, len(source))
	for key, limit := range source {
		cloned[key] = limit
	}
	return cloned
}
