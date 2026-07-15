package constant_test

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/constant"
)

func TestAsyncJobStatusPersistentValues(t *testing.T) {
	if constant.AsyncJobStatusQueued != 0 || constant.AsyncJobStatusRunning != 1 {
		t.Fatalf("Async Job 状态值漂移：queued=%d running=%d", constant.AsyncJobStatusQueued, constant.AsyncJobStatusRunning)
	}
	statusType := reflect.TypeOf(constant.AsyncJobStatusQueued)
	if statusType.Kind() != reflect.Uint8 || statusType.Name() != "AsyncJobStatus" {
		t.Fatalf("Async Job 状态必须是具名 uint8 类型：kind=%s name=%q", statusType.Kind(), statusType.Name())
	}
}

func TestModelCategoryPersistentValues(t *testing.T) {
	tests := []struct {
		name  string
		value constant.ModelCategory
		want  uint8
	}{
		{name: "文生文", value: constant.ModelCategoryTextToText, want: 1},
		{name: "文生图", value: constant.ModelCategoryTextToImage, want: 2},
		{name: "图生图", value: constant.ModelCategoryImageToImage, want: 3},
		{name: "图生文", value: constant.ModelCategoryImageToText, want: 4},
	}
	seen := make(map[constant.ModelCategory]string, len(tests))
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if uint8(test.value) != test.want {
				t.Fatalf("模型类别值漂移：实际=%d 期望=%d", test.value, test.want)
			}
			if previous, duplicate := seen[test.value]; duplicate {
				t.Fatalf("模型类别 %d 与 %s 重复", test.value, previous)
			}
			seen[test.value] = test.name
		})
	}
	categoryType := reflect.TypeOf(constant.ModelCategoryTextToText)
	if categoryType.Kind() != reflect.Uint8 || categoryType.Name() != "ModelCategory" {
		t.Fatalf("模型类别必须是具名 uint8 类型：kind=%s name=%q", categoryType.Kind(), categoryType.Name())
	}
	if categoryType == reflect.TypeOf(constant.AsyncJobStatusQueued) {
		t.Fatal("不同领域的强类型常量不得共享同一个 Go 类型")
	}
}

func TestConstantPackageHasNoGenericStatusFile(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("无法定位常量测试文件")
	}
	_, err := os.Stat(filepath.Join(filepath.Dir(filename), "status.go"))
	if err == nil {
		t.Fatal("constant 包不得出现通用 status.go")
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("检查通用 status.go 失败：%v", err)
	}
}
