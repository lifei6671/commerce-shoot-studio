package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	ginJSON "github.com/gin-gonic/gin/codec/json"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	appLogger "github.com/lifei6671/commerce-shoot-studio/server/lib/logger"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

// BindJSON 完整绑定 JSON；调用方必须在成功返回后才能执行任何业务副作用。
func BindJSON(ginContext *gin.Context, target any) error {
	decoder := ginJSON.API.NewDecoder(ginContext.Request.Body)
	if binding.EnableDecoderUseNumber {
		decoder.UseNumber()
	}
	if binding.EnableDecoderDisallowUnknownFields {
		decoder.DisallowUnknownFields()
	}
	if err := decoder.Decode(target); err != nil {
		return normalizeJSONBindingError(err)
	}
	var trailing struct{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			err = errors.New("JSON 请求体只能包含一个值")
		}
		return normalizeJSONBindingError(err)
	}
	if binding.Validator != nil {
		if err := binding.Validator.ValidateStruct(target); err != nil {
			return apperror.ErrInvalidRequest.Wrap(err)
		}
	}
	return nil
}

func normalizeJSONBindingError(err error) error {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		return apperror.ErrRequestBodyTooLarge.Wrap(err)
	}
	return apperror.ErrInvalidRequest.Wrap(err)
}

func validateBodyLimitOverrides(overrides map[RouteKey]int64) error {
	for key, limit := range overrides {
		if key.Method != http.MethodGet && key.Method != http.MethodPost {
			return fmt.Errorf("body limit override method 只允许 GET 或 POST")
		}
		if identifyAPISurface(key.Template) == surfaceNone {
			return fmt.Errorf("body limit override template 不在 API 前缀下")
		}
		if limit <= 0 {
			return fmt.Errorf("body limit override 必须为正数")
		}
	}
	return nil
}

func validateRegisteredRoutes(engine *gin.Engine, overrides map[RouteKey]int64) error {
	registered := make(map[RouteKey]struct{})
	for _, route := range engine.Routes() {
		if route.Method != http.MethodGet && route.Method != http.MethodPost {
			return fmt.Errorf("生产业务路由只允许 GET 或 POST")
		}
		if identifyAPISurface(route.Path) == surfaceNone {
			return fmt.Errorf("业务路由不在 API 前缀下")
		}
		if _, err := appLogger.NewContext(context.Background(), appLogger.ContextFields{
			Direction:     appLogger.DirectionInbound,
			Method:        route.Method,
			RouteTemplate: route.Path,
		}); err != nil {
			return fmt.Errorf("业务路由模板不符合日志合同")
		}
		registered[RouteKey{Method: route.Method, Template: route.Path}] = struct{}{}
	}
	for key := range overrides {
		if _, exists := registered[key]; !exists {
			return fmt.Errorf("body limit override 未指向已注册路由")
		}
	}
	return nil
}

func (runtime *runtime) bodyLimitMiddleware() gin.HandlerFunc {
	return func(context *gin.Context) {
		if identifyAPISurface(context.Request.URL.Path) == surfaceNone {
			context.Next()
			return
		}
		limit := runtime.defaultBodyBytes
		key := RouteKey{Method: context.Request.Method, Template: context.FullPath()}
		if override, exists := runtime.bodyLimitOverrides[key]; exists {
			limit = override
		}
		if context.Request.ContentLength > limit {
			response.WriteError(context, apperror.ErrRequestBodyTooLarge)
			context.Abort()
			return
		}
		context.Request.Body = http.MaxBytesReader(context.Writer, context.Request.Body, limit)
		context.Next()
	}
}
