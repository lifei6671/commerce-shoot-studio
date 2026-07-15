package buildcontract

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/publicsuffix"
)

const (
	ginModulePath     = "github.com/gin-gonic/gin"
	ginModuleVersion  = "v1.12.0"
	xNetModulePath    = "golang.org/x/net"
	xNetModuleVersion = "v0.51.0"
)

func TestHTTPDirectDependencyContract(t *testing.T) {
	t.Parallel()

	goModPath := filepath.Join(loggingServerRoot(t), "go.mod")
	dependencies := []struct {
		name    string
		path    string
		version string
	}{
		{name: "Gin", path: ginModulePath, version: ginModuleVersion},
		{name: "Public Suffix", path: xNetModulePath, version: xNetModuleVersion},
	}

	for _, dependency := range dependencies {
		dependency := dependency
		t.Run(dependency.name, func(t *testing.T) {
			t.Parallel()

			version, direct, err := findDirectModuleRequirement(goModPath, dependency.path)
			if err != nil {
				t.Fatalf("读取 %s 依赖合同失败：%v", dependency.name, err)
			}
			if version != dependency.version {
				t.Fatalf("%s 版本必须精确锁定：实际=%q 期望=%q", dependency.name, version, dependency.version)
			}
			if !direct {
				t.Fatalf("%s 必须是直接依赖", dependency.name)
			}
		})
	}
}

func TestHTTPResolvedDependencyContract(t *testing.T) {
	t.Parallel()

	for _, dependency := range []struct {
		path    string
		version string
	}{
		{path: ginModulePath, version: ginModuleVersion},
		{path: xNetModulePath, version: xNetModuleVersion},
	} {
		dependency := dependency
		t.Run(dependency.path, func(t *testing.T) {
			t.Parallel()

			command := exec.Command("go", "list", "-m", "-json", dependency.path)
			command.Dir = loggingServerRoot(t)
			output, err := command.Output()
			if err != nil {
				t.Fatalf("解析生效依赖失败：%v", err)
			}
			var module struct {
				Path    string
				Version string
				Replace *struct {
					Path    string
					Version string
				}
			}
			if err := json.Unmarshal(output, &module); err != nil {
				t.Fatalf("解析 go list JSON 失败：%v", err)
			}
			if module.Path != dependency.path || module.Version != dependency.version {
				t.Fatalf("生效依赖漂移：path=%q version=%q", module.Path, module.Version)
			}
			if module.Replace != nil {
				t.Fatalf("HTTP 依赖不得 replace：path=%q version=%q", module.Replace.Path, module.Replace.Version)
			}
		})
	}
}

func TestHTTPDependencyBehaviorContract(t *testing.T) {
	t.Parallel()

	if gin.Version != ginModuleVersion {
		t.Fatalf("Gin 运行时版本漂移：实际=%q 期望=%q", gin.Version, ginModuleVersion)
	}
	site, err := publicsuffix.EffectiveTLDPlusOne("app.example.co.uk")
	if err != nil {
		t.Fatalf("Public Suffix 合同不可用：%v", err)
	}
	if site != "example.co.uk" {
		t.Fatalf("Public Suffix eTLD+1 结果错误：实际=%q", site)
	}
}

func TestHTTPProductionSourceContract(t *testing.T) {
	t.Parallel()

	root := loggingServerRoot(t)
	files, err := productionGoFiles(root)
	if err != nil {
		t.Fatalf("枚举生产 Go 源码失败：%v", err)
	}
	foundGinNew := 0
	for _, path := range files {
		relative, err := filepath.Rel(root, path)
		if err != nil {
			t.Fatalf("计算 HTTP 源码相对路径失败：%v", err)
		}
		source, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("读取 HTTP 源码失败：%v", err)
		}
		result, err := validateHTTPSource(filepath.ToSlash(relative), source)
		if err != nil {
			t.Fatal(err)
		}
		foundGinNew += result.ginNewCalls
	}
	if foundGinNew != 1 {
		t.Fatalf("生产代码必须且只能调用一次 gin.New，实际=%d", foundGinNew)
	}
}

