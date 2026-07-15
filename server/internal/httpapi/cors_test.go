package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

func TestCORSAllowsSameSitePreflightAndPreservesVary(t *testing.T) {
	router := newCORSRouter(t, Options{
		UserAllowedOrigins: []string{"https://app.example.co.uk"},
		ExternalOrigin: func(*http.Request) (string, error) {
			return "https://api.example.co.uk", nil
		},
	})
	recorder := httptest.NewRecorder()
	recorder.Header().Set("Vary", "Cookie, origin")
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/probe", nil)
	request.Header.Set("Origin", "https://app.example.co.uk")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", " content-type, IDEMPOTENCY-key ")

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent || recorder.Body.Len() != 0 {
		t.Fatalf("合法预检应返回 204 空 body：status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	assertHeader(t, recorder, "Allow", "GET, POST, OPTIONS")
	assertHeader(t, recorder, "Access-Control-Allow-Origin", "https://app.example.co.uk")
	assertHeader(t, recorder, "Access-Control-Allow-Credentials", "true")
	assertHeader(t, recorder, "Access-Control-Allow-Methods", "GET, POST")
	assertHeader(t, recorder, "Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
	assertHeader(t, recorder, "Access-Control-Max-Age", "600")
	assertVarySet(t, recorder, []string{"Cookie", "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"})
}

func TestCORSAllowsPreflightWithoutRequestedHeaders(t *testing.T) {
	router := newCORSRouter(t, Options{
		UserAllowedOrigins: []string{"https://app.example.com"},
		ExternalOrigin: func(*http.Request) (string, error) {
			return "https://api.example.com", nil
		},
	})
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/probe", nil)
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("缺省请求 Header 的合法预检 status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestCORSAlwaysVariesByOriginAndOptionsRequestHeaders(t *testing.T) {
	router := newCORSRouter(t, Options{
		UserAllowedOrigins: []string{"https://app.example.com"},
		ExternalOrigin:     staticExternalOrigin("https://api.example.com"),
	})

	withoutOrigin := httptest.NewRecorder()
	router.ServeHTTP(withoutOrigin, httptest.NewRequest(http.MethodGet, "/api/v1/probe", nil))
	assertVarySet(t, withoutOrigin, []string{"Origin"})

	ordinaryOptions := httptest.NewRequest(http.MethodOptions, "/api/v1/probe", nil)
	ordinaryOptions.Header.Set("Origin", "https://app.example.com")
	ordinaryRecorder := httptest.NewRecorder()
	router.ServeHTTP(ordinaryRecorder, ordinaryOptions)
	if ordinaryRecorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("普通 OPTIONS status=%d", ordinaryRecorder.Code)
	}
	assertVarySet(t, ordinaryRecorder, []string{"Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"})
}

func TestCORSRejectsInvalidPreflightWithoutAllowHeaders(t *testing.T) {
	tests := []struct {
		name          string
		origin        string
		requestMethod string
		requestHeader string
	}{
		{name: "null origin", origin: "null", requestMethod: http.MethodPost},
		{name: "unlisted origin", origin: "https://other.example.com", requestMethod: http.MethodPost},
		{name: "malformed origin", origin: "https://app.example.com/path", requestMethod: http.MethodPost},
		{name: "forbidden method", origin: "https://app.example.com", requestMethod: http.MethodDelete},
		{name: "authorization header", origin: "https://app.example.com", requestMethod: http.MethodPost, requestHeader: "Authorization"},
		{name: "unknown header", origin: "https://app.example.com", requestMethod: http.MethodPost, requestHeader: "X-Secret-Marker"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := newCORSRouter(t, Options{
				UserAllowedOrigins: []string{"https://app.example.com"},
				ExternalOrigin: func(*http.Request) (string, error) {
					return "https://api.example.com", nil
				},
			})
			request := httptest.NewRequest(http.MethodOptions, "/api/v1/probe", nil)
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Access-Control-Request-Method", test.requestMethod)
			if test.requestHeader != "" {
				request.Header.Set("Access-Control-Request-Headers", test.requestHeader)
			}
			recorder := httptest.NewRecorder()
			recorder.Header().Set("Access-Control-Allow-Origin", "https://must-be-cleared.example")
			recorder.Header().Set("Vary", "Cookie")

			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("非法预检 status=%d body=%q", recorder.Code, recorder.Body.String())
			}
			body := decodeErrorResponse(t, recorder)
			if body["code"].(json.Number).String() != "100403" {
				t.Fatalf("非法预检 code 错误：%v", body)
			}
			for key := range recorder.Header() {
				if strings.HasPrefix(http.CanonicalHeaderKey(key), "Access-Control-Allow-") {
					t.Fatalf("非法预检不得返回允许跨域 Header：%s=%q", key, recorder.Header().Values(key))
				}
			}
			assertVarySet(t, recorder, []string{"Cookie", "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"})
		})
	}
}

func TestCORSRejectsRepeatedOriginAndChecksEveryRequestedHeaderLine(t *testing.T) {
	router := newCORSRouter(t, Options{
		UserAllowedOrigins: []string{"https://app.example.com"},
		ExternalOrigin:     staticExternalOrigin("https://api.example.com"),
	})

	repeatedOrigin := httptest.NewRequest(http.MethodOptions, "/api/v1/probe", nil)
	repeatedOrigin.Header.Add("Origin", "https://app.example.com")
	repeatedOrigin.Header.Add("Origin", "https://evil.example.com")
	repeatedOrigin.Header.Set("Access-Control-Request-Method", http.MethodPost)
	repeatedOriginRecorder := httptest.NewRecorder()
	router.ServeHTTP(repeatedOriginRecorder, repeatedOrigin)
	if repeatedOriginRecorder.Code != http.StatusForbidden {
		t.Fatalf("多个 Origin 值必须拒绝：status=%d", repeatedOriginRecorder.Code)
	}

	repeatedHeaders := httptest.NewRequest(http.MethodOptions, "/api/v1/probe", nil)
	repeatedHeaders.Header.Set("Origin", "https://app.example.com")
	repeatedHeaders.Header.Set("Access-Control-Request-Method", http.MethodPost)
	repeatedHeaders.Header.Add("Access-Control-Request-Headers", "Content-Type")
	repeatedHeaders.Header.Add("Access-Control-Request-Headers", "Authorization")
	repeatedHeadersRecorder := httptest.NewRecorder()
	router.ServeHTTP(repeatedHeadersRecorder, repeatedHeaders)
	if repeatedHeadersRecorder.Code != http.StatusForbidden {
		t.Fatalf("后续 requested-header 行不得被忽略：status=%d", repeatedHeadersRecorder.Code)
	}
	for key := range repeatedHeadersRecorder.Header() {
		if strings.HasPrefix(http.CanonicalHeaderKey(key), "Access-Control-Allow-") {
			t.Fatalf("重复非法 Header 请求不得获得 CORS 授权：%s", key)
		}
	}
}

func TestCORSKeepsUserAndAdminPoliciesSeparateAndAllowsErrorBodies(t *testing.T) {
	router, err := New(Options{
		Logger:              newTestLogger(t, io.Discard),
		DefaultBodyBytes:    1024,
		UserAllowedOrigins:  []string{"https://user.example.com"},
		AdminAllowedOrigins: []string{"https://admin.example.com"},
		ExternalOrigin:      staticExternalOrigin("https://api.example.com"),
		RegisterRoutes: func(user, admin *gin.RouterGroup) {
			user.GET("/error", func(context *gin.Context) {
				response.WriteError(context, "", apperror.ErrInternal)
			})
			admin.GET("/probe", func(context *gin.Context) {
				context.Status(http.StatusNoContent)
			})
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	userError := httptest.NewRecorder()
	userRequest := httptest.NewRequest(http.MethodGet, "/api/v1/error", nil)
	userRequest.Header.Set("Origin", "https://user.example.com")
	router.ServeHTTP(userError, userRequest)
	if userError.Code != http.StatusInternalServerError {
		t.Fatalf("用户端错误路由 status=%d", userError.Code)
	}
	assertHeader(t, userError, "Access-Control-Allow-Origin", "https://user.example.com")
	assertHeader(t, userError, "Access-Control-Allow-Credentials", "true")
	assertHeader(t, userError, "Access-Control-Expose-Headers", "X-Request-ID")

	for _, attempt := range []struct {
		path   string
		origin string
	}{
		{path: "/api/admin/v1/probe", origin: "https://user.example.com"},
		{path: "/api/v1/error", origin: "https://admin.example.com"},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, attempt.path, nil)
		request.Header.Set("Origin", attempt.origin)
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("Origin 策略串用：path=%s origin=%s status=%d", attempt.path, attempt.origin, recorder.Code)
		}
	}
}

func TestCORSSchemefulSiteCoversPublicSuffixLocalhostAndIP(t *testing.T) {
	tests := []struct {
		name     string
		external string
		allowed  string
		status   int
	}{
		{name: "example co uk same site", external: "https://api.example.co.uk", allowed: "https://app.example.co.uk", status: http.StatusNoContent},
		{name: "example co uk cross site", external: "https://api.example.co.uk", allowed: "https://app.evil.co.uk", status: http.StatusForbidden},
		{name: "different scheme", external: "https://api.example.com", allowed: "http://app.example.com", status: http.StatusForbidden},
		{name: "localhost different port", external: "http://localhost:8080", allowed: "http://localhost:3000", status: http.StatusNoContent},
		{name: "localhost different host", external: "http://localhost:8080", allowed: "http://other.localhost:3000", status: http.StatusForbidden},
		{name: "same IP different port", external: "http://127.0.0.1:8080", allowed: "http://127.0.0.1:3000", status: http.StatusNoContent},
		{name: "different IP", external: "http://127.0.0.1:8080", allowed: "http://127.0.0.2:3000", status: http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := newCORSRouter(t, Options{
				UserAllowedOrigins: []string{test.allowed},
				ExternalOrigin:     staticExternalOrigin(test.external),
			})
			request := httptest.NewRequest(http.MethodGet, "/api/v1/probe", nil)
			request.Header.Set("Origin", test.allowed)
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, request)

			if recorder.Code != test.status {
				t.Fatalf("status=%d，期望=%d body=%q", recorder.Code, test.status, recorder.Body.String())
			}
		})
	}
}

