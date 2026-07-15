package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	appLogger "github.com/lifei6671/commerce-shoot-studio/server/lib/logger"
)

func TestMain(main *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(main.Run())
}

func newTestLogger(t *testing.T, writer io.Writer) *slog.Logger {
	t.Helper()
	log, err := appLogger.New(appLogger.Options{
		Writer:   writer,
		Service:  "httpapi-test",
		Version:  "v1",
		MinLevel: slog.LevelInfo,
	})
	if err != nil {
		t.Fatalf("构造测试 logger 失败：%v", err)
	}
	return log
}

func decodeErrorResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	decoder := json.NewDecoder(recorder.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&body); err != nil {
		t.Fatalf("解析错误响应失败：%v，body=%q", err, recorder.Body.String())
	}
	return body
}

type lockedBuffer struct {
	mutex sync.Mutex
	bytes.Buffer
}

func (buffer *lockedBuffer) Write(content []byte) (int, error) {
	buffer.mutex.Lock()
	defer buffer.mutex.Unlock()
	return buffer.Buffer.Write(content)
}

func (buffer *lockedBuffer) BytesCopy() []byte {
	buffer.mutex.Lock()
	defer buffer.mutex.Unlock()
	return append([]byte(nil), buffer.Buffer.Bytes()...)
}