func TestHTTPSecurityMiddlewareOrderContract(t *testing.T) {
	t.Parallel()

	path := filepath.Join(loggingServerRoot(t), "internal", "httpapi", "router.go")
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, nil, parser.SkipObjectResolution)
	if err != nil {
		t.Fatalf("解析 router.go 失败：%v", err)
	}
	var order []string
	trustedProxyCalls := 0
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if selector.Sel.Name == "SetTrustedProxies" {
			trustedProxyCalls++
			if len(call.Args) != 1 {
				t.Fatalf("SetTrustedProxies 参数数量错误：%d", len(call.Args))
			}
			identifier, ok := call.Args[0].(*ast.Ident)
			if !ok || identifier.Name != "trustedProxyCIDRStrings" {
				t.Fatalf("SetTrustedProxies 必须使用规范化 CIDR 列表")
			}
		}
		if selector.Sel.Name != "Use" {
			return true
		}
		for _, argument := range call.Args {
			middlewareCall, ok := argument.(*ast.CallExpr)
			if !ok {
				continue
			}
			middleware, ok := middlewareCall.Fun.(*ast.SelectorExpr)
			if ok {
				order = append(order, middleware.Sel.Name)
			}
		}
		return true
	})
	want := []string{
		"completionMiddleware",
		"recoveryMiddleware",
		"proxyMiddleware",
		"corsMiddleware",
		"crossOriginProtectionMiddleware",
		"methodGuard",
		"bodyLimitMiddleware",
	}
	if strings.Join(order, ",") != strings.Join(want, ",") {
		t.Fatalf("HTTP 安全中间件顺序漂移：实际=%v 期望=%v", order, want)
	}
	if trustedProxyCalls != 1 {
		t.Fatalf("Router 必须且只能调用一次 SetTrustedProxies，实际=%d", trustedProxyCalls)
	}
}

