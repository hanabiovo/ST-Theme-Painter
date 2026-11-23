// Theme Painter · 主题模板加载、构建、保存、应用与撤销恢复

// 兜底默认布局参数（仅在用户当前 power_user 中缺少对应字段时使用，绝不覆盖用户现有习惯）
export const LAYOUT_DEFAULTS = {
    blur_strength: 0,
    shadow_width: 1,
    font_scale: 0.85,
    fast_ui_mode: false,
    waifuMode: false,
    avatar_style: 0,
    chat_display: 1,
    toastr_position: 'toast-top-center',
    noShadows: false,
    chat_width: 50,
    timer_enabled: true,
    timestamps_enabled: true,
    timestamp_model_icon: true,
    mesIDDisplay_enabled: true,
    hideChatAvatars_enabled: false,
    message_token_count_enabled: true,
    expand_message_actions: false,
    enableZenSliders: false,
    enableLabMode: false,
    hotswap_enabled: true,
    bogus_folders: true,
    zoomed_avatar_magnification: '',
    reduced_motion: false,
    compact_input_area: true,
    show_swipe_num_all_messages: false,
    click_to_edit: false,
    media_display: 'list',
};

export const COLOR_FIELD_BINDINGS = [
    ['main_text_color', '#main-text-color-picker', '--SmartThemeBodyColor'],
    ['italics_text_color', '#italics-color-picker', '--SmartThemeEmColor'],
    ['underline_text_color', '#underline-color-picker', '--SmartThemeUnderlineColor'],
    ['quote_text_color', '#quote-color-picker', '--SmartThemeQuoteColor'],
    ['blur_tint_color', '#blur-tint-color-picker', '--SmartThemeBlurTintColor'],
    ['chat_tint_color', '#chat-tint-color-picker', '--SmartThemeChatTintColor'],
    ['user_mes_blur_tint_color', '#user-mes-blur-tint-color-picker', '--SmartThemeUserMesBlurTintColor'],
    ['bot_mes_blur_tint_color', '#bot-mes-blur-tint-color-picker', '--SmartThemeBotMesBlurTintColor'],
    ['shadow_color', '#shadow-color-picker', '--SmartThemeShadowColor'],
    ['border_color', '#border-color-picker', '--SmartThemeBorderColor'],
];

let cachedBoxCss = null;
const sessionSavedThemes = new Map();

/** 获取本次会话中由改色盒子保存的新主题（用于不刷新页面时来回切换兜底） */
export function getSessionSavedTheme(name) {
    return sessionSavedThemes.get(name) || null;
}

/**
 * 动态读取插件根目录的 duosetbox.css（同源静态文件）并缓存，消除 1156 行硬编码冗余
 */
export async function loadBoxCss() {
    if (cachedBoxCss !== null) return cachedBoxCss;
    const cssUrl = new URL('../duosetbox.css', import.meta.url);
    const resp = await fetch(cssUrl);
    if (!resp.ok) {
        throw new Error(`加载双色盒子样式模板失败 (${resp.status})`);
    }
    cachedBoxCss = await resp.text();
    return cachedBoxCss;
}

/** 转义 CSS url('...') 中的特殊字符 */
export function escapeCssUrl(url) {
    return String(url || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/[\r\n]/g, '');
}

/** 生成背景图与可选遮罩的 CSS 片段 */
export function buildBgCss(imageUrl, overlayColor = '', injectBg = true) {
    const parts = [];

    if (injectBg && imageUrl) {
        const safeUrl = escapeCssUrl(imageUrl);
        parts.push(`/* ---注入的背景图--- */
#bg1 {
    background-image: url('${safeUrl}') !important;
    background-repeat: no-repeat !important;
    background-attachment: fixed !important;
    background-size: cover !important;
    background-position: center !important;
}`);
    }

    if (overlayColor) {
        parts.push(`/* 背景遮罩（可选）*/
#bg1::after {
    content: '';
    position: fixed;
    inset: 0;
    background: ${overlayColor};
    pointer-events: none;
    z-index: 0;
}`);
    }

    return parts.length > 0 ? `${parts.join('\n\n')}\n\n` : '';
}

/**
 * 从当前 power_user 提取布局设置，保证保存的主题保留用户的头像、字号、宽度等习惯
 */
export function collectUserLayoutSettings(powerUser = {}) {
    const layout = {};
    for (const [key, fallback] of Object.entries(LAYOUT_DEFAULTS)) {
        layout[key] = powerUser[key] !== undefined ? powerUser[key] : fallback;
    }
    return layout;
}

/**
 * 构建完整 SillyTavern 主题对象
 */
