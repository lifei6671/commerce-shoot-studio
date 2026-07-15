package httpapi

import (
	"crypto/tls"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTrustedProxyConfiguresGinAndCopiesPrefixes(t *testing.T) {
	prefixes := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	router := newProxyRouter(t, prefixes)
	if router.ForwardedByClientIP || router.RemoteIPHeaders != nil || router.TrustedPlatform != "" || router.AppEngine {
		t.Fatalf("Gin proxy shortcut 未完全关闭：%+v", router)
	}
	prefixes[0] = netip.MustParsePrefix("192.0.2.0/24")

	request := proxyRequest(http.MethodGet, "/api/v1/probe", "10.1.2.3:1234", "internal:8080")
	setForwardedTuple(request, "198.51.100.7", "https", "api.example.com")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	assertProxyMetadata(t, recorder, http.StatusOK, "198.51.100.7", "https://api.example.com", true)
}

func TestDirectRequestMetadataNormalizesAddressesAndIgnoresForwardedHeaders(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		host       string
		tls        bool
		clientIP   string
		origin     string
	}{
		{name: "IPv4", remoteAddr: "192.0.2.1:1234", host: "api.example.com:8080", clientIP: "192.0.2.1", origin: "http://api.example.com:8080"},
		{name: "IPv6", remoteAddr: "[2001:db8::1]:1234", host: "[2001:db8::2]:8443", tls: true, clientIP: "2001:db8::1", origin: "https://[2001:db8::2]:8443"},
		{name: "mapped IPv4", remoteAddr: "[::ffff:192.0.2.9]:1234", host: "api.example.com", tls: true, clientIP: "192.0.2.9", origin: "https://api.example.com"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := newProxyRouter(t, nil)
			request := proxyRequest(http.MethodGet, "/api/v1/probe", test.remoteAddr, test.host)
			if test.tls {
				request.TLS = &tls.ConnectionState{}
			}
			setForwardedTuple(request, "203.0.113.8", "https", "spoofed.example.com")
			request.Header.Set("Forwarded", "for=203.0.113.8")
			request.Header.Set("X-Real-IP", "203.0.113.8")
			request.Header.Set("X-Forwarded-Secret", "PROXY_HEADER_SECRET_MARKER")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			assertProxyMetadata(t, recorder, http.StatusOK, test.clientIP, test.origin, false)
			if strings.Contains(recorder.Body.String(), "PROXY_HEADER_SECRET_MARKER") {
				t.Fatal("代理 Header marker 泄漏到响应")
			}
		})
	}
}

