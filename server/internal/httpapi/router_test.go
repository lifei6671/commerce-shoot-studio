package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestNewCreatesAPIBoundariesWithoutProductionRoutes(t *testing.T) {
	registered := false
	router, err := New(Options{
		Logger:           newTestLogger(t, io.Discard),
		DefaultBodyBytes: 1024,
		RegisterRoutes: func(user, admin *gin.RouterGroup) {
			registered = true
			user.GET("/probe", func(context *gin.Context) {
				context.Status(http.StatusNoContent)
			})
			admin.POST("/probe", func(context *gin.Context) {
				context.Status(http.StatusNoContent)
			})
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if !registered {
		t.Fatal("Router 未提供用户端与管理端注册边界")
	}

	for _, request := range []struct {
		method string
		path   string
		status int
	}{
		{method: http.MethodGet, path: "/api/v1/probe", status: http.StatusNoContent},
		{method: http.MethodPost, path: "/api/admin/v1/probe", status: http.StatusNoContent},
		{method: http.MethodGet, path: "/api/v1/missing", status: http.StatusNotFound},
		{method: http.MethodPost, path: "/api/admin/v1/missing", status: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/v11/missing", status: http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(request.method, request.path, nil))
		if recorder.Code != request.status {
			t.Fatalf("%s %s status=%d，期望=%d", request.method, request.path, recorder.Code, request.status)
		}
		if request.status == http.StatusNotFound {
			body := decodeErrorResponse(t, recorder)
			if body["code"].(json.Number).String() != "100404" || body["message"] != "请求路径不存在" {
				t.Fatalf("NoRoute 错误合同不正确：%v", body)
			}
		}
	}
}

func TestRouterDoesNotRedirectTrailingSlash(t *testing.T) {
	router, err := New(Options{
		Logger:           newTestLogger(t, io.Discard),
		DefaultBodyBytes: 1024,
		RegisterRoutes: func(user, _ *gin.RouterGroup) {
			user.GET("/probe", func(context *gin.Context) {
				context.Status(http.StatusNoContent)
			})
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/probe/", nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("尾斜杠未匹配路由不得自动重定向：status=%d location=%q", recorder.Code, recorder.Header().Get("Location"))
	}
	body := decodeErrorResponse(t, recorder)
	if body["code"].(json.Number).String() != "100404" {
		t.Fatalf("尾斜杠未匹配错误合同=%v", body)
	}
}

func TestNewRejectsMissingRequiredOptions(t *testing.T) {
	if _, err := New(Options{DefaultBodyBytes: 1024}); err == nil {
		t.Fatal("nil logger 必须快速失败")
	}
	if _, err := New(Options{Logger: newTestLogger(t, io.Discard)}); err == nil {
		t.Fatal("非正默认 body limit 必须快速失败")
	}
}
