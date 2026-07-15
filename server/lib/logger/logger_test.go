package logger_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"reflect"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lifei6671/commerce-shoot-studio/server/internal/config"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/logger"
)

const (
	serviceName    = "commerce-shoot-studio"
	serviceVersion = "test-version"
)

func TestNewWritesSafeJSONAndFiltersBelowMinimumLevel(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	log := newTestLogger(t, &output, nil)

	log.Debug("DEBUG_MESSAGE_MARKER_MUST_NOT_APPEAR")
	log.Info(
		"HTTP 请求完成",
		slog.Int("status_code", 202),
		slog.Int("error_code", int(apperror.CodeInvalidRequest)),
		slog.Int64("elapsed_ms", 17),
		slog.String("unknown_key", "UNKNOWN_VALUE_MARKER_MUST_NOT_APPEAR"),
		slog.String("service", "OVERRIDDEN_SERVICE_MARKER_MUST_NOT_APPEAR"),
		slog.String("version", "OVERRIDDEN_VERSION_MARKER_MUST_NOT_APPEAR"),
	)

	raw := output.String()
	for _, forbidden := range []string{
		"DEBUG_MESSAGE_MARKER_MUST_NOT_APPEAR",
		"UNKNOWN_VALUE_MARKER_MUST_NOT_APPEAR",
		"OVERRIDDEN_SERVICE_MARKER_MUST_NOT_APPEAR",
		"OVERRIDDEN_VERSION_MARKER_MUST_NOT_APPEAR",
	} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("日志包含禁止 marker %q：%s", forbidden, raw)
		}
	}

	payload := decodeSingleJSONLine(t, output.Bytes())
	assertExactKeys(t, payload, []string{
		"elapsed_ms",
		"error_code",
		"level",
		"message",
		"service",
		"status_code",
		"timestamp",
		"version",
	})
	assertField(t, payload, "level", "info")
	assertField(t, payload, "message", "HTTP 请求完成")
	assertField(t, payload, "service", serviceName)
	assertField(t, payload, "version", serviceVersion)
	assertJSONNumber(t, payload, "status_code", "202")
	assertJSONNumber(t, payload, "error_code", "100400")
	assertJSONNumber(t, payload, "elapsed_ms", "17")

	timestamp, ok := payload["timestamp"].(string)
	if !ok {
		t.Fatalf("timestamp 类型=%T，期望 string", payload["timestamp"])
	}
	if _, err := time.Parse(time.RFC3339Nano, timestamp); err != nil {
		t.Fatalf("timestamp=%q 不是 RFC3339Nano：%v", timestamp, err)
	}
	if _, exists := payload["unknown_key"]; exists {
		t.Fatal("固定白名单之外的 unknown_key 不得进入日志")
	}
}

func TestSafeHandlerDropsConfigAndAdversarialValuesWithoutResolvingLogValuer(t *testing.T) {
	t.Parallel()

	markers := newLeakMarkers()
	startupConfig := config.Config{
		WorkDir: markers.absolutePath,
		MySQL: config.MySQLConfig{
			Host:      markers.mysqlHost,
			Username:  markers.mysqlUsername,
			Password:  markers.mysqlPassword,
			DSNParams: map[string]string{"unsafe": markers.dsnParameter},
		},
		Redis: &config.RedisConfig{
			Address:   markers.redisAddress,
			Password:  markers.redisPassword,
			KeyPrefix: markers.redisKeyPrefix,
		},
		Session: config.SessionConfig{
			Store: "cookie",
			User: config.SessionCookieConfig{
				CookieName:        markers.userCookie,
				AuthenticationKey: markers.userAuthenticationKey,
				EncryptionKey:     markers.userEncryptionKey,
			},
			Admin: config.SessionCookieConfig{
				CookieName:        markers.adminCookie,
				AuthenticationKey: markers.adminAuthenticationKey,
				EncryptionKey:     markers.adminEncryptionKey,
			},
		},
		Security: config.SecurityConfig{
			VerificationCode: config.VerificationCodeConfig{
				DerivationKey:   markers.derivationKey,
				VerificationKey: markers.verificationKey,
			},
		},
	}
	configJSON, err := json.Marshal(startupConfig)
	if err != nil {
		t.Fatalf("序列化 adversarial Config 失败：%v", err)
	}

	var logValuerCalls atomic.Int32
	valuer := countingLogValuer{
		calls:  &logValuerCalls,
		marker: markers.logValuer,
	}
	rawCause := errors.New(markers.rawCause)
	applicationError := apperror.ErrInternal.Wrap(rawCause)
	adversarial := map[string]any{
		"authorization":       markers.authorization,
		"cookie":              markers.cookieHeader,
		"raw_prompt":          markers.rawPrompt,
		"provider_response":   markers.providerResponse,
		"complete_url":        markers.completeURL,
		"absolute_path":       markers.absolutePath,
		"nested_binary_value": markers.binaryValue,
	}

	var output bytes.Buffer
	log := newTestLogger(t, &output, nil)
	log.Info(
		"安全边界测试",
		slog.Int64("elapsed_ms", 23), // 正断言：安全字段不能被全部丢弃。
		slog.Any("config_object", startupConfig),
		slog.String("config_json", string(configJSON)),
		slog.Any("adversarial_map", adversarial),
		slog.Any("raw_error", rawCause),
		slog.Any("application_error", applicationError),
		slog.Any("binary", markers.binaryValue),
		slog.Any("log_valuer", valuer),
		slog.Group(
			markers.groupName,
			slog.String("authorization", markers.groupValue),
			slog.Int("status_code", 599),
		),
	)

	if got := logValuerCalls.Load(); got != 0 {
		t.Fatalf("安全 Handler 调用了 LogValuer %d 次，期望 0", got)
	}
	raw := output.String()
	for _, forbidden := range markers.forbiddenStrings(string(configJSON)) {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("日志泄漏 marker %q：%s", forbidden, raw)
		}
	}

	payload := decodeSingleJSONLine(t, output.Bytes())
	assertExactKeys(t, payload, []string{
		"elapsed_ms",
		"level",
		"message",
		"service",
		"timestamp",
		"version",
	})
	assertField(t, payload, "message", "安全边界测试")
	assertJSONNumber(t, payload, "elapsed_ms", "23")
}

