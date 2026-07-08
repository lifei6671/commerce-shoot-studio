use commerce_shoot_studio_lib::infrastructure::providers::http_model_gateway::{
    build_model_gateway_request_body, build_model_gateway_stream_request_body,
    model_gateway_request_timeout, parse_model_gateway_sse_event,
    sanitize_model_gateway_request_for_diagnostics, HttpModelGatewayRequestConfig,
    ModelGatewaySseEvent,
};
use commerce_shoot_studio_lib::infrastructure::providers::openai_compatible::{
    normalize_openai_compatible_response, redact_provider_result_url,
};

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
    assert_eq!(body["images"][0], "data:image/jpeg;base64,reference");
    assert_eq!(body["watermark"], false);
    assert!(body["prompt"]
        .as_str()
        .expect("prompt should be a string")
        .contains("必须与参考图保持一致"));
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
fn uses_longer_timeout_for_prompt_plan_generation() {
    assert_eq!(model_gateway_request_timeout("prompt-plan").as_secs(), 300);
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
fn sanitizes_model_gateway_request_diagnostics_without_prompt_or_image_data() {
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
                        "content": "系统规则不能写入日志"
                    },
                    {
                        "role": "user",
                        "content": "用户任务不能写入日志"
                    }
                ],
                "rolelessPrompt": "完整合并 prompt 也不能写入日志"
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

    assert!(serialized.contains("\"textCharCount\""));
    assert!(serialized.contains("\"imageDataUrlLength\""));
    assert!(!serialized.contains("系统规则不能写入日志"));
    assert!(!serialized.contains("用户任务不能写入日志"));
    assert!(!serialized.contains("data:image/png;base64,abcdefghijklmnopqrstuvwxyz"));
}

#[test]
fn redacts_signed_provider_result_urls_before_persistence() {
    let redacted = redact_provider_result_url(
        "https://cdn.example.com/result.png?token=abc&signature=sig&expires=123&X-Amz-Credential=secret&OSSAccessKeyId=id&security-token=token&authorization=Bearer%20x&safe=keep",
    );

    assert_eq!(redacted, "https://cdn.example.com/result.png?safe=keep");
}
