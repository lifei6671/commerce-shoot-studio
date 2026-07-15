package logger_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/logger"
)

func TestInboundContextWritesValidatedCorrelationFields(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	log := newTestLogger(t, &output, nil)
	ctx, err := logger.NewContext(context.Background(), logger.ContextFields{
		Direction:     logger.DirectionInbound,
		Method:        "POST",
		RouteTemplate: "/api/v1/generation-plans/{id}",
		RequestID:     "req-123",
		TraceID:       "trace-123",
		UserID:        "user-123",
		TaskID:        "task-123",
		InvocationID:  "inv-123",
	})
	if err != nil {
		t.Fatalf("logger.NewContext() error = %v", err)
	}

	if err := logger.LogRequestComplete(ctx, log, logger.RequestResult{
		StatusCode: 422,
		ErrorCode:  int(apperror.CodeInvalidRequest),
		ElapsedMS:  31,
	}); err != nil {
		t.Fatalf("logger.LogRequestComplete() error = %v", err)
	}

	payload := decodeSingleJSONLine(t, output.Bytes())
	assertExactKeys(t, payload, []string{
		"direction", "elapsed_ms", "error_code", "invocation_id", "level", "message",
		"method", "request_id", "route_template", "service", "status_code", "task_id",
		"timestamp", "trace_id", "user_id", "version",
	})
	assertField(t, payload, "level", "warn")
	assertField(t, payload, "message", "HTTP 请求完成")
	assertField(t, payload, "direction", "inbound")
	assertField(t, payload, "method", "POST")
	assertField(t, payload, "route_template", "/api/v1/generation-plans/{id}")
	assertField(t, payload, "request_id", "req-123")
	assertField(t, payload, "trace_id", "trace-123")
	assertField(t, payload, "user_id", "user-123")
	assertField(t, payload, "task_id", "task-123")
	assertField(t, payload, "invocation_id", "inv-123")
	assertJSONNumber(t, payload, "status_code", "422")
	assertJSONNumber(t, payload, "error_code", "100400")
	assertJSONNumber(t, payload, "elapsed_ms", "31")
}

func TestOutboundContextAllowsTransportFailureWithoutHTTPStatus(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	log := newTestLogger(t, &output, nil)
	ctx, err := logger.NewContext(context.Background(), logger.ContextFields{
		Direction:   logger.DirectionOutbound,
		Method:      "POST",
		Operation:   "provider.generate_image",
		PeerService: "openai",
		RequestID:   "req-transport",
	})
	if err != nil {
		t.Fatalf("logger.NewContext() error = %v", err)
	}

	if err := logger.LogRequestComplete(ctx, log, logger.RequestResult{
		ErrorCode: int(apperror.CodeInternalError),
		ElapsedMS: 55,
	}); err != nil {
		t.Fatalf("logger.LogRequestComplete() error = %v", err)
	}

	payload := decodeSingleJSONLine(t, output.Bytes())
	assertExactKeys(t, payload, []string{
		"direction", "elapsed_ms", "error_code", "level", "message", "method",
		"operation", "peer_service", "request_id", "service", "timestamp", "version",
	})
	assertField(t, payload, "level", "error")
	assertField(t, payload, "direction", "outbound")
	assertField(t, payload, "method", "POST")
	assertField(t, payload, "operation", "provider.generate_image")
	assertField(t, payload, "peer_service", "openai")
	if _, exists := payload["status_code"]; exists {
		t.Fatal("传输失败且 status_code=0 时不得输出 status_code")
	}
	assertJSONNumber(t, payload, "error_code", "100500")
}