func TestCORSAllowsSameOriginWithEmptyListAndIgnoresForwardedHeaders(t *testing.T) {
	sameOriginRouter := newCORSRouter(t, Options{
		ExternalOrigin: staticExternalOrigin("https://api.example.com"),
	})
	sameRequest := httptest.NewRequest(http.MethodGet, "/api/v1/probe", nil)
	sameRequest.Header.Set("Origin", "https://api.example.com")
	sameRecorder := httptest.NewRecorder()
	sameOriginRouter.ServeHTTP(sameRecorder, sameRequest)
	if sameRecorder.Code != http.StatusNoContent {
		t.Fatalf("空白名单必须允许同源请求：status=%d", sameRecorder.Code)
	}

	directRouter := newCORSRouter(t, Options{
		UserAllowedOrigins: []string{"https://app.example.com"},
	})
	request := httptest.NewRequest(http.MethodGet, "http://api.example.com/api/v1/probe", nil)
	request.Host = "api.example.com"
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Header.Set("X-Forwarded-Host", "api.example.com")
	recorder := httptest.NewRecorder()
	directRouter.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("G0-T05 不得信任 X-Forwarded-*：status=%d", recorder.Code)
	}
}

func TestCORSDefensivelyCopiesOriginLists(t *testing.T) {
	origins := []string{"https://app.example.com"}
	router := newCORSRouter(t, Options{
		UserAllowedOrigins: origins,
		ExternalOrigin:     staticExternalOrigin("https://api.example.com"),
	})
	origins[0] = "https://mutated.example.com"
	request := httptest.NewRequest(http.MethodGet, "/api/v1/probe", nil)
	request.Header.Set("Origin", "https://app.example.com")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("Router 保留了调用方 Origin slice：status=%d", recorder.Code)
	}
}

