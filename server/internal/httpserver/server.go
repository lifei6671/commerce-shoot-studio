// Package httpserver 提供只构造、不启动监听的 HTTP Server 边界。
package httpserver

import (
	"fmt"
	"log"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Options 定义 HTTP Server 的构造参数。
type Options struct {
	Address           string
	Handler           http.Handler
	Logger            *slog.Logger
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	MaxHeaderBytes    int
}

// New 校验参数并构造 HTTP Server，但不启动监听或生命周期协程。
func New(options Options) (*http.Server, error) {
	if options.Address == "" {
		return nil, fmt.Errorf("address 不能为空")
	}
	if strings.TrimSpace(options.Address) != options.Address {
		return nil, fmt.Errorf("address 格式非法")
	}
	_, portText, err := net.SplitHostPort(options.Address)
	if err != nil || portText == "" {
		return nil, fmt.Errorf("address 格式非法")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 || port > 65535 {
		return nil, fmt.Errorf("address 格式非法")
	}
	if options.Handler == nil {
		return nil, fmt.Errorf("handler 不能为空")
	}
	if options.Logger == nil {
		return nil, fmt.Errorf("logger 不能为空")
	}
	if options.ReadHeaderTimeout <= 0 {
		return nil, fmt.Errorf("read header timeout 必须为正数")
	}
	if options.ReadTimeout <= 0 {
		return nil, fmt.Errorf("read timeout 必须为正数")
	}
	if options.WriteTimeout <= 0 {
		return nil, fmt.Errorf("write timeout 必须为正数")
	}
	if options.IdleTimeout <= 0 {
		return nil, fmt.Errorf("idle timeout 必须为正数")
	}
	if options.MaxHeaderBytes <= 0 {
		return nil, fmt.Errorf("max header bytes 必须为正数")
	}

	return &http.Server{
		Addr:                         options.Address,
		Handler:                      options.Handler,
		ReadHeaderTimeout:            options.ReadHeaderTimeout,
		ReadTimeout:                  options.ReadTimeout,
		WriteTimeout:                 options.WriteTimeout,
		IdleTimeout:                  options.IdleTimeout,
		MaxHeaderBytes:               options.MaxHeaderBytes,
		ErrorLog:                     log.New(safeErrorLogWriter{logger: options.Logger}, "", 0),
		DisableGeneralOptionsHandler: true,
	}, nil
}

type safeErrorLogWriter struct {
	logger *slog.Logger
}

func (writer safeErrorLogWriter) Write(content []byte) (int, error) {
	writer.logger.Error("HTTP 服务器内部错误")
	return len(content), nil
}
