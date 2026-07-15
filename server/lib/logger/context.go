package logger

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/lifei6671/logit"
)

const maxRouteTemplateBytes = 256

// Direction 标识一次请求是入站还是出站。
type Direction string

const (
	DirectionInbound  Direction = "inbound"
	DirectionOutbound Direction = "outbound"
)

// ContextFields 是允许写入日志上下文的结构化字段集合。
type ContextFields struct {
	Direction     Direction
	Method        string
	RouteTemplate string
	Operation     string
	PeerService   string
	RequestID     string
	TraceID       string
	UserID        string
	TaskID        string
	InvocationID  string
}

// RequestResult 描述一次入站或出站请求的完成结果。
type RequestResult struct {
	StatusCode int
	ErrorCode  int
	ElapsedMS  int64
}

// NewContext 创建独立的日志字段上下文。
func NewContext(parent context.Context, fields ContextFields) (context.Context, error) {
	if err := validateContextFields(fields); err != nil {
		return nil, err
	}
	ctx := logit.NewContext(parent)
	addContextFields(ctx, fields)
	return ctx, nil
}

// ForkContext 克隆父上下文，并允许为子调用添加出站字段。
func ForkContext(parent context.Context, fields ContextFields) (context.Context, error) {
	if !logit.ContextInitialized(parent) {
		return nil, fmt.Errorf("父日志上下文未初始化")
	}

	var err error
	fields.RequestID, err = inheritedIdentity(parent, "request_id", fields.RequestID)
	if err != nil {
		return nil, err
	}
	fields.TraceID, err = inheritedIdentity(parent, "trace_id", fields.TraceID)
	if err != nil {
		return nil, err
	}
	fields.UserID, err = inheritedIdentity(parent, "user_id", fields.UserID)
	if err != nil {
		return nil, err
	}
	fields.TaskID, err = inheritedIdentity(parent, "task_id", fields.TaskID)
	if err != nil {
		return nil, err
	}
	if err := validateContextFields(fields); err != nil {
		return nil, err
	}

	ctx := logit.ForkContext(parent)
	// 分叉只继承稳定身份字段，调用方向和 invocation 属于子调用自身。
	for _, key := range []string{"route_template", "operation", "peer_service", "invocation_id"} {
		logit.RemoveField(ctx, key)
	}
	addContextFields(ctx, fields)
	return ctx, nil
}

// LogRequestComplete 按完成结果选择日志级别并写入固定消息。
func LogRequestComplete(ctx context.Context, log *slog.Logger, result RequestResult) error {
	if log == nil {
		return fmt.Errorf("logger 不能为空")
	}
	directionField, ok := logit.FindField(ctx, "direction")
	if !ok || directionField.Kind() != logit.StringKind {
		return fmt.Errorf("日志上下文缺少 direction")
	}
	direction := Direction(directionField.Value().(string))
	if direction != DirectionInbound && direction != DirectionOutbound {
		return fmt.Errorf("日志上下文 direction 非法")
	}
	if result.ElapsedMS < 0 {
		return fmt.Errorf("elapsed_ms 不能为负数")
	}
	if result.ErrorCode < 0 {
		return fmt.Errorf("error_code 不能为负数")
	}
	if result.StatusCode == 0 {
		if direction != DirectionOutbound || result.ErrorCode == 0 {
			return fmt.Errorf("status_code=0 仅用于带错误码的出站传输失败")
		}
	} else if result.StatusCode < 100 || result.StatusCode > 599 {
		return fmt.Errorf("status_code 超出 HTTP 状态码范围")
	}

	level := slog.LevelInfo
	switch {
	case result.StatusCode == 0, result.StatusCode >= 500:
		level = slog.LevelError
	case result.StatusCode >= 400:
		level = slog.LevelWarn
	}
	attrs := make([]slog.Attr, 0, 3)
	if result.StatusCode != 0 {
		attrs = append(attrs, slog.Int(statusCodeKey, result.StatusCode))
	}
	if result.ErrorCode != 0 {
		attrs = append(attrs, slog.Int(errorCodeKey, result.ErrorCode))
	}
	attrs = append(attrs, slog.Int64(elapsedMSKey, result.ElapsedMS))
	log.LogAttrs(ctx, level, "HTTP 请求完成", attrs...)
	return nil
}

