package apperror_test

import (
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
)

func TestFirstErrorCatalog(t *testing.T) {
	tests := []struct {
		name       string
		err        *apperror.Error
		code       apperror.Code
		httpStatus int
		message    string
		rangeStart apperror.Code
		rangeEnd   apperror.Code
	}{
		{name: "INVALID_REQUEST", err: apperror.ErrInvalidRequest, code: 100400, httpStatus: http.StatusBadRequest, message: "请求参数无效", rangeStart: 100000, rangeEnd: 100999},
		{name: "FORBIDDEN", err: apperror.ErrForbidden, code: 100403, httpStatus: http.StatusForbidden, message: "请求被拒绝", rangeStart: 100000, rangeEnd: 100999},
		{name: "NOT_FOUND", err: apperror.ErrNotFound, code: 100404, httpStatus: http.StatusNotFound, message: "请求路径不存在", rangeStart: 100000, rangeEnd: 100999},
		{name: "METHOD_NOT_ALLOWED", err: apperror.ErrMethodNotAllowed, code: 100405, httpStatus: http.StatusMethodNotAllowed, message: "请求方法不允许", rangeStart: 100000, rangeEnd: 100999},
		{name: "REQUEST_BODY_TOO_LARGE", err: apperror.ErrRequestBodyTooLarge, code: 100413, httpStatus: http.StatusRequestEntityTooLarge, message: "请求体过大", rangeStart: 100000, rangeEnd: 100999},
		{name: "INTERNAL_ERROR", err: apperror.ErrInternal, code: 100500, httpStatus: http.StatusInternalServerError, message: "服务暂时不可用", rangeStart: 100000, rangeEnd: 100999},
		{name: "GENERATION_TASK_NOT_FOUND", err: apperror.ErrGenerationTaskNotFound, code: 140404, httpStatus: http.StatusNotFound, message: "生成任务不存在", rangeStart: 140000, rangeEnd: 140999},
		{name: "AI_REWRITE_IN_PROGRESS", err: apperror.ErrAIRewriteInProgress, code: 150409, httpStatus: http.StatusConflict, message: "AI 改写正在处理中", rangeStart: 150000, rangeEnd: 150999},
	}

	seen := make(map[apperror.Code]string, len(tests))
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.err.Code() != test.code {
				t.Fatalf("错误码漂移：实际=%d 期望=%d", test.err.Code(), test.code)
			}
			if test.err.HTTPStatus() != test.httpStatus {
				t.Fatalf("HTTP status 漂移：实际=%d 期望=%d", test.err.HTTPStatus(), test.httpStatus)
			}
			if test.err.SafeMessage() != test.message || test.err.Error() != test.message {
				t.Fatalf("安全消息漂移：message=%q error=%q", test.err.SafeMessage(), test.err.Error())
			}
			if test.code < test.rangeStart || test.code > test.rangeEnd {
				t.Fatalf("错误码 %d 不在所属号段 %d-%d", test.code, test.rangeStart, test.rangeEnd)
			}
			if test.httpStatus < 400 || test.httpStatus > 599 {
				t.Fatalf("HTTP status 不是 4xx/5xx：%d", test.httpStatus)
			}
			if strings.TrimSpace(test.message) == "" {
				t.Fatal("安全消息不能为空")
			}
			if previous, duplicate := seen[test.code]; duplicate {
				t.Fatalf("错误码 %d 与 %s 重复", test.code, previous)
			}
			seen[test.code] = test.name
		})
	}
}

func TestStableCodeConstants(t *testing.T) {
	codeType := reflect.TypeOf(apperror.Code(0))
	if codeType.Kind() != reflect.Int || codeType.Name() != "Code" {
		t.Fatalf("业务错误码必须是具名 int 类型：kind=%s name=%q", codeType.Kind(), codeType.Name())
	}

	tests := []struct {
		name       string
		code       apperror.Code
		want       apperror.Code
		rangeStart apperror.Code
		rangeEnd   apperror.Code
	}{
		{name: "INVALID_REQUEST", code: apperror.CodeInvalidRequest, want: 100400, rangeStart: 100000, rangeEnd: 100999},
		{name: "FORBIDDEN", code: apperror.CodeForbidden, want: 100403, rangeStart: 100000, rangeEnd: 100999},
		{name: "NOT_FOUND", code: apperror.CodeNotFound, want: 100404, rangeStart: 100000, rangeEnd: 100999},
		{name: "METHOD_NOT_ALLOWED", code: apperror.CodeMethodNotAllowed, want: 100405, rangeStart: 100000, rangeEnd: 100999},
		{name: "REQUEST_BODY_TOO_LARGE", code: apperror.CodeRequestBodyTooLarge, want: 100413, rangeStart: 100000, rangeEnd: 100999},
		{name: "INTERNAL_ERROR", code: apperror.CodeInternalError, want: 100500, rangeStart: 100000, rangeEnd: 100999},
		{name: "GENERATION_TASK_NOT_FOUND", code: apperror.CodeGenerationTaskNotFound, want: 140404, rangeStart: 140000, rangeEnd: 140999},
		{name: "GENERATION_PROVIDER_RESULT_UNCERTAIN", code: apperror.CodeGenerationProviderResultUncertain, want: 140504, rangeStart: 140000, rangeEnd: 140999},
		{name: "AI_REWRITE_IN_PROGRESS", code: apperror.CodeAIRewriteInProgress, want: 150409, rangeStart: 150000, rangeEnd: 150999},
	}
	seen := make(map[apperror.Code]string, len(tests))
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.code != test.want {
				t.Fatalf("稳定错误码漂移：实际=%d 期望=%d", test.code, test.want)
			}
			if test.code < test.rangeStart || test.code > test.rangeEnd {
				t.Fatalf("错误码 %d 不在所属号段 %d-%d", test.code, test.rangeStart, test.rangeEnd)
			}
			if previous, duplicate := seen[test.code]; duplicate {
				t.Fatalf("错误码 %d 与 %s 重复", test.code, previous)
			}
			seen[test.code] = test.name
		})
	}
}
