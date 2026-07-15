package config

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// RuntimeDocumentSource 是后续 system_configs 存储实现需要满足的最小读取端口。
type RuntimeDocumentSource interface {
	ReadRuntimeDocument(context.Context, string) ([]byte, error)
}

// RuntimeDocument 在严格 JSON 解码后执行具体业务配置校验。
type RuntimeDocument interface {
	Validate() error
}

type runtimeDocumentSourceError struct {
	cause error
}

func (err runtimeDocumentSourceError) Error() string {
	return "读取 runtime 配置失败"
}

func (err runtimeDocumentSourceError) Unwrap() error {
	return err.cause
}

// LoadRuntimeDocument 从运行时配置源读取单个 JSON 文档并严格解码。
func LoadRuntimeDocument(ctx context.Context, source RuntimeDocumentSource, key string, target RuntimeDocument) error {
	if source == nil || target == nil {
		return fmt.Errorf("runtime 配置源和目标不能为空")
	}
	content, err := source.ReadRuntimeDocument(ctx, key)
	if err != nil {
		return runtimeDocumentSourceError{cause: err}
	}
	trimmed := bytes.TrimSpace(content)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return fmt.Errorf("runtime 配置必须是单个 JSON object")
	}
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("解析 runtime 配置失败")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return fmt.Errorf("runtime 配置包含尾随内容")
	}
	if err := target.Validate(); err != nil {
		return fmt.Errorf("runtime 配置校验失败")
	}
	return nil
}
