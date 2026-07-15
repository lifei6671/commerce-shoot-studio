package buildcontract

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

var requiredOpenAPISchemas = []string{
	"AiAssistStreamDelta",
	"AiAssistStreamDone",
	"AiAssistStreamError",
	"AiAssistStreamMeta",
	"AiAssistTextResult",
	"CreditLedgerItemView",
	"CreditSummaryView",
	"CursorPageInfo",
	"CursorRequest",
	"ErrorResponse",
	"GenerationPlanQuoteView",
	"PageInfo",
	"PageRequest",
}

var requiredOpenAPISchemaFields = map[string]struct {
	properties []string
	required   []string
}{
	"AiAssistStreamDelta":     {properties: []string{"sequence", "text"}, required: []string{"sequence", "text"}},
	"AiAssistStreamDone":      {properties: []string{"result", "sequence"}, required: []string{"result", "sequence"}},
	"AiAssistStreamError":     {properties: []string{"code", "message", "sequence"}, required: []string{"code", "message", "sequence"}},
	"AiAssistStreamMeta":      {properties: []string{"aiAssistInvocationId", "replayed", "requestId"}, required: []string{"aiAssistInvocationId", "replayed", "requestId"}},
	"AiAssistTextResult":      {properties: []string{"text"}, required: []string{"text"}},
	"CreditLedgerItemView":    {properties: []string{"availableAfter", "createdAt", "deltaAvailable", "deltaReserved", "description", "id", "operation", "outputId", "points", "quantity", "reservedAfter", "taskId", "unitPoints"}, required: []string{"availableAfter", "createdAt", "deltaAvailable", "deltaReserved", "description", "id", "operation", "points", "quantity", "reservedAfter", "unitPoints"}},
	"CreditSummaryView":       {properties: []string{"available", "reserved"}, required: []string{"available", "reserved"}},
	"CursorPageInfo":          {properties: []string{"hasMore", "nextCursor"}, required: []string{"hasMore"}},
	"CursorRequest":           {properties: []string{"cursor", "limit"}},
	"ErrorResponse":           {properties: []string{"code", "message", "requestId"}, required: []string{"code", "message", "requestId"}},
	"GenerationPlanQuoteView": {properties: []string{"availablePoints", "invalidReason", "maxReservedPoints", "plannedSlotCount", "quoteVersion", "shortfallPoints"}, required: []string{"availablePoints", "maxReservedPoints", "plannedSlotCount", "quoteVersion", "shortfallPoints"}},
	"PageInfo":                {properties: []string{"page", "pageSize", "total"}, required: []string{"page", "pageSize", "total"}},
	"PageRequest":             {properties: []string{"page", "pageSize"}},
}