func TestForkContextsCanLogConcurrentlyWithoutCrossingFields(t *testing.T) {
	t.Parallel()

	parent, err := logger.NewContext(context.Background(), logger.ContextFields{
		Direction:     logger.DirectionInbound,
		Method:        "POST",
		RouteTemplate: "/api/v1/tasks/{id}",
		RequestID:     "req-concurrent",
		TraceID:       "trace-concurrent",
	})
	if err != nil {
		t.Fatalf("logger.NewContext() error = %v", err)
	}
	contexts := make([]context.Context, 0, 2)
	for _, operation := range []string{"provider.left", "provider.right"} {
		ctx, forkErr := logger.ForkContext(parent, logger.ContextFields{
			Direction:    logger.DirectionOutbound,
			Method:       "POST",
			Operation:    operation,
			PeerService:  strings.TrimPrefix(operation, "provider."),
			InvocationID: strings.ReplaceAll(operation, ".", "-"),
		})
		if forkErr != nil {
			t.Fatalf("logger.ForkContext(%s) error = %v", operation, forkErr)
		}
		contexts = append(contexts, ctx)
	}

	var output bytes.Buffer
	log := newTestLogger(t, &output, nil)
	start := make(chan struct{})
	var waitGroup sync.WaitGroup
	for _, ctx := range contexts {
		waitGroup.Add(1)
		go func(logContext context.Context) {
			defer waitGroup.Done()
			<-start
			if logErr := logger.LogRequestComplete(logContext, log, logger.RequestResult{
				StatusCode: 200,
				ElapsedMS:  2,
			}); logErr != nil {
				t.Errorf("logger.LogRequestComplete() error = %v", logErr)
			}
		}(ctx)
	}
	close(start)
	waitGroup.Wait()

	payloads := decodeJSONLines(t, output.Bytes())
	if len(payloads) != 2 {
		t.Fatalf("日志行数=%d，期望 2：%q", len(payloads), output.Bytes())
	}
	seen := make(map[string]bool, 2)
	for _, payload := range payloads {
		operation, ok := payload["operation"].(string)
		if !ok {
			t.Fatalf("operation 类型=%T，payload=%v", payload["operation"], payload)
		}
		seen[operation] = true
		assertField(t, payload, "request_id", "req-concurrent")
		assertField(t, payload, "trace_id", "trace-concurrent")
		assertField(t, payload, "invocation_id", strings.ReplaceAll(operation, ".", "-"))
		if _, exists := payload["route_template"]; exists {
			t.Fatalf("出站子上下文串入 route_template：%v", payload)
		}
	}
	for _, operation := range []string{"provider.left", "provider.right"} {
		if !seen[operation] {
			t.Fatalf("缺少子调用日志 %s：%v", operation, payloads)
		}
	}
}

func TestForkContextInheritsIdentityAndKeepsBranchesIsolated(t *testing.T) {
	t.Parallel()

	parent, err := logger.NewContext(context.Background(), logger.ContextFields{
		Direction:     logger.DirectionInbound,
		Method:        "POST",
		RouteTemplate: "/api/v1/tasks/{id}",
		RequestID:     "req-parent",
		TraceID:       "trace-parent",
		UserID:        "user-parent",
		TaskID:        "task-parent",
		InvocationID:  "inv-parent",
	})
	if err != nil {
		t.Fatalf("logger.NewContext() error = %v", err)
	}

	left, err := logger.ForkContext(parent, logger.ContextFields{
		Direction:    logger.DirectionOutbound,
		Method:       "POST",
		Operation:    "provider.left",
		PeerService:  "left",
		InvocationID: "inv-left",
	})
	if err != nil {
		t.Fatalf("logger.ForkContext(left) error = %v", err)
	}
	right, err := logger.ForkContext(parent, logger.ContextFields{
		Direction:   logger.DirectionOutbound,
		Method:      "POST",
		Operation:   "provider.right",
		PeerService: "right",
	})
	if err != nil {
		t.Fatalf("logger.ForkContext(right) error = %v", err)
	}

	for name, testCase := range map[string]struct {
		ctx        context.Context
		operation  string
		invocation string
	}{
		"left":  {ctx: left, operation: "provider.left", invocation: "inv-left"},
		"right": {ctx: right, operation: "provider.right"},
	} {
		t.Run(name, func(t *testing.T) {
			var output bytes.Buffer
			log := newTestLogger(t, &output, nil)
			if err := logger.LogRequestComplete(testCase.ctx, log, logger.RequestResult{
				StatusCode: 200,
				ElapsedMS:  1,
			}); err != nil {
				t.Fatalf("logger.LogRequestComplete() error = %v", err)
			}
			payload := decodeSingleJSONLine(t, output.Bytes())
			assertField(t, payload, "request_id", "req-parent")
			assertField(t, payload, "trace_id", "trace-parent")
			assertField(t, payload, "user_id", "user-parent")
			assertField(t, payload, "task_id", "task-parent")
			assertField(t, payload, "operation", testCase.operation)
			if testCase.invocation == "" {
				if _, exists := payload["invocation_id"]; exists {
					t.Fatal("子调用未指定 invocation_id 时不得继承父调用值")
				}
			} else {
				assertField(t, payload, "invocation_id", testCase.invocation)
			}
			if _, exists := payload["route_template"]; exists {
				t.Fatal("出站子上下文不得继承父入站 route_template")
			}
		})
	}

	for name, conflict := range map[string]logger.ContextFields{
		"request_id": {RequestID: "req-other"},
		"trace_id":   {TraceID: "trace-other"},
		"user_id":    {UserID: "user-other"},
		"task_id":    {TaskID: "task-other"},
	} {
		conflict.Direction = logger.DirectionOutbound
		conflict.Method = "POST"
		conflict.Operation = "provider.replace_identity"
		conflict.PeerService = "unsafe"
		if _, err := logger.ForkContext(parent, conflict); err == nil {
			t.Fatalf("ForkContext 不得替换父上下文 %s", name)
		}
	}
}

