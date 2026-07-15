package buildcontract

import (
	"bufio"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
)

const (
	logitModulePath    = "github.com/lifei6671/logit"
	logitModuleVersion = "v1.0.0"
)

var (
	packageLevelSlogCalls = map[string]struct{}{
		"Debug": {}, "DebugContext": {},
		"Info": {}, "InfoContext": {},
		"Warn": {}, "WarnContext": {},
		"Error": {}, "ErrorContext": {},
		"Log": {}, "LogAttrs": {},
	}
	forbiddenSlogConstructors = map[string]struct{}{
		"Default": {}, "NewJSONHandler": {}, "NewLogLogger": {}, "NewTextHandler": {},
		"SetDefault": {}, "With": {},
	}
	loggerMessageIndexes = map[string]int{
		"Debug": 0, "Info": 0, "Warn": 0, "Error": 0,
		"DebugContext": 1, "InfoContext": 1, "WarnContext": 1, "ErrorContext": 1,
		"Log": 2, "LogAttrs": 2,
	}
)

func TestLoggingDependencyContract(t *testing.T) {
	version, direct, err := findDirectModuleRequirement(
		filepath.Join(loggingServerRoot(t), "go.mod"),
		logitModulePath,
	)
	if err != nil {
		t.Fatalf("读取日志依赖合同失败：%v", err)
	}
	if version != logitModuleVersion {
		t.Fatalf("logit 版本必须精确锁定：实际=%q 期望=%q", version, logitModuleVersion)
	}
	if !direct {
		t.Fatal("logit 必须是 lib/logger 使用的直接依赖，不得标记为 indirect")
	}
}

func TestLoggingResolvedModuleContract(t *testing.T) {
	command := exec.Command("go", "list", "-m", "-json", logitModulePath)
	command.Dir = loggingServerRoot(t)
	output, err := command.Output()
	if err != nil {
		t.Fatalf("解析实际生效的 logit module 失败：%v", err)
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
		t.Fatalf("解析 go list module JSON 失败：%v", err)
	}
	if module.Path != logitModulePath || module.Version != logitModuleVersion {
		t.Fatalf("实际 logit module 漂移：path=%q version=%q", module.Path, module.Version)
	}
	if module.Replace != nil {
		t.Fatalf("实际 logit module 不得被 replace：path=%q version=%q", module.Replace.Path, module.Replace.Version)
	}
}

func TestFindDirectModuleRequirementRejectsCommentedReplaceBlock(t *testing.T) {
	goModPath := filepath.Join(t.TempDir(), "go.mod")
	content := "module fixture\n\nrequire " + logitModulePath + " " + logitModuleVersion + "\n\nreplace ( // local override\n\t" + logitModulePath + " => ../logit\n)\n"
	if err := os.WriteFile(goModPath, []byte(content), 0o600); err != nil {
		t.Fatalf("写入 go.mod fixture 失败：%v", err)
	}
	if _, _, err := findDirectModuleRequirement(goModPath, logitModulePath); err == nil {
		t.Fatal("带尾随注释的 replace block 必须被拒绝")
	}
}

func TestFindDirectModuleRequirementRejectsIndirectDependency(t *testing.T) {
	for _, content := range []string{
		"module fixture\n\nrequire " + logitModulePath + " " + logitModuleVersion + " // indirect\n",
		"module fixture\n\nrequire " + logitModulePath + " " + logitModuleVersion + " //  indirect\n",
		"module fixture\n\nrequire " + logitModulePath + " " + logitModuleVersion + " //\tindirect\n",
		"module fixture\n\nrequire " + logitModulePath + " " + logitModuleVersion + " // indirect; retained for tooling\n",
		"module fixture\n\nrequire (\n\t" + logitModulePath + " " + logitModuleVersion + " // indirect\n)\n",
	} {
		goModPath := filepath.Join(t.TempDir(), "go.mod")
		if err := os.WriteFile(goModPath, []byte(content), 0o600); err != nil {
			t.Fatalf("写入 go.mod fixture 失败：%v", err)
		}
		version, direct, err := findDirectModuleRequirement(goModPath, logitModulePath)
		if err != nil {
			t.Fatalf("解析 indirect fixture 失败：%v", err)
		}
		if version != logitModuleVersion || direct {
			t.Fatalf("indirect 依赖识别错误：version=%q direct=%v", version, direct)
		}
	}
}

