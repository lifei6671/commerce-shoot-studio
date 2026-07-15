// Package logger 提供服务端唯一的结构化日志构造入口。
package logger

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync/atomic"

	"github.com/lifei6671/logit"
)

const maxSafeTokenBytes = 128

// Options 定义服务日志器的稳定构造参数。
type Options struct {
	Writer       io.Writer
	Service      string
	Version      string
	MinLevel     slog.Level
	OnWriteError func()
}

// New 创建输出 JSON Lines 的安全 slog.Logger。
func New(options Options) (*slog.Logger, error) {
	if !validSafeToken(options.Service) {
		return nil, fmt.Errorf("service 必须是非空安全标识")
	}
	if !validSafeToken(options.Version) {
		return nil, fmt.Errorf("version 必须是非空安全标识")
	}

	writer := options.Writer
	if writer == nil {
		writer = os.Stdout
	}
	onWriteError := options.OnWriteError
	if onWriteError == nil {
		onWriteError = func() {
			_, _ = io.WriteString(os.Stderr, "日志输出失败\n")
		}
	}
	var writeErrorHookRunning atomic.Bool

	encoder := logit.NewJSONEncoder()
	encoder.TimeKey = "timestamp"
	encoder.MessageKey = "message"
	base := logit.NewSimpleLogger(
		writer,
		logit.WithEncoder(encoder),
		logit.WithErrorHandler(func(error) {
			if !writeErrorHookRunning.CompareAndSwap(false, true) {
				return
			}
			defer writeErrorHookRunning.Store(false)
			defer func() {
				_ = recover()
			}()
			onWriteError()
		}),
	)
	rawHandler := logit.NewSlogHandler(
		base,
		logit.WithSlogMinLevel(options.MinLevel),
		logit.WithSlogSource(false),
	).WithAttrs([]slog.Attr{
		slog.String("service", options.Service),
		slog.String("version", options.Version),
	})

	return slog.New(newSafeHandler(rawHandler, &writeErrorHookRunning)), nil
}

func validSafeToken(value string) bool {
	if value == "" || len(value) > maxSafeTokenBytes {
		return false
	}
	for _, char := range []byte(value) {
		if char >= 'a' && char <= 'z' ||
			char >= 'A' && char <= 'Z' ||
			char >= '0' && char <= '9' ||
			char == '.' || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}
