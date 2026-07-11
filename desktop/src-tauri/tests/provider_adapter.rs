use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::errors::ProviderTransportErrorKind;
use commerce_shoot_studio_lib::infrastructure::providers::http_model_gateway::{
    build_model_gateway_request_body, build_model_gateway_stream_request_body,
    model_gateway_request_timeout, parse_model_gateway_sse_event,
    sanitize_model_gateway_request_for_diagnostics, HttpModelGatewayAdapter,
    HttpModelGatewayRequestConfig, ModelGatewaySseEvent,
};
use commerce_shoot_studio_lib::infrastructure::providers::openai_compatible::{
    normalize_openai_compatible_response, redact_provider_result_url,
};
use commerce_shoot_studio_lib::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayAdapterRequest, ModelGatewayError,
};

#[test]
fn http_adapter_preserves_provider_http_status_without_response_body() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let base_url = format!(
        "http://{}",
        listener.local_addr().expect("address should resolve")
    );
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("request should arrive");
        let mut buffer = [0_u8; 4096];
        let _ = stream.read(&mut buffer);
        stream
            .write_all(
                b"HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
            )
            .expect("response should write");
    });
    let input = serde_json::json!({
        "prompt": {
            "messages": [{ "role": "user", "content": "生成文案" }]
        }
    });

    let error = HttpModelGatewayAdapter::new(None)
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "listing-copy",
            endpoint_path: "/v1/responses",
            input: &input,
            input_summary: "test",
            model: "gpt-test",
            provider_profile_id: "openai",
        })
        .expect_err("429 should propagate as a typed HTTP error");

    assert_eq!(
        error,
        ModelGatewayError::ProviderHttp {
            status_code: 429,
            provider_error_code: None,
        }
    );
    server.join().expect("test server should finish");
}

#[test]
fn http_adapter_preserves_network_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let base_url = format!(
        "http://{}",
        listener.local_addr().expect("address should resolve")
    );
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("request should arrive");
        let mut buffer = [0_u8; 4096];
        let _ = stream.read(&mut buffer);
    });
    let input = serde_json::json!({
        "prompt": {
            "messages": [{ "role": "user", "content": "生成文案" }]
        }
    });

    let error = HttpModelGatewayAdapter::new(None)
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "listing-copy",
            endpoint_path: "/v1/responses",
            input: &input,
            input_summary: "test",
            model: "gpt-test",
            provider_profile_id: "openai",
        })
        .expect_err("closed connection should propagate as a network error");

    assert_eq!(
        error,
        ModelGatewayError::ProviderTransport(ProviderTransportErrorKind::Network)
    );
    server.join().expect("test server should finish");
}

#[test]
fn http_adapter_network_failure_diagnostic_omits_base_url_path() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener.local_addr().expect("address should resolve");
    drop(listener);
    let base_url = format!("http://{address}/private/sk-network-diagnostic-secret");
    let diagnostic_log_path = test_diagnostic_log_path("network-error");
    let input = provider_text_input();

    let error = HttpModelGatewayAdapter::new(Some(diagnostic_log_path.clone()))
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "listing-copy",
            endpoint_path: "/v1/responses",
            input: &input,
            input_summary: "test",
            model: "gpt-test",
            provider_profile_id: "openai",
        })
        .expect_err("closed listener should propagate as a network error");

    assert_eq!(
        error,
        ModelGatewayError::ProviderTransport(ProviderTransportErrorKind::Network)
    );
    let diagnostic = fs::read_to_string(&diagnostic_log_path)
        .expect("network failure diagnostic log should exist");

    assert!(diagnostic.contains("\"transportKind\":\"network\""));
    assert!(!diagnostic.contains("sk-network-diagnostic-secret"));
    fs::remove_file(diagnostic_log_path).expect("diagnostic log should be removable");
}

#[test]
fn http_adapter_extracts_nested_error_code_without_logging_response_body() {
    let response_body =
        r#"{"error":{"code":"ModelNotOpen","message":"diagnostic-response-marker"}}"#;
    let (base_url, server) = spawn_http_response("404 Not Found", response_body);
    let diagnostic_log_path = test_diagnostic_log_path("nested-error-code");
    let input = provider_text_input();

    let error = HttpModelGatewayAdapter::new(Some(diagnostic_log_path.clone()))
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "listing-copy",
            endpoint_path: "/v1/responses",
            input: &input,
            input_summary: "test",
            model: "gpt-test",
            provider_profile_id: "openai",
        })
        .expect_err("404 should preserve the structured provider error code");

    assert_eq!(
        error,
        ModelGatewayError::ProviderHttp {
            status_code: 404,
            provider_error_code: Some("ModelNotOpen".to_string()),
        }
    );
    server.join().expect("test server should finish");
    assert_safe_diagnostic_log(
        &diagnostic_log_path,
        "ModelNotOpen",
        "diagnostic-response-marker",
    );
}

#[test]
fn streaming_http_adapter_extracts_top_level_error_code_without_logging_response_body() {
    let response_body = r#"{"code":"InvalidParameter","message":"stream-response-marker"}"#;
    let (base_url, server) = spawn_http_response("400 Bad Request", response_body);
    let diagnostic_log_path = test_diagnostic_log_path("stream-error-code");
    let input = provider_text_input();

    let error = HttpModelGatewayAdapter::new(Some(diagnostic_log_path.clone()))
        .expect("adapter should initialize")
        .invoke_stream(
            ModelGatewayAdapterRequest {
                api_key: Some("sk-test"),
                base_url: &base_url,
                capability_id: "listing-copy",
                endpoint_path: "/v1/responses",
                input: &input,
                input_summary: "test",
                model: "gpt-test",
                provider_profile_id: "openai",
            },
            |_| Ok(()),
        )
        .expect_err("400 should preserve the structured provider error code");

    assert_eq!(
        error,
        ModelGatewayError::ProviderHttp {
            status_code: 400,
            provider_error_code: Some("InvalidParameter".to_string()),
        }
    );
    server.join().expect("test server should finish");
    assert_safe_diagnostic_log(
        &diagnostic_log_path,
        "InvalidParameter",
        "stream-response-marker",
    );
}