func TestContextValidationRejectsUnsafeFieldsWithoutEchoingValues(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		fields logger.ContextFields
	}{
		{
			name: "未知方向",
			fields: logger.ContextFields{
				Direction:     logger.Direction("sideways"),
				Method:        "GET",
				RouteTemplate: "/health",
			},
		},
		{
			name: "未知方法",
			fields: logger.ContextFields{
				Direction:     logger.DirectionInbound,
				Method:        "BREW",
				RouteTemplate: "/health",
			},
		},
		{
			name: "route 带查询参数",
			fields: logger.ContextFields{
				Direction:     logger.DirectionInbound,
				Method:        "GET",
				RouteTemplate: "/users?token=ROUTE_SECRET_MARKER",
			},
		},
		{
			name: "route 带路径穿越",
			fields: logger.ContextFields{
				Direction:     logger.DirectionInbound,
				Method:        "GET",
				RouteTemplate: "/users/../secrets",
			},
		},
		{
			name: "route 带 host",
			fields: logger.ContextFields{
				Direction:     logger.DirectionInbound,
				Method:        "GET",
				RouteTemplate: "//ROUTE_HOST_MARKER.example/private",
			},
		},
		{
			name: "route 嵌入完整 URL",
			fields: logger.ContextFields{
				Direction:     logger.DirectionInbound,
				Method:        "GET",
				RouteTemplate: "/https://ROUTE_SCHEME_MARKER.example/private",
			},
		},
		{
			name: "ID 带空格",
			fields: logger.ContextFields{
				Direction:     logger.DirectionInbound,
				Method:        "GET",
				RouteTemplate: "/health",
				RequestID:     "REQUEST SECRET MARKER",
			},
		},
		{
			name: "出站缺 operation",
			fields: logger.ContextFields{
				Direction:   logger.DirectionOutbound,
				Method:      "POST",
				PeerService: "openai",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := logger.NewContext(context.Background(), test.fields)
			if err == nil {
				t.Fatal("logger.NewContext() 期望返回校验错误")
			}
			for _, marker := range []string{
				"ROUTE_SECRET_MARKER", "ROUTE_HOST_MARKER", "ROUTE_SCHEME_MARKER", "REQUEST SECRET MARKER",
			} {
				if strings.Contains(err.Error(), marker) {
					t.Fatalf("校验错误回显敏感输入 %q：%v", marker, err)
				}
			}
		})
	}
}

func TestRequestResultValidationAndCancellationPropagation(t *testing.T) {
	t.Parallel()

	parent, cancel := context.WithCancel(context.Background())
	ctx, err := logger.NewContext(parent, logger.ContextFields{
		Direction:     logger.DirectionInbound,
		Method:        "GET",
		RouteTemplate: "/health",
	})
	if err != nil {
		t.Fatalf("logger.NewContext() error = %v", err)
	}
	cancel()
	if err := ctx.Err(); err != context.Canceled {
		t.Fatalf("派生上下文未保留取消语义：%v", err)
	}

	log, err := logger.New(logger.Options{
		Writer:   &bytes.Buffer{},
		Service:  serviceName,
		Version:  serviceVersion,
		MinLevel: slog.LevelInfo,
	})
	if err != nil {
		t.Fatalf("logger.New() error = %v", err)
	}

	tests := []logger.RequestResult{
		{StatusCode: 99, ElapsedMS: 1},
		{StatusCode: 600, ElapsedMS: 1},
		{StatusCode: 200, ErrorCode: -1, ElapsedMS: 1},
		{StatusCode: 200, ElapsedMS: -1},
	}
	for _, result := range tests {
		if err := logger.LogRequestComplete(ctx, log, result); err == nil {
			t.Fatalf("LogRequestComplete(%+v) 期望返回校验错误", result)
		}
	}
	if err := logger.LogRequestComplete(ctx, nil, logger.RequestResult{StatusCode: 200}); err == nil {
		t.Fatal("LogRequestComplete 传入 nil logger 时必须快速失败")
	}
}