func TestLoggingProductionSourceContract(t *testing.T) {
	root := loggingServerRoot(t)
	files, err := productionGoFiles(root)
	if err != nil {
		t.Fatalf("枚举生产 Go 源码失败：%v", err)
	}

	foundLoggerAdapter := false
	for _, path := range files {
		relative, err := filepath.Rel(root, path)
		if err != nil {
			t.Fatalf("计算源码相对路径失败：%v", err)
		}
		source, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("读取生产源码 %s 失败：%v", relative, err)
		}
		result, err := validateLoggingSource(filepath.ToSlash(relative), source)
		if err != nil {
			t.Fatalf("日志源码合同失败：%v", err)
		}
		foundLoggerAdapter = foundLoggerAdapter || result.importsLogitInLogger
	}
	if !foundLoggerAdapter {
		t.Fatal("缺少 server/lib/logger 对 logit v1.0.0 的唯一适配实现")
	}
}

func TestLoggingSourceValidatorAcceptsInjectedLoggerWithLiteralMessage(t *testing.T) {
	source := `package fixture
import (
	"context"
	"log/slog"
)
type reporter struct{}
func (reporter) Info(string) {}
func (reporter) Handler() {}
func run(ctx context.Context, logger *slog.Logger) {
	logger.InfoContext(ctx, "HTTP 请求完成", slog.Int("status_code", 200))
}
func inspect(err error, message string) {
	_ = err.Error()
	var report reporter
	report.Info(message)
	report.Handler()
	slog := report
	slog.Info(message)
}`

	if _, err := validateLoggingSource("internal/service/example.go", []byte(source)); err != nil {
		t.Fatalf("显式注入 logger、字面量消息和受控数值字段应通过：%v", err)
	}
}

func TestLoggingSourceValidatorRejectsEveryBypass(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		source string
		want   string
	}{
		{
			name: "logit 越层导入",
			path: "internal/service/example.go",
			source: `package fixture
import _ "github.com/lifei6671/logit"`,
			want: "只有 lib/logger 可以导入 logit",
		},
		{
			name: "slog dot import",
			path: "internal/service/example.go",
			source: `package fixture
import . "log/slog"`,
			want: "禁止 dot import log/slog",
		},
		{
			name: "package Debug",
			path: "internal/service/example.go",
			source: `package fixture
import sl "log/slog"
func run() { sl.Debug("debug") }`,
			want: "禁止 package-level slog.Debug",
		},
		{
			name: "package DebugContext",
			path: "internal/service/example.go",
			source: `package fixture
import (
	"context"
	"log/slog"
)
func run(ctx context.Context) { slog.DebugContext(ctx, "debug") }`,
			want: "禁止 package-level slog.DebugContext",
		},
		{
			name: "package Info",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
func run() { slog.Info("info") }`,
			want: "禁止 package-level slog.Info",
		},
		{
			name: "package InfoContext",
			path: "internal/service/example.go",
			source: `package fixture
import (
	"context"
	"log/slog"
)
func run(ctx context.Context) { slog.InfoContext(ctx, "info") }`,
			want: "禁止 package-level slog.InfoContext",
		},
		{
			name: "package Warn",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
func run() { slog.Warn("warn") }`,
			want: "禁止 package-level slog.Warn",
		},
		{
			name: "package WarnContext",
			path: "internal/service/example.go",
			source: `package fixture
import (
	"context"
	"log/slog"
)
func run(ctx context.Context) { slog.WarnContext(ctx, "warn") }`,
			want: "禁止 package-level slog.WarnContext",
		},
		{
			name: "package Error",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
func run() { slog.Error("error") }`,
			want: "禁止 package-level slog.Error",
		},
		{
			name: "package ErrorContext",
			path: "internal/service/example.go",
			source: `package fixture
import (
	"context"
	"log/slog"
)
func run(ctx context.Context) { slog.ErrorContext(ctx, "error") }`,
			want: "禁止 package-level slog.ErrorContext",
		},
		{
			name: "package Log",
			path: "internal/service/example.go",
			source: `package fixture
import (
	"context"
	"log/slog"
)
func run(ctx context.Context) { slog.Log(ctx, slog.LevelInfo, "log") }`,
			want: "禁止 package-level slog.Log",
		},
		{
			name: "package LogAttrs",
			path: "internal/service/example.go",
			source: `package fixture
import (
	"context"
	"log/slog"
)
func run(ctx context.Context) { slog.LogAttrs(ctx, slog.LevelInfo, "log") }`,
			want: "禁止 package-level slog.LogAttrs",
		},
		{
			name: "Default",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
var logger = slog.Default()`,
			want: "禁止 slog.Default",
		},
		{
			name: "With",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
var logger = slog.With("scope", "unsafe")`,
			want: "禁止 slog.With",
		},
		{
			name: "New",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
func build(handler slog.Handler) *slog.Logger { return slog.New(handler) }`,
			want: "只有 lib/logger 可以调用 slog.New",
		},
		{
			name: "NewLogLogger",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
func build(handler slog.Handler) { _ = slog.NewLogLogger(handler, slog.LevelInfo) }`,
			want: "禁止 slog.NewLogLogger",
		},
		{
			name: "NewTextHandler",
			path: "internal/service/example.go",
			source: `package fixture
import (
	"io"
	"log/slog"
)
func build(writer io.Writer) { _ = slog.NewTextHandler(writer, nil) }`,
			want: "禁止 slog.NewTextHandler",
		},
		{
			name: "NewJSONHandler",
			path: "lib/logger/logger.go",
			source: `package logger
import (
	"io"
	"log/slog"
)
func build(writer io.Writer) { _ = slog.NewJSONHandler(writer, nil) }`,
			want: "禁止 slog.NewJSONHandler",
		},
		{
			name: "SetDefault",
			path: "lib/logger/logger.go",
			source: `package logger
import "log/slog"
func install(logger *slog.Logger) { slog.SetDefault(logger) }`,
			want: "禁止 slog.SetDefault",
		},
		{
			name: "WithSlogSource true",
			path: "lib/logger/logger.go",
			source: `package logger
import "github.com/lifei6671/logit"
var sourceOption = logit.WithSlogSource(true)`,
			want: "WithSlogSource 只能显式关闭",
		},
		{
			name: "Handler 提取",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
func unwrap(logger *slog.Logger) slog.Handler { return logger.Handler() }`,
			want: "禁止提取 slog Handler",
		},
		{
			name: "日志方法值",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
func bind(logger *slog.Logger) { write := logger.Info; _ = write }`,
			want: "禁止提取日志方法值",
		},
		{
			name: "logger 包日志方法值",
			path: "lib/logger/bypass.go",
			source: `package logger
import "log/slog"
func bind(logger *slog.Logger) { write := logger.Info; _ = write }`,
			want: "禁止提取日志方法值",
		},
		{
			name: "动态消息",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
func write(logger *slog.Logger, message string) { logger.Info(message) }`,
			want: "日志消息必须是字符串字面量",
		},
		{
			name: "本模块 logger 工厂动态消息",
			path: "cmd/fixture/main.go",
			source: `package fixture
import (
	"io"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/logger"
)
func write(message string) {
	log, _ := logger.New(logger.Options{Writer: io.Discard, Service: "fixture", Version: "v1"})
	log.Info(message)
}`,
			want: "日志消息必须是字符串字面量",
		},
		{
			name: "slog.Any",
			path: "internal/service/example.go",
			source: `package fixture
import "log/slog"
var unsafe = slog.Any("payload", map[string]string{"secret": "marker"})`,
			want: "禁止 slog.Any",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := validateLoggingSource(test.path, []byte(test.source))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("应拒绝绕过并包含 %q，实际错误：%v", test.want, err)
			}
		})
	}
}