fn provider_text_input() -> serde_json::Value {
    serde_json::json!({
        "prompt": {
            "messages": [{
                "role": "user",
                "content": "request-prompt-marker sk-diagnostic-secret-marker"
            }]
        }
    })
}

fn spawn_http_response(
    status_line: &'static str,
    response_body: &'static str,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let base_url = format!(
        "http://{}",
        listener.local_addr().expect("address should resolve")
    );
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("request should arrive");
        let mut buffer = [0_u8; 4096];
        let _ = stream.read(&mut buffer);
        let response = format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
            response_body.len(),
        );
        stream
            .write_all(response.as_bytes())
            .expect("response should write");
    });
    (base_url, server)
}

fn test_diagnostic_log_path(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time should move forward")
        .as_nanos();
    std::env::temp_dir().join(format!("commerce-shoot-studio-{label}-{nanos}.jsonl"))
}

fn assert_safe_diagnostic_log(path: &PathBuf, safe_code: &str, raw_marker: &str) {
    let diagnostic = fs::read_to_string(path).expect("diagnostic log should exist");
    assert!(diagnostic.contains(safe_code));
    assert!(!diagnostic.contains(raw_marker));
    assert!(!diagnostic.contains("rawResponse"));
    assert!(!diagnostic.contains("sk-test"));
    assert!(!diagnostic.contains("request-prompt-marker"));
    assert!(!diagnostic.contains("sk-diagnostic-secret-marker"));
    fs::remove_file(path).expect("diagnostic log should be removable");
}

#[test]
fn normalizes_chat_completion_text_response() {
    let normalized = normalize_openai_compatible_response(&serde_json::json!({
        "choices": [
            {
                "message": {
                    "content": "适合电商详情页的文案"
                }
            }
        ],
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 8,
            "total_tokens": 20
        }
    }))
    .expect("chat response should normalize");

    assert_eq!(
        normalized.output_text.as_deref(),
        Some("适合电商详情页的文案")
    );
    assert_eq!(normalized.usage_json["totalTokens"], 20);
    assert!(!normalized.raw_response_stored);
}

#[test]
fn normalizes_openai_responses_output_text() {
    let normalized = normalize_openai_compatible_response(&serde_json::json!({
        "output_text": "生成方案摘要",
        "usage": {
            "input_tokens": 10,
            "output_tokens": 5,
            "total_tokens": 15
        }
    }))
    .expect("responses api response should normalize");

    assert_eq!(normalized.output_text.as_deref(), Some("生成方案摘要"));
    assert_eq!(normalized.usage_json["totalTokens"], 15);
    assert!(!normalized.raw_response_stored);
}

#[test]
fn normalizes_openai_responses_message_output_text() {
    let normalized = normalize_openai_compatible_response(&serde_json::json!({
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": "1、产品名称：黑色休闲衬衫"
                    }
                ]
            }
        ],
        "usage": {
            "input_tokens": 30,
            "output_tokens": 20,
            "total_tokens": 50
        }
    }))
    .expect("responses message output should normalize");

    assert_eq!(
        normalized.output_text.as_deref(),
        Some("1、产品名称：黑色休闲衬衫")
    );
    assert_eq!(normalized.usage_json["totalTokens"], 50);
    assert!(!normalized.raw_response_stored);
}

#[test]
fn normalizes_openai_responses_message_text_content() {
    let normalized = normalize_openai_compatible_response(&serde_json::json!({
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "text",
                        "text": "1、产品名称：黑色休闲衬衫"
                    }
                ]
            }
        ],
        "usage": {
            "input_tokens": 30,
            "output_tokens": 20,
            "total_tokens": 50
        }
    }))
    .expect("responses message text content should normalize");

    assert_eq!(
        normalized.output_text.as_deref(),
        Some("1、产品名称：黑色休闲衬衫")
    );
}

#[test]
fn normalizes_chat_completion_array_content_response() {
    let normalized = normalize_openai_compatible_response(&serde_json::json!({
        "choices": [
            {
                "message": {
                    "content": [
                        {
                            "type": "text",
                            "text": "卖点内容"
                        }
                    ]
                }
            }
        ],
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 8,
            "total_tokens": 20
        }
    }))
    .expect("chat completion array content should normalize");

    assert_eq!(normalized.output_text.as_deref(), Some("卖点内容"));
    assert_eq!(normalized.usage_json["totalTokens"], 20);
    assert!(!normalized.raw_response_stored);
}

#[test]
fn normalizes_volcengine_image_generation_url_response() {
    let normalized = normalize_openai_compatible_response(&serde_json::json!({
        "created": 1782982805,
        "data": [
            {
                "size": "2048x2048",
                "url": "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/generated.jpeg?X-Tos-Signature=test"
            }
        ],
        "model": "doubao-seedream-4-0-250828",
        "usage": {
            "generated_images": 1,
            "output_tokens": 16384,
            "total_tokens": 16384
        }
    }))
    .expect("volcengine image response should normalize");

    assert!(normalized.output_text.is_none());
    assert_eq!(normalized.output_json["type"], "image");
    assert_eq!(
        normalized.output_json["images"][0]["url"],
        "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/generated.jpeg?X-Tos-Signature=test"
    );
    assert_eq!(
        normalized.output_json["images"][0]["mimeType"],
        "image/jpeg"
    );
    assert_eq!(normalized.output_json["images"][0]["size"], "2048x2048");
    assert_eq!(normalized.usage_json["generatedImages"], 1);
    assert_eq!(normalized.usage_json["totalTokens"], 16384);
    assert!(!normalized.raw_response_stored);
}

