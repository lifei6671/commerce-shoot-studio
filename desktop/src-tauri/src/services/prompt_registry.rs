#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptTemplateId {
    ProductSellingPoints,
    ViralStyleAnalysis,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptMessage {
    pub role: &'static str,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptTemplate {
    pub id: &'static str,
    pub version: &'static str,
    pub capability_id: &'static str,
    pub system_rules: &'static [&'static str],
    pub user_task: &'static str,
    pub output_format: &'static [&'static str],
}

const PRODUCT_SELLING_POINTS_SYSTEM_RULES: &[&str] = &[
    "你是一名专业的电商商品详情页文案策划，擅长从商品图片中提取可用于淘宝、天猫、京东、抖音、小红书等平台的商品信息与销售表达。",
    "用户会上传一张或多张商品图片。请根据图片内容，识别商品类型、外观特征、设计细节、材质/工艺线索、适用人群、使用场景，以及可转化为详情页表达的核心卖点。",
    "分析原则：",
    "1. 多张图片默认视为同一件商品的不同角度、细节图、包装图或使用场景图。",
    "2. 如果多张图片中明显包含多个不同商品，请分别按“商品一、商品二、商品三”输出。",
    "3. 只基于图片中能够观察到的信息进行判断，不要编造品牌、型号、价格、认证、功效、材质成分、尺寸、容量、重量、功率等无法确认的信息。",
    "4. 如果图片中无法确认某项信息，请写“需补充”，不要猜测。",
    "5. 如果某些内容只能根据外观进行弱推断，请使用“可能”“偏向”“疑似”等克制表达。",
    "6. 如果图片中有人物、模特、背景、道具或场景，请优先识别被展示的主要商品，不要把人物或背景误判为商品。",
    "7. 核心卖点要适合电商详情页使用，表达应清晰、具体、有转化价值，但不能夸大。",
    "8. 不要使用绝对化或无法验证的表述，例如“顶级”“最强”“全网第一”“100%有效”“医用级”“官方认证”等。",
    "9. 输出使用简体中文。",
    "10. 不要输出 Markdown 表格，不要输出分析过程，不要解释你的判断逻辑。",
];

const PRODUCT_SELLING_POINTS_OUTPUT_FORMAT: &[&str] = &[
    "请严格按照以下格式输出：",
    "1、产品名称：",
    "基于图片推断一个简洁、清晰、适合电商使用的商品名称，控制在 8-18 个字。",
    "如果无法判断商品类型，返回“无法识别”。",
    "2、核心卖点：",
    "* 卖点 1：突出图片中可见的外观、造型、结构、版型、颜色、图案或设计特征。",
    "* 卖点 2：突出图片中可观察到的细节、工艺感、质感、组件、配件或品质感线索。",
    "* 卖点 3：突出该商品可转化为购买理由的利益点，例如搭配性、便携性、收纳性、舒适感、装饰性、实用性、氛围感、耐用感等。",
    "* 卖点 4：如图片信息足够，可补充一个差异化卖点；如信息不足，写“需补充”。",
    "3、适用人群：",
    "列出 2-4 类可能适用人群。要求人群描述具体，例如“日常通勤人群”“喜欢简约穿搭的女性”“租房小户型用户”“注重桌面收纳的人群”。",
    "4、使用场景：",
    "列出 2-4 个适合该商品的真实使用场景。场景应贴近电商详情页表达，例如“日常通勤”“居家收纳”“户外出行”“办公室使用”“节日送礼”“拍照搭配”“宿舍使用”等。",
    "5、规格参数：",
    "仅列出图片可观察或可合理描述的信息，不能编造具体数值。",
    "可包含但不限于以下字段：",
    "* 颜色：",
    "* 款式：",
    "* 形态：",
    "* 图案：",
    "* 外观结构：",
    "* 可见组件：",
    "* 包装信息：",
    "* 材质/工艺线索：",
    "* 尺寸/容量/重量/功率：",
    "* 其他可见信息：",
    "无法从图片确认的字段则不输出。",
];

const PRODUCT_SELLING_POINTS_PROMPT: PromptTemplate = PromptTemplate {
    id: "product-selling-points",
    version: "v1",
    capability_id: "product-selling-points",
    system_rules: PRODUCT_SELLING_POINTS_SYSTEM_RULES,
    user_task: "请根据上传图片识别商品信息。",
    output_format: PRODUCT_SELLING_POINTS_OUTPUT_FORMAT,
};

