// Package buildcontract 用测试固化服务端 Go 模块的构建契约。
package buildcontract

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const (
	wantModulePath       = "github.com/lifei6671/commerce-shoot-studio/server"
	wantGoVersion        = "1.26.0"
	wantToolchain        = "go1.26.5"
	wantRuntimeToolchain = "go1.26.5"
)

// moduleContract 仅承载 G0-T01 需要固定的三项模块声明，避免测试依赖第三方解析库。
type moduleContract struct {
	modulePath string
	goVersion  string
	toolchain  string
}

func TestModuleContract(t *testing.T) {
	contract, err := parseModuleContract(readModuleFile(t))
	if err != nil {
		t.Fatalf("解析 go.mod 构建契约失败：%v", err)
	}

	if contract.modulePath != wantModulePath {
		t.Errorf("module 声明不符合约定：实际为 %q，期望为 %q", contract.modulePath, wantModulePath)
	}
	if contract.goVersion != wantGoVersion {
		t.Errorf("go 语言版本不符合约定：实际为 %q，期望为 %q", contract.goVersion, wantGoVersion)
	}
	if contract.toolchain != wantToolchain {
		t.Errorf("toolchain 声明不符合约定：实际为 %q，期望为 %q", contract.toolchain, wantToolchain)
	}
}

func TestRuntimeUsesPinnedToolchain(t *testing.T) {
	if got := runtime.Version(); got != wantRuntimeToolchain {
		t.Fatalf("测试未使用固定 Go 工具链：实际为 %q，期望为 %q", got, wantRuntimeToolchain)
	}
}

func TestParseModuleContractRejectsMissingToolchain(t *testing.T) {
	fixture := strings.NewReader("module example.com/server\n\ngo 1.26.0\n")

	_, err := parseModuleContract(fixture)
	if err == nil || !strings.Contains(err.Error(), "toolchain") {
		t.Fatalf("缺少 toolchain 时应返回明确错误，实际错误为：%v", err)
	}
}

// readModuleFile 通过当前测试文件定位模块根目录，确保 macOS、Linux 与 Windows 均可运行。
func readModuleFile(t *testing.T) *strings.Reader {
	t.Helper()

	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("无法定位当前测试文件")
	}

	moduleFile := filepath.Join(filepath.Dir(filename), "..", "..", "go.mod")
	content, err := os.ReadFile(moduleFile)
	if err != nil {
		t.Fatalf("读取 go.mod 失败：%v", err)
	}

	return strings.NewReader(string(content))
}

// parseModuleContract 只解析当前任务关心的顶层单值指令，并对缺失声明快速失败。
func parseModuleContract(input io.Reader) (moduleContract, error) {
	var contract moduleContract

	scanner := bufio.NewScanner(input)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 2 {
			continue
		}

		switch fields[0] {
		case "module":
			contract.modulePath = fields[1]
		case "go":
			contract.goVersion = fields[1]
		case "toolchain":
			contract.toolchain = fields[1]
		}
	}
	if err := scanner.Err(); err != nil {
		return moduleContract{}, fmt.Errorf("读取模块声明失败：%w", err)
	}

	if contract.modulePath == "" {
		return moduleContract{}, fmt.Errorf("缺少 module 声明")
	}
	if contract.goVersion == "" {
		return moduleContract{}, fmt.Errorf("缺少 go 声明")
	}
	if contract.toolchain == "" {
		return moduleContract{}, fmt.Errorf("缺少 toolchain 声明")
	}

	return contract, nil
}
