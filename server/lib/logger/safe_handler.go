package logger

import (
	"context"
	"log/slog"
	"sync/atomic"
)

const (
	statusCodeKey = "status_code"
	errorCodeKey  = "error_code"
	elapsedMSKey  = "elapsed_ms"
)

type safeHandler struct {
	next      slog.Handler
	grouped   bool
	suspended *atomic.Bool
}

func newSafeHandler(next slog.Handler, suspended *atomic.Bool) slog.Handler {
	return &safeHandler{next: next, suspended: suspended}
}

func (handler *safeHandler) Enabled(ctx context.Context, level slog.Level) bool {
	if handler.suspended.Load() {
		return false
	}
	return handler.next.Enabled(ctx, level)
}

func (handler *safeHandler) Handle(ctx context.Context, record slog.Record) error {
	// logit 在 writer 锁内执行错误 hook；hook 期间抑制同 logger 的递归写入，避免自锁。
	if handler.suspended.Load() {
		return nil
	}
	safeRecord := slog.NewRecord(record.Time, record.Level, record.Message, record.PC)
	if !handler.grouped {
		record.Attrs(func(attr slog.Attr) bool {
			if safeAttr, ok := allowSafeAttr(attr); ok {
				safeRecord.AddAttrs(safeAttr)
			}
			return true
		})
	}
	return handler.next.Handle(ctx, safeRecord)
}

func (handler *safeHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	child := *handler
	if handler.grouped {
		return &child
	}
	safeAttrs := make([]slog.Attr, 0, len(attrs))
	for _, attr := range attrs {
		if safeAttr, ok := allowSafeAttr(attr); ok {
			safeAttrs = append(safeAttrs, safeAttr)
		}
	}
	if len(safeAttrs) > 0 {
		child.next = handler.next.WithAttrs(safeAttrs)
	}
	return &child
}

func (handler *safeHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return handler
	}
	child := *handler
	child.grouped = true
	return &child
}

func allowSafeAttr(attr slog.Attr) (slog.Attr, bool) {
	// 禁止 Resolve：LogValuer、error、字节和任意对象必须在边界直接丢弃。
	if attr.Value.Kind() != slog.KindInt64 {
		return slog.Attr{}, false
	}
	value := attr.Value.Int64()
	switch attr.Key {
	case statusCodeKey:
		return attr, value >= 100 && value <= 599
	case errorCodeKey:
		return attr, value > 0
	case elapsedMSKey:
		return attr, value >= 0
	default:
		return slog.Attr{}, false
	}
}
