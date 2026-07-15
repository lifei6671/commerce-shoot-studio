package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPICacheHeadersCoverSuccessAndEarlyFailures(t *testing.T) {
	router, err := New(Options{
		Logger:             newTestLogger(t, io.Discard),
		DefaultBodyBytes:   8,
		UserAllowedOrigins: []string{"https://app.example.com"},
		RegisterRoutes: func(user, admin *gin.RouterGroup) {
			for _, group := range []*gin.RouterGroup{user, admin} {
				group.GET("/ok", func(context *gin.Context) { context.Status(http.StatusNoContent) })
				group.GET("/panic", func(*gin.Context) { panic("CACHE_SECRET_MARKER") })
				group.POST("/body", func(context *gin.Context) { context.Status(http.StatusNoContent) })
			}
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		origin string
		want   int
	}{
		{name: "success", method: http.MethodGet, path: "/ok", want: 204},
		{name: "cors reject", method: http.MethodGet, path: "/ok", origin: "https://evil.example.net", want: 403},
		{name: "not found", method: http.MethodGet, path: "/missing", want: 404},
		{name: "method", method: http.MethodPut, path: "/ok", want: 405},
		{name: "body", method: http.MethodPost, path: "/body", body: "123456789", want: 413},
		{name: "panic", method: http.MethodGet, path: "/panic", want: 500},
	}
	for _, prefix := range []string{"/api/v1", "/api/admin/v1"} {
		for _, test := range tests {
			t.Run(prefix+" "+test.name, func(t *testing.T) {
				request := httptest.NewRequest(test.method, prefix+test.path, strings.NewReader(test.body))
				if test.origin != "" {
					request.Header.Set("Origin", test.origin)
				}
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, request)
				if recorder.Code != test.want {
					t.Fatalf("status=%d want=%d body=%q", recorder.Code, test.want, recorder.Body.String())
				}
				if got := recorder.Header().Get("Cache-Control"); got != "no-store, private" {
					t.Fatalf("Cache-Control = %q", got)
				}
				assertVaryContains(t, recorder.Header(), "Cookie", "Origin")
				if recorder.Header().Get("X-Request-ID") == "" {
					t.Fatal("早期响应缺少 X-Request-ID")
				}
			})
		}
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/outside", nil))
	if recorder.Header().Get("Cache-Control") != "" || containsVary(recorder.Header(), "Cookie") {
		t.Fatalf("非 API 路径不得增加业务缓存合同：%v", recorder.Header())
	}
}

func TestAPICacheHeadersPreservePreflightVaryDimensions(t *testing.T) {
	router, err := New(Options{
		Logger:             newTestLogger(t, io.Discard),
		DefaultBodyBytes:   1024,
		UserAllowedOrigins: []string{"https://app.example.com"},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/probe", nil)
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	assertVaryContains(t, recorder.Header(), "Cookie", "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers")
}

func TestCrossOriginProtectionUserAndAdminPolicies(t *testing.T) {
	router, err := New(Options{
		Logger:              newTestLogger(t, io.Discard),
		DefaultBodyBytes:    1024,
		UserAllowedOrigins:  []string{"https://app.example.com"},
		AdminAllowedOrigins: []string{"https://admin.example.com"},
		RegisterRoutes: func(user, admin *gin.RouterGroup) {
			user.POST("/write", func(context *gin.Context) { context.Status(http.StatusNoContent) })
			user.GET("/read", func(context *gin.Context) { context.Status(http.StatusNoContent) })
			admin.POST("/write", func(context *gin.Context) { context.Status(http.StatusNoContent) })
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	tests := []struct {
		name      string
		method    string
		path      string
		fetchSite string
		origin    string
		want      int
	}{
		{name: "same origin", method: http.MethodPost, path: "/api/v1/write", fetchSite: "same-origin", want: 204},
		{name: "browser none", method: http.MethodPost, path: "/api/v1/write", fetchSite: "none", want: 204},
		{name: "user trusted same site", method: http.MethodPost, path: "/api/v1/write", fetchSite: "same-site", origin: "https://app.example.com", want: 204},
		{name: "admin trusted same site", method: http.MethodPost, path: "/api/admin/v1/write", fetchSite: "same-site", origin: "https://admin.example.com", want: 204},
		{name: "cross surface origin", method: http.MethodPost, path: "/api/admin/v1/write", fetchSite: "same-site", origin: "https://app.example.com", want: 403},
		{name: "cross site", method: http.MethodPost, path: "/api/v1/write", fetchSite: "cross-site", origin: "https://evil.example.net", want: 403},
		{name: "cross site without origin", method: http.MethodPost, path: "/api/v1/write", fetchSite: "cross-site", want: 403},
		{name: "legacy same host", method: http.MethodPost, path: "/api/v1/write", origin: "https://api.example.com", want: 204},
		{name: "no browser headers", method: http.MethodPost, path: "/api/v1/write", want: 204},
		{name: "safe GET", method: http.MethodGet, path: "/api/v1/read", fetchSite: "cross-site", want: 204},
		{name: "safe HEAD reaches method guard", method: http.MethodHead, path: "/api/v1/read", fetchSite: "cross-site", want: 405},
		{name: "safe OPTIONS reaches method guard", method: http.MethodOptions, path: "/api/v1/read", fetchSite: "cross-site", want: 405},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, "https://api.example.com"+test.path, nil)
			request.Host = "api.example.com"
			if test.fetchSite != "" {
				request.Header.Set("Sec-Fetch-Site", test.fetchSite)
			}
			if test.origin != "" {
				request.Header.Set("Origin", test.origin)
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("status=%d want=%d body=%q", recorder.Code, test.want, recorder.Body.String())
			}
			if test.want == http.StatusForbidden {
				body := decodeErrorResponse(t, recorder)
				if fmt.Sprint(body["code"]) != "100403" || body["requestId"] != recorder.Header().Get("X-Request-ID") {
					t.Fatalf("CSRF 拒绝合同错误：%v", body)
				}
			}
		})
	}
}

func TestCrossOriginProtectionUsesTrustedProxyExternalAuthority(t *testing.T) {
	router, err := New(Options{
		Logger:            newTestLogger(t, io.Discard),
		DefaultBodyBytes:  1024,
		TrustedProxyCIDRs: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			user.POST("/write", func(context *gin.Context) { context.Status(http.StatusNoContent) })
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://internal:8080/api/v1/write", nil)
	request.RemoteAddr = "10.0.0.5:12345"
	request.Host = "internal:8080"
	request.Header.Set("Origin", "https://api.example.com")
	request.Header.Set("X-Forwarded-For", "198.51.100.8")
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Header.Set("X-Forwarded-Host", "api.example.com")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("proxy external authority 未用于 COP：status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func assertVaryContains(t *testing.T, header http.Header, names ...string) {
	t.Helper()
	for _, name := range names {
		if !containsVary(header, name) {
			t.Fatalf("Vary 缺少 %q：%v", name, header.Values("Vary"))
		}
	}
}

func containsVary(header http.Header, want string) bool {
	for _, line := range header.Values("Vary") {
		for _, value := range strings.Split(line, ",") {
			if strings.EqualFold(strings.TrimSpace(value), want) {
				return true
			}
		}
	}
	return false
}