func validateContextFields(fields ContextFields) error {
	if fields.Direction != DirectionInbound && fields.Direction != DirectionOutbound {
		return fmt.Errorf("direction 必须是 inbound 或 outbound")
	}
	if !validHTTPMethod(fields.Method) {
		return fmt.Errorf("method 不在允许列表中")
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{name: "operation", value: fields.Operation},
		{name: "peer_service", value: fields.PeerService},
		{name: "request_id", value: fields.RequestID},
		{name: "trace_id", value: fields.TraceID},
		{name: "user_id", value: fields.UserID},
		{name: "task_id", value: fields.TaskID},
		{name: "invocation_id", value: fields.InvocationID},
	} {
		if field.value != "" && !validSafeToken(field.value) {
			return fmt.Errorf("%s 不是安全标识", field.name)
		}
	}

	switch fields.Direction {
	case DirectionInbound:
		if !validRouteTemplate(fields.RouteTemplate) {
			return fmt.Errorf("route_template 非法")
		}
		if fields.Operation != "" || fields.PeerService != "" {
			return fmt.Errorf("入站上下文不能设置出站字段")
		}
	case DirectionOutbound:
		if fields.Operation == "" || fields.PeerService == "" {
			return fmt.Errorf("出站上下文必须设置 operation 和 peer_service")
		}
		if fields.RouteTemplate != "" {
			return fmt.Errorf("出站上下文不能设置 route_template")
		}
	}
	return nil
}

func validHTTPMethod(method string) bool {
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE":
		return true
	default:
		return false
	}
}

func validRouteTemplate(route string) bool {
	if route == "" || len(route) > maxRouteTemplateBytes || route[0] != '/' ||
		strings.HasPrefix(route, "//") || strings.Contains(route, "://") || strings.Contains(route, "..") {
		return false
	}
	for _, char := range []byte(route) {
		if char >= 'a' && char <= 'z' ||
			char >= 'A' && char <= 'Z' ||
			char >= '0' && char <= '9' ||
			char == '/' || char == '.' || char == '_' || char == '-' ||
			char == ':' || char == '{' || char == '}' {
			continue
		}
		return false
	}
	return true
}

func inheritedIdentity(parent context.Context, key, requested string) (string, error) {
	field, ok := logit.FindMetaField(parent, key)
	if !ok {
		return requested, nil
	}
	if field.Kind() != logit.StringKind {
		return "", fmt.Errorf("父日志上下文身份字段非法")
	}
	inherited := field.Value().(string)
	if requested != "" && requested != inherited {
		return "", fmt.Errorf("ForkContext 不得替换父上下文身份字段")
	}
	return inherited, nil
}

func addContextFields(ctx context.Context, fields ContextFields) {
	common := []logit.Field{
		logit.String("direction", string(fields.Direction)),
		logit.String("method", fields.Method),
	}
	if fields.RouteTemplate != "" {
		common = append(common, logit.String("route_template", fields.RouteTemplate))
	}
	if fields.Operation != "" {
		common = append(common, logit.String("operation", fields.Operation))
	}
	if fields.PeerService != "" {
		common = append(common, logit.String("peer_service", fields.PeerService))
	}
	logit.AddFields(ctx, common...)

	meta := make([]logit.Field, 0, 5)
	for _, field := range []struct {
		key   string
		value string
	}{
		{key: "request_id", value: fields.RequestID},
		{key: "trace_id", value: fields.TraceID},
		{key: "user_id", value: fields.UserID},
		{key: "task_id", value: fields.TaskID},
		{key: "invocation_id", value: fields.InvocationID},
	} {
		if field.value != "" {
			meta = append(meta, logit.String(field.key, field.value))
		}
	}
	logit.AddMetaFields(ctx, meta...)
}
