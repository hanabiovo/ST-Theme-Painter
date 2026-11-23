// Theme Painter · 色彩解析、Canvas 像素取色与 WCAG 对比度自检

/**
 * 解析颜色字符串（支持 rgba / rgb / #hex）为 { r, g, b, a }
 * @param {string} str
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
export function parseColor(str) {
    if (typeof str !== 'string') return null;
    const s = str.trim();

    // rgba(r, g, b, a) 或 rgb(r, g, b)
    const rgbaMatch = s.match(
        /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i
    );
    if (rgbaMatch) {
        const r = clamp(Number(rgbaMatch[1]), 0, 255);
        const g = clamp(Number(rgbaMatch[2]), 0, 255);
        const b = clamp(Number(rgbaMatch[3]), 0, 255);
        const a = rgbaMatch[4] !== undefined ? clamp(parseFloat(rgbaMatch[4]), 0, 1) : 1;
        if (Number.isNaN(a)) return null;
        return { r, g, b, a };
    }

    // #RGB / #RRGGBB / #RRGGBBAA
    const hexMatch = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? round2(parseInt(hex.slice(6, 8), 16) / 255) : 1;
        return { r, g, b, a };
    }

    return null;
}

/** 格式化为标准 rgba(r, g, b, a) 字符串 */
export function toRgba(c, alphaOverride) {
    const r = Math.round(clamp(c.r, 0, 255));
    const g = Math.round(clamp(c.g, 0, 255));
    const b = Math.round(clamp(c.b, 0, 255));
    const a = round2(clamp(alphaOverride !== undefined ? alphaOverride : (c.a ?? 1), 0, 1));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 转换为 #rrggbb（忽略 alpha，供 color input 使用） */
export function toHex(c) {
    const h = n => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** 保留原色 alpha，仅替换 RGB（hex 来自 color picker） */
export function replaceRgbKeepAlpha(origStr, hexStr) {
    const orig = parseColor(origStr);
    const next = parseColor(hexStr);
    if (!next) return origStr;
    const alpha = orig ? orig.a : 1;
    return toRgba(next, alpha);
}

/** RGB 转 HSL（h: 0-360, s: 0-1, l: 0-1） */
export function rgbToHsl({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
    return { h: Math.round(h * 360), s, l };
}

/** WCAG 2.1 相对亮度（0 = 纯黑，1 = 纯白） */
export function relativeLuminance({ r, g, b }) {
    const lin = v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 将半透明前景色合成到不透明背景色上 */
export function compositeOver(fg, bg) {
    const a = fg.a ?? 1;
    return {
        r: Math.round(fg.r * a + bg.r * (1 - a)),
        g: Math.round(fg.g * a + bg.g * (1 - a)),
        b: Math.round(fg.b * a + bg.b * (1 - a)),
        a: 1,
    };
}

/** WCAG 对比度（1 ~ 21） */
export function contrastRatio(fg, bg) {
    const effectiveFg = (fg.a ?? 1) < 1 ? compositeOver(fg, bg) : fg;
    const l1 = relativeLuminance(effectiveFg);
    const l2 = relativeLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 使用离屏 Canvas 对图片进行像素采样，提取客观色彩统计信息。
 * 若图片因 CORS 受限导致画布被污染，返回 null（由调用方降级处理）。
 * @param {HTMLImageElement} imgEl
 * @returns {object | null}
 */
export function extractImageColors(imgEl) {
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return null;

    const maxDim = 120;
    const scale = Math.min(1, maxDim / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    const width = Math.max(1, Math.round(imgEl.naturalWidth * scale));
    const height = Math.max(1, Math.round(imgEl.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    try {
        ctx.drawImage(imgEl, 0, 0, width, height);
        const { data } = ctx.getImageData(0, 0, width, height);
        return analyzePixelBuffer(data);
    } catch {
        // 跨域未授权导致 canvas tainted
        return null;
    }
}

/**
 * 纯函数：从 RGBA 像素数组提取主色、点缀色、明暗度与对比度离散度
 * @param {Uint8ClampedArray | number[]} data
 */
export function analyzePixelBuffer(data) {
    const buckets = new Map();
    let totalPixels = 0;
    let sumLuma = 0;
    let sumLumaSq = 0;

    // 量化步长 24（每通道约 11 档），兼顾速度与色彩区分度
    const step = 24;

    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 128) continue;

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        sumLuma += luma;
        sumLumaSq += luma * luma;
        totalPixels++;

        const qr = Math.min(255, Math.round(r / step) * step);
        const qg = Math.min(255, Math.round(g / step) * step);
        const qb = Math.min(255, Math.round(b / step) * step);
        const key = (qr << 16) | (qg << 8) | qb;

        let entry = buckets.get(key);
        if (!entry) {
            entry = { rSum: 0, gSum: 0, bSum: 0, count: 0 };
            buckets.set(key, entry);
        }
        entry.rSum += r;
        entry.gSum += g;
        entry.bSum += b;
        entry.count++;
    }

    if (totalPixels === 0) return null;

    const avgBrightness = sumLuma / totalPixels;
    const variance = Math.max(0, sumLumaSq / totalPixels - avgBrightness * avgBrightness);
    const brightnessStdDev = Math.sqrt(variance);

    const candidates = Array.from(buckets.values()).map(b => {
        const rgb = {
            r: Math.round(b.rSum / b.count),
            g: Math.round(b.gSum / b.count),
            b: Math.round(b.bSum / b.count),
            a: 1,
        };
        const hsl = rgbToHsl(rgb);
        return {
            ...rgb,
            hex: toHex(rgb),
            ratio: b.count / totalPixels,
            saturation: hsl.s,
            lightness: hsl.l,
            hue: hsl.h,
        };
    });

    // 挑选彼此色差足够大的主色（按占比降序）
    const byFreq = [...candidates].sort((a, b) => b.ratio - a.ratio);
    const dominantColors = pickDistinctColors(byFreq, 6, 42);

    // 挑选高饱和且不过暗/过曝的点缀色候选
    const accentPool = candidates
        .filter(c => c.saturation >= 0.25 && c.lightness >= 0.18 && c.lightness <= 0.85 && c.ratio >= 0.004)
        .sort((a, b) => (b.saturation * Math.sqrt(b.ratio)) - (a.saturation * Math.sqrt(a.ratio)));
    const accentColors = pickDistinctColors(accentPool, 4, 48);

    return {
        avgBrightness: round2(avgBrightness),
        brightnessStdDev: round2(brightnessStdDev),
        suggestedMode: avgBrightness >= 0.52 ? 'light' : 'dark',
        dominantColors: dominantColors.map(formatSampleColor),
        accentColors: accentColors.map(formatSampleColor),
    };
}

function formatSampleColor(c) {
    return {
        hex: c.hex,
        rgb: `rgb(${c.r}, ${c.g}, ${c.b})`,
        r: c.r,
        g: c.g,
        b: c.b,
        hue: c.hue,
        ratio: Math.round(c.ratio * 100),
        saturation: Math.round(c.saturation * 100),
        lightness: Math.round(c.lightness * 100),
    };
}

/** HSL（h: 0-360, s: 0-1, l: 0-1）转 RGB */
export function hslToRgb(h, s, l) {
    const hn = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (hn < 60) { r = c; g = x; }
    else if (hn < 120) { r = x; g = c; }
    else if (hn < 180) { g = c; b = x; }
    else if (hn < 240) { g = x; b = c; }
    else if (hn < 300) { r = x; b = c; }
    else { r = c; b = x; }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
        a: 1,
    };
}

function hueDistance(h1, h2) {
    const d = Math.abs(h1 - h2) % 360;
    return d > 180 ? 360 - d : d;
}

/** 根据色相、饱和度和明暗模式，给离线生成的主题起一个克制的中文意境名 */
function pickLocalThemeName(hue, sat, mode) {
    if (sat < 0.12) {
        return mode === 'light' ? '素笺' : '墨影';
    }
    const isLight = mode === 'light';
    if (hue < 18 || hue >= 342) return isLight ? '绯霞' : '绛夜';
    if (hue < 45) return isLight ? '暖杏' : '琥珀';
    if (hue < 75) return isLight ? '鹅黄' : '鎏金';
    if (hue < 150) return isLight ? '竹露' : '松烟';
    if (hue < 195) return isLight ? '青岚' : '沧溟';
    if (hue < 240) return isLight ? '晴空' : '深海';
    if (hue < 285) return isLight ? '暮岚' : '星夜';
    return isLight ? '樱雾' : '紫宸';
}

/**
 * 调整 HSL 亮度直到与背景色满足目标 WCAG 对比度
 */
function ensureContrastColor(hue, sat, startLightness, bgRgb, targetRatio, preferDarker) {
    let l = clamp(startLightness, 0.08, 0.94);
    let best = hslToRgb(hue, sat, l);
    let bestRatio = contrastRatio(best, bgRgb);

    for (let step = 0; step < 24 && bestRatio < targetRatio; step++) {
        l = preferDarker ? Math.max(0.08, l - 0.03) : Math.min(0.94, l + 0.03);
        const candidate = hslToRgb(hue, sat, l);
        const ratio = contrastRatio(candidate, bgRgb);
        if (ratio > bestRatio) {
            best = candidate;
            bestRatio = ratio;
        }
    }
    return best;
}

/**
 * 纯本地算法配色引擎（零 API 消耗、自动保障 WCAG 对比度）
 * @param {object} sampleData extractImageColors 返回的采样结果
 * @param {'auto'|'light'|'dark'} stylePreference
 */
export function generateLocalPalette(sampleData, stylePreference = 'auto') {
    if (!sampleData || !sampleData.dominantColors?.length) {
        throw new Error('缺少本地像素采样数据（若使用外链且图床禁止跨域，请改用「当前背景」或「本地图」）');
    }

    const mode = stylePreference === 'auto'
        ? (sampleData.suggestedMode || 'light')
        : stylePreference;
    const isLight = mode === 'light';

    // 选主色：优先选面积较大且有一定彩度的颜色，避免整张图被大面积白/黑吞掉主色相
    const chromaticDominant = sampleData.dominantColors.find(c => c.saturation >= 14);
    const primary = chromaticDominant || sampleData.dominantColors[0];
    const h1 = primary.hue ?? 220;
    const s1 = clamp((primary.saturation ?? 20) / 100, 0, 1);

    // 选第二点缀色：优先从高饱和点缀池挑一个与主色色相拉开距离的颜色；单色图则用邻近色微偏移
    const accentCandidate = (sampleData.accentColors || []).find(c => hueDistance(c.hue, h1) >= 24)
        || sampleData.dominantColors.find(c => hueDistance(c.hue, h1) >= 24 && c.saturation >= 16)
        || (sampleData.accentColors || [])[0];
    const h2 = accentCandidate ? accentCandidate.hue : (h1 + 28) % 360;
    const s2 = accentCandidate ? clamp(accentCandidate.saturation / 100, 0.25, 0.8) : clamp(s1 + 0.12, 0.25, 0.65);

    // 1. UI 菜单底色（柔和同色系底色）
    const bgS = s1 < 0.1 ? s1 * 0.5 : clamp(s1 * 0.34, 0.06, 0.24);
    const bgL = isLight ? 0.94 : 0.13;
    const bgRgb = hslToRgb(h1, bgS, bgL);
    const blurTint = toRgba(bgRgb, isLight ? 0.92 : 0.93);

    // 2. 正文文本色（带极轻微主色相的高对比度墨色/米白）
    const textS = s1 < 0.1 ? 0.02 : clamp(s1 * 0.22, 0.05, 0.16);
    const mainTextRgb = ensureContrastColor(h1, textS, isLight ? 0.17 : 0.92, bgRgb, 7.0, isLight);
    const mainText = toRgba(mainTextRgb, 1);

    // 3. 次级/斜体文字色
    const subTextRgb = ensureContrastColor(h1, textS, isLight ? 0.36 : 0.74, bgRgb, 4.5, isLight);
    const italicsText = toRgba(subTextRgb, 0.82);

    // 4. 引用/主色调（标题星号、滚动条、高亮）
    const quoteS = s1 < 0.1 ? 0.08 : clamp(s1 * 0.9, 0.3, 0.66);
    const quoteRgb = ensureContrastColor(h1, quoteS, isLight ? 0.44 : 0.68, bgRgb, 4.2, isLight);
    const quoteText = toRgba(quoteRgb, 1);

    // 5. 点缀色（渐变另一端、下划线）
    const underS = s1 < 0.1 ? 0.1 : clamp(s2 * 0.9, 0.32, 0.72);
    const underRgb = ensureContrastColor(h2, underS, isLight ? 0.48 : 0.66, bgRgb, 3.2, isLight);
    const underlineText = toRgba(underRgb, 0.85);

    // 6. 聊天背景遮罩与模糊强度（根据画面反差离散度自动判断）
    const std = sampleData.brightnessStdDev ?? 0;
    let chatTint = 'rgba(0, 0, 0, 0)';
    let blurStrength = 0;
    if (std > 0.30) {
        chatTint = toRgba(bgRgb, 0.24);
        blurStrength = 2;
    } else if (std > 0.22) {
        chatTint = toRgba(bgRgb, 0.14);
        blurStrength = 1;
    }

    // 7. 阴影/代码块底色
    const shadowRgb = hslToRgb(h1, clamp(bgS, 0.04, 0.18), isLight ? 0.26 : 0.06);
    const shadowColor = toRgba(shadowRgb, isLight ? 0.22 : 0.3);

    return {
        name: pickLocalThemeName(h1, s1, mode),
        mode,
        blur_strength: blurStrength,
        main_text_color: mainText,
        italics_text_color: italicsText,
        underline_text_color: underlineText,
        quote_text_color: quoteText,
        blur_tint_color: blurTint,
        chat_tint_color: chatTint,
        user_mes_blur_tint_color: 'rgba(0, 0, 0, 0)',
        bot_mes_blur_tint_color: 'rgba(0, 0, 0, 0)',
        shadow_color: shadowColor,
        border_color: 'rgba(0, 0, 0, 0)',
        overlay_color: '',
    };
}

function pickDistinctColors(sortedList, limit, minDist) {
    const picked = [];
    for (const c of sortedList) {
        if (picked.length >= limit) break;
        const tooClose = picked.some(p => colorDistance(p, c) < minDist);
        if (!tooClose) picked.push(c);
    }
    return picked;
}

function colorDistance(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 规范化并自检 AI 返回的配色方案（包含格式修正与 WCAG 对比度校验）
 * @param {object} rawPalette
 * @returns {{ palette: object, warnings: string[] }}
 */
export function normalizeAndValidatePalette(rawPalette) {
    const warnings = [];
    const palette = { ...rawPalette };

    const colorFields = [
        ['main_text_color', '主要文本', true],
        ['italics_text_color', '次级文字', false],
        ['underline_text_color', '点缀色', false],
        ['quote_text_color', '引用文本', true],
        ['blur_tint_color', 'UI背景', true],
        ['chat_tint_color', '背景遮罩', false],
        ['shadow_color', '阴影颜色', true],
    ];

    const parsed = {};

    for (const [key, label, required] of colorFields) {
        const val = palette[key];
        if (!val) {
            if (required) warnings.push(`${label} 字段缺失，主题可能显示异常`);
            continue;
        }
        const c = parseColor(val);
        if (!c) {
            warnings.push(`${label} 颜色格式无法识别（${String(val).slice(0, 30)}）`);
            continue;
        }
        parsed[key] = c;
        // 统一规范为标准 rgba(...)，兼容 AI 偶尔返回 #hex 的情况
        palette[key] = toRgba(c);
    }

    // 固定全透明字段
    palette.user_mes_blur_tint_color = 'rgba(0, 0, 0, 0)';
    palette.bot_mes_blur_tint_color = 'rgba(0, 0, 0, 0)';
    palette.border_color = 'rgba(0, 0, 0, 0)';

    // overlay_color 校验
    if (palette.overlay_color) {
        const oc = parseColor(palette.overlay_color);
        if (oc) {
            palette.overlay_color = toRgba(oc);
        } else {
            warnings.push('CSS 遮罩色格式无效，已自动忽略');
            palette.overlay_color = '';
        }
    } else {
        palette.overlay_color = '';
    }

    // 主题名称检查
    if (!palette.name || typeof palette.name !== 'string') {
        warnings.push('主题名称未生成，请手动填写');
        palette.name = '';
    } else {
        palette.name = palette.name.trim();
    }

    // 模糊强度规范化
    if (palette.blur_strength !== undefined) {
        const blurNum = Number(palette.blur_strength);
        if (!Number.isFinite(blurNum) || blurNum < 0 || blurNum > 5 || !Number.isInteger(blurNum)) {
            const clamped = Math.round(clamp(Number.isFinite(blurNum) ? blurNum : 0, 0, 5));
            warnings.push(`模糊强度值 ${palette.blur_strength} 超出范围，已自动修正为 ${clamped}`);
            palette.blur_strength = clamped;
        }
    } else {
        palette.blur_strength = 0;
    }

    // UI 背景透明度检查
    if (parsed.blur_tint_color && parsed.blur_tint_color.a < 0.8) {
        warnings.push(`UI背景透明度偏低（${Math.round(parsed.blur_tint_color.a * 100)}%），菜单文字可能难以辨认`);
    }

    // 阴影透明度检查
    if (parsed.shadow_color && parsed.shadow_color.a > 0.5) {
        warnings.push(`阴影颜色透明度偏高（${Math.round(parsed.shadow_color.a * 100)}%），阴影效果可能过重`);
    }

    // WCAG 对比度检查：正文色 vs UI背景色
    if (parsed.main_text_color && parsed.blur_tint_color) {
        const ratio = contrastRatio(parsed.main_text_color, parsed.blur_tint_color);
        if (ratio < 4.5) {
            warnings.push(`正文与 UI 背景对比度偏低（${ratio.toFixed(1)}:1，建议 ≥ 4.5:1），可点击色块微调`);
        }
    }

    // WCAG 对比度检查：引用主色调 vs UI背景色
    if (parsed.quote_text_color && parsed.blur_tint_color) {
        const ratio = contrastRatio(parsed.quote_text_color, parsed.blur_tint_color);
        if (ratio < 3.0) {
            warnings.push(`主色调与 UI 背景对比度偏低（${ratio.toFixed(1)}:1，建议 ≥ 3.0:1），标题与强调文字可能偏淡`);
        }
    }

    return { palette, warnings };
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

function round2(v) {
    return Math.round(v * 100) / 100;
}
