// Theme Painter · 提示词构建、视觉读取、稳健 JSON 解析与配色生成

import { extractImageColors, normalizeAndValidatePalette } from './color.js';

const BASE_SYSTEM_PROMPT =
    '你是一位有审美品位的界面设计师，擅长根据图片色彩数据与氛围生成高可读性的网页配色方案。只输出严格合法的 JSON，不要输出思考过程、解释或 Markdown 代码块。';

/**
 * 构造配色生成提示词（已修正深浅模式定义，并注入 Canvas 客观取色数据）
 */
export function buildAnalysisPrompt({ sampleData, visionDescription, imageHint, stylePreference = 'auto' }) {
    const styleDirective = {
        auto: '请根据图片整体明暗度自动决定浅色界面（light）或深色界面（dark）。',
        light: '用户指定偏好【浅色界面（light）】：请使用柔和明亮的菜单底色与深色高对比度正文文字，确保文字清晰易读。',
        dark: '用户指定偏好【深色界面（dark）】：请使用沉稳深邃的菜单底色与浅色高对比度正文文字，确保文字清晰易读。',
    }[stylePreference] || '请根据图片整体明暗度自动决定浅色界面（light）或深色界面（dark）。';

    const sections = [];

    sections.push(`请为一张作为页面背景的图片生成完整的 SillyTavern「双色盒子」界面配色方案。页面文字会显示在背景图或半透明菜单底色之上，文字可读性（WCAG 对比度 ≥ 4.5:1）为首要原则，同时保持色彩与图片和谐统一。

风格偏好要求：${styleDirective}

配色设计原则：
1. 所有主题色与点缀色必须源于图片本身的色相，不得凭空引入与图片冲突的颜色。
2. 正文文本色（main_text_color）：在浅色界面中为深色（接近深灰/深炭，可带极微弱图片色调）；在深色界面中为浅色（接近浅白/米白）。alpha 固定为 1，且与菜单底色（blur_tint_color）对比度至少达到 4.5:1。
3. 次级文字色（italics_text_color）：在正文色基础上略降对比度，用于斜体和辅助信息。清透风格 alpha 0.6-0.75，厚重风格 alpha 0.75-0.9。
4. 引用文本/主色调（quote_text_color）：提取图片最具代表性的主色调，饱和度适中，alpha 固定为 1，且在菜单底色上清晰可见（对比度 ≥ 3:1）。
5. 点缀色（underline_text_color）：从图片中挑选鲜明和谐的第二色彩，用于渐变与装饰，alpha 0.65-0.9。
6. 菜单底色（blur_tint_color）：与图片主色同色系，调整为适合承载文字的浅色或深色背景，alpha 建议 0.88-0.96（清透感 0.88-0.92，厚重感 0.93-0.96）。
7. 聊天背景遮罩（chat_tint_color）：如果图片明暗反差大、纹理复杂，可给一个低透明度的柔和底色（alpha 0.12-0.32）来托住聊天文字；若画面干净柔和则填 rgba(0, 0, 0, 0)。
8. 文字阴影/代码块底色（shadow_color）：浅色或深色，alpha 固定 0.3。
9. 模糊强度（blur_strength）：0-5 整数；背景干净填 0-1，纹理复杂填 2-4。`);

    if (sampleData) {
        const dominantText = sampleData.dominantColors
            .map(c => `${c.hex} (${c.rgb}, 占比约${c.ratio}%, 饱和度${c.saturation}%, 亮度${c.lightness}%)`)
            .join('\n  - ');
        const accentText = sampleData.accentColors.length > 0
            ? sampleData.accentColors
                .map(c => `${c.hex} (${c.rgb}, 饱和度${c.saturation}%, 亮度${c.lightness}%)`)
                .join('\n  - ')
            : '（画面整体偏低饱和/中性色，可从主色中微调提纯）';

        sections.push(`【图片客观像素采样数据（最可靠参考）】
- 平均明度：${Math.round(sampleData.avgBrightness * 100)}%（建议模式：${sampleData.suggestedMode === 'light' ? 'light 浅色界面' : 'dark 深色界面'}）
- 明暗反差离散度：${Math.round(sampleData.brightnessStdDev * 100)}%（高于 25% 说明画面反差较强，建议适当增加 blur_strength 或 chat_tint_color）
- 主要色彩（按面积占比）：
  - ${dominantText}
- 候选点缀色（高饱和）：
  - ${accentText}`);
    }

    if (visionDescription) {
        sections.push(`【视觉模型氛围补充描述】\n${visionDescription}`);
    } else if (!sampleData && imageHint) {
        sections.push(`【图片参考信息】\n图片像素与视觉读取均受限，仅获取到路径/文件名：${imageHint}，请结合常见风格给出优雅克制的配色。`);
    }

    sections.push(`只输出以下格式的纯 JSON，不要任何解释、注释或代码块标记：
{
  "name": "主题名",
  "mode": "light",
  "blur_strength": 0,
  "main_text_color": "rgba(R, G, B, 1)",
  "italics_text_color": "rgba(R, G, B, A)",
  "underline_text_color": "rgba(R, G, B, A)",
  "quote_text_color": "rgba(R, G, B, 1)",
  "blur_tint_color": "rgba(R, G, B, A)",
  "chat_tint_color": "rgba(R, G, B, A)",
  "user_mes_blur_tint_color": "rgba(0, 0, 0, 0)",
  "bot_mes_blur_tint_color": "rgba(0, 0, 0, 0)",
  "shadow_color": "rgba(R, G, B, 0.3)",
  "border_color": "rgba(0, 0, 0, 0)",
  "overlay_color": ""
}

字段说明：
- name：1-2 个汉字或 1 个英文词，凝练体现画面气质（如 晨雾、暮雪、Dusk、Moss）
- mode：light（浅色界面·深色文字）或 dark（深色界面·浅色文字）
- user_mes_blur_tint_color / bot_mes_blur_tint_color / border_color：固定 rgba(0, 0, 0, 0)
- overlay_color：通常为空字符串 ""，仅在画面极度杂乱时填极低透明度 rgba`);

    return sections.join('\n\n');
}

