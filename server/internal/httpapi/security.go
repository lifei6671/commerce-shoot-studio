package httpapi

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

type securityPolicy struct {
	user  *http.CrossOriginProtection
	admin *http.CrossOriginProtection
}

func newSecurityPolicy(cors *corsPolicy) (*securityPolicy, error) {
	user, err := newCrossOriginProtection(cors.userOrigins)
	if err != nil {
		return nil, err
	}
	admin, err := newCrossOriginProtection(cors.adminOrigins)
	if err != nil {
		return nil, err
	}
	return &securityPolicy{user: user, admin: admin}, nil
}

func newCrossOriginProtection(origins map[string]originInfo) (*http.CrossOriginProtection, error) {
	protection := http.NewCrossOriginProtection()
	for origin := range origins {
		if err := protection.AddTrustedOrigin(origin); err != nil {
			return nil, fmt.Errorf("CSRF trusted origin 配置失败")
		}
	}
	return protection, nil
}

func (runtime *runtime) crossOriginProtectionMiddleware() gin.HandlerFunc {
	return func(context *gin.Context) {
		surface := identifyAPISurface(context.Request.URL.Path)
		if surface == surfaceNone {
			context.Next()
			return
		}
		metadata, ok := requestMetadataFromRequest(context.Request)
		if !ok || metadata.externalOrigin.normalized == "" {
			runtime.rejectCrossOrigin(context)
			return
		}

		protection := runtime.security.user
		if surface == surfaceAdmin {
			protection = runtime.security.admin
		}
		requestCopy := *context.Request
		requestCopy.Host = strings.TrimPrefix(metadata.externalOrigin.normalized, metadata.externalOrigin.scheme+"://")
		if err := protection.Check(&requestCopy); err != nil {
			runtime.rejectCrossOrigin(context)
			return
		}
		context.Next()
	}
}

func (runtime *runtime) rejectCrossOrigin(context *gin.Context) {
	response.WriteError(context, apperror.ErrForbidden)
	context.Abort()
}

func setAPIResponseHeaderBaseline(context *gin.Context) {
	if context == nil || context.Request == nil || identifyAPISurface(context.Request.URL.Path) == surfaceNone {
		return
	}
	header := context.Writer.Header()
	header.Set("Cache-Control", "no-store, private")
	appendVary(header, "Cookie")
	appendVary(header, "Origin")
	if context.Request.Method == http.MethodOptions {
		appendVary(header, "Access-Control-Request-Method")
		appendVary(header, "Access-Control-Request-Headers")
	}
}
