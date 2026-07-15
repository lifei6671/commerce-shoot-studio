package httpapi

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/publicsuffix"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

const (
	allowMethods = "GET, POST, OPTIONS"
	corsMethods  = "GET, POST"
	corsHeaders  = "Content-Type, Idempotency-Key"
)

var allowHeaderNames = map[string]struct{}{
	"content-type":    {},
	"idempotency-key": {},
}

type apiSurface uint8

const (
	surfaceNone apiSurface = iota
	surfaceUser
	surfaceAdmin
)

type originInfo struct {
	normalized string
	scheme     string
	hostname   string
}

type corsPolicy struct {
	userOrigins  map[string]originInfo
	adminOrigins map[string]originInfo
}

func newCORSPolicy(userOrigins, adminOrigins []string) (*corsPolicy, error) {
	user, err := buildOriginSet("用户端", userOrigins)
	if err != nil {
		return nil, err
	}
	admin, err := buildOriginSet("管理端", adminOrigins)
	if err != nil {
		return nil, err
	}
	return &corsPolicy{userOrigins: user, adminOrigins: admin}, nil
}

func buildOriginSet(name string, origins []string) (map[string]originInfo, error) {
	result := make(map[string]originInfo, len(origins))
	for _, raw := range origins {
		origin, ok := parseOrigin(raw, false)
		if !ok || origin.normalized != raw {
			return nil, fmt.Errorf("%s CORS Origin 非法", name)
		}
		if _, duplicate := result[origin.normalized]; duplicate {
			return nil, fmt.Errorf("%s CORS Origin 重复", name)
		}
		result[origin.normalized] = origin
	}
	return result, nil
}

func (runtime *runtime) corsMiddleware() gin.HandlerFunc {
	return func(context *gin.Context) {
		surface := identifyAPISurface(context.Request.URL.Path)
		if surface == surfaceNone {
			context.Next()
			return
		}

		appendVary(context.Writer.Header(), "Origin")
		if context.Request.Method == http.MethodOptions {
			appendVary(context.Writer.Header(), "Access-Control-Request-Method")
			appendVary(context.Writer.Header(), "Access-Control-Request-Headers")
		}
		originValues := context.Request.Header.Values("Origin")
		if len(originValues) == 0 {
			context.Next()
			return
		}
		if len(originValues) != 1 {
			runtime.rejectCORS(context)
			return
		}
		rawOrigin := originValues[0]
		origin, ok := parseOrigin(rawOrigin, false)
		if !ok {
			runtime.rejectCORS(context)
			return
		}
		external, err := runtime.resolveExternalOrigin(context.Request)
		if err != nil {
			runtime.rejectCORS(context)
			return
		}

		allowed := origin.normalized == external.normalized
		if !allowed {
			configured, exists := runtime.cors.origins(surface)[origin.normalized]
			allowed = exists && sameSchemefulSite(configured, external)
		}
		if !allowed {
			runtime.rejectCORS(context)
			return
		}

		if context.Request.Method == http.MethodOptions {
			requestedMethods := context.Request.Header.Values("Access-Control-Request-Method")
			if len(requestedMethods) == 0 {
				setOrdinaryCORSHeaders(context.Writer.Header(), origin.normalized)
				context.Next()
				return
			}
			if len(requestedMethods) != 1 {
				runtime.rejectCORS(context)
				return
			}
			requestedMethod := requestedMethods[0]
			if requestedMethod != http.MethodGet && requestedMethod != http.MethodPost ||
				!validRequestedHeaders(context.Request.Header.Values("Access-Control-Request-Headers")) {
				runtime.rejectCORS(context)
				return
			}
			setPreflightHeaders(context.Writer.Header(), origin.normalized)
			context.Status(http.StatusNoContent)
			context.Abort()
			return
		}

		setOrdinaryCORSHeaders(context.Writer.Header(), origin.normalized)
		context.Next()
	}
}

func (runtime *runtime) rejectCORS(context *gin.Context) {
	clearCORSAllowHeaders(context.Writer.Header())
	response.WriteError(context, apperror.ErrForbidden)
	context.Abort()
}

func (runtime *runtime) resolveExternalOrigin(request *http.Request) (originInfo, error) {
	metadata, ok := requestMetadataFromRequest(request)
	if !ok || metadata.externalOrigin.normalized == "" {
		return originInfo{}, fmt.Errorf("外部 Origin 非法")
	}
	return metadata.externalOrigin, nil
}