func TestSafeHandlerWithGroupPreservesOnlyAttrsBoundBeforeGroup(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		build      func(*slog.Logger) *slog.Logger
		wantStatus bool
	}{
		{
			name: "白名单字段先绑定",
			build: func(log *slog.Logger) *slog.Logger {
				return log.
					With(slog.Int("status_code", 204)).
					WithGroup("GROUP_NAME_MARKER_MUST_NOT_APPEAR").
					With(slog.Int("error_code", int(apperror.CodeInvalidRequest)))
			},
			wantStatus: true,
		},
		{
			name: "先进入 group",
			build: func(log *slog.Logger) *slog.Logger {
				return log.
					WithGroup("GROUP_NAME_MARKER_MUST_NOT_APPEAR").
					With(slog.Int("status_code", 204))
			},
			wantStatus: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			var output bytes.Buffer
			log := test.build(newTestLogger(t, &output, nil))
			log.Info(
				"分组顺序测试",
				slog.Int64("elapsed_ms", 91),
				slog.String("unknown", "GROUP_VALUE_MARKER_MUST_NOT_APPEAR"),
			)

			raw := output.String()
			for _, forbidden := range []string{
				"GROUP_NAME_MARKER_MUST_NOT_APPEAR",
				"GROUP_VALUE_MARKER_MUST_NOT_APPEAR",
			} {
				if strings.Contains(raw, forbidden) {
					t.Fatalf("group marker %q 不得进入日志：%s", forbidden, raw)
				}
			}
			payload := decodeSingleJSONLine(t, output.Bytes())
			_, hasStatus := payload["status_code"]
			if hasStatus != test.wantStatus {
				t.Fatalf("status_code 存在=%v，期望=%v；payload=%v", hasStatus, test.wantStatus, payload)
			}
			if test.wantStatus {
				assertJSONNumber(t, payload, "status_code", "204")
			}
			if _, exists := payload["error_code"]; exists {
				t.Fatal("进入 group 后绑定的 error_code 不得进入日志")
			}
			if _, exists := payload["elapsed_ms"]; exists {
				t.Fatal("进入 group 后 record 上的 elapsed_ms 不得进入日志")
			}
		})
	}
}

func TestWriterFailureCallsSafeHookExactlyOnce(t *testing.T) {
	t.Parallel()

	const writerErrorMarker = "WRITER_RAW_ERROR_MARKER_MUST_NOT_APPEAR"
	w := &recordingFailWriter{errorMarker: writerErrorMarker}
	var hookCalls atomic.Int32
	log := newTestLogger(t, w, func() {
		hookCalls.Add(1)
	})

	if got := hookCalls.Load(); got != 0 {
		t.Fatalf("构造阶段调用 writer error hook %d 次，期望 0", got)
	}
	log.Info("writer 失败测试", slog.Int64("elapsed_ms", 1))
	waitForHookCalls(t, &hookCalls, 1)

	if got := w.writeCalls.Load(); got != 1 {
		t.Fatalf("writer 调用次数=%d，期望 1；可能发生了递归写入", got)
	}
	if got := hookCalls.Load(); got != 1 {
		t.Fatalf("writer error hook 调用次数=%d，期望 1", got)
	}
	if strings.Contains(w.String(), writerErrorMarker) {
		t.Fatalf("writer 原始错误进入日志内容：%s", w.String())
	}
}