func TestHTTPSourceValidatorRejectsForbiddenPatterns(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		path   string
		source string
		want   string
	}{
		{name: "Gin 越层导入", path: "internal/service/bad.go", source: `package bad; import _ "github.com/gin-gonic/gin"`, want: "Gin 只能"},
		{name: "Gin 子包越层导入", path: "internal/service/bad.go", source: `package bad; import _ "github.com/gin-gonic/gin/binding"`, want: "Gin 只能"},
		{name: "默认 Engine", path: "internal/httpapi/bad.go", source: `package httpapi; import "github.com/gin-gonic/gin"; var _ = gin.Default()`, want: "禁止 gin.Default"},
		{name: "默认 Logger", path: "internal/httpapi/bad.go", source: `package httpapi; import "github.com/gin-gonic/gin"; var _ = gin.Logger()`, want: "禁止 gin.Logger"},
		{name: "默认 Recovery", path: "internal/httpapi/bad.go", source: `package httpapi; import "github.com/gin-gonic/gin"; var _ = gin.Recovery()`, want: "禁止 gin.Recovery"},
		{name: "gin.H", path: "lib/response/bad.go", source: `package response; import "github.com/gin-gonic/gin"; var _ = gin.H{"code": 1}`, want: "禁止 gin.H"},
		{name: "TimeoutHandler", path: "internal/httpapi/bad.go", source: `package httpapi; import "net/http"; var _ = http.TimeoutHandler`, want: "禁止 http.TimeoutHandler"},
		{name: "engine Run", path: "internal/httpapi/bad.go", source: `package httpapi; type engine struct{}; func (engine) Run(...string) error { return nil }; func start(e engine) { _ = e.Run() }`, want: "禁止 Gin 自启动"},
		{name: "占位 GET", path: "internal/httpapi/bad.go", source: `package httpapi; type group struct{}; func (group) GET(string, ...any) {}; func register(g group) { g.GET("/placeholder") }`, want: "禁止生产占位路由"},
		{name: "原始 Error", path: "internal/httpapi/bad.go", source: `package httpapi; func write(err error) string { return err.Error() }`, want: "禁止读取原始 error 文本"},
		{name: "重复 DTO", path: "internal/httpapi/bad.go", source: `package httpapi; type ErrorResponse struct { Code int }`, want: "禁止定义第二套 ErrorResponse"},
		{name: "越层重复 DTO", path: "internal/service/bad.go", source: `package service; type ErrorResponse struct { Code int }`, want: "禁止定义第二套 ErrorResponse"},
		{name: "HTTP 生命周期调用", path: "internal/httpapi/bad.go", source: `package httpapi; type server struct{}; func (server) ListenAndServe() {}; func start(s server) { s.ListenAndServe() }`, want: "禁止 HTTP 生命周期调用"},
		{name: "HTTP goroutine", path: "internal/httpapi/bad.go", source: `package httpapi; func start() { go func() {}() }`, want: "禁止创建 goroutine"},
		{name: "ClientIP", path: "internal/httpapi/bad.go", source: `package httpapi; type context struct{}; func (context) ClientIP() string { return "" }; func read(c context) { _ = c.ClientIP() }`, want: "禁止 ClientIP"},
		{name: "forwarded header 越权读取", path: "internal/httpapi/bad.go", source: `package httpapi; import "net/http"; func read(r *http.Request) { _ = r.Header.Get("X-Forwarded-For") }`, want: "代理 Header 只能"},
		{name: "X-Real-IP 越权删除", path: "internal/httpapi/bad.go", source: `package httpapi; import "net/http"; func clean(r *http.Request) { r.Header.Del("X-Real-IP") }`, want: "代理 Header 只能"},
		{name: "COP Handler wrapper", path: "internal/httpapi/bad.go", source: `package httpapi; type cop struct{}; func (cop) Handler(any) any { return nil }; func wrap(c cop, h any) { _ = c.Handler(h) }`, want: "禁止 CrossOriginProtection Handler"},
		{name: "COP bypass", path: "internal/httpapi/bad.go", source: `package httpapi; type cop struct{}; func (cop) AddInsecureBypassPattern(string) {}; func bypass(c cop) { c.AddInsecureBypassPattern("/") }`, want: "禁止 CSRF bypass"},
		{name: "CSRF token header", path: "internal/httpapi/bad.go", source: `package httpapi; const token = "X-CSRF-Token"`, want: "禁止 CSRF Token"},
		{name: "math rand", path: "internal/httpapi/bad.go", source: `package httpapi; import "math/rand"; var _ = rand.Uint64`, want: "禁止 math/rand"},
		{name: "crypto rand Read", path: "internal/httpapi/bad.go", source: `package httpapi; import "crypto/rand"; func read(p []byte) { _, _ = rand.Read(p) }`, want: "禁止 crypto/rand.Read"},
		{name: "Request ID 越权绑定", path: "internal/httpapi/bad.go", source: `package httpapi; import "github.com/lifei6671/commerce-shoot-studio/server/lib/response"; func bind(c any) { _ = response.BindRequestID(c, "id") }`, want: "BindRequestID 只能"},
		{name: "WriteError 自由 ID", path: "internal/httpapi/bad.go", source: `package httpapi; import "github.com/lifei6671/commerce-shoot-studio/server/lib/response"; func write(c any, err error) { response.WriteError(c, "id", err) }`, want: "WriteError 不得接收"},
		{name: "公开 entropy seam", path: "internal/httpapi/router.go", source: `package httpapi; type Options struct { Entropy any }`, want: "Options 禁止暴露"},
		{name: "第二套 CSRF trusted origin", path: "internal/httpapi/router.go", source: `package httpapi; type Options struct { CSRFTrustedOrigins []string }`, want: "Options 禁止暴露"},
		{name: "AddTrustedOrigin 越权", path: "internal/service/bad.go", source: `package service; type cop struct{}; func (cop) AddTrustedOrigin(string) error { return nil }; func add(c cop) { _ = c.AddTrustedOrigin("https://evil.example") }`, want: "AddTrustedOrigin 只能"},
		{name: "response dot import", path: "internal/service/bad.go", source: `package service; import . "github.com/lifei6671/commerce-shoot-studio/server/lib/response"; var _ = BindRequestID`, want: "禁止 dot import response"},
		{name: "BindRequestID 函数引用", path: "internal/httpapi/bad.go", source: `package httpapi; import "github.com/lifei6671/commerce-shoot-studio/server/lib/response"; var bind = response.BindRequestID`, want: "BindRequestID 只能"},
		{name: "共享 HMAC", path: "internal/httpapi/request_id.go", source: `package httpapi; import ("crypto/hmac"; "crypto/sha256"); var shared = hmac.New(sha256.New, nil)`, want: "hmac.New 只能"},
		{name: "其他 Next 共享 HMAC", path: "internal/httpapi/request_id.go", source: `package httpapi; import ("crypto/hmac"; "crypto/sha256"); type other struct{}; func (other) Next() { _ = hmac.New(sha256.New, nil) }`, want: "hmac.New 只能"},
		{name: "HTTP 边界跨文件 HMAC", path: "internal/httpapi/request_id_extra.go", source: `package httpapi; import ("crypto/hmac"; "crypto/sha256"); var shared = hmac.New(sha256.New, nil)`, want: "hmac.New 只能"},
		{name: "crypto hmac dot import", path: "internal/httpapi/request_id.go", source: `package httpapi; import (. "crypto/hmac"; "crypto/sha256"); var shared = New(sha256.New, nil)`, want: "禁止 dot import crypto/hmac"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := validateHTTPSource(test.path, []byte(test.source))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("应拒绝并包含 %q，实际=%v", test.want, err)
			}
		})
	}
}

