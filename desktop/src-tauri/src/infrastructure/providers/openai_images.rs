use serde_json::Value;

use crate::services::model_config::validate_image_size;
use crate::services::model_gateway::ModelGatewayError;

const MULTIPART_BOUNDARY: &str = "commerce-shoot-studio-openai-images-edit";

pub struct OpenAiMultipartBody {
    pub content_type: String,
    pub body: Vec<u8>,
}

pub fn build_openai_image_edit_multipart(
    model: &str,
    input: &Value,
) -> Result<OpenAiMultipartBody, ModelGatewayError> {
    let prompt = input
        .pointer("/prompt/rolelessPrompt")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ModelGatewayError::ProviderRequestInvalid(
                "OpenAI 图生图缺少 rolelessPrompt。".to_string(),
            )
        })?;
    let images = input
        .get("userImages")
        .and_then(Value::as_array)
        .filter(|images| !images.is_empty())
        .ok_or_else(|| {
            ModelGatewayError::ProviderRequestInvalid(
                "OpenAI 图生图至少需要一张参考图。".to_string(),
            )
        })?;
    if let Some(size) = input
        .get("size")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        validate_image_size("openai", model, size).map_err(|_| {
            ModelGatewayError::ProviderRequestInvalid(
                "当前 OpenAI 模型不支持所选图片尺寸。".to_string(),
            )
        })?;
    }

    let decoded_images = images
        .iter()
        .map(|image| {
            let data_url = image
                .get("dataUrl")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid_image_input("缺少图片 data URL。"))?;
            decode_image_data_url(data_url)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let boundary = select_multipart_boundary(model, prompt, &decoded_images);

    let mut body = Vec::new();
    write_text_part(&mut body, &boundary, "model", model);
    write_text_part(&mut body, &boundary, "prompt", prompt);
    write_text_part(&mut body, &boundary, "output_format", "png");
    let size = openai_image_size(input);
    write_text_part(&mut body, &boundary, "size", &size);

    for (index, image) in decoded_images.iter().enumerate() {
        write_image_part(&mut body, &boundary, index + 1, image);
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    Ok(OpenAiMultipartBody {
        content_type: format!("multipart/form-data; boundary={boundary}"),
        body,
    })
}

struct DecodedImage {
    bytes: Vec<u8>,
    file_extension: &'static str,
    mime_type: &'static str,
}

fn decode_image_data_url(data_url: &str) -> Result<DecodedImage, ModelGatewayError> {
    let (metadata, payload) = data_url
        .strip_prefix("data:")
        .and_then(|value| value.split_once(','))
        .ok_or_else(|| invalid_image_input("图片必须是 base64 data URL。"))?;
    let (mime_type, file_extension) = match metadata {
        "image/png;base64" => ("image/png", "png"),
        "image/jpeg;base64" => ("image/jpeg", "jpg"),
        "image/webp;base64" => ("image/webp", "webp"),
        _ => return Err(invalid_image_input("仅支持 PNG、JPEG 或 WebP 图片。")),
    };

    let bytes =
        decode_base64(payload).ok_or_else(|| invalid_image_input("图片 data URL 编码无效。"))?;
    if !matches_image_mime_type(mime_type, &bytes) {
        return Err(invalid_image_input("图片内容与声明 MIME 类型不匹配。"));
    }

    Ok(DecodedImage {
        bytes,
        file_extension,
        mime_type,
    })
}

fn decode_base64(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || value.len() % 4 != 0 {
        return None;
    }

    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(value.len() / 4 * 3);
    for (chunk_index, chunk) in bytes.chunks_exact(4).enumerate() {
        let is_last_chunk = chunk_index == bytes.len() / 4 - 1;
        let a = base64_value(chunk[0])?;
        let b = base64_value(chunk[1])?;
        let c = match chunk[2] {
            b'=' if is_last_chunk && chunk[3] == b'=' => None,
            value => Some(base64_value(value)?),
        };
        let d = match chunk[3] {
            b'=' if is_last_chunk => None,
            value => Some(base64_value(value)?),
        };
        if c.is_none() && d.is_some() {
            return None;
        }

        decoded.push(a << 2 | b >> 4);
        if let Some(c) = c {
            decoded.push((b & 0x0f) << 4 | c >> 2);
            if let Some(d) = d {
                decoded.push((c & 0x03) << 6 | d);
            }
        }
    }
    Some(decoded)
}

fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn openai_image_size(input: &Value) -> String {
    if let Some(size) = input
        .get("size")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return size.to_string();
    }

    let Some((width, height)) = input
        .get("ratio")
        .and_then(Value::as_str)
        .and_then(parse_ratio)
    else {
        return "1024x1024".to_string();
    };

    if width < height {
        "1024x1536".to_string()
    } else if width > height {
        "1536x1024".to_string()
    } else {
        "1024x1024".to_string()
    }
}

fn parse_ratio(ratio: &str) -> Option<(u32, u32)> {
    let (width, height) = ratio.split_once(':')?;
    let width = width.trim().parse::<u32>().ok()?;
    let height = height.trim().parse::<u32>().ok()?;
    (width > 0 && height > 0).then_some((width, height))
}

fn matches_image_mime_type(mime_type: &str, bytes: &[u8]) -> bool {
    match mime_type {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

fn select_multipart_boundary(model: &str, prompt: &str, images: &[DecodedImage]) -> String {
    for suffix in 0_u64.. {
        let boundary = if suffix == 0 {
            MULTIPART_BOUNDARY.to_string()
        } else {
            format!("{MULTIPART_BOUNDARY}-{suffix}")
        };
        if !contains_multipart_delimiter(model.as_bytes(), &boundary)
            && !contains_multipart_delimiter(prompt.as_bytes(), &boundary)
            && images
                .iter()
                .all(|image| !contains_multipart_delimiter(&image.bytes, &boundary))
        {
            return boundary;
        }
    }
    unreachable!("boundary suffix is unbounded")
}

fn contains_multipart_delimiter(value: &[u8], boundary: &str) -> bool {
    let opening_delimiter = format!("--{boundary}");
    let line_delimiter = format!("\r\n--{boundary}");
    value.starts_with(opening_delimiter.as_bytes())
        || contains_bytes(value, line_delimiter.as_bytes())
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn write_text_part(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(value.as_bytes());
    body.extend_from_slice(b"\r\n");
}

fn write_image_part(body: &mut Vec<u8>, boundary: &str, index: usize, image: &DecodedImage) {
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"image[]\"; filename=\"image-{index}.{}\"\r\n",
            image.file_extension
        )
        .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", image.mime_type).as_bytes());
    body.extend_from_slice(&image.bytes);
    body.extend_from_slice(b"\r\n");
}

fn invalid_image_input(message: &str) -> ModelGatewayError {
    ModelGatewayError::ProviderRequestInvalid(format!("OpenAI 图生图{message}"))
}
