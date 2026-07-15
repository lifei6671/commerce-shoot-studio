package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

func TestRequestIDIssuerUsesKnownHMACVector(t *testing.T) {
	issuer, err := newRequestIDIssuer(strings.NewReader("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("newRequestIDIssuer() error = %v", err)
	}

	if got := issuer.Next(); got != "5b3d79beea0aec6631ff5fd6882a0449" {
		t.Fatalf("第一个 Request ID = %q", got)
	}
	if got := issuer.Next(); got != "b1a19202cf3304a53cf4d525b0205d44" {
		t.Fatalf("第二个 Request ID = %q", got)
	}
}

func TestNewWithEntropyReadsProcessKeyOnlyDuringConstruction(t *testing.T) {
	reader := &countingReader{Reader: strings.NewReader("0123456789abcdef0123456789abcdef")}
	router, err := newWithEntropy(Options{
		Logger:           newTestLogger(t, io.Discard),
		DefaultBodyBytes: 1024,
	}, reader)
	if err != nil {
		t.Fatalf("newWithEntropy() error = %v", err)
	}
	if reader.bytesRead != 32 {
		t.Fatalf("构造期读取字节数 = %d", reader.bytesRead)
	}

	for range 3 {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/missing", nil))
		requestID := recorder.Header().Get("X-Request-ID")
		if len(requestID) != 32 || requestID != strings.ToLower(requestID) {
			t.Fatalf("Request ID 格式非法：%q", requestID)
		}
	}
	if reader.bytesRead != 32 {
		t.Fatalf("请求路径再次读取熵源：%d", reader.bytesRead)
	}
}

func TestNewWithEntropyRejectsUnavailableProcessKeyWithoutLeakingMarker(t *testing.T) {
	const marker = "ENTROPY_SECRET_MARKER"
	tests := []struct {
		name   string
		reader io.Reader
	}{
		{name: "short read", reader: bytes.NewReader(bytes.Repeat([]byte{'x'}, 31))},
		{name: "read error", reader: errorReader{err: errors.New(marker)}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router, err := newWithEntropy(Options{
				Logger:           newTestLogger(t, io.Discard),
				DefaultBodyBytes: 1024,
			}, test.reader)
			if err == nil || router != nil {
				t.Fatalf("熵源不可用时必须拒绝构造：router=%v err=%v", router, err)
			}
			if strings.Contains(err.Error(), marker) {
				t.Fatalf("构造错误泄漏熵源 marker：%v", err)
			}
		})
	}
}

func TestRequestIDProcessKeyAndInboundHeaderNeverLeak(t *testing.T) {
	processKey := []byte("0123456789abcdef0123456789abcdef")
	const inboundMarker = "UNTRUSTED_REQUEST_ID_SECRET_MARKER"
	var output bytes.Buffer
	router, err := newWithEntropy(Options{
		Logger:           newTestLogger(t, &output),
		DefaultBodyBytes: 1024,
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			user.GET("/probe", func(context *gin.Context) {
				first := response.RequestID(context)
				second := response.RequestID(context)
				if first != second {
					panic("REQUEST_ID_CHANGED")
				}
				context.Status(http.StatusNoContent)
			})
			user.GET("/error", func(context *gin.Context) {
				response.WriteError(context, apperror.ErrForbidden)
			})
			user.GET("/panic", func(*gin.Context) {
				panic("REQUEST_ID_PANIC_SECRET_MARKER")
			})
		},
	}, bytes.NewReader(processKey))
	if err != nil {
		t.Fatalf("newWithEntropy() error = %v", err)
	}
	var serialized strings.Builder
	for _, path := range []string{"/api/v1/probe", "/api/v1/error", "/api/v1/panic"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("X-Request-ID", inboundMarker)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		serialized.WriteString(recorder.Header().Get("X-Request-ID"))
		serialized.WriteString(recorder.Body.String())
	}
	serialized.WriteString(output.String())
	markers := []string{
		string(processKey),
		hex.EncodeToString(processKey),
		base64.StdEncoding.EncodeToString(processKey),
		inboundMarker,
	}
	for _, marker := range markers {
		if strings.Contains(serialized.String(), marker) {
			t.Fatalf("Request ID 边界泄漏敏感 marker：%q", marker)
		}
	}
}

func TestInboundRequestIDValuesAreIgnored(t *testing.T) {
	tests := []struct {
		name   string
		values []string
	}{
		{name: "合法值", values: []string{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},
		{name: "非法值", values: []string{"UNTRUSTED_REQUEST_ID_SECRET_MARKER"}},
		{name: "多值", values: []string{"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "SECOND_REQUEST_ID_SECRET_MARKER"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			var handlerHeaderValues []string
			router, err := newWithEntropy(Options{
				Logger:           newTestLogger(t, &output),
				DefaultBodyBytes: 1024,
				RegisterRoutes: func(user, _ *gin.RouterGroup) {
					user.GET("/error", func(context *gin.Context) {
						handlerHeaderValues = append(handlerHeaderValues, context.Request.Header.Values("X-Request-ID")...)
						response.WriteError(context, apperror.ErrForbidden)
					})
				},
			}, strings.NewReader("0123456789abcdef0123456789abcdef"))
			if err != nil {
				t.Fatalf("newWithEntropy() error = %v", err)
			}

			request := httptest.NewRequest(http.MethodGet, "/api/v1/error", nil)
			for _, value := range test.values {
				request.Header.Add("X-Request-ID", value)
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			if len(handlerHeaderValues) != 0 {
				t.Fatalf("业务 Handler 仍能读取入站 Request ID：%q", handlerHeaderValues)
			}
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("统一错误状态=%d，期望=%d body=%q", recorder.Code, http.StatusForbidden, recorder.Body.String())
			}
			responseIDs := recorder.Header().Values("X-Request-ID")
			if len(responseIDs) != 1 || len(responseIDs[0]) != 32 || responseIDs[0] != strings.ToLower(responseIDs[0]) {
				t.Fatalf("响应必须只包含一个服务端 Request ID：%q", responseIDs)
			}
			serverRequestID := responseIDs[0]
			if _, err := hex.DecodeString(serverRequestID); err != nil {
				t.Fatalf("服务端 Request ID 不是小写十六进制：%q", serverRequestID)
			}
			for _, inboundValue := range test.values {
				if serverRequestID == inboundValue {
					t.Fatalf("复用了入站 Request ID：%q", inboundValue)
				}
			}

			body := decodeErrorResponse(t, recorder)
			bodyCode, ok := body["code"].(json.Number)
			if !ok || bodyCode.String() != "100403" || body["requestId"] != serverRequestID {
				t.Fatalf("统一错误体未使用服务端 Request ID：%v", body)
			}
			logs := decodeLogLines(t, output.Bytes())
			if len(logs) != 1 || logs[0]["request_id"] != serverRequestID {
				t.Fatalf("完成日志未使用服务端 Request ID：%v", logs)
			}

			serialized := recorder.Header().Get("X-Request-ID") + recorder.Body.String() + output.String()
			for _, inboundValue := range test.values {
				if strings.Contains(serialized, inboundValue) {
					t.Fatalf("入站 Request ID 泄漏到响应或日志：%q", inboundValue)
				}
			}
		})
	}
}

type countingReader struct {
	io.Reader
	bytesRead int
}

func (reader *countingReader) Read(content []byte) (int, error) {
	count, err := reader.Reader.Read(content)
	reader.bytesRead += count
	return count, err
}

type errorReader struct {
	err error
}

func (reader errorReader) Read([]byte) (int, error) {
	return 0, reader.err
}