func TestOpenAPISharedContract(t *testing.T) {
	document := readYAMLDocument(t, filepath.Join(serverRoot(t), "api", "openapi.yaml"))
	if err := validateOpenAPIDocument(document); err != nil {
		t.Fatalf("OpenAPI 合同无效：%v", err)
	}
	if got := stringValue(document, "openapi"); got != "3.0.3" {
		t.Fatalf("OpenAPI 版本漂移：实际=%q 期望=%q", got, "3.0.3")
	}

	paths := mapValue(t, document, "paths")
	if len(paths) != 0 {
		t.Fatalf("方案 A 的初始 OpenAPI 不得伪造业务 operation：%v", sortedKeys(paths))
	}
	components := mapValue(t, document, "components")
	schemas := mapValue(t, components, "schemas")
	if got := sortedKeys(schemas); !reflect.DeepEqual(got, requiredOpenAPISchemas) {
		t.Fatalf("首批 schema 集合漂移：实际=%v 期望=%v", got, requiredOpenAPISchemas)
	}

	for _, name := range requiredOpenAPISchemas {
		fields := requiredOpenAPISchemaFields[name]
		assertObjectSchema(t, schemas, name, fields.properties, fields.required)
	}
	assertPropertyType(t, schemas, "ErrorResponse", "code", "integer", "")
	assertPropertyType(t, schemas, "ErrorResponse", "message", "string", "")
	assertPropertyType(t, schemas, "ErrorResponse", "requestId", "string", "")

	parameters := mapValue(t, components, "parameters")
	idempotencyKey := mapValue(t, parameters, "IdempotencyKey")
	if stringValue(idempotencyKey, "name") != "Idempotency-Key" || stringValue(idempotencyKey, "in") != "header" {
		t.Fatalf("幂等 Header 合同漂移：%v", idempotencyKey)
	}
	if required, _ := idempotencyKey["required"].(bool); !required {
		t.Fatal("Idempotency-Key 参数必须声明为必填")
	}
	responses := mapValue(t, components, "responses")
	streamResponse := mapValue(t, responses, "AiAssistStream")
	content := mapValue(t, streamResponse, "content")
	streamContent := mapValue(t, content, "text/event-stream")
	streamSchema := mapValue(t, streamContent, "schema")
	if stringValue(streamSchema, "type") != "string" {
		t.Fatalf("SSE wire response 必须声明为字符串流：%v", streamSchema)
	}
	if _, exists := components["securitySchemes"]; exists {
		t.Fatal("Cookie 名可配置时不得伪造静态 OpenAPI security scheme")
	}
}

func TestOpenAPIValidatorRejectsUnsafeContracts(t *testing.T) {
	tests := []struct {
		name     string
		document map[string]any
		want     string
	}{
		{
			name: "远程 ref",
			document: contractFixture(map[string]any{
				"schemas": map[string]any{"Remote": map[string]any{"$ref": "https://example.com/schema.yaml"}},
			}),
			want: "只允许内部 $ref",
		},
		{
			name: "逃逸文件 ref",
			document: contractFixture(map[string]any{
				"schemas": map[string]any{"Escape": map[string]any{"$ref": "../../secret.yaml"}},
			}),
			want: "只允许内部 $ref",
		},
		{
			name: "禁止 PUT",
			document: contractFixture(map[string]any{
				"paths": map[string]any{"/api/v1/example": map[string]any{"put": map[string]any{"operationId": "updateExample"}}},
			}),
			want: "只允许 GET/POST",
		},
		{
			name: "重复 operationId",
			document: contractFixture(map[string]any{
				"paths": map[string]any{
					"/api/v1/a": map[string]any{"get": map[string]any{"operationId": "getExample"}},
					"/api/v1/b": map[string]any{"post": map[string]any{"operationId": "getExample"}},
				},
			}),
			want: "operationId 重复",
		},
		{
			name: "CSRF 字段",
			document: contractFixture(map[string]any{
				"schemas": map[string]any{
					"Unsafe": map[string]any{"type": "object", "properties": map[string]any{"csrfToken": map[string]any{"type": "string"}}},
				},
			}),
			want: "禁止字段",
		},
		{
			name: "CSRF Header 参数名",
			document: contractFixture(map[string]any{
				"paths": map[string]any{
					"/api/v1/example": map[string]any{
						"post": map[string]any{
							"operationId": "createExample",
							"parameters": []any{map[string]any{
								"name": "X-CSRF-Token", "in": "header", "schema": map[string]any{"type": "string"},
							}},
						},
					},
				},
			}),
			want: "禁止名称",
		},
		{
			name: "敏感字段",
			document: contractFixture(map[string]any{
				"schemas": map[string]any{
					"Unsafe": map[string]any{"type": "object", "properties": map[string]any{"rawPrompt": map[string]any{"type": "string"}}},
				},
			}),
			want: "禁止字段",
		},
		{
			name: "复合敏感字段",
			document: contractFixture(map[string]any{
				"schemas": map[string]any{
					"Unsafe": map[string]any{"type": "object", "properties": map[string]any{"imageBase64": map[string]any{"type": "string"}}},
				},
			}),
			want: "禁止字段",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateOpenAPIDocument(test.document)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("应拒绝非法合同并包含 %q，实际错误：%v", test.want, err)
			}
		})
	}
}