/**
 * 稳健地从模型输出中提取 JSON 对象（兼容思维链 <think> 标签、Markdown 代码块及多余说明文字）
 * @param {string} rawText
 * @returns {object}
 */
export function extractJsonFromText(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim()) {
        throw new Error('模型未返回有效文本');
    }

    // 1. 移除常见思考过程标签
    let cleaned = rawText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .trim();

    // 2. 若包含 ```json ... ``` 或 ``` ... ``` 代码块，优先尝试解析块内内容
    const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let fenceMatch;
    while ((fenceMatch = fenceRegex.exec(cleaned)) !== null) {
        const candidate = tryParseJsonObject(fenceMatch[1].trim());
        if (candidate && isLikelyPalette(candidate)) return candidate;
    }

    // 3. 直接尝试整段解析
    const direct = tryParseJsonObject(cleaned);
    if (direct) return direct;

    // 4. 按花括号平衡扫描所有顶层 JSON 对象，避免贪婪正则被前缀/后缀中的花括号干扰
    const candidates = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start !== -1) {
                    const slice = cleaned.slice(start, i + 1);
                    const parsed = tryParseJsonObject(slice);
                    if (parsed) candidates.push(parsed);
                    start = -1;
                }
            }
        }
    }

    const paletteCandidate = candidates.find(isLikelyPalette) || candidates[candidates.length - 1];
    if (paletteCandidate) return paletteCandidate;

    throw new Error(`模型未返回有效 JSON（原始片段：${cleaned.slice(0, 200)}）`);
}

function tryParseJsonObject(str) {
    try {
        const obj = JSON.parse(str);
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch {
        return null;
    }
}

function isLikelyPalette(obj) {
    return Boolean(obj.main_text_color || obj.blur_tint_color || obj.quote_text_color);
}

/**
 * 将图片转为适合上传给视觉 API 的压缩 Base64 Data URL
 */
export async function imageToBase64(imageSource, imgEl) {
    if (typeof imageSource === 'string' && imageSource.startsWith('data:image/')) {
        return imageSource;
    }

    // 优先尝试从已加载的 imgEl 通过 Canvas 压缩导出（免去二次下载，且控制体积）
    if (imgEl && imgEl.naturalWidth > 0) {
        try {
            const maxDim = 1024;
            const scale = Math.min(1, maxDim / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(imgEl.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(imgEl.naturalHeight * scale));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.85);
        } catch {
            // canvas 被跨域污染，继续走 fetch
        }
    }

    const resp = await fetch(imageSource);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(blob);
    });
}

/**
 * 调用酒馆 Image Captioning 的 Multimodal 后端读取图片氛围与色彩描述
 */
