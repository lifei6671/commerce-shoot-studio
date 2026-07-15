package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

func TestBodyLimitRejectsKnownLengthBeforeHandler(t *testing.T) {
	var entered atomic.Int64
	router := newBodyRouter(t, 32, nil, func(user *gin.RouterGroup) {
		user.POST("/known", func(context *gin.Context) {
			entered.Add(1)
			context.Status(http.StatusNoContent)
		})
	})
	body := strings.Repeat("x", 33)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/known", strings.NewReader(body))
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	assertBodyLimitError(t, recorder)
	if entered.Load() != 0 {
		t.Fatal("已知 Content-Length 超限时不得进入 handler")
	}
}

func TestChunkedBodyIsNotPreReadAndBindJSONPrecedesSideEffects(t *testing.T) {
	var entered atomic.Int64
	var sideEffects atomic.Int64
	var preRead atomic.Bool
	reader := &countingReadCloser{reader: strings.NewReader(`{"value":"` + strings.Repeat("x", 64) + `"}`)}
	router := newBodyRouter(t, 32, nil, func(user *gin.RouterGroup) {
		user.POST("/chunked", func(context *gin.Context) {
			entered.Add(1)
			if reader.reads.Load() != 0 {
				preRead.Store(true)
			}
			var input struct {
				Value string `json:"value"`
			}
			if err := BindJSON(context, &input); err != nil {
				response.WriteError(context, "", err)
				return
			}
			sideEffects.Add(1)
			context.Status(http.StatusNoContent)
		})
	})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/chunked", nil)
	request.Body = reader
	request.ContentLength = -1
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	assertBodyLimitError(t, recorder)
	if entered.Load() != 1 || sideEffects.Load() != 0 || preRead.Load() {
		t.Fatalf("chunked 绑定顺序错误：entered=%d sideEffects=%d preRead=%v", entered.Load(), sideEffects.Load(), preRead.Load())
	}
}

func TestBindJSONMapsMalformedInputAndAllowsValidInput(t *testing.T) {
	var sideEffects atomic.Int64
	router := newBodyRouter(t, 128, nil, func(user *gin.RouterGroup) {
		user.POST("/bind", func(context *gin.Context) {
			var input struct {
				Value string `json:"value"`
			}
			if err := BindJSON(context, &input); err != nil {
				response.WriteError(context, "", err)
				return
			}
			sideEffects.Add(1)
			context.Status(http.StatusNoContent)
		})
	})

	malformed := httptest.NewRecorder()
	router.ServeHTTP(malformed, httptest.NewRequest(http.MethodPost, "/api/v1/bind", strings.NewReader(`{"value":`)))
	if malformed.Code != http.StatusBadRequest {
		t.Fatalf("非法 JSON status=%d body=%q", malformed.Code, malformed.Body.String())
	}
	malformedBody := decodeErrorResponse(t, malformed)
	if malformedBody["code"].(json.Number).String() != "100400" {
		t.Fatalf("非法 JSON code=%v", malformedBody)
	}
	if sideEffects.Load() != 0 {
		t.Fatal("非法 JSON 不得产生业务副作用")
	}

	valid := httptest.NewRecorder()
	router.ServeHTTP(valid, httptest.NewRequest(http.MethodPost, "/api/v1/bind", strings.NewReader(`{"value":"ok"}`)))
	if valid.Code != http.StatusNoContent || sideEffects.Load() != 1 {
		t.Fatalf("合法 JSON 未进入业务逻辑：status=%d sideEffects=%d", valid.Code, sideEffects.Load())
	}
}

func TestBindJSONRejectsTrailingJSONAndOversizedTrailingBytes(t *testing.T) {
	tests := []struct {
		name       string
		limit      int64
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name:       "第二个 JSON 值",
			limit:      128,
			body:       `{"value":"ok"}{"extra":true}`,
			wantCode:   "100400",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "超出限制的尾随空白",
			limit:      int64(len(`{"value":"ok"}`)),
			body:       `{"value":"ok"} `,
			wantCode:   "100413",
			wantStatus: http.StatusRequestEntityTooLarge,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var sideEffects atomic.Int64
			router := newBodyRouter(t, test.limit, nil, func(user *gin.RouterGroup) {
				user.POST("/bind-complete", func(context *gin.Context) {
					var input struct {
						Value string `json:"value"`
					}
					if err := BindJSON(context, &input); err != nil {
						response.WriteError(context, "", err)
						return
					}
					sideEffects.Add(1)
					context.Status(http.StatusNoContent)
				})
			})
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/bind-complete", strings.NewReader(test.body)))

			if recorder.Code != test.wantStatus {
				t.Fatalf("status=%d，期望=%d body=%q", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			body := decodeErrorResponse(t, recorder)
			if body["code"].(json.Number).String() != test.wantCode {
				t.Fatalf("错误合同=%v，期望 code=%s", body, test.wantCode)
			}
			if sideEffects.Load() != 0 {
				t.Fatal("未完整消费或超限的 JSON 不得产生业务副作用")
			}
		})
	}
}