#[test]
fn rejects_chat_completion_response_truncated_by_token_limit() {
    let error = normalize_openai_compatible_response(&serde_json::json!({
        "choices": [
            {
                "finish_reason": "length",
                "message": {
                    "content": "{\"version\":\"v1\",\"groups\":["
                }
            }
        ],
        "usage": {
            "prompt_tokens": 1729,
            "completion_tokens": 3348,
            "total_tokens": 5077
        }
    }))
    .expect_err("truncated response should not be normalized as usable text");

    assert_eq!(
        error.to_string(),
        "模型输出被 token 上限截断，请减少模块/风格数量或提高输出 token 上限。"
    );
}

#[test]
fn builds_responses_image_to_text_request_with_system_rules_and_user_images() {
    let body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/v1/responses",
            model: "gpt-4.1-mini",
            provider_profile_id: "openai",
        },
        &serde_json::json!({
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "系统规则"
                    },
                    {
                        "role": "user",
                        "content": "请根据上传图片识别商品信息。"
                    }
                ],
                "rolelessPrompt": "【应用规则】\n系统规则\n\n【用户任务】\n请根据上传图片识别商品信息。"
            },
            "userImages": [
                {
                    "mimeType": "image/png",
                    "dataUrl": "data:image/png;base64,abc"
                }
            ]
        }),
    )
    .expect("request body should build");

    assert_eq!(body["model"], "gpt-4.1-mini");
    assert_eq!(body["instructions"], "系统规则");
    assert_eq!(body["input"][0]["role"], "user");
    assert_eq!(body["input"][0]["content"][0]["type"], "input_image");
    assert_eq!(
        body["input"][0]["content"][0]["image_url"],
        "data:image/png;base64,abc"
    );
    assert_eq!(body["input"][0]["content"][1]["type"], "input_text");
    assert!(body.get("thinking").is_none());
}

#[test]
fn builds_volcengine_responses_request_with_thinking_disabled() {
    let body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/responses",
            model: "doubao-seed-2-1-pro-260628",
            provider_profile_id: "volcengine",
        },
        &serde_json::json!({
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "系统规则"
                    },
                    {
                        "role": "user",
                        "content": "请根据上传图片识别商品信息。"
                    }
                ],
                "rolelessPrompt": "【应用规则】\n系统规则\n\n【用户任务】\n请根据上传图片识别商品信息。"
            },
            "userImages": [
                {
                    "mimeType": "image/jpeg",
                    "dataUrl": "data:image/jpeg;base64,abc"
                }
            ]
        }),
    )
    .expect("request body should build");

    assert_eq!(body["instructions"], "系统规则");
    assert_eq!(body["thinking"]["type"], "disabled");
    assert_eq!(body["input"][0]["role"], "user");
    assert_eq!(body["input"][0]["content"][0]["type"], "input_image");
}

#[test]
fn builds_volcengine_streaming_responses_request() {
    let body = build_model_gateway_stream_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/responses",
            model: "doubao-seed-2-1-pro-260628",
            provider_profile_id: "volcengine",
        },
        &serde_json::json!({
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "系统规则"
                    },
                    {
                        "role": "user",
                        "content": "请根据上传图片识别商品信息。"
                    }
                ],
                "rolelessPrompt": "【应用规则】\n系统规则\n\n【用户任务】\n请根据上传图片识别商品信息。"
            },
            "userImages": [
                {
                    "mimeType": "image/jpeg",
                    "dataUrl": "data:image/jpeg;base64,abc"
                }
            ]
        }),
    )
    .expect("stream request body should build");

    assert_eq!(body["stream"], true);
    assert_eq!(body["thinking"]["type"], "disabled");
    assert_eq!(body["input"][0]["content"][0]["type"], "input_image");
}

#[test]
fn builds_image_generation_request_with_reference_images_and_consistency_prompt() {
    let body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/images/generations",
            model: "doubao-seedream-4-0-250828",
            provider_profile_id: "volcengine",
        },
        &serde_json::json!({
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "你是专业电商商品详情页图生图生成器。"
                    },
                    {
                        "role": "user",
                        "content": "请基于上传的商品参考图生成详情图。必须与参考图保持一致。"
                    }
                ],
                "rolelessPrompt": "【应用规则】\n你是专业电商商品详情页图生图生成器。\n\n【用户任务】\n请基于上传的商品参考图生成详情图。必须与参考图保持一致。"
            },
            "userImages": [
                {
                    "mimeType": "image/jpeg",
                    "dataUrl": "data:image/jpeg;base64,reference"
                }
            ]
        }),
    )
    .expect("image generation request body should build");

    assert_eq!(body["model"], "doubao-seedream-4-0-250828");
    assert_eq!(body["image"], "data:image/jpeg;base64,reference");
    assert!(body.get("images").is_none());
    assert!(body.get("sequential_image_generation").is_none());
    assert!(body.get("max_tokens").is_none());
    assert!(body.get("temperature").is_none());
    assert_eq!(body["size"], "2K");
    assert_eq!(body["response_format"], "url");
    assert!(body.get("output_format").is_none());
    assert_eq!(body["watermark"], false);
    assert!(body["prompt"]
        .as_str()
        .expect("prompt should be a string")
        .contains("必须与参考图保持一致"));
}