export async function callMultimodalCaption(base64Img, prompt, deps) {
    const { extension_settings, oai_settings, getRequestHeaders } = deps;
    const captionSettings = extension_settings?.caption;
    if (!captionSettings || captionSettings.source !== 'multimodal') {
        throw new Error('未在扩展页面将 Image Captioning 设为 Multimodal');
    }

    const api = captionSettings.multimodal_api || 'openai';
    const model = captionSettings.multimodal_model || '';

    let resolvedModel = model;
    if (api === 'custom') {
        if (model === 'custom_current') resolvedModel = oai_settings?.custom_model || '';
        if (model === 'custom_custom') {
            resolvedModel = captionSettings.custom_model || oai_settings?.custom_model || '';
        }
    }

    // 保留用户的反代设置，避免反代用户请求失败
    const requestBody = {
        image: base64Img,
        prompt,
        reverse_proxy: oai_settings?.reverse_proxy || '',
        proxy_password: oai_settings?.proxy_password || '',
        api,
        model: resolvedModel,
    };

    if (api === 'custom') {
        requestBody.server_url = oai_settings?.custom_url || '';
        requestBody.custom_include_headers = oai_settings?.custom_include_headers;
        requestBody.custom_include_body = oai_settings?.custom_include_body;
        requestBody.custom_exclude_body = oai_settings?.custom_exclude_body;
    }

    let endpoint;
    switch (api) {
        case 'google':
        case 'vertexai':
            endpoint = '/api/google/caption-image';
            break;
        case 'anthropic':
            endpoint = '/api/anthropic/caption-image';
            break;
        case 'ollama':
            endpoint = '/api/backends/text-completions/ollama/caption-image';
            break;
        case 'cohere':
            endpoint = '/api/cohere/caption-image';
            break;
        default:
            endpoint = '/api/openai/caption-image';
    }

    const resp = await fetch(endpoint, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
        const err = await resp.text().catch(() => String(resp.status));
        throw new Error(`视觉 API 请求失败 (${resp.status})：${err.slice(0, 120)}`);
    }

    const data = await resp.json();
    return String(data?.caption || '').trim();
}

/**
 * 完整分析流程：Canvas 像素取色 -> 可选视觉氛围补充 -> generateRaw 生成配色 -> 规范化与自检
 */
export async function analyzeImagePalette({
    imageSource,
    imgEl,
    stylePreference = 'auto',
    useVision = false,
    deps,
    onLog = () => {},
}) {
    const context = deps.getContext();
    if (typeof context?.generateRaw !== 'function') {
        throw new Error('当前 SillyTavern 版本不支持 generateRaw，请更新酒馆');
    }

    // 第一步：Canvas 本地精准取色（零网络开销、无 API 依赖）
    onLog('正在采样图片像素色彩…', 'loading', 'step-canvas');
    const sampleData = extractImageColors(imgEl);
    if (sampleData) {
        const hexPreview = sampleData.dominantColors.slice(0, 4).map(c => c.hex).join(' ');
        onLog(`✓ 像素取色完成（明度 ${Math.round(sampleData.avgBrightness * 100)}%，主色 ${hexPreview}）`, 'ok', 'step-canvas');
    } else {
        onLog('⚠ 外链图床限制跨域读取，跳过本地像素采样', 'warn', 'step-canvas');
    }

    // 第二步：视觉模型氛围识别（用户勾选，或本地取色受 CORS 阻断时自动尝试兜底）
    let visionDescription = '';
    const shouldTryVision = useVision || !sampleData;
    if (shouldTryVision) {
        const captionConfigured = deps.extension_settings?.caption?.source === 'multimodal';
        if (!useVision && !captionConfigured) {
            onLog('提示：若想获得更精准取色，建议使用「当前背景」或「本地图片」', 'warn', 'step-vision');
        } else {
            onLog('正在调用视觉模型识别画面氛围…', 'loading', 'step-vision');
            try {
                const base64 = await imageToBase64(imageSource, imgEl);
                const visionPrompt =
                    '请简洁描述这张图片的视觉氛围、光线明暗、色彩情绪以及适合起什么 1-2 字的中文意境主题名。不要输出多余寒暄。';
                visionDescription = await callMultimodalCaption(base64, visionPrompt, deps);
                onLog('✓ 视觉氛围识别完成', 'ok', 'step-vision');
            } catch (err) {
                console.warn('[Theme Painter] 视觉识别跳过：', err);
                onLog(`⚠ 视觉识别跳过（${err.message}），继续使用已有信息生成`, 'warn', 'step-vision');
            }
        }
    }

    // 第三步：调用当前聊天模型生成配色 JSON
    onLog('正在生成配色方案…', 'loading', 'step-gen');
    const prompt = buildAnalysisPrompt({
        sampleData,
        visionDescription,
        imageHint: imageSource?.startsWith('data:') ? '本地上传图片' : imageSource,
        stylePreference,
    });

    const result = await context.generateRaw({
        systemPrompt: BASE_SYSTEM_PROMPT,
        prompt,
    });

    if (!result) {
        throw new Error('模型未返回内容，请检查当前 API 连接是否正常');
    }

    const rawPalette = extractJsonFromText(result);
    const { palette, warnings } = normalizeAndValidatePalette(rawPalette);
    onLog('✓ 配色方案生成完成', 'ok', 'step-gen');

    return { palette, warnings, sampleData };
}