func TestBodyLimitUsesExactRouteOverrideAndCopiesOptions(t *testing.T) {
	overrides := map[RouteKey]int64{
		{Method: http.MethodPost, Template: "/api/v1/small"}: 32,
	}
	router := newBodyRouter(t, 128, overrides, func(user *gin.RouterGroup) {
		handler := func(context *gin.Context) {
			var input map[string]any
			if err := BindJSON(context, &input); err != nil {
				response.WriteError(context, "", err)
				return
			}
			context.Status(http.StatusNoContent)
		}
		user.POST("/small", handler)
		user.POST("/default", handler)
	})
	overrides[RouteKey{Method: http.MethodPost, Template: "/api/v1/small"}] = 1024
	payload := `{"value":"` + strings.Repeat("x", 40) + `"}`

	var waitGroup sync.WaitGroup
	results := make(chan struct {
		path   string
		status int
	}, 40)
	for index := 0; index < 20; index++ {
		for _, path := range []string{"/api/v1/small", "/api/v1/default"} {
			waitGroup.Add(1)
			go func(path string) {
				defer waitGroup.Done()
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(payload)))
				results <- struct {
					path   string
					status int
				}{path: path, status: recorder.Code}
			}(path)
		}
	}
	waitGroup.Wait()
	close(results)
	for result := range results {
		want := http.StatusNoContent
		if result.path == "/api/v1/small" {
			want = http.StatusRequestEntityTooLarge
		}
		if result.status != want {
			t.Fatalf("path=%s status=%d，期望=%d", result.path, result.status, want)
		}
	}
}

func TestBodyLimitAcceptsExactBoundary(t *testing.T) {
	body := `{"value":"ok"}`
	router := newBodyRouter(t, int64(len(body)), nil, func(user *gin.RouterGroup) {
		user.POST("/boundary", func(context *gin.Context) {
			var input map[string]any
			if err := BindJSON(context, &input); err != nil {
				response.WriteError(context, "", err)
				return
			}
			context.Status(http.StatusNoContent)
		})
	})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/boundary", strings.NewReader(body)))
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("精确 limit body 应成功：status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestNewRejectsInvalidBodyLimitOverridesAndRoutes(t *testing.T) {
	tests := []struct {
		name      string
		overrides map[RouteKey]int64
		register  func(user, admin *gin.RouterGroup)
	}{
		{name: "non positive", overrides: map[RouteKey]int64{{Method: http.MethodPost, Template: "/api/v1/probe"}: 0}, register: registerPostProbe},
		{name: "invalid method", overrides: map[RouteKey]int64{{Method: http.MethodDelete, Template: "/api/v1/probe"}: 1}, register: registerPostProbe},
		{name: "outside prefixes", overrides: map[RouteKey]int64{{Method: http.MethodPost, Template: "/other/probe"}: 1}, register: registerPostProbe},
		{name: "unknown route", overrides: map[RouteKey]int64{{Method: http.MethodPost, Template: "/api/v1/missing"}: 1}, register: registerPostProbe},
		{name: "registered forbidden method", register: func(user, _ *gin.RouterGroup) {
			user.DELETE("/probe", func(context *gin.Context) { context.Status(http.StatusNoContent) })
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := New(Options{
				Logger:             newTestLogger(t, io.Discard),
				DefaultBodyBytes:   128,
				BodyLimitOverrides: test.overrides,
				RegisterRoutes:     test.register,
			})
			if err == nil {
				t.Fatal("非法 body limit 或 route 必须快速失败")
			}
		})
	}
}

func newBodyRouter(t *testing.T, defaultLimit int64, overrides map[RouteKey]int64, register func(user *gin.RouterGroup)) *gin.Engine {
	t.Helper()
	router, err := New(Options{
		Logger:             newTestLogger(t, io.Discard),
		DefaultBodyBytes:   defaultLimit,
		BodyLimitOverrides: overrides,
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			register(user)
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return router
}

func registerPostProbe(user, _ *gin.RouterGroup) {
	user.POST("/probe", func(context *gin.Context) {
		context.Status(http.StatusNoContent)
	})
}

func assertBodyLimitError(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("body 超限 status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	body := decodeErrorResponse(t, recorder)
	if body["code"].(json.Number).String() != "100413" || body["message"] != "请求体过大" {
		t.Fatalf("body 超限错误合同=%v", body)
	}
}

type countingReadCloser struct {
	reader io.Reader
	reads  atomic.Int64
}

func (reader *countingReadCloser) Read(buffer []byte) (int, error) {
	reader.reads.Add(1)
	return reader.reader.Read(buffer)
}

func (*countingReadCloser) Close() error {
	return nil
}