func TestOpenAPIGeneratorBoundaries(t *testing.T) {
	root := serverRoot(t)
	generateSource := readTextFile(t, filepath.Join(root, "api", "generate.go"))
	wantGenerateSource := `// Package api owns the reviewed OpenAPI source and reproducible generation entry point.
package api

//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.7.2 --config oapi-codegen.yaml openapi.yaml
`
	if generateSource != wantGenerateSource {
		t.Fatalf("Go 生成入口必须保持唯一且精确，实际：\n%s", generateSource)
	}
	config := readYAMLDocument(t, filepath.Join(root, "api", "oapi-codegen.yaml"))
	wantConfig := map[string]any{
		"package": "generated",
		"output":  "../internal/models/dto/generated/types.gen.go",
		"generate": map[string]any{
			"models": true,
		},
		"output-options": map[string]any{
			"skip-prune": true,
		},
	}
	if !reflect.DeepEqual(config, wantConfig) {
		t.Fatalf("Go 生成配置必须是精确的 models-only 白名单，实际=%v", config)
	}

	webPackage := readJSONDocument(t, filepath.Join(root, "..", "web", "package.json"))
	devDependencies := mapValue(t, webPackage, "devDependencies")
	if got := stringValue(devDependencies, "openapi-typescript"); got != "7.13.0" {
		t.Fatalf("openapi-typescript 必须精确锁定 7.13.0，实际=%q", got)
	}
	scripts := mapValue(t, webPackage, "scripts")
	if got := stringValue(scripts, "generate:openapi"); got != "openapi-typescript ../server/api/openapi.yaml --output src/api/generated/openapi.ts --default-non-nullable false" {
		t.Fatalf("TypeScript 生成脚本必须固定本地输入与 Web 输出，实际=%q", got)
	}
	desktopPackage := readJSONDocument(t, filepath.Join(root, "..", "desktop", "package.json"))
	for _, section := range []string{"dependencies", "devDependencies"} {
		if _, exists := mapValue(t, desktopPackage, section)["openapi-typescript"]; exists {
			t.Fatal("G0-T04 不得把 Web 生成器加入 Desktop 依赖")
		}
	}
}

func TestGeneratedOpenAPITransportTypes(t *testing.T) {
	root := serverRoot(t)
	assertFileSHA256(t, filepath.Join(root, "api", "openapi.yaml"), "378a4b0c867de36ebd30df5006cb310dde37771eab8c426c336f85b7ac6e1ca9")
	assertFileSHA256(t, filepath.Join(root, "internal", "models", "dto", "generated", "types.gen.go"), "c5c1be80595fc3fe810de1f29f43d0a0159716b0a94d3977952d43e9951f3b68")
	assertFileSHA256(t, filepath.Join(root, "..", "web", "src", "api", "generated", "openapi.ts"), "02f76e6c304566e5855d68bc11f4623355b7372ed34989d4d56bc168ae9b631b")

	goTypes := readTextFile(t, filepath.Join(root, "internal", "models", "dto", "generated", "types.gen.go"))
	if !strings.Contains(goTypes, "Code generated by github.com/oapi-codegen/oapi-codegen") {
		t.Fatal("Go DTO 必须由 oapi-codegen 生成并带禁止手改文件头")
	}
	if strings.Contains(strings.ToLower(goTypes), "gorm:") {
		t.Fatal("OpenAPI HTTP DTO 不得包含 GORM tag")
	}
	for _, typeName := range requiredOpenAPISchemas {
		if !strings.Contains(goTypes, "type "+typeName+" struct") {
			t.Fatalf("Go 生成物缺少 %s", typeName)
		}
	}
	tsTypes := readTextFile(t, filepath.Join(root, "..", "web", "src", "api", "generated", "openapi.ts"))
	if !strings.Contains(tsTypes, "This file was auto-generated by openapi-typescript") {
		t.Fatal("TypeScript DTO 必须由 openapi-typescript 生成并带禁止手改文件头")
	}
	for _, typeName := range requiredOpenAPISchemas {
		if !strings.Contains(tsTypes, typeName+":") {
			t.Fatalf("TypeScript 生成物缺少 %s", typeName)
		}
	}
}