func TestWriterFailureHookCannotDeadlockRecursivelyOrPropagatePanic(t *testing.T) {
	t.Parallel()

	w := &recordingFailWriter{errorMarker: "RECURSIVE_WRITER_ERROR_MARKER"}
	var hookCalls atomic.Int32
	done := make(chan struct{})
	var log *slog.Logger
	var err error
	log, err = logger.New(logger.Options{
		Writer:   w,
		Service:  serviceName,
		Version:  serviceVersion,
		MinLevel: slog.LevelInfo,
		OnWriteError: func() {
			defer close(done)
			hookCalls.Add(1)
			log.Info("递归 writer 失败测试", slog.Int64("elapsed_ms", 2))
			panic("HOOK_PANIC_MARKER_MUST_NOT_PROPAGATE")
		},
	})
	if err != nil {
		t.Fatalf("logger.New() error = %v", err)
	}

	log.Info("首次 writer 失败测试", slog.Int64("elapsed_ms", 1))
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("writer error hook 递归写日志发生死锁")
	}
	if got := hookCalls.Load(); got != 1 {
		t.Fatalf("writer error hook 调用次数=%d，期望 1", got)
	}
	if got := w.writeCalls.Load(); got != 1 {
		t.Fatalf("writer 调用次数=%d，期望递归写被安全抑制", got)
	}
}

func waitForHookCalls(t *testing.T, calls *atomic.Int32, want int32) {
	t.Helper()

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if calls.Load() == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("writer error hook 调用次数=%d，期望=%d", calls.Load(), want)
}

func newTestLogger(t *testing.T, writer io.Writer, onWriteError func()) *slog.Logger {
	t.Helper()

	log, err := logger.New(logger.Options{
		Writer:       writer,
		Service:      serviceName,
		Version:      serviceVersion,
		MinLevel:     slog.LevelInfo,
		OnWriteError: onWriteError,
	})
	if err != nil {
		t.Fatalf("logger.New() error = %v", err)
	}
	return log
}

func decodeSingleJSONLine(t *testing.T, content []byte) map[string]any {
	t.Helper()

	if !bytes.HasSuffix(content, []byte("\n")) {
		t.Fatalf("日志必须以换行结尾：%q", content)
	}
	if got := bytes.Count(content, []byte("\n")); got != 1 {
		t.Fatalf("日志行数=%d，期望 1：%q", got, content)
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	var payload map[string]any
	if err := decoder.Decode(&payload); err != nil {
		t.Fatalf("解析日志 JSON 失败：%v，内容=%q", err, content)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		t.Fatalf("日志包含尾随 JSON：%v，内容=%q", err, content)
	}
	return payload
}

func assertExactKeys(t *testing.T, payload map[string]any, want []string) {
	t.Helper()

	got := make([]string, 0, len(payload))
	for key := range payload {
		got = append(got, key)
	}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("日志字段=%v，期望=%v；payload=%v", got, want, payload)
	}
}

func assertField(t *testing.T, payload map[string]any, key string, want any) {
	t.Helper()

	if got := payload[key]; !reflect.DeepEqual(got, want) {
		t.Fatalf("%s=%v (%T)，期望=%v (%T)", key, got, got, want, want)
	}
}

func assertJSONNumber(t *testing.T, payload map[string]any, key, want string) {
	t.Helper()

	value, ok := payload[key].(json.Number)
	if !ok {
		t.Fatalf("%s 类型=%T，期望 json.Number；payload=%v", key, payload[key], payload)
	}
	if got := value.String(); got != want {
		t.Fatalf("%s=%s，期望=%s", key, got, want)
	}
}

type countingLogValuer struct {
	calls  *atomic.Int32
	marker string
}

func (v countingLogValuer) LogValue() slog.Value {
	v.calls.Add(1)
	return slog.StringValue(v.marker)
}

type recordingFailWriter struct {
	bytes.Buffer
	errorMarker string
	writeCalls  atomic.Int32
}

func (w *recordingFailWriter) Write(content []byte) (int, error) {
	w.writeCalls.Add(1)
	_, _ = w.Buffer.Write(content)
	return 0, errors.New(w.errorMarker)
}