func newCORSRouter(t *testing.T, options Options) *gin.Engine {
	t.Helper()
	options.Logger = newTestLogger(t, io.Discard)
	options.DefaultBodyBytes = 1024
	options.RegisterRoutes = func(user, admin *gin.RouterGroup) {
		user.GET("/probe", func(context *gin.Context) {
			context.Status(http.StatusNoContent)
		})
		admin.GET("/probe", func(context *gin.Context) {
			context.Status(http.StatusNoContent)
		})
	}
	router, err := New(options)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return router
}

func staticExternalOrigin(origin string) func(*http.Request) (string, error) {
	return func(*http.Request) (string, error) {
		return origin, nil
	}
}

func assertHeader(t *testing.T, recorder *httptest.ResponseRecorder, key, want string) {
	t.Helper()
	if got := recorder.Header().Get(key); got != want {
		t.Fatalf("%s=%q，期望=%q", key, got, want)
	}
}

func assertVarySet(t *testing.T, recorder *httptest.ResponseRecorder, want []string) {
	t.Helper()
	actual := make(map[string]bool)
	for _, value := range recorder.Header().Values("Vary") {
		for _, token := range strings.Split(value, ",") {
			actual[strings.ToLower(strings.TrimSpace(token))] = true
		}
	}
	if len(actual) != len(want) {
		t.Fatalf("Vary 集合=%v，期望=%v", actual, want)
	}
	for _, token := range want {
		if !actual[strings.ToLower(token)] {
			t.Fatalf("Vary 缺少 %q：%v", token, actual)
		}
	}
}
