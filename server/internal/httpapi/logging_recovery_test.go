package httpapi

import (
	"bytes"
	stdContext "context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

func TestRecoveryMapsUncommittedPanicBeforeCompletionLogging(t *testing.T) {
	const marker = "PANIC_SECRET_PATH_PROMPT_MARKER"
	var output bytes.Buffer
	router, err := New(Options{
		Logger:             newTestLogger(t, &output),
		DefaultBodyBytes:   1024,
		UserAllowedOrigins: []string{"https://app.example.com"},
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			user.GET("/panic", func(*gin.Context) {
				panic(marker)
			})
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/panic", nil)
	setRequestExternalOrigin(t, request, "https://api.example.com")
	request.Header.Set("Origin", "https://app.example.com")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("panic status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), marker) {
		t.Fatal("panic 原值泄漏到响应")
	}
	requestID := recorder.Header().Get("X-Request-ID")
	body := decodeErrorResponse(t, recorder)
	if body["requestId"] != requestID {
		t.Fatalf("panic 错误体与响应 Header 的 Request ID 不一致：body=%v header=%q", body, requestID)
	}
	assertHeader(t, recorder, "Access-Control-Allow-Origin", "https://app.example.com")
	logs := decodeLogLines(t, output.Bytes())
	if len(logs) != 1 {
		t.Fatalf("panic 完成日志行数=%d，内容=%q", len(logs), output.Bytes())
	}
	assertLogField(t, logs[0], "level", "error")
	assertLogField(t, logs[0], "method", http.MethodGet)
	assertLogField(t, logs[0], "route_template", "/api/v1/panic")
	assertLogField(t, logs[0], "request_id", requestID)
	assertLogNumber(t, logs[0], "status_code", "500")
	assertLogNumber(t, logs[0], "error_code", "100500")
	if strings.Contains(output.String(), marker) || strings.Contains(output.String(), "stack") {
		t.Fatal("panic 原值或 stack 泄漏到完成日志")
	}
}

func TestRecoveryDoesNotAppendJSONAfterCommittedResponse(t *testing.T) {
	const marker = "COMMITTED_PANIC_SECRET_MARKER"
	var output bytes.Buffer
	router, err := New(Options{
		Logger:           newTestLogger(t, &output),
		DefaultBodyBytes: 1024,
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			user.GET("/committed", func(context *gin.Context) {
				context.String(http.StatusAccepted, "partial")
				panic(fmt.Errorf("%s", marker))
			})
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/committed", nil))

	if recorder.Code != http.StatusAccepted || recorder.Body.String() != "partial" {
		t.Fatalf("已提交 panic 不得覆盖或追加响应：status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	logs := decodeLogLines(t, output.Bytes())
	if len(logs) != 1 {
		t.Fatalf("已提交 panic 完成日志行数=%d", len(logs))
	}
	assertLogNumber(t, logs[0], "status_code", "202")
	assertLogNumber(t, logs[0], "error_code", "100500")
	if strings.Contains(output.String(), marker) {
		t.Fatal("已提交 panic marker 泄漏到日志")
	}
}

func TestCompletionLogsEveryEarlyExitExactlyOnce(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		configure  func(*http.Request)
		body       string
		wantStatus int
		wantCode   string
		wantMethod string
		wantLevel  string
	}{
		{name: "success", method: http.MethodGet, path: "/api/v1/probe", wantStatus: 200, wantMethod: "GET", wantLevel: "info"},
		{name: "invalid JSON", method: http.MethodPost, path: "/api/v1/bind", body: `{"value":`, wantStatus: 400, wantCode: "100400", wantMethod: "POST", wantLevel: "warn"},
		{name: "no route", method: http.MethodGet, path: "/api/v1/RAW_PATH_SECRET?q=QUERY_SECRET", wantStatus: 404, wantCode: "100404", wantMethod: "GET", wantLevel: "warn"},
		{name: "cors reject", method: http.MethodGet, path: "/api/v1/probe", configure: func(request *http.Request) { request.Header.Set("Origin", "https://evil.example.com") }, wantStatus: 403, wantCode: "100403", wantMethod: "GET", wantLevel: "warn"},
		{name: "put", method: http.MethodPut, path: "/api/v1/probe", wantStatus: 405, wantCode: "100405", wantMethod: "PUT", wantLevel: "warn"},
		{name: "patch", method: http.MethodPatch, path: "/api/v1/probe", wantStatus: 405, wantCode: "100405", wantMethod: "PATCH", wantLevel: "warn"},
		{name: "delete", method: http.MethodDelete, path: "/api/v1/probe", wantStatus: 405, wantCode: "100405", wantMethod: "DELETE", wantLevel: "warn"},
		{name: "head", method: http.MethodHead, path: "/api/v1/probe", wantStatus: 405, wantCode: "100405", wantMethod: "HEAD", wantLevel: "warn"},
		{name: "connect", method: http.MethodConnect, path: "/api/v1/probe", wantStatus: 405, wantCode: "100405", wantMethod: "CONNECT", wantLevel: "warn"},
		{name: "trace", method: http.MethodTrace, path: "/api/v1/probe", wantStatus: 405, wantCode: "100405", wantMethod: "TRACE", wantLevel: "warn"},
		{name: "other method", method: "RAW_METHOD_SECRET_MARKER", path: "/api/v1/probe", wantStatus: 405, wantCode: "100405", wantMethod: "OTHER", wantLevel: "warn"},
		{name: "ordinary options", method: http.MethodOptions, path: "/api/v1/probe", wantStatus: 405, wantCode: "100405", wantMethod: "OPTIONS", wantLevel: "warn"},
		{name: "valid preflight", method: http.MethodOptions, path: "/api/v1/probe", configure: func(request *http.Request) {
			request.Header.Set("Origin", "https://app.example.com")
			request.Header.Set("Access-Control-Request-Method", http.MethodPost)
		}, wantStatus: 204, wantMethod: "OPTIONS", wantLevel: "info"},
		{name: "known body limit", method: http.MethodPost, path: "/api/v1/probe", body: strings.Repeat("x", 33), wantStatus: 413, wantCode: "100413", wantMethod: "POST", wantLevel: "warn"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			router, err := New(Options{
				Logger:             newTestLogger(t, &output),
				DefaultBodyBytes:   32,
				UserAllowedOrigins: []string{"https://app.example.com"},
				RegisterRoutes: func(user, _ *gin.RouterGroup) {
					user.GET("/probe", func(context *gin.Context) { context.Status(http.StatusOK) })
					user.POST("/probe", func(context *gin.Context) { context.Status(http.StatusNoContent) })
					user.POST("/bind", func(context *gin.Context) {
						var input map[string]any
						if err := BindJSON(context, &input); err != nil {
							response.WriteError(context, err)
							return
						}
						context.Status(http.StatusNoContent)
					})
				},
			})
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			setRequestExternalOrigin(t, request, "https://api.example.com")
			if test.configure != nil {
				test.configure(request)
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status=%d，期望=%d body=%q", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			requestID := recorder.Header().Get("X-Request-ID")
			if len(requestID) != 32 || requestID != strings.ToLower(requestID) {
				t.Fatalf("响应 Request ID 格式非法：%q", requestID)
			}
			logs := decodeLogLines(t, output.Bytes())
			if len(logs) != 1 {
				t.Fatalf("完成日志行数=%d，内容=%q", len(logs), output.Bytes())
			}
			assertLogField(t, logs[0], "method", test.wantMethod)
			assertLogField(t, logs[0], "level", test.wantLevel)
			assertLogField(t, logs[0], "request_id", requestID)
			assertLogNumber(t, logs[0], "status_code", fmt.Sprint(test.wantStatus))
			if test.wantCode == "" {
				if _, exists := logs[0]["error_code"]; exists {
					t.Fatalf("成功响应不应有 error_code：%v", logs[0])
				}
			} else {
				assertLogNumber(t, logs[0], "error_code", test.wantCode)
				if test.method != http.MethodHead {
					body := decodeErrorResponse(t, recorder)
					if body["requestId"] != requestID {
						t.Fatalf("错误体与响应 Header 的 Request ID 不一致：body=%v header=%q", body, requestID)
					}
				}
			}
			serialized := output.String()
			for _, marker := range []string{"RAW_PATH_SECRET", "QUERY_SECRET", "RAW_METHOD_SECRET_MARKER"} {
				if strings.Contains(serialized, marker) {
					t.Fatalf("完成日志泄漏 marker %q：%s", marker, serialized)
				}
			}
		})
	}
}

func TestCompletionUsesRouteTemplateAndIgnoresRequestIDHeader(t *testing.T) {
	var output bytes.Buffer
	router, err := New(Options{
		Logger:           newTestLogger(t, &output),
		DefaultBodyBytes: 1024,
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			user.GET("/items/:id", func(context *gin.Context) { context.Status(http.StatusOK) })
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/items/RAW_ID_SECRET?token=QUERY_SECRET", nil)
	request.Header.Set("X-Request-ID", "UNTRUSTED_REQUEST_ID_SECRET")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	logs := decodeLogLines(t, output.Bytes())
	if len(logs) != 1 {
		t.Fatalf("完成日志行数=%d", len(logs))
	}
	assertLogField(t, logs[0], "route_template", "/api/v1/items/:id")
	requestID := recorder.Header().Get("X-Request-ID")
	if requestID == "" || requestID == "UNTRUSTED_REQUEST_ID_SECRET" {
		t.Fatalf("服务端 Request ID 非法：%q", requestID)
	}
	assertLogField(t, logs[0], "request_id", requestID)
	serialized := output.String()
	for _, marker := range []string{"RAW_ID_SECRET", "QUERY_SECRET", "UNTRUSTED_REQUEST_ID_SECRET"} {
		if strings.Contains(serialized, marker) {
			t.Fatalf("日志泄漏 marker %q：%s", marker, serialized)
		}
	}
}

func TestConcurrentCompletionLogsDoNotCrossRequestIDs(t *testing.T) {
	var output lockedBuffer
	const count = 32
	var entered sync.WaitGroup
	entered.Add(count)
	release := make(chan struct{})
	handler := func(fail bool) gin.HandlerFunc {
		return func(context *gin.Context) {
			entered.Done()
			<-release
			context.Request = context.Request.WithContext(stdContext.Background())
			if fail {
				response.WriteError(context, apperror.ErrForbidden)
				return
			}
			context.Status(http.StatusNoContent)
		}
	}
	router, err := New(Options{
		Logger:           newTestLogger(t, &output),
		DefaultBodyBytes: 1024,
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			user.GET("/success/:id", handler(false))
			user.GET("/failure/:id", handler(true))
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	type outcome struct {
		requestID string
		route     string
		bodyID    string
		status    int
	}
	var waitGroup sync.WaitGroup
	outcomes := make(chan outcome, count)
	for index := 0; index < count; index++ {
		waitGroup.Add(1)
		go func(index int) {
			defer waitGroup.Done()
			route := "/api/v1/success/:id"
			path := fmt.Sprintf("/api/v1/success/%d", index)
			if index%2 == 1 {
				route = "/api/v1/failure/:id"
				path = fmt.Sprintf("/api/v1/failure/%d", index)
			}
			request := httptest.NewRequest(http.MethodGet, path, nil)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			var body struct {
				RequestID string `json:"requestId"`
			}
			if recorder.Body.Len() > 0 {
				_ = json.Unmarshal(recorder.Body.Bytes(), &body)
			}
			outcomes <- outcome{requestID: recorder.Header().Get("X-Request-ID"), route: route, bodyID: body.RequestID, status: recorder.Code}
		}(index)
	}
	go func() {
		entered.Wait()
		close(release)
	}()
	waitGroup.Wait()
	close(outcomes)
	want := make(map[string]outcome, count)
	for current := range outcomes {
		if current.requestID == "" || want[current.requestID].requestID != "" {
			t.Fatalf("响应 Request ID 缺失或重复：%q", current.requestID)
		}
		if current.status == http.StatusForbidden && current.bodyID != current.requestID {
			t.Fatalf("并发错误体 Request ID 串用：%+v", current)
		}
		want[current.requestID] = current
	}
	logs := decodeLogLines(t, output.BytesCopy())
	if len(logs) != count {
		t.Fatalf("并发完成日志行数=%d，期望=%d", len(logs), count)
	}
	seen := make(map[string]bool, count)
	for _, record := range logs {
		requestID, _ := record["request_id"].(string)
		expected, exists := want[requestID]
		if !exists || seen[requestID] {
			t.Fatalf("request_id 缺失或交叉：%v", record)
		}
		seen[requestID] = true
		assertLogField(t, record, "route_template", expected.route)
	}
}

func decodeLogLines(t *testing.T, content []byte) []map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	var records []map[string]any
	for {
		var record map[string]any
		if err := decoder.Decode(&record); err != nil {
			if err == io.EOF {
				return records
			}
			t.Fatalf("解析日志失败：%v，content=%q", err, content)
		}
		records = append(records, record)
	}
}

func assertLogField(t *testing.T, record map[string]any, key string, want any) {
	t.Helper()
	if got := record[key]; got != want {
		t.Fatalf("日志字段 %s=%v，期望=%v，record=%v", key, got, want, record)
	}
}

func assertLogNumber(t *testing.T, record map[string]any, key, want string) {
	t.Helper()
	value, ok := record[key].(json.Number)
	if !ok || value.String() != want {
		t.Fatalf("日志数字字段 %s=%v，期望=%s，record=%v", key, record[key], want, record)
	}
}
