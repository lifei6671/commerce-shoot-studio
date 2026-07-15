package apperror

import "net/http"

// 首批稳定应用错误码。
const (
	CodeInvalidRequest                    Code = 100400
	CodeMethodNotAllowed                  Code = 100405
	CodeRequestBodyTooLarge               Code = 100413
	CodeInternalError                     Code = 100500
	CodeGenerationTaskNotFound            Code = 140404
	CodeGenerationProviderResultUncertain Code = 140504
	CodeAIRewriteInProgress               Code = 150409
)

// 首批带 HTTP 映射的应用错误定义。
// CodeGenerationProviderResultUncertain 仅用于异步任务结果，本阶段不映射 HTTP 错误。
var (
	ErrInvalidRequest         = define(CodeInvalidRequest, http.StatusBadRequest, "请求参数无效")
	ErrMethodNotAllowed       = define(CodeMethodNotAllowed, http.StatusMethodNotAllowed, "请求方法不允许")
	ErrRequestBodyTooLarge    = define(CodeRequestBodyTooLarge, http.StatusRequestEntityTooLarge, "请求体过大")
	ErrInternal               = define(CodeInternalError, http.StatusInternalServerError, "服务暂时不可用")
	ErrGenerationTaskNotFound = define(CodeGenerationTaskNotFound, http.StatusNotFound, "生成任务不存在")
	ErrAIRewriteInProgress    = define(CodeAIRewriteInProgress, http.StatusConflict, "AI 改写正在处理中")
)