func TestHTTPSourceValidatorAllowsBusinessHMAC(t *testing.T) {
	t.Parallel()

	source := []byte(`package verification
import (
	"crypto/hmac"
	"crypto/sha256"
)
func sign(key, payload []byte) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}`)
	if _, err := validateHTTPSource("internal/verification/code.go", source); err != nil {
		t.Fatalf("业务生产包应允许独立使用 crypto/hmac.New：%v", err)
	}
}

type httpSourceResult struct {
	ginNewCalls int
}

func validateHTTPSource(relativePath string, source []byte) (httpSourceResult, error) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, relativePath, source, parser.SkipObjectResolution)
	if err != nil {
		return httpSourceResult{}, fmt.Errorf("解析 %s 失败：%w", relativePath, err)
	}

	normalizedPath := filepath.ToSlash(relativePath)
	ginAllowed := strings.HasPrefix(normalizedPath, "internal/httpapi/") || strings.HasPrefix(normalizedPath, "lib/response/")
	httpBoundary := ginAllowed || strings.HasPrefix(normalizedPath, "internal/httpserver/")
	aliases := make(map[string]string)
	for _, spec := range file.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			return httpSourceResult{}, fmt.Errorf("%s import path 非法：%w", relativePath, err)
		}
		alias := filepath.Base(path)
		if spec.Name != nil {
			alias = spec.Name.Name
		}
		aliases[alias] = path
		if path == "github.com/lifei6671/commerce-shoot-studio/server/lib/response" && alias == "." {
			return httpSourceResult{}, fmt.Errorf("%s 禁止 dot import response", relativePath)
		}
		if path == "crypto/hmac" && alias == "." {
			return httpSourceResult{}, fmt.Errorf("%s 禁止 dot import crypto/hmac", relativePath)
		}
		if httpBoundary && path == "math/rand" {
			return httpSourceResult{}, fmt.Errorf("%s Request ID 禁止 math/rand", relativePath)
		}
		ginImport := path == ginModulePath || strings.HasPrefix(path, ginModulePath+"/")
		if ginImport && !ginAllowed {
			return httpSourceResult{}, fmt.Errorf("%s Gin 只能由 internal/httpapi 或 lib/response 导入", relativePath)
		}
		if ginImport && (alias == "." || alias == "_") {
			return httpSourceResult{}, fmt.Errorf("%s Gin 必须使用具名 import", relativePath)
		}
	}

	for _, declaration := range file.Decls {
		generic, ok := declaration.(*ast.GenDecl)
		if !ok || generic.Tok != token.TYPE {
			continue
		}
		for _, spec := range generic.Specs {
			typeSpec, ok := spec.(*ast.TypeSpec)
			if ok && typeSpec.Name.Name == "ErrorResponse" && normalizedPath != "internal/models/dto/generated/types.gen.go" {
				return httpSourceResult{}, fmt.Errorf("%s 禁止定义第二套 ErrorResponse", relativePath)
			}
			if ok && typeSpec.Name.Name == "Options" && normalizedPath == "internal/httpapi/router.go" {
				structure, ok := typeSpec.Type.(*ast.StructType)
				if !ok {
					return httpSourceResult{}, fmt.Errorf("%s httpapi Options 必须是结构体", relativePath)
				}
				for _, field := range structure.Fields.List {
					for _, name := range field.Names {
						switch name.Name {
						case "Entropy", "RequestID", "ExternalOrigin":
							return httpSourceResult{}, fmt.Errorf("%s Options 禁止暴露 %s seam", relativePath, name.Name)
						}
						if strings.Contains(name.Name, "TrustedOrigin") || strings.Contains(name.Name, "CSRF") {
							return httpSourceResult{}, fmt.Errorf("%s Options 禁止暴露第二套 CSRF trusted origin", relativePath)
						}
					}
				}
			}
		}
	}

	result := httpSourceResult{}
	var validationErr error
	ast.Inspect(file, func(node ast.Node) bool {
		if validationErr != nil {
			return false
		}
		if literal, ok := node.(*ast.BasicLit); ok && httpBoundary && literal.Kind == token.STRING {
			value, err := strconv.Unquote(literal.Value)
			if err == nil && isForbiddenCSRFTokenName(value) {
				validationErr = fmt.Errorf("%s 禁止 CSRF Token/Cookie/Header 合同", relativePath)
				return false
			}
		}
		if _, ok := node.(*ast.GoStmt); ok && httpBoundary {
			validationErr = fmt.Errorf("%s HTTP 边界禁止创建 goroutine", relativePath)
			return false
		}
		selector, ok := node.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		identifier, packageSelector := selector.X.(*ast.Ident)
		if packageSelector && aliases[identifier.Name] == "github.com/lifei6671/commerce-shoot-studio/server/lib/response" &&
			selector.Sel.Name == "BindRequestID" && normalizedPath != "internal/httpapi/middleware.go" {
			validationErr = fmt.Errorf("%s BindRequestID 只能由 HTTP lifecycle 调用", relativePath)
			return false
		}
		if packageSelector && aliases[identifier.Name] == "crypto/hmac" && selector.Sel.Name == "New" && httpBoundary {
			owner := containingFunction(file, selector)
			if normalizedPath != "internal/httpapi/request_id.go" || !isRequestIDIssuerNext(owner) {
				validationErr = fmt.Errorf("%s hmac.New 只能在 requestIDIssuer.Next 内创建", relativePath)
				return false
			}
		}
		if selector.Sel.Name == "AddTrustedOrigin" && normalizedPath != "internal/httpapi/security.go" {
			validationErr = fmt.Errorf("%s AddTrustedOrigin 只能由 security.go 从 CORS policy 构造", relativePath)
			return false
		}
		if packageSelector && aliases[identifier.Name] == ginModulePath {
			switch selector.Sel.Name {
			case "New":
				if normalizedPath != "internal/httpapi/router.go" {
					validationErr = fmt.Errorf("%s gin.New 只能由 internal/httpapi/router.go 调用", relativePath)
					return false
				}
				result.ginNewCalls++
			case "Default", "Logger", "LoggerWithConfig", "LoggerWithFormatter", "LoggerWithWriter", "Recovery", "RecoveryWithWriter", "CustomRecovery", "CustomRecoveryWithWriter":
				validationErr = fmt.Errorf("%s 禁止 gin.%s", relativePath, selector.Sel.Name)
				return false
			case "H":
				validationErr = fmt.Errorf("%s 禁止 gin.H", relativePath)
				return false
			}
		}
		if packageSelector && aliases[identifier.Name] == "net/http" && selector.Sel.Name == "TimeoutHandler" {
			validationErr = fmt.Errorf("%s 禁止 http.TimeoutHandler", relativePath)
			return false
		}
		if call, ok := parentCall(file, selector); ok {
			if httpBoundary {
				switch selector.Sel.Name {
				case "ClientIP":
					validationErr = fmt.Errorf("%s 禁止 ClientIP 作为业务事实源", relativePath)
					return false
				case "Handler":
					validationErr = fmt.Errorf("%s 禁止 CrossOriginProtection Handler wrapper", relativePath)
					return false
				case "AddInsecureBypassPattern":
					validationErr = fmt.Errorf("%s 禁止 CSRF bypass", relativePath)
					return false
				case "GET", "POST", "Any", "Handle", "Match":
					validationErr = fmt.Errorf("%s 禁止生产占位路由注册 %s", relativePath, selector.Sel.Name)
					return false
				case "Run", "RunTLS", "RunUnix", "RunFd":
					validationErr = fmt.Errorf("%s 禁止 Gin 自启动 %s", relativePath, selector.Sel.Name)
					return false
				case "Listen", "ListenAndServe", "ListenAndServeTLS", "Serve", "ServeTLS", "Shutdown", "Notify", "NotifyContext":
					validationErr = fmt.Errorf("%s 禁止 HTTP 生命周期调用 %s", relativePath, selector.Sel.Name)
					return false
				case "Error":
					if len(call.Args) != 0 {
						return true
					}
					validationErr = fmt.Errorf("%s 禁止读取原始 error 文本", relativePath)
					return false
				}
			}
			if packageSelector && aliases[identifier.Name] == "crypto/rand" && selector.Sel.Name == "Read" {
				validationErr = fmt.Errorf("%s 禁止 crypto/rand.Read", relativePath)
				return false
			}
			if packageSelector && aliases[identifier.Name] == "github.com/lifei6671/commerce-shoot-studio/server/lib/response" {
				switch selector.Sel.Name {
				case "BindRequestID":
					if normalizedPath != "internal/httpapi/middleware.go" {
						validationErr = fmt.Errorf("%s BindRequestID 只能由 HTTP lifecycle 调用", relativePath)
						return false
					}
				case "WriteError":
					if len(call.Args) != 2 {
						validationErr = fmt.Errorf("%s WriteError 不得接收自由 Request ID", relativePath)
						return false
					}
				}
			}
			if isForwardedHeaderMethod(selector.Sel.Name) && len(call.Args) > 0 {
				literal, ok := call.Args[0].(*ast.BasicLit)
				if ok && literal.Kind == token.STRING {
					headerName, err := strconv.Unquote(literal.Value)
					if err == nil && isForwardedHeaderName(headerName) && normalizedPath != "internal/httpapi/proxy.go" {
						validationErr = fmt.Errorf("%s 代理 Header 只能由 internal/httpapi/proxy.go 读取或删除", relativePath)
						return false
					}
				}
			}
		}
		return true
	})
	if validationErr != nil {
		return httpSourceResult{}, validationErr
	}
	return result, nil
}

