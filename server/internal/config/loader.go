package config

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-viper/mapstructure/v2"
	"github.com/spf13/viper"
	"go.yaml.in/yaml/v3"
)

// Load 从指定 app.yaml 加载启动配置；空路径使用进程工作目录下的 conf/app.yaml。
func Load(configPath string) (Config, error) {
	if strings.TrimSpace(configPath) == "" {
		configPath = filepath.Join("conf", "app.yaml")
	}
	absolutePath, err := filepath.Abs(configPath)
	if err != nil {
		return Config{}, fmt.Errorf("解析启动配置路径失败")
	}
	if err := requireRegularFile(absolutePath); err != nil {
		return Config{}, fmt.Errorf("启动配置文件无效")
	}

	var app appDocument
	if err := decodeYAMLFile(absolutePath, &app); err != nil {
		return Config{}, fmt.Errorf("解析 app.yaml 失败")
	}
	if app.Version != 1 {
		return Config{}, fmt.Errorf("app.version 只支持 1")
	}
	workDir := filepath.Dir(absolutePath)
	httpConfig, err := buildHTTPConfig(app.HTTP)
	if err != nil {
		return Config{}, err
	}

	mysql, err := buildMySQLConfig(app.MySQL)
	if err != nil {
		return Config{}, err
	}

	session, err := buildSessionConfig(app.Session)
	if err != nil {
		return Config{}, err
	}

	var redis *RedisConfig
	if session.Store == "redis" {
		validatedRedis, err := buildRedisConfig(app.Redis)
		if err != nil {
			return Config{}, err
		}
		redis = &validatedRedis
	}

	security, err := buildSecurityConfig(app.Security, session)
	if err != nil {
		return Config{}, err
	}

	return Config{
		WorkDir: workDir, HTTP: httpConfig, MySQL: mysql, Redis: redis, Session: session, Security: security,
	}, nil
}

func decodeYAMLFile(path string, target any) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := validateYAMLMappingKeys(content); err != nil {
		return err
	}
	decoder := viper.New()
	decoder.SetConfigType("yaml")
	if err := decoder.ReadConfig(strings.NewReader(string(content))); err != nil {
		return err
	}
	if err := decoder.UnmarshalExact(target, func(config *mapstructure.DecoderConfig) {
		config.WeaklyTypedInput = false
		config.MatchName = func(mapKey, fieldName string) bool {
			return mapKey == fieldName
		}
	}); err != nil {
		return err
	}
	return restoreCaseSensitiveMaps(content, target)
}

func validateYAMLMappingKeys(content []byte) error {
	var document yaml.Node
	decoder := yaml.NewDecoder(bytes.NewReader(content))
	if err := decoder.Decode(&document); err != nil {
		return err
	}
	var trailing yaml.Node
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err != nil {
			return err
		}
		return fmt.Errorf("YAML 配置只能包含一个文档")
	}
	return validateYAMLNodeMappingKeys(&document)
}

func validateYAMLNodeMappingKeys(node *yaml.Node) error {
	switch node.Kind {
	case yaml.DocumentNode, yaml.SequenceNode:
		for _, child := range node.Content {
			if err := validateYAMLNodeMappingKeys(child); err != nil {
				return err
			}
		}
	case yaml.MappingNode:
		seen := make(map[string]struct{}, len(node.Content)/2)
		for index := 0; index < len(node.Content); index += 2 {
			key := node.Content[index]
			if key.Kind != yaml.ScalarNode || key.Tag != "!!str" {
				return fmt.Errorf("YAML 配置字段名必须是字符串")
			}
			normalized := strings.ToLower(strings.TrimSpace(key.Value))
			if _, duplicate := seen[normalized]; duplicate {
				return fmt.Errorf("YAML 配置包含大小写或空格语义重复字段")
			}
			seen[normalized] = struct{}{}
			if err := validateYAMLNodeMappingKeys(node.Content[index+1]); err != nil {
				return err
			}
		}
	}
	return nil
}

func restoreCaseSensitiveMaps(content []byte, target any) error {
	appTarget, ok := target.(*appDocument)
	if !ok {
		return nil
	}
	var original struct {
		HTTP struct {
			CORS struct {
				UserAllowedOrigins  *[]*string `yaml:"user_allowed_origins"`
				AdminAllowedOrigins *[]*string `yaml:"admin_allowed_origins"`
			} `yaml:"cors"`
		} `yaml:"http"`
		MySQL struct {
			DSNParams map[string]string `yaml:"dsn_params"`
		} `yaml:"mysql"`
		Security struct {
			TrustedProxyCIDRs *[]*string `yaml:"trusted_proxy_cidrs"`
		} `yaml:"security"`
	}
	if err := yaml.Unmarshal(content, &original); err != nil {
		return err
	}
	userOrigins, err := restoreOriginList(original.HTTP.CORS.UserAllowedOrigins)
	if err != nil {
		return err
	}
	adminOrigins, err := restoreOriginList(original.HTTP.CORS.AdminAllowedOrigins)
	if err != nil {
		return err
	}
	appTarget.HTTP.CORS.UserAllowedOrigins = userOrigins
	appTarget.HTTP.CORS.AdminAllowedOrigins = adminOrigins
	appTarget.MySQL.DSNParams = original.MySQL.DSNParams
	trustedProxyCIDRs, err := restoreTrustedProxyCIDRList(original.Security.TrustedProxyCIDRs)
	if err != nil {
		return err
	}
	appTarget.Security.TrustedProxyCIDRs = trustedProxyCIDRs
	return nil
}

func restoreOriginList(values *[]*string) (*[]string, error) {
	if values == nil {
		return nil, nil
	}
	restored := make([]string, 0, len(*values))
	for _, value := range *values {
		if value == nil {
			return nil, fmt.Errorf("http.cors Origin 必须是字符串")
		}
		restored = append(restored, *value)
	}
	return &restored, nil
}

func restoreTrustedProxyCIDRList(values *[]*string) (*[]string, error) {
	if values == nil {
		return nil, nil
	}
	restored := make([]string, 0, len(*values))
	for _, value := range *values {
		if value == nil {
			return nil, fmt.Errorf("security.trusted_proxy_cidrs 必须是字符串列表")
		}
		restored = append(restored, *value)
	}
	return &restored, nil
}

func requireRegularFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("不是普通文件")
	}
	return nil
}