#[test]
fn builds_volcengine_image_generation_request_with_multiple_reference_images_as_array() {
    let body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/images/generations",
            model: "doubao-seedream-5-0-260128",
            provider_profile_id: "volcengine",
        },
        &serde_json::json!({
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "你是专业电商服饰虚拟试穿与场景商拍图像生成模型。"
                    },
                    {
                        "role": "user",
                        "content": "参考图 A 是服装，参考图 B 是模特。生成服饰试穿图。"
                    }
                ],
                "rolelessPrompt": "参考图 A 是服装，参考图 B 是模特。生成服饰试穿图。"
            },
            "userImages": [
                {
                    "mimeType": "image/png",
                    "role": "source",
                    "dataUrl": "data:image/png;base64,garment"
                },
                {
                    "mimeType": "image/png",
                    "role": "model",
                    "dataUrl": "data:image/png;base64,model"
                }
            ]
        }),
    )
    .expect("image generation request body should build");

    assert_eq!(
        body["image"],
        serde_json::json!([
            "data:image/png;base64,garment",
            "data:image/png;base64,model"
        ])
    );
    assert!(body.get("images").is_none());
    assert!(body.get("sequential_image_generation").is_none());
    assert_eq!(body["size"], "2K");
    assert_eq!(body["response_format"], "url");
    assert!(body.get("output_format").is_none());
    assert_eq!(body["watermark"], false);
}

#[test]
fn builds_openai_image_generation_request_without_text_response_fields() {
    let body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/v1/images/generations",
            model: "gpt-image-1",
            provider_profile_id: "openai",
        },
        &serde_json::json!({
            "kind": "clothing-base-model-generation",
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "你是专业电商服饰模特图生成器。"
                    },
                    {
                        "role": "user",
                        "content": "生成一张干净的白底基准模特图。"
                    }
                ],
                "rolelessPrompt": "【应用规则】\\n你是专业电商服饰模特图生成器。\\n\\n【用户任务】\\n生成一张干净的白底基准模特图。"
            }
        }),
    )
    .expect("OpenAI image generation request body should build");

    assert_eq!(body["model"], "gpt-image-1");
    assert_eq!(body["size"], "1024x1536");
    assert!(body["prompt"]
        .as_str()
        .expect("prompt should be a string")
        .contains("生成一张干净的白底基准模特图"));
    assert!(body.get("input").is_none());
    assert!(body.get("messages").is_none());
    assert!(body.get("instructions").is_none());
    assert!(body.get("max_output_tokens").is_none());
    assert!(body.get("max_tokens").is_none());
    assert!(body.get("temperature").is_none());
}

#[test]
fn rejects_openai_image_generation_outside_clothing_base_model_capability() {
    let error = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/v1/images/generations",
            model: "gpt-image-1",
            provider_profile_id: "openai",
        },
        &serde_json::json!({
            "kind": "product-detail-generation",
            "ratio": "3:4",
            "prompt": {
                "messages": [
                    { "role": "system", "content": "系统规则" },
                    { "role": "user", "content": "生成商品图" }
                ],
                "rolelessPrompt": "生成商品图"
            }
        }),
    )
    .expect_err("OpenAI images endpoint must not silently approximate arbitrary ratios");

    assert_eq!(
        error,
        ModelGatewayError::ProviderRequestInvalid(
            "OpenAI 文生图当前仅支持服饰基准模特生成。".to_string(),
        )
    );
}

#[test]
fn rejects_openai_image_generation_with_reference_images() {
    let error = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/v1/images/generations",
            model: "gpt-image-1",
            provider_profile_id: "openai",
        },
        &serde_json::json!({
            "kind": "clothing-base-model-generation",
            "prompt": {
                "messages": [
                    { "role": "system", "content": "系统规则" },
                    { "role": "user", "content": "生成基准模特图" }
                ],
                "rolelessPrompt": "生成基准模特图"
            },
            "userImages": [{
                "mimeType": "image/png",
                "dataUrl": "data:image/png;base64,reference"
            }]
        }),
    )
    .expect_err("OpenAI images endpoint must not silently discard reference images");

    assert_eq!(
        error,
        ModelGatewayError::ProviderRequestInvalid(
            "OpenAI 服饰基准模特生成不支持参考图。".to_string(),
        )
    );
}

#[test]
fn openai_image_edit_sends_single_png_multipart_with_square_size() {
    let (base_url, request, server) = spawn_openai_image_edit_server();
    let diagnostic_log_path = test_diagnostic_log_path("openai-image-edit-single");
    let input = serde_json::json!({
        "ratio": "1:1",
        "prompt": {
            "messages": [{ "role": "user", "content": "生成商品详情图" }],
            "rolelessPrompt": "openai-image-edit-prompt-marker"
        },
        "userImages": [{
            "mimeType": "image/png",
            "dataUrl": valid_png_data_url()
        }]
    });

    HttpModelGatewayAdapter::new(Some(diagnostic_log_path.clone()))
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-openai-image-edit-test-secret"),
            base_url: &base_url,
            capability_id: "product-detail-generation",
            endpoint_path: "/v1/images/edits",
            input: &input,
            input_summary: "test",
            model: "gpt-image-1",
            provider_profile_id: "openai",
        })
        .expect("OpenAI image edit request should succeed");

    let request = request
        .recv()
        .expect("test server should capture the image edit request");
    assert_multipart_request_contains(
        &request,
        &[
            "name=\"image[]\"; filename=\"image-1.png\"",
            "name=\"model\"",
            "gpt-image-1",
            "name=\"prompt\"",
            "openai-image-edit-prompt-marker",
            "name=\"output_format\"",
            "png",
            "name=\"size\"",
            "1024x1024",
        ],
    );
    assert_eq!(request.matches("name=\"image[]\""), 1);
    assert_multipart_image_part(&request, "image-1.png", valid_png_bytes());
    assert_multipart_closing_boundary(&request);
    let diagnostic = fs::read_to_string(&diagnostic_log_path)
        .expect("diagnostic log should remain available before cleanup");
    assert!(diagnostic.contains("normalized_response"));
    assert!(!diagnostic.contains("openai-image-edit-prompt-marker"));
    assert!(!diagnostic.contains("sk-openai-image-edit-test-secret"));
    assert!(!diagnostic.contains(valid_png_data_url()));
    assert!(!diagnostic.contains("Content-Disposition: form-data"));
    fs::remove_file(diagnostic_log_path).expect("diagnostic log should be removable");
    server.join().expect("test server should finish");
}