func isForwardedHeaderMethod(method string) bool {
	return method == "Get" || method == "Values" || method == "Del"
}

func isForwardedHeaderName(name string) bool {
	switch strings.ToLower(name) {
	case "forwarded", "x-real-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto":
		return true
	default:
		return strings.HasPrefix(strings.ToLower(name), "x-forwarded-")
	}
}

func isForbiddenCSRFTokenName(value string) bool {
	normalized := strings.ToLower(value)
	return strings.Contains(normalized, "x-csrf-token") || strings.Contains(normalized, "csrf_token") || strings.Contains(normalized, "csrf-token")
}

func parentCall(file *ast.File, target ast.Expr) (*ast.CallExpr, bool) {
	var found *ast.CallExpr
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if ok && call.Fun == target {
			found = call
			return false
		}
		return found == nil
	})
	return found, found != nil
}

func containingFunction(file *ast.File, target ast.Node) *ast.FuncDecl {
	var owner *ast.FuncDecl
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			continue
		}
		ast.Inspect(function.Body, func(node ast.Node) bool {
			if node == target {
				owner = function
				return false
			}
			return owner == nil
		})
		if owner != nil {
			return owner
		}
	}
	return nil
}

func isRequestIDIssuerNext(function *ast.FuncDecl) bool {
	if function == nil || function.Name.Name != "Next" || function.Recv == nil || len(function.Recv.List) != 1 {
		return false
	}
	pointer, ok := function.Recv.List[0].Type.(*ast.StarExpr)
	if !ok {
		return false
	}
	receiver, ok := pointer.X.(*ast.Ident)
	return ok && receiver.Name == "requestIDIssuer"
}