func validateOpenAPIDocument(document map[string]any) error {
	if stringValue(document, "openapi") != "3.0.3" {
		return fmt.Errorf("OpenAPI 版本必须为 3.0.3")
	}
	if err := validateRefsAndFieldNames(document, "$"); err != nil {
		return err
	}
	paths, ok := document["paths"].(map[string]any)
	if !ok {
		return fmt.Errorf("paths 必须是对象")
	}
	operationIDs := make(map[string]string)
	for path, rawPathItem := range paths {
		pathItem, ok := rawPathItem.(map[string]any)
		if !ok {
			return fmt.Errorf("path %s 必须是对象", path)
		}
		for key, rawOperation := range pathItem {
			normalized := strings.ToLower(key)
			if normalized == "parameters" || normalized == "summary" || normalized == "description" || normalized == "servers" || normalized == "$ref" {
				continue
			}
			if normalized != "get" && normalized != "post" {
				return fmt.Errorf("业务 operation 只允许 GET/POST：%s %s", key, path)
			}
			operation, ok := rawOperation.(map[string]any)
			if !ok {
				return fmt.Errorf("operation %s %s 必须是对象", key, path)
			}
			operationID := stringValue(operation, "operationId")
			if operationID == "" {
				return fmt.Errorf("operation %s %s 缺少 operationId", key, path)
			}
			if previous, duplicate := operationIDs[operationID]; duplicate {
				return fmt.Errorf("operationId 重复：%s 同时用于 %s 和 %s", operationID, previous, path)
			}
			operationIDs[operationID] = path
		}
	}
	return nil
}

func validateRefsAndFieldNames(value any, path string) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if key == "$ref" {
				ref, ok := child.(string)
				if !ok || !strings.HasPrefix(ref, "#/") {
					return fmt.Errorf("%s 只允许内部 $ref，实际=%v", path, child)
				}
			}
			normalized := normalizeContractName(key)
			if isUniversallyForbiddenContractName(normalized) || strings.Contains(normalized, "csrf") {
				return fmt.Errorf("%s 包含禁止字段 %q", path, key)
			}
			if key == "name" {
				if name, ok := child.(string); ok && strings.Contains(normalizeContractName(name), "csrf") {
					return fmt.Errorf("%s 包含禁止名称 %q", path, name)
				}
			}
			if err := validateRefsAndFieldNames(child, path+"."+key); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range typed {
			if err := validateRefsAndFieldNames(child, fmt.Sprintf("%s[%d]", path, index)); err != nil {
				return err
			}
		}
	}
	return nil
}

func contractFixture(overrides map[string]any) map[string]any {
	document := map[string]any{
		"openapi": "3.0.3",
		"info":    map[string]any{"title": "fixture", "version": "1.0.0"},
		"paths":   map[string]any{},
		"components": map[string]any{
			"schemas": map[string]any{},
		},
	}
	for key, value := range overrides {
		if key == "schemas" {
			components := document["components"].(map[string]any)
			components["schemas"] = value
			continue
		}
		document[key] = value
	}
	return document
}

func assertObjectSchema(t *testing.T, schemas map[string]any, name string, properties []string, required []string) {
	t.Helper()
	schema := mapValue(t, schemas, name)
	if stringValue(schema, "type") != "object" {
		t.Fatalf("%s 必须是 object schema", name)
	}
	assertAdditionalPropertiesDisabled(t, schemas, name)
	gotProperties := sortedKeys(mapValue(t, schema, "properties"))
	sort.Strings(properties)
	if !reflect.DeepEqual(gotProperties, properties) {
		t.Fatalf("%s 字段集合漂移：实际=%v 期望=%v", name, gotProperties, properties)
	}
	var gotRequired []string
	if _, exists := schema["required"]; exists {
		gotRequired = stringSliceValue(t, schema, "required")
	}
	sort.Strings(required)
	if !reflect.DeepEqual(gotRequired, required) {
		t.Fatalf("%s 必填字段漂移：实际=%v 期望=%v", name, gotRequired, required)
	}
}