#[test]
fn openai_image_edit_sends_two_pngs_multipart_with_portrait_size() {
    let (base_url, request, server) = spawn_openai_image_edit_server();
    let input = serde_json::json!({
        "ratio": "3:4",
        "prompt": {
            "messages": [{ "role": "user", "content": "生成服饰试穿图" }],
            "rolelessPrompt": "two-image-edit-prompt"
        },
        "userImages": [
            { "mimeType": "image/png", "dataUrl": valid_png_data_url() },
            { "mimeType": "image/png", "dataUrl": valid_png_data_url() }
        ]
    });

    HttpModelGatewayAdapter::new(None)
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "clothing-tryon-generation",
            endpoint_path: "/v1/images/edits",
            input: &input,
            input_summary: "test",
            model: "gpt-image-1",
            provider_profile_id: "openai",
        })
        .expect("OpenAI image edit request should succeed");

    let request = request
        .recv()
        .expect("test server should capture the image edit request");
    assert_multipart_request_contains(
        &request,
        &[
            "name=\"image[]\"; filename=\"image-1.png\"",
            "name=\"image[]\"; filename=\"image-2.png\"",
            "name=\"model\"",
            "gpt-image-1",
            "name=\"prompt\"",
            "two-image-edit-prompt",
            "name=\"output_format\"",
            "png",
            "name=\"size\"",
            "1024x1536",
        ],
    );
    assert_eq!(request.matches("name=\"image[]\""), 2);
    assert_multipart_image_part(&request, "image-1.png", valid_png_bytes());
    assert_multipart_image_part(&request, "image-2.png", valid_png_bytes());
    assert_multipart_closing_boundary(&request);
    server.join().expect("test server should finish");
}

#[test]
fn openai_image_edit_uses_landscape_size() {
    let (base_url, request, server) = spawn_openai_image_edit_server();
    let input = serde_json::json!({
        "ratio": "4:3",
        "prompt": {
            "messages": [{ "role": "user", "content": "生成横向商品详情图" }],
            "rolelessPrompt": "landscape-image-edit-prompt"
        },
        "userImages": [{ "mimeType": "image/png", "dataUrl": valid_png_data_url() }]
    });

    HttpModelGatewayAdapter::new(None)
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "product-detail-generation",
            endpoint_path: "/v1/images/edits",
            input: &input,
            input_summary: "test",
            model: "gpt-image-1",
            provider_profile_id: "openai",
        })
        .expect("OpenAI image edit request should succeed");

    let request = request
        .recv()
        .expect("test server should capture the image edit request");
    assert_multipart_request_contains(&request, &["name=\"size\"", "1536x1024"]);
    server.join().expect("test server should finish");
}

#[test]
fn openai_image_edit_rejects_gif_data_url() {
    let input = serde_json::json!({
        "ratio": "1:1",
        "prompt": {
            "messages": [{ "role": "user", "content": "生成商品图" }],
            "rolelessPrompt": "gif-edit-prompt"
        },
        "userImages": [{ "mimeType": "image/gif", "dataUrl": "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" }]
    });

    let error = invoke_openai_image_edit(&input).expect_err("GIF must be rejected before HTTP");

    assert!(matches!(
        error,
        ModelGatewayError::ProviderRequestInvalid(_)
    ));
}

#[test]
fn openai_image_edit_rejects_malformed_data_url() {
    let input = serde_json::json!({
        "ratio": "1:1",
        "prompt": {
            "messages": [{ "role": "user", "content": "生成商品图" }],
            "rolelessPrompt": "invalid-data-url-edit-prompt"
        },
        "userImages": [{ "mimeType": "image/png", "dataUrl": "not-a-data-url" }]
    });

    let error = invoke_openai_image_edit(&input)
        .expect_err("malformed data URL must be rejected before HTTP");

    assert!(matches!(
        error,
        ModelGatewayError::ProviderRequestInvalid(_)
    ));
}

