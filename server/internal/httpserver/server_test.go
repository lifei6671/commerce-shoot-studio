package httpserver_test

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/lifei6671/commerce-shoot-studio/server/internal/httpserver"
	projectlogger "github.com/lifei6671/commerce-shoot-studio/server/lib/logger"
)

func TestNewRejectsInvalidOptions(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*httpserver.Options)
	}{
		{name: "空地址", mutate: func(options *httpserver.Options) { options.Address = "" }},
		{name: "空白地址", mutate: func(options *httpserver.Options) { options.Address = "   " }},
		{name: "地址缺少端口", mutate: func(options *httpserver.Options) { options.Address = "ADDRESS_SECRET_MARKER" }},
		{name: "端口不是数字", mutate: func(options *httpserver.Options) { options.Address = "127.0.0.1:not-a-port" }},
		{name: "端口为零", mutate: func(options *httpserver.Options) { options.Address = "127.0.0.1:0" }},
		{name: "端口超出范围", mutate: func(options *httpserver.Options) { options.Address = "127.0.0.1:65536" }},
		{name: "地址带首尾空白", mutate: func(options *httpserver.Options) { options.Address = " 127.0.0.1:8080" }},
		{name: "handler 为空", mutate: func(options *httpserver.Options) { options.Handler = nil }},
		{name: "logger 为空", mutate: func(options *httpserver.Options) { options.Logger = nil }},
		{name: "read header timeout 为零", mutate: func(options *httpserver.Options) { options.ReadHeaderTimeout = 0 }},
		{name: "read header timeout 为负", mutate: func(options *httpserver.Options) { options.ReadHeaderTimeout = -time.Second }},
		{name: "read timeout 为零", mutate: func(options *httpserver.Options) { options.ReadTimeout = 0 }},
		{name: "read timeout 为负", mutate: func(options *httpserver.Options) { options.ReadTimeout = -time.Second }},
		{name: "write timeout 为零", mutate: func(options *httpserver.Options) { options.WriteTimeout = 0 }},
		{name: "write timeout 为负", mutate: func(options *httpserver.Options) { options.WriteTimeout = -time.Second }},
		{name: "idle timeout 为零", mutate: func(options *httpserver.Options) { options.IdleTimeout = 0 }},
		{name: "idle timeout 为负", mutate: func(options *httpserver.Options) { options.IdleTimeout = -time.Second }},
		{name: "header limit 为零", mutate: func(options *httpserver.Options) { options.MaxHeaderBytes = 0 }},
		{name: "header limit 为负", mutate: func(options *httpserver.Options) { options.MaxHeaderBytes = -1 }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			options := validOptions(t, &bytes.Buffer{})
			test.mutate(&options)

			server, err := httpserver.New(options)
			if err == nil {
				t.Fatalf("httpserver.New() server=%v，期望返回校验错误", server)
			}
			if server != nil {
				t.Fatalf("httpserver.New() 失败时 server=%v，期望 nil", server)
			}
			if strings.Contains(err.Error(), "ADDRESS_SECRET_MARKER") {
				t.Fatalf("校验错误回显了原始 address：%v", err)
			}
		})
	}
}

func TestNewConstructsExactServerWithoutStartingIt(t *testing.T) {
	handler := &noopHandler{}
	options := validOptions(t, &bytes.Buffer{})
	options.Handler = handler

	server, err := httpserver.New(options)
	if err != nil {
		t.Fatalf("httpserver.New() error = %v", err)
	}
	if server.Addr != options.Address {
		t.Fatalf("Addr=%q，期望=%q", server.Addr, options.Address)
	}
	gotHandler, ok := server.Handler.(*noopHandler)
	if !ok || gotHandler != handler {
		t.Fatalf("Handler=%T，未保留调用方传入的 handler", server.Handler)
	}
	if server.ReadHeaderTimeout != options.ReadHeaderTimeout {
		t.Fatalf("ReadHeaderTimeout=%v，期望=%v", server.ReadHeaderTimeout, options.ReadHeaderTimeout)
	}
	if server.ReadTimeout != options.ReadTimeout {
		t.Fatalf("ReadTimeout=%v，期望=%v", server.ReadTimeout, options.ReadTimeout)
	}
	if server.WriteTimeout != options.WriteTimeout {
		t.Fatalf("WriteTimeout=%v，期望=%v", server.WriteTimeout, options.WriteTimeout)
	}
	if server.IdleTimeout != options.IdleTimeout {
		t.Fatalf("IdleTimeout=%v，期望=%v", server.IdleTimeout, options.IdleTimeout)
	}
	if server.MaxHeaderBytes != options.MaxHeaderBytes {
		t.Fatalf("MaxHeaderBytes=%d，期望=%d", server.MaxHeaderBytes, options.MaxHeaderBytes)
	}
	if !server.DisableGeneralOptionsHandler {
		t.Fatal("DisableGeneralOptionsHandler 必须为 true")
	}
	if server.ErrorLog == nil {
		t.Fatal("ErrorLog 不能为空")
	}
	if server.ErrorLog.Flags() != 0 || server.ErrorLog.Prefix() != "" {
		t.Fatalf("ErrorLog flags=%d prefix=%q，期望无标准库前缀", server.ErrorLog.Flags(), server.ErrorLog.Prefix())
	}
}

