package apperror

// Code 是稳定的应用错误码，跨 HTTP、日志与异步任务结果复用。
type Code int

// Error 描述可安全暴露给调用方的应用错误。
// 底层 cause 仅参与标准错误链判断，不进入公开错误文本。
type Error struct {
	code        Code
	httpStatus  int
	safeMessage string
	cause       error
}

func define(code Code, httpStatus int, safeMessage string) *Error {
	return &Error{
		code:        code,
		httpStatus:  httpStatus,
		safeMessage: safeMessage,
	}
}

// Error 返回可安全展示的错误消息。
func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.safeMessage
}

// Unwrap 返回底层错误，支持 errors.Is 与 errors.As。
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

// Is 按稳定错误码判断两个应用错误是否属于同一错误定义。
func (e *Error) Is(target error) bool {
	if e == nil {
		return false
	}
	targetError, ok := target.(*Error)
	return ok && targetError != nil && e.code == targetError.code
}

// Code 返回稳定应用错误码。
func (e *Error) Code() Code {
	if e == nil {
		return 0
	}
	return e.code
}

// HTTPStatus 返回对应该应用错误的 HTTP 状态码。
func (e *Error) HTTPStatus() int {
	if e == nil {
		return 0
	}
	return e.httpStatus
}

// SafeMessage 返回可安全暴露给调用方的错误消息。
func (e *Error) SafeMessage() string {
	if e == nil {
		return ""
	}
	return e.safeMessage
}

// Wrap 为错误定义附加底层 cause，同时保持稳定错误码与安全消息不变。
func (e *Error) Wrap(cause error) *Error {
	if e == nil || cause == nil {
		return e
	}
	return &Error{
		code:        e.code,
		httpStatus:  e.httpStatus,
		safeMessage: e.safeMessage,
		cause:       cause,
	}
}