#[test]
fn openai_image_edit_chooses_boundary_outside_model_prompt_and_image_bytes() {
    let colliding_delimiter = b"\r\n--commerce-shoot-studio-openai-images-edit";
    let mut image_bytes = b"\x89PNG\r\n\x1a\nimage-prefix".to_vec();
    image_bytes.extend_from_slice(colliding_delimiter);
    image_bytes.extend_from_slice(b"image-suffix");
    let model = "gpt-image-1\r\n--commerce-shoot-studio-openai-images-edit";
    let prompt = "安全提示\r\n--commerce-shoot-studio-openai-images-edit";
    let input = serde_json::json!({
        "ratio": "1:1",
        "prompt": {
            "messages": [{ "role": "user", "content": "生成商品图" }],
            "rolelessPrompt": prompt
        },
        "userImages": [{
            "mimeType": "image/png",
            "dataUrl": data_url_from_bytes("image/png", &image_bytes)
        }]
    });
    let (base_url, request, server) = spawn_openai_image_edit_server();

    HttpModelGatewayAdapter::new(None)
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "product-detail-generation",
            endpoint_path: "/v1/images/edits",
            input: &input,
            input_summary: "test",
            model,
            provider_profile_id: "openai",
        })
        .expect("multipart encoder should choose a non-colliding boundary");

    let request = request
        .recv()
        .expect("test server should capture the image edit request");
    let boundary = multipart_boundary(&request);
    let delimiter = format!("\r\n--{boundary}");
    assert_ne!(boundary, "commerce-shoot-studio-openai-images-edit");
    assert!(!model
        .as_bytes()
        .windows(delimiter.len())
        .any(|bytes| bytes == delimiter.as_bytes()));
    assert!(!prompt
        .as_bytes()
        .windows(delimiter.len())
        .any(|bytes| bytes == delimiter.as_bytes()));
    assert!(!image_bytes
        .windows(delimiter.len())
        .any(|bytes| bytes == delimiter.as_bytes()));
    assert_multipart_image_part(&request, "image-1.png", &image_bytes);
    assert_multipart_closing_boundary(&request);
    server.join().expect("test server should finish");
}

#[test]
fn openai_image_edit_chooses_boundary_when_model_starts_with_base_boundary() {
    let model = "--commerce-shoot-studio-openai-images-edit";
    let input = serde_json::json!({
        "ratio": "1:1",
        "prompt": {
            "messages": [{ "role": "user", "content": "生成商品图" }],
            "rolelessPrompt": "model-boundary-prefix-prompt"
        },
        "userImages": [{
            "mimeType": "image/png",
            "dataUrl": valid_png_data_url()
        }]
    });
    let (base_url, request, server) = spawn_openai_image_edit_server();

    HttpModelGatewayAdapter::new(None)
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "product-detail-generation",
            endpoint_path: "/v1/images/edits",
            input: &input,
            input_summary: "test",
            model,
            provider_profile_id: "openai",
        })
        .expect("multipart encoder should choose a non-colliding boundary");

    let request = request
        .recv()
        .expect("test server should capture the image edit request");
    assert_ne!(
        multipart_boundary(&request),
        "commerce-shoot-studio-openai-images-edit"
    );
    assert_multipart_text_part(&request, "model", model);
    assert_multipart_image_part(&request, "image-1.png", valid_png_bytes());
    server.join().expect("test server should finish");
}

#[test]
fn openai_image_edit_chooses_boundary_when_prompt_starts_with_base_boundary() {
    let prompt = "--commerce-shoot-studio-openai-images-edit";
    let input = serde_json::json!({
        "ratio": "1:1",
        "prompt": {
            "messages": [{ "role": "user", "content": "生成商品图" }],
            "rolelessPrompt": prompt
        },
        "userImages": [{
            "mimeType": "image/png",
            "dataUrl": valid_png_data_url()
        }]
    });
    let (base_url, request, server) = spawn_openai_image_edit_server();

    HttpModelGatewayAdapter::new(None)
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: &base_url,
            capability_id: "product-detail-generation",
            endpoint_path: "/v1/images/edits",
            input: &input,
            input_summary: "test",
            model: "gpt-image-1",
            provider_profile_id: "openai",
        })
        .expect("multipart encoder should choose a non-colliding boundary");

    let request = request
        .recv()
        .expect("test server should capture the image edit request");
    assert_ne!(
        multipart_boundary(&request),
        "commerce-shoot-studio-openai-images-edit"
    );
    assert_multipart_text_part(&request, "prompt", prompt);
    assert_multipart_image_part(&request, "image-1.png", valid_png_bytes());
    server.join().expect("test server should finish");
}

#[test]
fn openai_image_edit_rejects_data_url_mime_mismatches_before_http() {
    for actual_bytes in [
        b"GIF89a\x01\x00\x01\x00".as_slice(),
        b"unknown-image-bytes".as_slice(),
    ] {
        let input = serde_json::json!({
            "ratio": "1:1",
            "prompt": {
                "messages": [{ "role": "user", "content": "生成商品图" }],
                "rolelessPrompt": "mismatched-image-format"
            },
            "userImages": [{
                "mimeType": "image/png",
                "dataUrl": data_url_from_bytes("image/png", actual_bytes)
            }]
        });

        let error = invoke_openai_image_edit(&input)
            .expect_err("mismatched image data URL must be rejected before HTTP");

        assert!(matches!(
            error,
            ModelGatewayError::ProviderRequestInvalid(_)
        ));
    }
}

fn invoke_openai_image_edit(
    input: &serde_json::Value,
) -> Result<
    commerce_shoot_studio_lib::services::model_gateway::ModelGatewayAdapterResult,
    ModelGatewayError,
> {
    invoke_openai_image_edit_with_model(input, "gpt-image-1")
}

fn invoke_openai_image_edit_with_model(
    input: &serde_json::Value,
    model: &str,
) -> Result<
    commerce_shoot_studio_lib::services::model_gateway::ModelGatewayAdapterResult,
    ModelGatewayError,
> {
    HttpModelGatewayAdapter::new(None)
        .expect("adapter should initialize")
        .invoke(ModelGatewayAdapterRequest {
            api_key: Some("sk-test"),
            base_url: "http://127.0.0.1:1",
            capability_id: "product-detail-generation",
            endpoint_path: "/v1/images/edits",
            input,
            input_summary: "test",
            model,
            provider_profile_id: "openai",
        })
}