type leakMarkers struct {
	absolutePath           string
	adminAuthenticationKey []byte
	adminCookie            string
	adminEncryptionKey     []byte
	authorization          string
	binaryValue            []byte
	completeURL            string
	cookieHeader           string
	derivationKey          []byte
	dsnParameter           string
	groupName              string
	groupValue             string
	logValuer              string
	mysqlHost              string
	mysqlPassword          string
	mysqlUsername          string
	providerResponse       string
	rawCause               string
	rawPrompt              string
	redisAddress           string
	redisKeyPrefix         string
	redisPassword          string
	userAuthenticationKey  []byte
	userCookie             string
	userEncryptionKey      []byte
	verificationKey        []byte
}

func newLeakMarkers() leakMarkers {
	return leakMarkers{
		absolutePath:           "/Users/private/ABSOLUTE_PATH_MARKER_MUST_NOT_APPEAR",
		adminAuthenticationKey: []byte("ADMIN_AUTH_KEY_MARKER_MUST_NOT_APPEAR"),
		adminCookie:            "ADMIN_COOKIE_NAME_MARKER_MUST_NOT_APPEAR",
		adminEncryptionKey:     []byte("ADMIN_ENCRYPT_KEY_MARKER_MUST_NOT_APPEAR"),
		authorization:          "Bearer AUTHORIZATION_MARKER_MUST_NOT_APPEAR",
		binaryValue:            []byte("BINARY_VALUE_MARKER_MUST_NOT_APPEAR"),
		completeURL:            "https://private.example/path?token=COMPLETE_URL_MARKER_MUST_NOT_APPEAR",
		cookieHeader:           "session=COOKIE_HEADER_MARKER_MUST_NOT_APPEAR",
		derivationKey:          []byte("DERIVATION_KEY_MARKER_MUST_NOT_APPEAR"),
		dsnParameter:           "DSN_PARAMETER_MARKER_MUST_NOT_APPEAR",
		groupName:              "GROUP_NAME_MARKER_MUST_NOT_APPEAR",
		groupValue:             "GROUP_VALUE_MARKER_MUST_NOT_APPEAR",
		logValuer:              "LOG_VALUER_MARKER_MUST_NOT_APPEAR",
		mysqlHost:              "MYSQL_HOST_MARKER_MUST_NOT_APPEAR",
		mysqlPassword:          "MYSQL_PASSWORD_MARKER_MUST_NOT_APPEAR",
		mysqlUsername:          "MYSQL_USERNAME_MARKER_MUST_NOT_APPEAR",
		providerResponse:       "PROVIDER_RESPONSE_MARKER_MUST_NOT_APPEAR",
		rawCause:               "RAW_CAUSE_MARKER_MUST_NOT_APPEAR",
		rawPrompt:              "RAW_PROMPT_MARKER_MUST_NOT_APPEAR",
		redisAddress:           "REDIS_ADDRESS_MARKER_MUST_NOT_APPEAR:6379",
		redisKeyPrefix:         "REDIS_KEY_PREFIX_MARKER_MUST_NOT_APPEAR:",
		redisPassword:          "REDIS_PASSWORD_MARKER_MUST_NOT_APPEAR",
		userAuthenticationKey:  []byte("USER_AUTH_KEY_MARKER_MUST_NOT_APPEAR"),
		userCookie:             "USER_COOKIE_NAME_MARKER_MUST_NOT_APPEAR",
		userEncryptionKey:      []byte("USER_ENCRYPT_KEY_MARKER_MUST_NOT_APPEAR"),
		verificationKey:        []byte("VERIFICATION_KEY_MARKER_MUST_NOT_APPEAR"),
	}
}

func (m leakMarkers) forbiddenStrings(configJSON string) []string {
	forbidden := []string{
		m.absolutePath,
		m.adminCookie,
		m.authorization,
		m.completeURL,
		m.cookieHeader,
		m.dsnParameter,
		m.groupName,
		m.groupValue,
		m.logValuer,
		m.mysqlHost,
		m.mysqlPassword,
		m.mysqlUsername,
		m.providerResponse,
		m.rawCause,
		m.rawPrompt,
		m.redisAddress,
		m.redisKeyPrefix,
		m.redisPassword,
		m.userCookie,
		configJSON,
	}
	for _, value := range [][]byte{
		m.adminAuthenticationKey,
		m.adminEncryptionKey,
		m.binaryValue,
		m.derivationKey,
		m.userAuthenticationKey,
		m.userEncryptionKey,
		m.verificationKey,
	} {
		forbidden = append(forbidden, string(value), base64.StdEncoding.EncodeToString(value))
	}
	return forbidden
}