type loggingSourceResult struct {
	importsLogitInLogger bool
}

func validateLoggingSource(relativePath string, source []byte) (loggingSourceResult, error) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, relativePath, source, parser.SkipObjectResolution)
	if err != nil {
		return loggingSourceResult{}, fmt.Errorf("解析 %s 失败：%w", relativePath, err)
	}

	isLoggerPackage := strings.HasPrefix(filepath.ToSlash(relativePath), "lib/logger/")
	result := loggingSourceResult{}

	for _, spec := range file.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			return loggingSourceResult{}, fmt.Errorf("%s 包含非法 import path：%w", relativePath, err)
		}
		alias := filepath.Base(path)
		if spec.Name != nil {
			alias = spec.Name.Name
		}
		switch path {
		case "log/slog":
			if alias == "." {
				return loggingSourceResult{}, fmt.Errorf("%s 禁止 dot import log/slog", relativePath)
			}
		case logitModulePath:
			if !isLoggerPackage {
				return loggingSourceResult{}, fmt.Errorf("%s 只有 lib/logger 可以导入 logit", relativePath)
			}
			if alias == "." || alias == "_" {
				return loggingSourceResult{}, fmt.Errorf("%s 必须使用具名 logit import", relativePath)
			}
			result.importsLogitInLogger = true
		}
	}

	typeInfo := &types.Info{
		Uses:       make(map[*ast.Ident]types.Object),
		Selections: make(map[*ast.SelectorExpr]*types.Selection),
	}
	packageFiles, err := loggingPackageFiles(fileSet, relativePath, source, file)
	if err != nil {
		return loggingSourceResult{}, err
	}
	typeConfig := types.Config{
		Importer: loggingImporter(fileSet),
	}
	if _, err := typeConfig.Check(
		"loggingcontract/"+strings.TrimSuffix(filepath.ToSlash(relativePath), ".go"),
		fileSet,
		packageFiles,
		typeInfo,
	); err != nil {
		return loggingSourceResult{}, fmt.Errorf("%s 无法完成日志类型检查：%w", relativePath, err)
	}

	calledSelectors := make(map[*ast.SelectorExpr]*ast.CallExpr)
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		if selector, ok := call.Fun.(*ast.SelectorExpr); ok {
			calledSelectors[selector] = call
		}
		return true
	})

	var validationErr error
	ast.Inspect(file, func(node ast.Node) bool {
		if validationErr != nil {
			return false
		}
		selector, ok := node.(*ast.SelectorExpr)
		if !ok {
			return true
		}

		isSlogPackage := isPackageSelector(selector, typeInfo, "log/slog")
		isLogitPackage := isPackageSelector(selector, typeInfo, logitModulePath)
		isSlogLoggerMethod := isMethodSelector(selector, typeInfo, "log/slog")
		call, isCalled := calledSelectors[selector]

		if isSlogPackage {
			if _, forbidden := packageLevelSlogCalls[selector.Sel.Name]; forbidden {
				validationErr = fmt.Errorf("%s 禁止 package-level slog.%s", relativePath, selector.Sel.Name)
				return false
			}
			if selector.Sel.Name == "Any" {
				validationErr = fmt.Errorf("%s 禁止 slog.Any", relativePath)
				return false
			}
			if selector.Sel.Name == "New" && !isLoggerPackage {
				validationErr = fmt.Errorf("%s 只有 lib/logger 可以调用 slog.New", relativePath)
				return false
			}
			if _, forbidden := forbiddenSlogConstructors[selector.Sel.Name]; forbidden {
				validationErr = fmt.Errorf("%s 禁止 slog.%s", relativePath, selector.Sel.Name)
				return false
			}
		}

		if isLogitPackage && selector.Sel.Name == "WithSlogSource" {
			if !isCalled || len(call.Args) != 1 || !isFalseLiteral(call.Args[0]) {
				validationErr = fmt.Errorf("%s WithSlogSource 只能显式关闭", relativePath)
				return false
			}
		}

		if isSlogLoggerMethod && selector.Sel.Name == "Handler" {
			validationErr = fmt.Errorf("%s 禁止提取 slog Handler", relativePath)
			return false
		}

		messageIndex, loggingMethod := loggerMessageIndexes[selector.Sel.Name]
		if !loggingMethod || isSlogPackage || !isSlogLoggerMethod {
			return true
		}
		if !isCalled {
			validationErr = fmt.Errorf("%s 禁止提取日志方法值 %s", relativePath, selector.Sel.Name)
			return false
		}
		// 普通 error.Error() 等同名方法没有 slog 消息参数，不属于日志调用面。
		if len(call.Args) <= messageIndex {
			return true
		}
		if !isStringLiteral(call.Args[messageIndex]) {
			validationErr = fmt.Errorf("%s 日志消息必须是字符串字面量：%s", relativePath, selector.Sel.Name)
			return false
		}
		return true
	})
	if validationErr != nil {
		return loggingSourceResult{}, validationErr
	}
	return result, nil
}