export async function buildThemeFromAnalysis({
    themeName,
    imageUrl,
    palette,
    powerUser = {},
    injectBg = true,
    boxCssOverride = null,
}) {
    const blurStrength = palette.blur_strength ?? 0;
    const overlayColor = palette.overlay_color || '';

    const boxCss = boxCssOverride !== null ? boxCssOverride : await loadBoxCss();
    const bgCssBlock = buildBgCss(imageUrl, overlayColor, injectBg);
    const finalCss = bgCssBlock + (boxCss || '/* 双色盒子 CSS 未找到，请手动粘贴 */');

    return {
        ...collectUserLayoutSettings(powerUser),
        name: themeName,
        blur_strength: blurStrength,
        main_text_color: palette.main_text_color,
        italics_text_color: palette.italics_text_color,
        underline_text_color: palette.underline_text_color,
        quote_text_color: palette.quote_text_color,
        blur_tint_color: palette.blur_tint_color,
        chat_tint_color: palette.chat_tint_color,
        user_mes_blur_tint_color: 'rgba(0, 0, 0, 0)',
        bot_mes_blur_tint_color: 'rgba(0, 0, 0, 0)',
        shadow_color: palette.shadow_color,
        border_color: 'rgba(0, 0, 0, 0)',
        custom_css: finalCss,
    };
}

/**
 * 在应用新主题前，给当前主题拍一份快照以便一键撤销
 */
export function snapshotCurrentTheme(powerUser) {
    const snap = {
        theme: powerUser.theme,
        custom_css: powerUser.custom_css || '',
        blur_strength: powerUser.blur_strength,
    };
    for (const [key] of COLOR_FIELD_BINDINGS) {
        snap[key] = powerUser[key];
    }
    return snap;
}

/**
 * 保存主题到酒馆后端、同步更新内存主题列表与下拉框（免疫主题名中的引号/特殊字符）
 */
export async function saveThemeViaApi(name, themeObj, deps) {
    const { getRequestHeaders, power_user, saveSettingsDebounced, themesList } = deps;
    const response = await fetch('/api/themes/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(themeObj),
    });
    if (!response.ok) {
        throw new Error(`主题保存失败 (${response.status})`);
    }

    // 1. 写入插件会话缓存，确保不刷新页面切去其他主题再切回来也能生效
    sessionSavedThemes.set(name, themeObj);

    // 2. 若酒馆导出了内存 themes 数组，同步写入或更新对应项
    if (Array.isArray(themesList)) {
        const idx = themesList.findIndex(t => t && t.name === name);
        if (idx >= 0) {
            themesList[idx] = themeObj;
        } else {
            themesList.push(themeObj);
        }
    }

    // 3. 安全更新 #themes 下拉列表
    const selectEl = document.getElementById('themes');
    if (selectEl) {
        const existing = Array.from(selectEl.options).find(opt => opt.value === name);
        if (existing) {
            existing.selected = true;
        } else {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            option.selected = true;
            selectEl.appendChild(option);
        }
    }

    power_user.theme = name;
    saveSettingsDebounced();
}

/**
 * 将主题颜色、CSS 和模糊强度实时应用到当前页面
 * @param {object} theme
 * @param {object} deps
 * @param {{ persist?: boolean }} options persist=false 时仅做实时预览，不写入 power_user 与设置文件
 */
export function applyThemeColors(theme, deps, { persist = true } = {}) {
    const { power_user, saveSettingsDebounced } = deps;

    for (const [key, selector, cssVar] of COLOR_FIELD_BINDINGS) {
        if (!theme[key]) continue;
        if (persist) power_user[key] = theme[key];
        document.documentElement.style.setProperty(cssVar, theme[key]);
        const picker = document.querySelector(selector);
        if (picker) {
            picker.setAttribute('color', theme[key]);
        }
    }

    const nextCss = theme.custom_css || '';
    if (persist) power_user.custom_css = nextCss;
    const customCssInput = document.getElementById('customCSS');
    if (customCssInput) {
        customCssInput.value = nextCss;
    }

    let styleEl = document.getElementById('custom-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.setAttribute('type', 'text/css');
        styleEl.setAttribute('id', 'custom-style');
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = nextCss;

    if (theme.blur_strength !== undefined) {
        if (persist) power_user.blur_strength = theme.blur_strength;
        document.documentElement.style.setProperty('--blurStrength', String(theme.blur_strength));
        const counter = document.getElementById('blur_strength_counter');
        const slider = document.getElementById('blur_strength');
        if (counter) counter.value = theme.blur_strength;
        if (slider) slider.value = theme.blur_strength;
    }

    // 恢复下拉框选中项（用于还原/撤销时同步主题名称）
    if (persist && theme.theme) {
        const selectEl = document.getElementById('themes');
        if (selectEl) {
            const existing = Array.from(selectEl.options).find(opt => opt.value === theme.theme);
            if (existing) existing.selected = true;
        }
        power_user.theme = theme.theme;
    }

    if (persist) {
        saveSettingsDebounced();
    }
}

/**
 * 触发浏览器下载完整主题 JSON 文件（可直接导入 SillyTavern）
 */
export function downloadThemeJson(themeName, themeObj) {
    const safeFileName = (themeName || 'theme-painter').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    const blob = new Blob([JSON.stringify(themeObj, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