func TestTrustedProxyMatchesMappedPeerAndParsesSingleTuple(t *testing.T) {
	router := newProxyRouter(t, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
	request := proxyRequest(http.MethodGet, "/api/v1/probe", "[::ffff:10.1.2.3]:1234", "internal:8080")
	setForwardedTuple(request, "::ffff:198.51.100.8", "https", "api.example.com:8443")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	assertProxyMetadata(t, recorder, http.StatusOK, "198.51.100.8", "https://api.example.com:8443", true)
}

func TestTrustedProxyMatchesNativeIPv6Peer(t *testing.T) {
	router := newProxyRouter(t, []netip.Prefix{netip.MustParsePrefix("2001:db8:1::/48")})
	request := proxyRequest(http.MethodGet, "/api/v1/probe", "[2001:db8:1::8]:1234", "internal:8080")
	setForwardedTuple(request, "2001:db8:2::9", "https", "[2001:db8:3::10]:8443")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	assertProxyMetadata(t, recorder, http.StatusOK, "2001:db8:2::9", "https://[2001:db8:3::10]:8443", true)
}

func TestConfiguredTrustedProxyIgnoresTupleFromUntrustedPeer(t *testing.T) {
	router := newProxyRouter(t, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
	request := proxyRequest(http.MethodGet, "/api/v1/probe", "192.0.2.8:1234", "api.example.com")
	setForwardedTuple(request, "198.51.100.9", "https", "spoofed.example.com")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	assertProxyMetadata(t, recorder, http.StatusOK, "192.0.2.8", "http://api.example.com", false)
}

func TestTrustedProxyRejectsInvalidTransportAndForwardedTuple(t *testing.T) {
	tests := []struct {
		name      string
		configure func(*http.Request)
	}{
		{name: "zoned peer", configure: func(request *http.Request) { request.RemoteAddr = "[fe80::1%25eth0]:1234" }},
		{name: "missing XFF", configure: func(request *http.Request) { request.Header.Del("X-Forwarded-For") }},
		{name: "missing proto", configure: func(request *http.Request) { request.Header.Del("X-Forwarded-Proto") }},
		{name: "missing host", configure: func(request *http.Request) { request.Header.Del("X-Forwarded-Host") }},
		{name: "empty XFF", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-For", "") }},
		{name: "empty proto", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Proto", "") }},
		{name: "empty host", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Host", "") }},
		{name: "repeated XFF", configure: func(request *http.Request) { request.Header.Add("X-Forwarded-For", "198.51.100.9") }},
		{name: "XFF chain", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-For", "198.51.100.8, 198.51.100.9") }},
		{name: "invalid XFF", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-For", "PROXY_SECRET_MARKER") }},
		{name: "zoned XFF", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-For", "fe80::1%eth0") }},
		{name: "uppercase proto", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Proto", "HTTPS") }},
		{name: "proto chain", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Proto", "https,http") }},
		{name: "repeated proto", configure: func(request *http.Request) { request.Header.Add("X-Forwarded-Proto", "https") }},
		{name: "uppercase host", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Host", "API.Example.com") }},
		{name: "default port", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Host", "api.example.com:443") }},
		{name: "noncanonical IPv6", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Host", "[2001:0db8::1]") }},
		{name: "host path", configure: func(request *http.Request) {
			request.Header.Set("X-Forwarded-Host", "api.example.com/PROXY_SECRET_MARKER")
		}},
		{name: "host query", configure: func(request *http.Request) {
			request.Header.Set("X-Forwarded-Host", "api.example.com?PROXY_SECRET_MARKER")
		}},
		{name: "host fragment", configure: func(request *http.Request) {
			request.Header.Set("X-Forwarded-Host", "api.example.com#PROXY_SECRET_MARKER")
		}},
		{name: "host userinfo", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Host", "user@api.example.com") }},
		{name: "host invalid port", configure: func(request *http.Request) { request.Header.Set("X-Forwarded-Host", "api.example.com:99999") }},
		{name: "host control", configure: func(request *http.Request) {
			request.Header["X-Forwarded-Host"] = []string{"api.example.com\nPROXY_SECRET_MARKER"}
		}},
		{name: "host comma", configure: func(request *http.Request) {
			request.Header.Set("X-Forwarded-Host", "api.example.com,evil.example.com")
		}},
		{name: "repeated host", configure: func(request *http.Request) { request.Header.Add("X-Forwarded-Host", "api.example.com") }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := newProxyRouter(t, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
			request := proxyRequest(http.MethodGet, "/api/v1/probe", "10.1.2.3:1234", "internal:8080")
			setForwardedTuple(request, "198.51.100.8", "https", "api.example.com")
			test.configure(request)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("非法代理元数据 status=%d body=%q", recorder.Code, recorder.Body.String())
			}
			body := decodeErrorResponse(t, recorder)
			if body["code"].(json.Number).String() != "100403" {
				t.Fatalf("非法代理元数据错误合同=%v", body)
			}
			if strings.Contains(recorder.Body.String(), "PROXY_SECRET_MARKER") {
				t.Fatal("非法代理元数据原值泄漏")
			}
		})
	}
}

func TestTrustedProxyIgnoresTupleOutsideBusinessAPI(t *testing.T) {
	router := newProxyRouter(t, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
	request := proxyRequest(http.MethodGet, "/healthz", "10.1.2.3:1234", "internal:8080")
	request.Header.Set("X-Forwarded-For", "invalid,chain")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("非业务路径不得校验 forwarded tuple：status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestNewRejectsInvalidTrustedProxyPrefixesWithoutEcho(t *testing.T) {
	for _, prefix := range []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/0"),
		netip.MustParsePrefix("::/0"),
		netip.MustParsePrefix("::ffff:192.0.2.0/120"),
		netip.MustParsePrefix("10.0.0.1/8"),
	} {
		_, err := New(Options{
			Logger:            newTestLogger(t, io.Discard),
			DefaultBodyBytes:  1024,
			TrustedProxyCIDRs: []netip.Prefix{prefix},
		})
		if err == nil {
			t.Fatalf("非法 trusted proxy prefix %v 应拒绝", prefix)
		}
		if strings.Contains(err.Error(), prefix.String()) {
			t.Fatalf("构造错误回显 trusted proxy prefix：%v", err)
		}
	}
}

func newProxyRouter(t *testing.T, prefixes []netip.Prefix) *gin.Engine {
	t.Helper()
	router, err := New(Options{
		Logger:            newTestLogger(t, io.Discard),
		DefaultBodyBytes:  1024,
		TrustedProxyCIDRs: prefixes,
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			user.GET("/probe", func(context *gin.Context) {
				metadata, ok := requestMetadataFromRequest(context.Request)
				if !ok {
					context.Status(http.StatusInternalServerError)
					return
				}
				for name := range context.Request.Header {
					lower := strings.ToLower(name)
					if strings.HasPrefix(lower, "x-forwarded-") || lower == "forwarded" || lower == "x-real-ip" {
						context.Status(http.StatusInternalServerError)
						return
					}
				}
				context.JSON(http.StatusOK, gin.H{
					"clientIP": metadata.clientIP.String(), "externalOrigin": metadata.externalOrigin.normalized,
					"trustedProxy": metadata.trustedProxy,
				})
			})
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return router
}

func proxyRequest(method, path, remoteAddr, host string) *http.Request {
	request := httptest.NewRequest(method, path, nil)
	request.RemoteAddr = remoteAddr
	request.Host = host
	return request
}

func setForwardedTuple(request *http.Request, clientIP, scheme, host string) {
	request.Header.Set("X-Forwarded-For", clientIP)
	request.Header.Set("X-Forwarded-Proto", scheme)
	request.Header.Set("X-Forwarded-Host", host)
}

func assertProxyMetadata(t *testing.T, recorder *httptest.ResponseRecorder, status int, clientIP, origin string, trusted bool) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("status=%d，期望=%d body=%q", recorder.Code, status, recorder.Body.String())
	}
	var body struct {
		ClientIP       string `json:"clientIP"`
		ExternalOrigin string `json:"externalOrigin"`
		TrustedProxy   bool   `json:"trustedProxy"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析 metadata 响应失败：%v", err)
	}
	if body.ClientIP != clientIP || body.ExternalOrigin != origin || body.TrustedProxy != trusted {
		t.Fatalf("metadata=%+v，期望 client=%q origin=%q trusted=%v", body, clientIP, origin, trusted)
	}
}