func productionGoFiles(root string) ([]string, error) {
	files := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != root && excludedGoSourceDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(entry.Name()) != ".go" || strings.HasSuffix(entry.Name(), "_test.go") {
			return nil
		}
		files = append(files, path)
		return nil
	})
	return files, err
}

func excludedGoSourceDirectory(name string) bool {
	switch name {
	case ".git", "generated", "node_modules", "testdata", "vendor":
		return true
	default:
		return false
	}
}

func findDirectModuleRequirement(goModPath string, modulePath string) (string, bool, error) {
	file, err := os.Open(goModPath)
	if err != nil {
		return "", false, err
	}
	defer file.Close()

	var (
		inRequireBlock bool
		inReplaceBlock bool
		version        string
		direct         bool
	)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		rawLine := strings.TrimSpace(scanner.Text())
		line := strings.TrimSpace(strings.SplitN(rawLine, "//", 2)[0])
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}

		if len(fields) == 2 && fields[1] == "(" {
			inRequireBlock = fields[0] == "require"
			inReplaceBlock = fields[0] == "replace" || fields[0] == "exclude"
			continue
		}
		if fields[0] == ")" {
			inRequireBlock = false
			inReplaceBlock = false
			continue
		}
		if inReplaceBlock && fields[0] == modulePath {
			return "", false, fmt.Errorf("logit 不得使用 replace 或 exclude")
		}
		if fields[0] == "replace" || fields[0] == "exclude" {
			if len(fields) > 1 && fields[1] == modulePath {
				return "", false, fmt.Errorf("logit 不得使用 replace 或 exclude")
			}
			continue
		}

		var requirement []string
		switch {
		case inRequireBlock:
			requirement = fields
		case fields[0] == "require":
			requirement = fields[1:]
		default:
			continue
		}
		if len(requirement) < 2 || requirement[0] != modulePath {
			continue
		}
		if version != "" {
			return "", false, fmt.Errorf("logit require 重复")
		}
		version = requirement[1]
		direct = !hasIndirectComment(rawLine)
	}
	if err := scanner.Err(); err != nil {
		return "", false, err
	}
	if version == "" {
		return "", false, fmt.Errorf("go.mod 缺少 %s", modulePath)
	}
	return version, direct, nil
}

