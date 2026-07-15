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
		}
	}

	result := httpSourceResult{}
	var validationErr error
	ast.Inspect(file, func(node ast.Node) bool {
		if validationErr != nil {
			return false
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
		}
		return true
	})
	if validationErr != nil {
		return httpSourceResult{}, validationErr
	}
	return result, nil
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