func TestRequestCompletionUsesFrozenStatusLevelBoundaries(t *testing.T) {
	t.Parallel()

	ctx, err := logger.NewContext(context.Background(), logger.ContextFields{
		Direction:     logger.DirectionInbound,
		Method:        "GET",
		RouteTemplate: "/health",
	})
	if err != nil {
		t.Fatalf("logger.NewContext() error = %v", err)
	}
	for _, test := range []struct {
		status int
		level  string
	}{
		{status: 100, level: "info"},
		{status: 399, level: "info"},
		{status: 400, level: "warn"},
		{status: 499, level: "warn"},
		{status: 500, level: "error"},
		{status: 599, level: "error"},
	} {
		var output bytes.Buffer
		log := newTestLogger(t, &output, nil)
		if err := logger.LogRequestComplete(ctx, log, logger.RequestResult{
			StatusCode: test.status,
			ElapsedMS:  0,
		}); err != nil {
			t.Fatalf("status=%d error=%v", test.status, err)
		}
		payload := decodeSingleJSONLine(t, output.Bytes())
		assertField(t, payload, "level", test.level)
		assertJSONNumber(t, payload, "status_code", strconv.Itoa(test.status))
	}
}

func TestNewContextAcceptsAllFrozenHTTPMethodsAndPreservesDeadline(t *testing.T) {
	t.Parallel()

	deadline := time.Now().Add(time.Minute).Round(0)
	parent, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"} {
		ctx, err := logger.NewContext(parent, logger.ContextFields{
			Direction:     logger.DirectionInbound,
			Method:        method,
			RouteTemplate: "/health",
		})
		if err != nil {
			t.Fatalf("logger.NewContext(%s) error = %v", method, err)
		}
		gotDeadline, ok := ctx.Deadline()
		if !ok || !gotDeadline.Equal(deadline) {
			t.Fatalf("method=%s deadline=%v ok=%v，期望=%v", method, gotDeadline, ok, deadline)
		}
	}
}

func TestNewContextAcceptsOnlyFixedNormalizedOtherForNonStandardMethods(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	log := newTestLogger(t, &output, nil)
	ctx, err := logger.NewContext(context.Background(), logger.ContextFields{
		Direction:     logger.DirectionInbound,
		Method:        "OTHER",
		RouteTemplate: "/api/v1/{unmatched}",
	})
	if err != nil {
		t.Fatalf("logger.NewContext(OTHER) error = %v", err)
	}
	if err := logger.LogRequestComplete(ctx, log, logger.RequestResult{
		StatusCode: http.StatusMethodNotAllowed,
		ErrorCode:  int(apperror.CodeMethodNotAllowed),
		ElapsedMS:  1,
	}); err != nil {
		t.Fatalf("logger.LogRequestComplete() error = %v", err)
	}
	payload := decodeSingleJSONLine(t, output.Bytes())
	assertField(t, payload, "method", "OTHER")

	for _, rawMethod := range []string{"BREW", "RAW_METHOD_SECRET_MARKER", "other"} {
		_, err := logger.NewContext(context.Background(), logger.ContextFields{
			Direction:     logger.DirectionInbound,
			Method:        rawMethod,
			RouteTemplate: "/api/v1/{unmatched}",
		})
		if err == nil {
			t.Fatalf("任意原始非标准 method %q 必须被拒绝", rawMethod)
		}
		if strings.Contains(err.Error(), rawMethod) {
			t.Fatalf("method 校验错误不得回显原始值：%q", err)
		}
	}
}

func decodeJSONLines(t *testing.T, content []byte) []map[string]any {
	t.Helper()

	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	var payloads []map[string]any
	for {
		var payload map[string]any
		if err := decoder.Decode(&payload); err != nil {
			if err == io.EOF {
				return payloads
			}
			t.Fatalf("解析日志 JSON Lines 失败：%v，内容=%q", err, content)
		}
		payloads = append(payloads, payload)
	}
}
