package config

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type runtimeDocumentFixture struct {
	Enabled bool   `json:"enabled"`
	Name    string `json:"name"`
}

func (fixture *runtimeDocumentFixture) Validate() error {
	if strings.TrimSpace(fixture.Name) == "" {
		return errors.New("名称不能为空")
	}
	return nil
}

type runtimeDocumentSourceFixture struct {
	content []byte
	err     error
}

type runtimeSecretValidationFixture struct{}

func (*runtimeSecretValidationFixture) Validate() error {
	return errors.New("runtime-validation-secret-marker")
}

func (source runtimeDocumentSourceFixture) ReadRuntimeDocument(context.Context, string) ([]byte, error) {
	if source.err != nil {
		return nil, source.err
	}
	return source.content, nil
}

func TestLoadRuntimeDocument(t *testing.T) {
	target := &runtimeDocumentFixture{}
	err := LoadRuntimeDocument(
		context.Background(),
		runtimeDocumentSourceFixture{content: []byte(`{"enabled":true,"name":"mail"}`)},
		"mail",
		target,
	)
	if err != nil {
		t.Fatalf("加载合法 runtime document 失败：%v", err)
	}
	if !target.Enabled || target.Name != "mail" {
		t.Fatalf("runtime document 解码结果错误：%+v", target)
	}
}

func TestLoadRuntimeDocumentRejectsInvalidInput(t *testing.T) {
	tests := []struct {
		name    string
		content string
	}{
		{name: "未知字段", content: `{"enabled":true,"name":"mail","secret":"runtime-secret-marker"}`},
		{name: "尾随 JSON", content: `{"enabled":true,"name":"mail"}{"enabled":false}`},
		{name: "错误类型", content: `{"enabled":"true","name":"mail"}`},
		{name: "不是 JSON object", content: `[]`},
		{name: "JSON null", content: `null`},
		{name: "业务校验失败", content: `{"enabled":true,"name":""}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := LoadRuntimeDocument(
				context.Background(),
				runtimeDocumentSourceFixture{content: []byte(test.content)},
				"mail",
				&runtimeDocumentFixture{},
			)
			if err == nil {
				t.Fatal("无效 runtime document 应被拒绝")
			}
			if strings.Contains(err.Error(), "runtime-secret-marker") || strings.Contains(err.Error(), test.content) {
				t.Fatalf("错误信息泄漏原始 JSON：%v", err)
			}
		})
	}
}

func TestLoadRuntimeDocumentPropagatesSourceFailure(t *testing.T) {
	sourceErr := errors.New("runtime-source-secret-marker")
	err := LoadRuntimeDocument(
		context.Background(),
		runtimeDocumentSourceFixture{err: sourceErr},
		"mail",
		&runtimeDocumentFixture{},
	)
	if !errors.Is(err, sourceErr) {
		t.Fatalf("source 错误应保留错误链：%v", err)
	}
	if strings.Contains(err.Error(), "runtime-source-secret-marker") {
		t.Fatalf("source 错误消息不应泄漏底层值：%v", err)
	}
}

func TestLoadRuntimeDocumentDoesNotExposeValidationFailure(t *testing.T) {
	err := LoadRuntimeDocument(
		context.Background(),
		runtimeDocumentSourceFixture{content: []byte(`{}`)},
		"mail",
		&runtimeSecretValidationFixture{},
	)
	if err == nil {
		t.Fatal("runtime document 业务校验失败应返回错误")
	}
	if strings.Contains(err.Error(), "runtime-validation-secret-marker") {
		t.Fatalf("业务校验错误不应泄漏底层值：%v", err)
	}
}