const VIRAL_STYLE_ANALYSIS_SYSTEM_RULES: &[&str] = &[
    "你是一名专业的电商视觉营销与爆款内容策划专家，擅长根据商品卖点和目标销售平台，分析适合商品详情页、主图、信息流素材和社媒种草内容的爆款视觉风格方向。",
    "请基于用户提供的目标平台和商品卖点进行分析，不要编造实时销量、榜单排名、官方认证、具体品牌数据或无法验证的平台趋势。",
    "如果商品卖点信息不足，请围绕已提供内容给出保守、可落地的视觉表达方向，不要虚构商品参数、功效、材质成分、价格或品牌背书。",
    "四个风格方向需要彼此有明显差异，分别覆盖不同的视觉调性、页面表达重点或消费心智。",
    "标题要短、明确、适合在工作台中作为风格标签使用；小标题控制在 8-15 个汉字以内，避免长句和逗号。",
    "每个风格方向只返回 2-3 个颜色，颜色必须使用 6 位 HEX 色值。",
    "输出必须是合法 JSON，不要输出 Markdown，不要使用代码块，不要输出分析过程，不要解释你的判断逻辑。",
    "输出使用简体中文。",
];

const VIRAL_STYLE_ANALYSIS_OUTPUT_FORMAT: &[&str] = &[
    "请严格按照以下 JSON 结构输出：",
    r##"{"platform":"目标平台","items":[{"id":"style-1","title":"风格标题一","subtitle":"8到15个汉字小标题","designFocus":"视觉设计重点","colors":["#111827","#F8FAFC","#2563EB"]},{"id":"style-2","title":"风格标题二","subtitle":"8到15个汉字小标题","designFocus":"视觉设计重点","colors":["#0F172A","#22C55E"]},{"id":"style-3","title":"风格标题三","subtitle":"8到15个汉字小标题","designFocus":"视觉设计重点","colors":["#1E3A8A","#E0F2FE"]},{"id":"style-4","title":"风格标题四","subtitle":"8到15个汉字小标题","designFocus":"视觉设计重点","colors":["#27272A","#F4F4F5"]}]}"##,
    "items 必须且只能包含 4 个风格方向。",
    "每个 colors 必须包含 2-3 个颜色。",
    "字段名必须保持为 platform、items、id、title、subtitle、designFocus、colors。",
];

const VIRAL_STYLE_ANALYSIS_PROMPT: PromptTemplate = PromptTemplate {
    id: "viral-style-analysis",
    version: "v1",
    capability_id: "viral-style-analysis",
    system_rules: VIRAL_STYLE_ANALYSIS_SYSTEM_RULES,
    user_task: "请根据以下信息生成爆款风格分析。\n\n目标平台：{{platform}}\n\n商品卖点：\n{{productSellingPoints}}\n\n请严格按照指定 JSON 结构输出。",
    output_format: VIRAL_STYLE_ANALYSIS_OUTPUT_FORMAT,
};

pub fn get_prompt_template(
    id: PromptTemplateId,
) -> Result<&'static PromptTemplate, PromptRegistryError> {
    match id {
        PromptTemplateId::ProductSellingPoints => Ok(&PRODUCT_SELLING_POINTS_PROMPT),
        PromptTemplateId::ViralStyleAnalysis => Ok(&VIRAL_STYLE_ANALYSIS_PROMPT),
    }
}

pub fn render_prompt_for_roles(
    id: PromptTemplateId,
) -> Result<Vec<PromptMessage>, PromptRegistryError> {
    let template = get_prompt_template(id)?;
    Ok(vec![
        PromptMessage {
            role: "system",
            content: join_sections(&[template.system_rules, template.output_format]),
        },
        PromptMessage {
            role: "user",
            content: template.user_task.to_string(),
        },
    ])
}

pub fn render_roleless_prompt(id: PromptTemplateId) -> Result<String, PromptRegistryError> {
    let template = get_prompt_template(id)?;
    Ok(format!(
        "【应用规则】\n{}\n\n【用户任务】\n{}",
        join_sections(&[template.system_rules, template.output_format]),
        template.user_task
    ))
}

fn join_sections(sections: &[&[&str]]) -> String {
    sections
        .iter()
        .flat_map(|section| section.iter().copied())
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptRegistryError {
    NotFound,
}

impl std::fmt::Display for PromptRegistryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => write!(formatter, "内置 prompt 不存在。"),
        }
    }
}

impl std::error::Error for PromptRegistryError {}