func hasIndirectComment(line string) bool {
	parts := strings.SplitN(line, "//", 2)
	if len(parts) != 2 {
		return false
	}
	fields := strings.Fields(parts[1])
	return len(fields) > 0 && (fields[0] == "indirect" || strings.HasPrefix(fields[0], "indirect;"))
}

func loggingServerRoot(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("无法定位日志合同测试文件")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", ".."))
}

func isPackageSelector(selector *ast.SelectorExpr, info *types.Info, packagePath string) bool {
	identifier, ok := selector.X.(*ast.Ident)
	if !ok {
		return false
	}
	packageName, ok := info.Uses[identifier].(*types.PkgName)
	return ok && packageName.Imported().Path() == packagePath
}

func isMethodSelector(selector *ast.SelectorExpr, info *types.Info, packagePath string) bool {
	selection := info.Selections[selector]
	if selection == nil || selection.Obj() == nil || selection.Obj().Pkg() == nil {
		return false
	}
	return selection.Obj().Pkg().Path() == packagePath
}

func isFalseLiteral(expression ast.Expr) bool {
	identifier, ok := expression.(*ast.Ident)
	return ok && identifier.Name == "false"
}

func isStringLiteral(expression ast.Expr) bool {
	for {
		parenthesized, ok := expression.(*ast.ParenExpr)
		if !ok {
			break
		}
		expression = parenthesized.X
	}
	literal, ok := expression.(*ast.BasicLit)
	return ok && literal.Kind == token.STRING
}

var loggingExportPaths sync.Map

func loggingPackageFiles(fileSet *token.FileSet, relativePath string, source []byte, primary *ast.File) ([]*ast.File, error) {
	actualPath := filepath.Join(loggingServerRootPath(), filepath.FromSlash(relativePath))
	actualSource, err := os.ReadFile(actualPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []*ast.File{primary}, nil
		}
		return nil, fmt.Errorf("检查生产源码路径失败：%w", err)
	}
	if string(actualSource) != string(source) {
		return []*ast.File{primary}, nil
	}

	entries, err := os.ReadDir(filepath.Dir(actualPath))
	if err != nil {
		return nil, fmt.Errorf("读取生产源码目录失败：%w", err)
	}
	files := []*ast.File{primary}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".go" || strings.HasSuffix(entry.Name(), "_test.go") || entry.Name() == filepath.Base(actualPath) {
			continue
		}
		path := filepath.Join(filepath.Dir(actualPath), entry.Name())
		parsed, err := parser.ParseFile(fileSet, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return nil, fmt.Errorf("解析同包源码 %s 失败：%w", path, err)
		}
		if parsed.Name.Name == primary.Name.Name {
			files = append(files, parsed)
		}
	}
	return files, nil
}

func loggingImporter(fileSet *token.FileSet) types.Importer {
	return importer.ForCompiler(fileSet, "gc", func(importPath string) (io.ReadCloser, error) {
		if cached, ok := loggingExportPaths.Load(importPath); ok {
			return os.Open(cached.(string))
		}
		command := exec.Command("go", "list", "-export", "-f={{.Export}}", importPath)
		command.Dir = loggingServerRootPath()
		output, err := command.Output()
		if err != nil {
			return nil, fmt.Errorf("解析 import %s 的 export data 失败：%w", importPath, err)
		}
		exportPath := strings.TrimSpace(string(output))
		if exportPath == "" {
			return nil, fmt.Errorf("import %s 缺少 export data", importPath)
		}
		loggingExportPaths.Store(importPath, exportPath)
		return os.Open(exportPath)
	})
}

func loggingServerRootPath() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return ""
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", ".."))
}