func TestErrorLogDropsStandardLibraryTextBeforeFinalWriter(t *testing.T) {
	var output bytes.Buffer
	options := validOptions(t, &output)
	server, err := httpserver.New(options)
	if err != nil {
		t.Fatalf("httpserver.New() error = %v", err)
	}

	server.ErrorLog.Printf(
		"HTTP_SERVER_SECRET_MARKER certificate=/Users/example/private/server.pem error=%s",
		"RAW_TLS_ERROR_MARKER",
	)

	raw := output.String()
	for _, forbidden := range []string{
		"HTTP_SERVER_SECRET_MARKER",
		"/Users/example/private/server.pem",
		"RAW_TLS_ERROR_MARKER",
	} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("最终日志泄漏标准库 ErrorLog 文本 %q：%s", forbidden, raw)
		}
	}
	if strings.Count(raw, "\n") != 1 {
		t.Fatalf("最终日志行数=%d，期望 1：%q", strings.Count(raw, "\n"), raw)
	}

	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var payload map[string]any
	if err := decoder.Decode(&payload); err != nil {
		t.Fatalf("解析最终日志失败：%v，内容=%q", err, raw)
	}
	if got := payload["message"]; got != "HTTP 服务器内部错误" {
		t.Fatalf("message=%v，期望固定安全消息", got)
	}
	if got := payload["level"]; got != "error" {
		t.Fatalf("level=%v，期望 error", got)
	}
}

func TestServerSourceHasNoLifecycleSideEffects(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("无法定位 httpserver 测试文件")
	}
	productionFile := filepath.Join(filepath.Dir(currentFile), "server.go")
	source, err := os.ReadFile(productionFile)
	if err != nil {
		t.Fatalf("读取 %s 失败：%v", productionFile, err)
	}

	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, productionFile, source, parser.SkipObjectResolution)
	if err != nil {
		t.Fatalf("解析 %s 失败：%v", productionFile, err)
	}
	for _, spec := range file.Imports {
		path, unquoteErr := strconv.Unquote(spec.Path.Value)
		if unquoteErr != nil {
			t.Fatalf("解析 import path 失败：%v", unquoteErr)
		}
		if path == "os/signal" || path == "syscall" {
			t.Fatalf("httpserver 构造包不得导入生命周期包 %q", path)
		}
	}

	forbiddenCalls := map[string]struct{}{
		"Listen": {}, "ListenAndServe": {}, "ListenAndServeTLS": {},
		"Serve": {}, "ServeTLS": {}, "Shutdown": {}, "Notify": {}, "NotifyContext": {},
	}
	ast.Inspect(file, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.GoStmt:
			t.Errorf("httpserver 构造包不得创建 goroutine：%s", fileSet.Position(typed.Pos()))
		case *ast.CallExpr:
			selector, ok := typed.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if _, forbidden := forbiddenCalls[selector.Sel.Name]; forbidden {
				t.Errorf("httpserver 构造包不得调用 %s：%s", selector.Sel.Name, fileSet.Position(selector.Pos()))
			}
		}
		return true
	})
}

func validOptions(t *testing.T, output *bytes.Buffer) httpserver.Options {
	t.Helper()

	log, err := projectlogger.New(projectlogger.Options{
		Writer:   output,
		Service:  "commerce-shoot-studio",
		Version:  "test-version",
		MinLevel: slog.LevelInfo,
	})
	if err != nil {
		t.Fatalf("logger.New() error = %v", err)
	}
	return httpserver.Options{
		Address:           "127.0.0.1:8080",
		Handler:           &noopHandler{},
		Logger:            log,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    32768,
	}
}

type noopHandler struct{}

func (*noopHandler) ServeHTTP(http.ResponseWriter, *http.Request) {}
