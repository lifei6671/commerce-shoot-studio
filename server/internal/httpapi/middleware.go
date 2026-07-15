package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	appLogger "github.com/lifei6671/commerce-shoot-studio/server/lib/logger"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

type completionErrorCodeKey struct{}

func (runtime *runtime) completionMiddleware() gin.HandlerFunc {
	return func(context *gin.Context) {
		setAPIResponseHeaderBaseline(context)
		context.Request.Header.Del("X-Request-ID")
		requestID := runtime.requestIDs.Next()
		if err := response.BindRequestID(context, requestID); err != nil {
			runtime.logger.ErrorContext(context.Request.Context(), "HTTP Request ID 绑定失败")
			response.WriteError(context, apperror.ErrInternal)
			context.Abort()
			return
		}
		context.Header("X-Request-ID", requestID)
		fields := appLogger.ContextFields{
			Direction:     appLogger.DirectionInbound,
			Method:        normalizedMethod(context.Request.Method),
			RouteTemplate: completionRouteTemplate(context),
			RequestID:     requestID,
		}
		logContext, err := appLogger.NewContext(context.Request.Context(), fields)
		if err != nil {
			runtime.logger.ErrorContext(context.Request.Context(), "HTTP 日志上下文初始化失败")
			if !context.Writer.Written() {
				response.WriteError(context, apperror.ErrInternal)
			}
			context.Abort()
			return
		}

		context.Request = context.Request.WithContext(logContext)
		startedAt := time.Now()
		if !context.IsAborted() {
			context.Next()
		}
		statusCode := context.Writer.Status()
		if statusCode < 100 || statusCode > 599 {
			statusCode = http.StatusInternalServerError
		}
		if err := appLogger.LogRequestComplete(logContext, runtime.logger, appLogger.RequestResult{
			StatusCode: statusCode,
			ErrorCode:  int(completionErrorCode(context)),
			ElapsedMS:  time.Since(startedAt).Milliseconds(),
		}); err != nil {
			runtime.logger.ErrorContext(logContext, "HTTP 完成日志合同失败")
		}
	}
}

func (runtime *runtime) recoveryMiddleware() gin.HandlerFunc {
	return func(context *gin.Context) {
		defer func() {
			if recover() == nil {
				return
			}
			if context.Writer.Written() {
				context.Set(completionErrorCodeKey{}, apperror.CodeInternalError)
			} else {
				response.WriteError(context, apperror.ErrInternal)
			}
			context.Abort()
		}()
		context.Next()
	}
}

func normalizedMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete,
		http.MethodHead, http.MethodOptions, http.MethodConnect, http.MethodTrace:
		return method
	default:
		return "OTHER"
	}
}

func completionRouteTemplate(context *gin.Context) string {
	if template := context.FullPath(); template != "" {
		return template
	}
	switch identifyAPISurface(context.Request.URL.Path) {
	case surfaceUser:
		return "/api/v1/{unmatched}"
	case surfaceAdmin:
		return "/api/admin/v1/{unmatched}"
	default:
		return "/{unmatched}"
	}
}

func completionErrorCode(context *gin.Context) apperror.Code {
	if value, exists := context.Get(completionErrorCodeKey{}); exists {
		if code, ok := value.(apperror.Code); ok && code > 0 {
			return code
		}
	}
	return response.ErrorCode(context)
}

func (runtime *runtime) methodGuard() gin.HandlerFunc {
	return func(context *gin.Context) {
		isOptionsStar := context.Request.Method == http.MethodOptions && context.Request.RequestURI == "*"
		if identifyAPISurface(context.Request.URL.Path) == surfaceNone && !isOptionsStar {
			context.Next()
			return
		}
		switch context.Request.Method {
		case http.MethodGet, http.MethodPost:
			context.Next()
			return
		default:
			context.Header("Allow", allowMethods)
			response.WriteError(context, apperror.ErrMethodNotAllowed)
			context.Abort()
		}
	}
}
