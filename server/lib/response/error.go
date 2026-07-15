// Package response 提供 Gin HTTP 边界唯一的统一错误响应写出入口。
package response

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/internal/models/dto/generated"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
)

const errorCodeContextKey = "commerce_shoot_studio_error_code"

// WriteError 把内部错误归一化为安全的公共错误合同，并保存整数错误码供完成日志读取。
func WriteError(context *gin.Context, requestID string, err error) apperror.Code {
	publicError := normalizeError(err)
	code := publicError.Code()
	context.Set(errorCodeContextKey, code)
	if context.Writer.Written() {
		return code
	}

	// net/http 在线路上会抑制 HEAD body；这里也不向测试 writer 写入伪 JSON。
	if context.Request != nil && context.Request.Method == http.MethodHead {
		context.Status(publicError.HTTPStatus())
		context.Writer.WriteHeaderNow()
		return code
	}

	context.JSON(publicError.HTTPStatus(), generated.ErrorResponse{
		Code:      int(code),
		Message:   publicError.SafeMessage(),
		RequestId: requestID,
	})
	return code
}

// ErrorCode 返回当前 Gin 请求已经写出的安全整数错误码；缺失或类型非法时返回零。
func ErrorCode(context *gin.Context) apperror.Code {
	if context == nil {
		return 0
	}
	value, exists := context.Get(errorCodeContextKey)
	if !exists {
		return 0
	}
	code, ok := value.(apperror.Code)
	if !ok || code <= 0 {
		return 0
	}
	return code
}

func normalizeError(err error) *apperror.Error {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		return apperror.ErrRequestBodyTooLarge
	}

	var applicationError *apperror.Error
	if errors.As(err, &applicationError) && applicationError != nil {
		return applicationError
	}
	return apperror.ErrInternal
}
