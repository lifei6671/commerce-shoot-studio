package constant

// AsyncJobStatus 是异步作业持久化状态类型。
type AsyncJobStatus uint8

// 首批冻结的异步作业状态值。
const (
	AsyncJobStatusQueued  AsyncJobStatus = 0
	AsyncJobStatusRunning AsyncJobStatus = 1
)