func normalizeContractName(value string) string {
	replacer := strings.NewReplacer("-", "", "_", "", " ", "")
	return strings.ToLower(replacer.Replace(value))
}

func isUniversallyForbiddenContractName(normalized string) bool {
	for _, forbidden := range []string{
		"absolutepath", "base64", "rawprompt", "rawrequest", "rawresponse", "systemprompt",
	} {
		if strings.Contains(normalized, forbidden) {
			return true
		}
	}
	return false
}

func assertFileSHA256(t *testing.T, path string, want string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取合同快照 %s 失败：%v", path, err)
	}
	if got := fmt.Sprintf("%x", sha256.Sum256(content)); got != want {
		t.Fatalf("合同或生成物 %s 被手改或未重新生成：实际=%s 期望=%s", path, got, want)
	}
}

func assertAdditionalPropertiesDisabled(t *testing.T, schemas map[string]any, name string) {
	t.Helper()
	schema := mapValue(t, schemas, name)
	if additional, ok := schema["additionalProperties"].(bool); !ok || additional {
		t.Fatalf("%s 必须显式拒绝未登记字段", name)
	}
}

func assertPropertyType(t *testing.T, schemas map[string]any, schemaName string, propertyName string, wantType string, wantFormat string) {
	t.Helper()
	schema := mapValue(t, schemas, schemaName)
	properties := mapValue(t, schema, "properties")
	property := mapValue(t, properties, propertyName)
	if got := stringValue(property, "type"); got != wantType {
		t.Fatalf("%s.%s 类型漂移：实际=%q 期望=%q", schemaName, propertyName, got, wantType)
	}
	if got := stringValue(property, "format"); got != wantFormat {
		t.Fatalf("%s.%s format 漂移：实际=%q 期望=%q", schemaName, propertyName, got, wantFormat)
	}
}

func serverRoot(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("无法定位 OpenAPI 合同测试")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", ".."))
}

func readYAMLDocument(t *testing.T, path string) map[string]any {
	t.Helper()
	content := []byte(readTextFile(t, path))
	var document map[string]any
	if err := yaml.Unmarshal(content, &document); err != nil {
		t.Fatalf("解析 YAML %s 失败：%v", path, err)
	}
	return document
}

func readJSONDocument(t *testing.T, path string) map[string]any {
	t.Helper()
	content := []byte(readTextFile(t, path))
	var document map[string]any
	if err := json.Unmarshal(content, &document); err != nil {
		t.Fatalf("解析 JSON %s 失败：%v", path, err)
	}
	return document
}

func readTextFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取合同文件 %s 失败：%v", path, err)
	}
	return string(content)
}

func mapValue(t *testing.T, object map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := object[key].(map[string]any)
	if !ok {
		t.Fatalf("字段 %s 必须是对象，实际=%T", key, object[key])
	}
	return value
}

func stringValue(object map[string]any, key string) string {
	value, _ := object[key].(string)
	return value
}

func stringSliceValue(t *testing.T, object map[string]any, key string) []string {
	t.Helper()
	raw, ok := object[key].([]any)
	if !ok {
		t.Fatalf("字段 %s 必须是数组，实际=%T", key, object[key])
	}
	values := make([]string, 0, len(raw))
	for _, item := range raw {
		value, ok := item.(string)
		if !ok {
			t.Fatalf("字段 %s 必须是字符串数组，实际元素=%T", key, item)
		}
		values = append(values, value)
	}
	sort.Strings(values)
	return values
}

func sortedKeys(object map[string]any) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
