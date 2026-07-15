package apperror_test

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
)

func TestErrorWrapPreservesIdentityAndHidesCause(t *testing.T) {
	cause := errors.New("mysql://credential-secret-marker internal SQL prompt")
	wrapped := apperror.ErrInternal.Wrap(cause)

	if !errors.Is(wrapped, apperror.ErrInternal) {
		t.Fatal("包装后的错误应保留稳定业务错误身份")
	}
	if !errors.Is(wrapped, cause) {
		t.Fatal("包装后的错误应保留底层 cause 链")
	}
	if errors.Is(wrapped, apperror.ErrInvalidRequest) {
		t.Fatal("不同业务错误码不得被识别为同一错误")
	}
	var appError *apperror.Error
	outer := fmt.Errorf("service: %w", wrapped)
	if !errors.As(outer, &appError) {
		t.Fatal("标准 errors.As 应能取得业务错误")
	}
	if errors.Is(outer, apperror.ErrInvalidRequest) {
		t.Fatal("外层包装不得改变业务错误身份")
	}
	if appError.Code() != apperror.CodeInternalError || appError.HTTPStatus() != 500 {
		t.Fatalf("包装后错误合同漂移：code=%d status=%d", appError.Code(), appError.HTTPStatus())
	}
	for _, exposed := range []string{wrapped.Error(), wrapped.SafeMessage(), fmt.Sprintf("%v", wrapped)} {
		if strings.Contains(exposed, "credential-secret-marker") || strings.Contains(exposed, "SQL") || strings.Contains(exposed, "prompt") {
			t.Fatalf("公开错误文本泄漏底层 cause：%q", exposed)
		}
	}
}

func TestWrapNilCauseReturnsOriginalDefinition(t *testing.T) {
	if got := apperror.ErrInvalidRequest.Wrap(nil); got != apperror.ErrInvalidRequest {
		t.Fatal("没有 cause 时应复用不可变错误定义")
	}
}