fn valid_png_data_url() -> &'static str {
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQ6QAAAABJRU5ErkJggg=="
}

fn valid_png_bytes() -> &'static [u8] {
    &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 29, 99, 248, 207, 192, 240, 31,
        0, 5, 128, 2, 63, 73, 194, 208, 233, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]
}

fn data_url_from_bytes(mime_type: &str, bytes: &[u8]) -> String {
    format!("data:{mime_type};base64,{}", base64_encode(bytes))
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        encoded.push(ALPHABET[(first >> 2) as usize] as char);
        encoded.push(ALPHABET[((first & 0x03) << 4 | second >> 4) as usize] as char);
        encoded.push(match chunk.len() {
            1 => '=',
            _ => ALPHABET[((second & 0x0f) << 2 | third >> 6) as usize] as char,
        });
        encoded.push(match chunk.len() {
            1 | 2 => '=',
            _ => ALPHABET[(third & 0x3f) as usize] as char,
        });
    }
    encoded
}

struct CapturedHttpRequest {
    headers: String,
    body: Vec<u8>,
}

impl CapturedHttpRequest {
    fn matches(&self, text: &str) -> usize {
        count_byte_occurrences(&self.body, text.as_bytes())
    }
}

fn spawn_openai_image_edit_server() -> (
    String,
    std::sync::mpsc::Receiver<CapturedHttpRequest>,
    thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let base_url = format!(
        "http://{}",
        listener.local_addr().expect("address should resolve")
    );
    let (sender, receiver) = std::sync::mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("request should arrive");
        let request = read_http_request(&mut stream);
        sender.send(request).expect("request should be captured");
        let response_body = r#"{"data":[{"url":"https://example.test/generated.png"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
            response_body.len(),
        );
        stream
            .write_all(response.as_bytes())
            .expect("response should write");
    });
    (base_url, receiver, server)
}

fn read_http_request(stream: &mut std::net::TcpStream) -> CapturedHttpRequest {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let read = stream
            .read(&mut buffer)
            .expect("request should be readable");
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let headers = String::from_utf8_lossy(&bytes[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim())
        })
        .expect("request should contain a content length")
        .parse::<usize>()
        .expect("content length should be numeric");
    while bytes.len() < header_end + content_length {
        let read = stream
            .read(&mut buffer)
            .expect("request body should be readable");
        bytes.extend_from_slice(&buffer[..read]);
    }
    CapturedHttpRequest {
        headers: String::from_utf8_lossy(&bytes[..header_end]).into_owned(),
        body: bytes[header_end..header_end + content_length].to_vec(),
    }
}

fn assert_multipart_request_contains(request: &CapturedHttpRequest, snippets: &[&str]) {
    assert!(
        request
            .headers
            .to_ascii_lowercase()
            .contains("content-type: multipart/form-data; boundary="),
        "OpenAI image edit must use multipart/form-data"
    );
    for snippet in snippets {
        assert!(
            request_body_contains(request, snippet.as_bytes()),
            "multipart request should contain {snippet:?}"
        );
    }
}

fn assert_multipart_image_part(request: &CapturedHttpRequest, file_name: &str, bytes: &[u8]) {
    assert!(
        request_body_contains(
            request,
            format!(
                "name=\"image[]\"; filename=\"{file_name}\"\r\nContent-Type: image/png\r\n\r\n"
            )
            .as_bytes(),
        ),
        "multipart image part should declare image/png"
    );
    assert!(
        request_body_contains(request, bytes),
        "multipart image part should preserve source bytes"
    );
}

fn assert_multipart_text_part(request: &CapturedHttpRequest, name: &str, value: &str) {
    assert!(
        request_body_contains(
            request,
            format!("name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        ),
        "multipart request should preserve {name} value"
    );
}

fn assert_multipart_closing_boundary(request: &CapturedHttpRequest) {
    let boundary = multipart_boundary(request);
    assert!(
        request
            .body
            .ends_with(format!("--{boundary}--\r\n").as_bytes()),
        "multipart body should end with the closing boundary"
    );
}

fn multipart_boundary(request: &CapturedHttpRequest) -> String {
    request
        .headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-type")
                .then(|| value.trim().strip_prefix("multipart/form-data; boundary="))
                .flatten()
        })
        .expect("multipart request should declare a boundary")
        .to_string()
}

fn request_body_contains(request: &CapturedHttpRequest, expected: &[u8]) -> bool {
    request
        .body
        .windows(expected.len())
        .any(|window| window == expected)
}

fn count_byte_occurrences(bytes: &[u8], expected: &[u8]) -> usize {
    bytes
        .windows(expected.len())
        .filter(|window| *window == expected)
        .count()
}

#[test]
fn builds_text_only_responses_request_without_user_images() {
    let body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/v1/responses",
            model: "gpt-5.5",
            provider_profile_id: "openai",
        },
        &serde_json::json!({
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "系统规则"
                    },
                    {
                        "role": "user",
                        "content": "目标平台：淘宝天猫\n商品卖点：黑色翻领长袖版型"
                    }
                ],
                "rolelessPrompt": "【应用规则】\n系统规则\n\n【用户任务】\n目标平台：淘宝天猫"
            }
        }),
    )
    .expect("text-only request body should build");

    assert_eq!(body["instructions"], "系统规则");
    assert_eq!(body["input"][0]["role"], "user");
    assert_eq!(body["input"][0]["content"].as_array().unwrap().len(), 1);
    assert_eq!(body["input"][0]["content"][0]["type"], "input_text");
    assert_eq!(
        body["input"][0]["content"][0]["text"],
        "目标平台：淘宝天猫\n商品卖点：黑色翻领长袖版型"
    );
}

