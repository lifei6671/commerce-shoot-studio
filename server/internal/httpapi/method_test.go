package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMethodGuardRejectsDisabledAndNonStandardMethods(t *testing.T) {
	router, err := New(Options{
		Logger:           newTestLogger(t, io.Discard),
		DefaultBodyBytes: 1024,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	for _, method := range []string{
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
		http.MethodConnect,
		http.MethodTrace,
		"RAW_METHOD_SECRET_MARKER",
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(method, "/api/v1/missing", nil)
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("method=%s status=%d body=%q", method, recorder.Code, recorder.Body.String())
		}
		assertHeader(t, recorder, "Allow", allowMethods)
		body := decodeErrorResponse(t, recorder)
		if body["code"].(json.Number).String() != "100405" || body["message"] != "请求方法不允许" {
			t.Fatalf("method=%s 错误合同=%v", method, body)
		}
		if strings.Contains(recorder.Body.String(), "RAW_METHOD_SECRET_MARKER") {
			t.Fatal("非标准 method 泄漏到错误响应")
		}
	}
}

func TestOrdinaryOptionsAndOptionsStarReturn405(t *testing.T) {
	router := newCORSRouter(t, Options{
		UserAllowedOrigins: []string{"https://app.example.com"},
	})
	ordinary := httptest.NewRequest(http.MethodOptions, "/api/v1/probe", nil)
	setRequestExternalOrigin(t, ordinary, "https://api.example.com")
	ordinary.Header.Set("Origin", "https://app.example.com")
	ordinaryRecorder := httptest.NewRecorder()
	router.ServeHTTP(ordinaryRecorder, ordinary)
	if ordinaryRecorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("普通 OPTIONS status=%d body=%q", ordinaryRecorder.Code, ordinaryRecorder.Body.String())
	}
	assertHeader(t, ordinaryRecorder, "Allow", allowMethods)
	assertHeader(t, ordinaryRecorder, "Access-Control-Allow-Origin", "https://app.example.com")

	star := httptest.NewRequest(http.MethodOptions, "*", nil)
	star.RequestURI = "*"
	starRecorder := httptest.NewRecorder()
	router.ServeHTTP(starRecorder, star)
	if starRecorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("OPTIONS * status=%d body=%q", starRecorder.Code, starRecorder.Body.String())
	}
	assertHeader(t, starRecorder, "Allow", allowMethods)
}

func TestHEADUsesRealHTTPServerAndKeepsWireBodyEmpty(t *testing.T) {
	router, err := New(Options{
		Logger:             newTestLogger(t, io.Discard),
		DefaultBodyBytes:   1024,
		UserAllowedOrigins: []string{"http://app.example.com"},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	server := httptest.NewServer(router)
	defer server.Close()
	client := &http.Client{Timeout: 2 * time.Second}
	request, err := http.NewRequest(http.MethodHead, server.URL+"/api/v1/missing", nil)
	if err != nil {
		t.Fatalf("构造 HEAD 请求失败：%v", err)
	}
	request.Header.Set("Origin", "http://app.example.com")
	request.Host = "api.example.com"

	result, err := client.Do(request)
	if err != nil {
		t.Fatalf("真实 HEAD 请求失败：%v", err)
	}
	defer result.Body.Close()
	if result.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("HEAD status=%d", result.StatusCode)
	}
	if result.ContentLength > 0 {
		t.Fatalf("HEAD 线路不得声明响应 body：ContentLength=%d", result.ContentLength)
	}
	content, err := io.ReadAll(result.Body)
	if err != nil {
		t.Fatalf("读取 HEAD body 失败：%v", err)
	}
	if len(content) != 0 {
		t.Fatalf("HEAD 线路 body=%q", content)
	}
	if result.Header.Get("Allow") != allowMethods || result.Header.Get("Access-Control-Allow-Origin") != "http://app.example.com" {
		t.Fatalf("HEAD Header 不完整：%v", result.Header)
	}
}

func TestMethodGuardKeepsGETAndPOSTOnNoRouteContract(t *testing.T) {
	router, err := New(Options{
		Logger:           newTestLogger(t, io.Discard),
		DefaultBodyBytes: 1024,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(method, "/api/v1/missing", nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("method=%s status=%d", method, recorder.Code)
		}
	}
}
