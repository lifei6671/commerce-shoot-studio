package response

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
)

func TestWriteErrorMapsSafeResponses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const (
		requestID = "01JHTTPRESPONSETEST"
		marker    = "secret-sql-path-prompt-marker"
	)

	tests := []struct {
		name        string
		err         error
		wantStatus  int
		wantCode    apperror.Code
		wantMessage string
	}{
		{
			name:        "wrapped application error",
			err:         fmt.Errorf("transport: %w", apperror.ErrNotFound.Wrap(errors.New(marker))),
			wantStatus:  http.StatusNotFound,
			wantCode:    apperror.CodeNotFound,
			wantMessage: "请求路径不存在",
		},
		{
			name:        "wrapped max bytes error",
			err:         fmt.Errorf("bind: %w", &http.MaxBytesError{Limit: 1024}),
			wantStatus:  http.StatusRequestEntityTooLarge,
			wantCode:    apperror.CodeRequestBodyTooLarge,
			wantMessage: "请求体过大",
		},
		{
			name:        "unknown error",
			err:         errors.New(marker),
			wantStatus:  http.StatusInternalServerError,
			wantCode:    apperror.CodeInternalError,
			wantMessage: "服务暂时不可用",
		},
		{
			name:        "nil error",
			err:         nil,
			wantStatus:  http.StatusInternalServerError,
			wantCode:    apperror.CodeInternalError,
			wantMessage: "服务暂时不可用",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodPost, "/api/v1/test", nil)

			gotCode := WriteError(context, requestID, test.err)
			if gotCode != test.wantCode {
				t.Fatalf("返回错误码错误：实际=%d 期望=%d", gotCode, test.wantCode)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("HTTP status 错误：实际=%d 期望=%d", recorder.Code, test.wantStatus)
			}
			if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Fatalf("错误响应 Content-Type 必须是 JSON，实际=%q", contentType)
			}
			var body map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("解析错误响应失败：%v", err)
			}
			if len(body) != 3 {
				t.Fatalf("错误响应只能包含三个字段：%v", body)
			}
			if body["code"] != float64(test.wantCode) || body["message"] != test.wantMessage || body["requestId"] != requestID {
				t.Fatalf("错误响应字段不符合合同：%v", body)
			}
			if strings.Contains(recorder.Body.String(), marker) {
				t.Fatal("错误响应泄漏了底层 marker")
			}
			if stored := ErrorCode(context); stored != test.wantCode {
				t.Fatalf("Gin context 错误码错误：实际=%d 期望=%d", stored, test.wantCode)
			}
		})
	}
}

func TestWriteErrorAllowsEmptyRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/missing", nil)

	WriteError(context, "", apperror.ErrNotFound)

	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析错误响应失败：%v", err)
	}
	if requestID, ok := body["requestId"]; !ok || requestID != "" {
		t.Fatalf("G0-T06 注入前 requestId 应保留空字符串：%v", body)
	}
}

func TestWriteErrorSuppressesHEADBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodHead, "/api/v1/missing", nil)

	gotCode := WriteError(context, "01JHEAD", apperror.ErrMethodNotAllowed)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("HEAD status 错误：实际=%d", recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("HEAD handler 不应写响应体，实际=%q", recorder.Body.String())
	}
	if gotCode != apperror.CodeMethodNotAllowed || ErrorCode(context) != apperror.CodeMethodNotAllowed {
		t.Fatalf("HEAD 错误码没有进入完成日志上下文：returned=%d stored=%d", gotCode, ErrorCode(context))
	}
}

func TestWriteErrorDoesNotOverwriteCommittedResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/v1/stream", nil)
	context.Status(http.StatusAccepted)
	context.Writer.WriteHeaderNow()
	_, _ = context.Writer.Write([]byte("committed-safe-body"))

	gotCode := WriteError(context, "01JCOMMITTED", errors.New("panic-secret-marker"))

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("已提交 status 不得被覆盖：实际=%d", recorder.Code)
	}
	if recorder.Body.String() != "committed-safe-body" {
		t.Fatalf("已提交 body 不得追加统一错误：%q", recorder.Body.String())
	}
	if gotCode != apperror.CodeInternalError || ErrorCode(context) != apperror.CodeInternalError {
		t.Fatalf("已提交响应仍应记录安全错误码：returned=%d stored=%d", gotCode, ErrorCode(context))
	}
}

func TestErrorCodeRejectsMissingOrInvalidContextValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	if code := ErrorCode(context); code != 0 {
		t.Fatalf("未设置错误码时应返回 0，实际=%d", code)
	}
	context.Set(errorCodeContextKey, "100500")
	if code := ErrorCode(context); code != 0 {
		t.Fatalf("错误类型的 context 值必须被拒绝，实际=%d", code)
	}
}