#[test]
fn builds_request_with_custom_max_output_tokens() {
    let chat_body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/chat/completions",
            model: "deepseek-v4-flash-260425",
            provider_profile_id: "volcengine",
        },
        &serde_json::json!({
            "maxOutputTokens": 12000,
            "prompt": {
                "messages": [
                    {
                        "role": "user",
                        "content": "请输出较长 JSON"
                    }
                ]
            }
        }),
    )
    .expect("chat request body should build");

    assert_eq!(chat_body["max_tokens"], 12000);

    let responses_body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/v1/responses",
            model: "gpt-4.1-mini",
            provider_profile_id: "openai",
        },
        &serde_json::json!({
            "maxOutputTokens": 12000,
            "prompt": {
                "messages": [
                    {
                        "role": "user",
                        "content": "请输出较长 JSON"
                    }
                ]
            }
        }),
    )
    .expect("responses request body should build");

    assert_eq!(responses_body["max_output_tokens"], 12000);
}

#[test]
fn builds_text_only_chat_completion_request_with_string_content() {
    let body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/chat/completions",
            model: "deepseek-v4-flash-260425",
            provider_profile_id: "volcengine",
        },
        &serde_json::json!({
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "系统规则"
                    },
                    {
                        "role": "user",
                        "content": "请输出 JSON"
                    }
                ]
            }
        }),
    )
    .expect("chat request body should build");

    assert_eq!(body["messages"][0]["content"], "系统规则");
    assert_eq!(body["messages"][1]["content"], "请输出 JSON");
    assert!(body["messages"][1]["content"].as_array().is_none());
}

#[test]
fn uses_one_minute_timeout_for_image_to_image_calls() {
    assert_eq!(model_gateway_request_timeout("prompt-plan").as_secs(), 300);
    assert_eq!(
        model_gateway_request_timeout("clothing-tryon-generation").as_secs(),
        60
    );
    assert_eq!(model_gateway_request_timeout("image-edit").as_secs(), 60);
    assert_eq!(
        model_gateway_request_timeout("viral-style-analysis").as_secs(),
        90
    );
}

#[test]
fn parses_responses_stream_output_text_delta_event() {
    let event = parse_model_gateway_sse_event(
        "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"卖点内容\"}\n\n",
    )
    .expect("delta event should parse");

    assert_eq!(event, ModelGatewaySseEvent::Delta("卖点内容".to_string()));
}

#[test]
fn parses_responses_stream_completed_event() {
    let event = parse_model_gateway_sse_event(
        "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"完整内容\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2,\"total_tokens\":3}}}\n\n",
    )
    .expect("completed event should parse");

    match event {
        ModelGatewaySseEvent::Completed(response) => {
            assert_eq!(response["output_text"], "完整内容");
        }
        ModelGatewaySseEvent::Delta(_) | ModelGatewaySseEvent::DoneText(_) => {
            panic!("completed event should not parse as text delta")
        }
    }
}

#[test]
fn model_gateway_request_diagnostics_summarize_prompt_content_and_image_data() {
    let body = build_model_gateway_request_body(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/v1/responses",
            model: "gpt-4.1-mini",
            provider_profile_id: "openai",
        },
        &serde_json::json!({
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "system-prompt-raw-marker"
                    },
                    {
                        "role": "user",
                        "content": "user-content-raw-marker sk-request-secret-marker"
                    }
                ],
                "rolelessPrompt": "roleless-prompt-raw-marker"
            },
            "userImages": [
                {
                    "mimeType": "image/png",
                    "dataUrl": "data:image/png;base64,abcdefghijklmnopqrstuvwxyz"
                }
            ]
        }),
    )
    .expect("request body should build");

    let sanitized = sanitize_model_gateway_request_for_diagnostics(
        &HttpModelGatewayRequestConfig {
            endpoint_path: "/v1/responses",
            model: "gpt-4.1-mini",
            provider_profile_id: "openai",
        },
        &body,
    );
    let serialized = sanitized.to_string();

    assert_eq!(sanitized["providerProfileId"], "openai");
    assert!(sanitized.get("endpointPath").is_none());
    assert_eq!(sanitized["model"], "gpt-4.1-mini");
    assert_eq!(sanitized["body"]["model"], "gpt-4.1-mini");
    assert_eq!(sanitized["body"]["input"]["itemCount"], 1);
    assert_eq!(
        sanitized["body"]["input"]["items"][0]["content"]["itemCount"],
        2
    );
    assert!(serialized.contains("\"imageDataUrlLength\""));
    assert!(serialized.contains("\"stringCharCount\""));
    assert!(!serialized.contains("system-prompt-raw-marker"));
    assert!(!serialized.contains("user-content-raw-marker"));
    assert!(!serialized.contains("roleless-prompt-raw-marker"));
    assert!(!serialized.contains("sk-request-secret-marker"));
    assert!(!serialized.contains("data:image/png;base64,abcdefghijklmnopqrstuvwxyz"));
}

#[test]
fn redacts_signed_provider_result_urls_before_persistence() {
    let redacted = redact_provider_result_url(
        "https://cdn.example.com/result.png?token=abc&signature=sig&expires=123&X-Amz-Credential=secret&OSSAccessKeyId=id&security-token=token&authorization=Bearer%20x&safe=keep",
    );

    assert_eq!(redacted, "https://cdn.example.com/result.png?safe=keep");
}