func (policy *corsPolicy) origins(surface apiSurface) map[string]originInfo {
	if surface == surfaceAdmin {
		return policy.adminOrigins
	}
	return policy.userOrigins
}

func identifyAPISurface(path string) apiSurface {
	switch {
	case path == adminAPIPrefix || strings.HasPrefix(path, adminAPIPrefix+"/"):
		return surfaceAdmin
	case path == userAPIPrefix || strings.HasPrefix(path, userAPIPrefix+"/"):
		return surfaceUser
	default:
		return surfaceNone
	}
}

func parseOrigin(raw string, allowDefaultPort bool) (originInfo, bool) {
	if raw == "" || strings.TrimSpace(raw) != raw || strings.ContainsAny(raw, " \t\r\n") ||
		strings.Contains(raw, "*") || strings.EqualFold(raw, "null") {
		return originInfo{}, false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Opaque != "" || parsed.User != nil || parsed.Host == "" ||
		parsed.Path != "" || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery ||
		parsed.Fragment != "" || parsed.RawFragment != "" || strings.HasSuffix(parsed.Host, ":") {
		return originInfo{}, false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return originInfo{}, false
	}
	hostname := strings.ToLower(parsed.Hostname())
	if !validOriginHost(hostname) {
		return originInfo{}, false
	}
	if ip := net.ParseIP(hostname); ip != nil {
		hostname = ip.String()
	}
	port := parsed.Port()
	if port != "" {
		portNumber, err := strconv.Atoi(port)
		if err != nil || portNumber <= 0 || portNumber > 65535 || strconv.Itoa(portNumber) != port {
			return originInfo{}, false
		}
		isDefault := scheme == "http" && portNumber == 80 || scheme == "https" && portNumber == 443
		if isDefault {
			if !allowDefaultPort {
				return originInfo{}, false
			}
			port = ""
		}
	}
	host := hostname
	if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	if port != "" {
		host = net.JoinHostPort(hostname, port)
	}
	return originInfo{
		normalized: scheme + "://" + host,
		scheme:     scheme,
		hostname:   hostname,
	}, true
}

func validOriginHost(hostname string) bool {
	if hostname == "" || strings.HasSuffix(hostname, ".") {
		return false
	}
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

func sameSchemefulSite(left, right originInfo) bool {
	if left.scheme != right.scheme {
		return false
	}
	return siteHost(left.hostname) == siteHost(right.hostname)
}

func siteHost(hostname string) string {
	if net.ParseIP(hostname) != nil || hostname == "localhost" {
		return hostname
	}
	registrable, err := publicsuffix.EffectiveTLDPlusOne(hostname)
	if err != nil {
		return hostname
	}
	return registrable
}

func validRequestedHeaders(values []string) bool {
	if len(values) == 0 {
		return true
	}
	for _, raw := range values {
		if raw == "" {
			continue
		}
		for _, token := range strings.Split(raw, ",") {
			name := strings.ToLower(strings.TrimSpace(token))
			if name == "" {
				return false
			}
			if _, allowed := allowHeaderNames[name]; !allowed {
				return false
			}
		}
	}
	return true
}

func setOrdinaryCORSHeaders(header http.Header, origin string) {
	header.Set("Access-Control-Allow-Origin", origin)
	header.Set("Access-Control-Allow-Credentials", "true")
	header.Set("Access-Control-Expose-Headers", "X-Request-ID")
	appendVary(header, "Origin")
}

func setPreflightHeaders(header http.Header, origin string) {
	setOrdinaryCORSHeaders(header, origin)
	header.Set("Allow", allowMethods)
	header.Set("Access-Control-Allow-Methods", corsMethods)
	header.Set("Access-Control-Allow-Headers", corsHeaders)
	header.Set("Access-Control-Max-Age", "600")
	appendVary(header, "Access-Control-Request-Method")
	appendVary(header, "Access-Control-Request-Headers")
}

func appendVary(header http.Header, name string) {
	for _, value := range header.Values("Vary") {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), name) {
				return
			}
		}
	}
	header.Add("Vary", name)
}

func clearCORSAllowHeaders(header http.Header) {
	for _, key := range []string{
		"Access-Control-Allow-Origin",
		"Access-Control-Allow-Credentials",
		"Access-Control-Allow-Methods",
		"Access-Control-Allow-Headers",
		"Access-Control-Max-Age",
		"Access-Control-Expose-Headers",
	} {
		header.Del(key)
	}
}
