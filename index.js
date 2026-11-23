// Theme Painter · 改色盒子 v2.0
// 本地 Canvas 精准取色 + AI 审美搭配，基于「双色盒子」结构生成匹配背景图的 SillyTavern 主题

import { getContext, extension_settings } from '../../../extensions.js';
import { power_user } from '../../../power-user.js';
import { getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { oai_settings } from '../../../openai.js';

import {
    parseColor,
    toHex,
    replaceRgbKeepAlpha,
    normalizeAndValidatePalette,
} from './src/color.js';
import { analyzeImagePalette } from './src/analyzer.js';
import {
    loadBoxCss,
    buildBgCss,
    buildThemeFromAnalysis,
    snapshotCurrentTheme,
    saveThemeViaApi,
    applyThemeColors,
    downloadThemeJson,
} from './src/theme.js';

const ST_DEPS = {
    getContext,
    extension_settings,
    power_user,
    getRequestHeaders,
    saveSettingsDebounced,
    oai_settings,
};

const SWATCH_FIELDS = [
    ['main_text_color', '正文色'],
    ['italics_text_color', '次级文字'],
    ['underline_text_color', '点缀色'],
    ['quote_text_color', '主色调'],
    ['blur_tint_color', 'UI背景'],
    ['chat_tint_color', '聊天底色'],
    ['shadow_color', '阴影/代码'],
];

// ── 运行时状态 ────────────────────────────────────────────────────
let currentPalette = null;
let currentImageSource = ''; // URL 或压缩后的 Data URL
let currentSourceKind = 'url'; // 'url' | 'bg' | 'local'
let previousThemeSnapshot = null;
let isPreviewing = false;
let hasPersistedChange = false;

// ── 安全日志渲染（纯 textContent，防止 HTML 注入）────────────────────

function clearLog() {
    const el = document.getElementById('tp-status');
    if (el) el.textContent = '';
}

function appendLog(msg, type = '', id = '') {
    const container = document.getElementById('tp-status');
    if (!container) return;

    const buildLineContent = (lineEl) => {
        lineEl.textContent = '';
        lineEl.className = 'tp-log-line';
        if (type === 'error') lineEl.classList.add('error');
        if (type === 'warn') lineEl.classList.add('warn');
        if (type === 'ok') lineEl.classList.add('ok');

        if (type === 'loading') {
            const spinner = document.createElement('span');
            spinner.className = 'tp-spinner';
            lineEl.appendChild(spinner);
        }
        lineEl.appendChild(document.createTextNode(msg));
    };

    if (id) {
        const existing = container.querySelector(`[data-log-id="${CSS.escape(id)}"]`);
        if (existing) {
            buildLineContent(existing);
            return;
        }
    }

    // 移除旧行的 spinner
    container.querySelectorAll('.tp-spinner').forEach(sp => sp.remove());

    const line = document.createElement('div');
    if (id) line.setAttribute('data-log-id', id);
    buildLineContent(line);
    container.appendChild(line);
}

function setStatus(msg, type = '') {
    clearLog();
    appendLog(msg, type);
}

// ── 色卡渲染与点击微调 ────────────────────────────────────────────

function renderSwatches(palette) {
    const container = document.getElementById('tp-palette');
    if (!container) return;
    container.textContent = '';

    for (const [key, label] of SWATCH_FIELDS) {
        const val = palette[key];
        if (!val) continue;
        const parsed = parseColor(val);
        if (!parsed) continue;

        const swatch = document.createElement('label');
        swatch.className = 'tp-swatch';
        swatch.style.backgroundColor = val;
        swatch.title = `${label}: ${val}（点击可微调）`;

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'tp-swatch-picker';
        picker.value = toHex(parsed);

        picker.addEventListener('input', () => {
            if (!currentPalette) return;
            const updated = replaceRgbKeepAlpha(currentPalette[key], picker.value);
            currentPalette[key] = updated;
            swatch.style.backgroundColor = updated;
            swatch.title = `${label}: ${updated}（点击可微调）`;
            // 若当前处于实时预览状态，拖动色块立即刷新页面效果
            if (isPreviewing) {
                previewCurrentPalette({ silent: true });
            }
        });

        picker.addEventListener('change', () => {
            if (!currentPalette) return;
            const { palette: next, warnings } = normalizeAndValidatePalette(currentPalette);
            currentPalette = next;
            showValidationResult(warnings, true);
        });

        swatch.appendChild(picker);
        container.appendChild(swatch);
    }
}

function showValidationResult(warnings, isManualEdit = false) {
    clearLog();
    warnings.forEach(w => appendLog(`⚠ ${w}`, 'warn'));
    const blurInfo = currentPalette ? `，模糊度 ${currentPalette.blur_strength ?? 0}` : '';
    if (warnings.length > 0) {
        appendLog(
            `${isManualEdit ? '微调后' : '自检完成'}，共 ${warnings.length} 条提醒${blurInfo}（点击色块可微调）`,
            'warn'
        );
    } else {
        appendLog(
            isManualEdit
                ? `✓ 微调后自检通过${blurInfo}`
                : `✓ 自检通过${blurInfo}（点击色块可微调）`,
            'ok'
        );
    }
}

// ── 图片载入（支持直链、当前酒馆背景、本地图片）────────────────────

function resetAnalysisState() {
    currentPalette = null;
    const paletteEl = document.getElementById('tp-palette');
    if (paletteEl) paletteEl.textContent = '';
    $('#tp-preview-theme, #tp-apply, #tp-export-json, #tp-export-css').prop('disabled', true);
    $('#tp-css-output-wrap').hide();
}

/** 仅在当前页面实时预览配色（不保存主题文件、不修改 settings.json） */
async function previewCurrentPalette({ silent = false } = {}) {
    if (!currentPalette) return;
    const name = String($('#tp-theme-name').val() || '').trim() || '临时预览';

    if (!previousThemeSnapshot) {
        previousThemeSnapshot = snapshotCurrentTheme(power_user);
    }

    const themeObj = await buildThemeFromAnalysis({
        themeName: name,
        imageUrl: currentImageSource,
        palette: currentPalette,
        powerUser: power_user,
        injectBg: true,
    });
    applyThemeColors(themeObj, ST_DEPS, { persist: false });
    isPreviewing = true;
    $('#tp-undo').show();

    if (!silent) {
        appendLog('✓ 已进入实时预览（未保存，点色块可实时微调，不满意点「还原」）', 'ok', 'saving');
    }
}

function loadPreviewImage(source, kind = 'url') {
    if (!source) return;
    currentImageSource = source;
    currentSourceKind = kind;
    resetAnalysisState();
    $('#tp-analyze').prop('disabled', true);
    setStatus('正在载入图片预览…', 'loading');

    const imgEl = document.getElementById('tp-preview-img');
    if (!imgEl) return;

    const isDataUrl = source.startsWith('data:');
    let triedWithoutCors = false;

    const onLoad = () => {
        imgEl.style.display = 'block';
        $('#tp-analyze').prop('disabled', false);
        if (triedWithoutCors) {
            setStatus('图片已载入（该外链禁止跨域取色，分析时将尝试视觉模式或降级推断）', 'warn');
        } else {
            setStatus('图片载入成功，可以开始分析配色', 'ok');
        }
    };

    const onError = () => {
        // 若是远程直链且首次带 crossorigin 失败，自动去掉 crossorigin 重试一次以便至少展示预览
        if (!isDataUrl && !triedWithoutCors) {
            triedWithoutCors = true;
            imgEl.removeAttribute('crossorigin');
            imgEl.src = source;
            return;
        }
        imgEl.style.display = 'none';
        $('#tp-analyze').prop('disabled', true);
        setStatus('图片载入失败，请检查链接是否有效或改用本地图片', 'error');
    };

    imgEl.onload = onLoad;
    imgEl.onerror = onError;

    if (isDataUrl) {
        imgEl.removeAttribute('crossorigin');
    } else {
        imgEl.setAttribute('crossorigin', 'anonymous');
    }
    imgEl.src = source;
}

/** 读取当前酒馆 #bg1 正在显示的背景图地址 */
function readCurrentStBackgroundUrl() {
    const bg1 = document.getElementById('bg1');
    if (!bg1) return null;
    const bgStyle = getComputedStyle(bg1).backgroundImage || bg1.style.backgroundImage || '';
    const match = bgStyle.match(/url\(["']?([^"')]+)["']?\)/i);
    if (!match || !match[1] || match[1] === 'none') return null;
    return match[1];
}

/** 读取本地图片文件并做适度尺寸优化，避免把超大原图直接塞进主题 CSS */
function readLocalImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('读取本地图片失败'));
        reader.onload = () => {
            const rawDataUrl = reader.result;
            // 小于 350KB 直接保留原图
            if (file.size <= 350 * 1024) {
                resolve(rawDataUrl);
                return;
            }
            const tempImg = new Image();
            tempImg.onerror = () => resolve(rawDataUrl);
            tempImg.onload = () => {
                const maxDim = 1920;
                const scale = Math.min(1, maxDim / Math.max(tempImg.naturalWidth, tempImg.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(tempImg.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(tempImg.naturalHeight * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(tempImg, 0, 0, canvas.width, canvas.height);
                // 优先导出 WebP，不支持则退回 JPEG
                let compressed = canvas.toDataURL('image/webp', 0.85);
                if (!compressed.startsWith('data:image/webp')) {
                    compressed = canvas.toDataURL('image/jpeg', 0.85);
                }
                resolve(compressed);
            };
            tempImg.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
    });
}

// ── UI 面板渲染 ───────────────────────────────────────────────────

function renderPanel() {
    if ($('#theme-painter-panel').length > 0) return;

    const html = `
    <div id="theme-painter-panel">
        <div id="tp-toggle" class="tp-toggle-header">
            <span class="tp-title-left">
                <i class="fa-solid fa-palette tp-title-icon"></i>
                <span class="tp-title-text">Theme Painter <em>· 改色盒子</em></span>
            </span>
            <i class="fa-solid fa-chevron-down tp-chevron" id="tp-chevron"></i>
        </div>

        <div id="tp-body" style="display:none">

            <!-- 区块一：图片来源与选项 -->
            <div class="tp-section tp-input-section">
                <div class="tp-row">
                    <input id="tp-image-url" class="text_pole" type="text" placeholder="粘贴图片直链…" />
                    <button id="tp-load-preview" class="menu_button tp-short-btn" title="载入直链预览">
                        <i class="fa-solid fa-cloud-arrow-down"></i> 载入
                    </button>
                </div>

                <div class="tp-source-row">
                    <button id="tp-use-current-bg" class="menu_button" title="读取酒馆当前背景图">
                        <i class="fa-solid fa-image"></i> 当前背景
                    </button>
                    <button id="tp-upload-btn" class="menu_button" title="从本地相册或文件选择图片">
                        <i class="fa-solid fa-folder-open"></i> 本地选图
                    </button>
                    <input id="tp-file-input" type="file" accept="image/*" style="display:none" />
                </div>

                <div class="tp-options-row">
                    <select id="tp-engine" class="text_pole tp-select" title="选择配色生成方式">
                        <option value="local">引擎：纯本地（免费秒出）</option>
                        <option value="vision">引擎：图片注解视觉（省主API）</option>
                        <option value="main_api">引擎：当前主 API</option>
                    </select>
                    <select id="tp-style-pref" class="text_pole tp-select" title="界面明暗风格倾向">
                        <option value="auto">明暗：自动判断</option>
                        <option value="light">明暗：浅色界面</option>
                        <option value="dark">明暗：深色界面</option>
                    </select>
                </div>

                <button id="tp-analyze" class="menu_button tp-analyze-btn" disabled>
                    <i class="fa-solid fa-wand-magic-sparkles"></i> 分析配色
                </button>
            </div>

            <!-- 区块二：预览 + 可微调色卡 + 日志 -->
            <div class="tp-section tp-preview-section">
                <div class="tp-preview-wrap">
                    <img id="tp-preview-img" alt="背景图预览" />
                    <div id="tp-palette"></div>
                </div>
                <div id="tp-status" class="tp-status">等待载入背景图…</div>
            </div>

            <!-- 区块三：预览、保存与导出 -->
            <div class="tp-section tp-output-section">
                <div class="tp-output-row">
                    <input id="tp-theme-name" class="text_pole tp-name-input" type="text" placeholder="主题名称" />
                    <button id="tp-preview-theme" class="menu_button" disabled title="先在当前页面实时预览，不保存主题文件">
                        <i class="fa-solid fa-eye"></i> 预览
                    </button>
                    <button id="tp-apply" class="menu_button" disabled title="将当前配色保存为正式主题并应用">
                        <i class="fa-solid fa-floppy-disk"></i> 保存
                    </button>
                    <button id="tp-undo" class="menu_button tp-undo-btn" style="display:none" title="恢复到预览/应用前的原主题">
                        <i class="fa-solid fa-rotate-left"></i> 还原
                    </button>
                </div>
                <div class="tp-export-row">
                    <button id="tp-export-json" class="menu_button" disabled title="导出完整主题文件，可直接导入 SillyTavern">
                        <i class="fa-solid fa-file-arrow-down"></i> 导出主题 JSON
                    </button>
                    <button id="tp-export-css" class="menu_button" disabled title="查看并复制双色盒子与背景图 CSS">
                        <i class="fa-solid fa-code"></i> 查看 CSS
                    </button>
                </div>
                <div id="tp-css-output-wrap">
                    <div class="tp-css-hint">提示：此 CSS 包含双色盒子布局与背景图；完整配色请使用「导出主题 JSON」。</div>
                    <textarea id="tp-css-output" readonly></textarea>
                    <button id="tp-copy-css" class="menu_button">
                        <i class="fa-solid fa-copy"></i> 复制 CSS
                    </button>
                </div>
            </div>

        </div>
    </div>`;

    $('#themes').closest('.flex-container').after(html);
    bindEvents();
}

// ── 事件绑定 ──────────────────────────────────────────────────────

function bindEvents() {
    // 折叠/展开面板
    $('#tp-toggle').off('click').on('click', () => {
        const $body = $('#tp-body');
        const $chevron = $('#tp-chevron');
        const isOpen = $body.is(':visible');
        $body.slideToggle(200);
        $chevron.toggleClass('tp-chevron-open', !isOpen);
    });

    // 载入直链预览
    $('#tp-load-preview').off('click').on('click', () => {
        const url = String($('#tp-image-url').val() || '').trim();
        if (!url) return;
        loadPreviewImage(url, 'url');
    });

    // 回车触发载入
    $('#tp-image-url').off('keydown').on('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('#tp-load-preview').trigger('click');
        }
    });

    // 读取酒馆当前背景图
    $('#tp-use-current-bg').off('click').on('click', () => {
        const bgUrl = readCurrentStBackgroundUrl();
        if (!bgUrl) {
            setStatus('未检测到当前酒馆背景图，请先在背景页面选择一张背景，或手动输入直链', 'warn');
            return;
        }
        $('#tp-image-url').val(bgUrl);
        loadPreviewImage(bgUrl, 'bg');
    });

    // 选择本地图片
    $('#tp-upload-btn').off('click').on('click', () => {
        $('#tp-file-input').val('').trigger('click');
    });

    $('#tp-file-input').off('change').on('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            setStatus('正在读取并优化本地图片…', 'loading');
            const dataUrl = await readLocalImageFile(file);
            $('#tp-image-url').val(`[本地图片] ${file.name}`);
            loadPreviewImage(dataUrl, 'local');
        } catch (err) {
            setStatus(err.message, 'error');
        }
    });

    // 分析配色
    $('#tp-analyze').off('click').on('click', async () => {
        if (!currentImageSource) return;

        $('#tp-analyze').prop('disabled', true);
        resetAnalysisState();
        clearLog();

        const imgEl = document.getElementById('tp-preview-img');
        const stylePreference = String($('#tp-style-pref').val() || 'auto');
        const engine = String($('#tp-engine').val() || 'local');

        try {
            const { palette, warnings } = await analyzeImagePalette({
                imageSource: currentImageSource,
                imgEl,
                stylePreference,
                engine,
                deps: ST_DEPS,
                onLog: (msg, type, id) => appendLog(msg, type, id),
            });

            currentPalette = palette;
            console.log('[Theme Painter] 生成配色：', palette);

            renderSwatches(palette);
            if (palette.name) {
                $('#tp-theme-name').val(palette.name);
            }
            showValidationResult(warnings, false);

            $('#tp-preview-theme, #tp-apply, #tp-export-json, #tp-export-css').prop('disabled', false);
        } catch (err) {
            appendLog(`✗ ${err.message}`, 'error');
            console.error('[Theme Painter]', err);
        } finally {
            $('#tp-analyze').prop('disabled', false);
        }
    });

    // 仅实时预览（不保存文件）
    $('#tp-preview-theme').off('click').on('click', async () => {
        if (!currentPalette) return;
        try {
            await previewCurrentPalette({ silent: false });
        } catch (err) {
            appendLog(`✗ 预览失败：${err.message}`, 'error', 'saving');
            console.error('[Theme Painter]', err);
        }
    });

    // 正式保存并应用到酒馆
    $('#tp-apply').off('click').on('click', async () => {
        if (!currentPalette) return;
        const name = String($('#tp-theme-name').val() || '').trim() || `改色主题_${Date.now()}`;

        try {
            if (!previousThemeSnapshot) {
                previousThemeSnapshot = snapshotCurrentTheme(power_user);
            }

            appendLog('正在保存并应用主题…', 'loading', 'saving');
            const themeObj = await buildThemeFromAnalysis({
                themeName: name,
                imageUrl: currentImageSource,
                palette: currentPalette,
                powerUser: power_user,
                injectBg: true,
            });
            await saveThemeViaApi(name, themeObj, ST_DEPS);
            applyThemeColors(themeObj, ST_DEPS, { persist: true });
            isPreviewing = false;
            hasPersistedChange = true;

            $('#tp-undo').show();
            appendLog(`✓ 主题「${name}」已保存并应用（已保留你的头像与布局设置）`, 'ok', 'saving');
            toastr.success(`主题「${name}」已保存并应用`, 'Theme Painter');
        } catch (err) {
            appendLog(`✗ 保存失败：${err.message}`, 'error', 'saving');
            console.error('[Theme Painter]', err);
        }
    });

    // 一键还原至预览/应用前的原主题
    $('#tp-undo').off('click').on('click', () => {
        if (!previousThemeSnapshot) return;
        applyThemeColors(previousThemeSnapshot, ST_DEPS, { persist: hasPersistedChange });
        const restoredName = previousThemeSnapshot.theme || '原主题';
        previousThemeSnapshot = null;
        isPreviewing = false;
        hasPersistedChange = false;
        $('#tp-undo').hide();
        appendLog(`↺ 已还原至「${restoredName}」`, 'ok', 'saving');
        toastr.info(`已还原原主题「${restoredName}」`, 'Theme Painter');
    });

    // 导出完整主题 JSON
    $('#tp-export-json').off('click').on('click', async () => {
        if (!currentPalette) return;
        const name = String($('#tp-theme-name').val() || '').trim() || 'theme-painter';
        try {
            const themeObj = await buildThemeFromAnalysis({
                themeName: name,
                imageUrl: currentImageSource,
                palette: currentPalette,
                powerUser: power_user,
                injectBg: true,
            });
            downloadThemeJson(name, themeObj);
            toastr.success('已导出完整主题 JSON 文件', 'Theme Painter');
        } catch (err) {
            appendLog(`✗ 导出失败：${err.message}`, 'error');
        }
    });

    // 展开/收起 CSS 预览
    $('#tp-export-css').off('click').on('click', async () => {
        if (!currentPalette) return;

        const $wrap = $('#tp-css-output-wrap');
        if ($wrap.is(':visible')) {
            $wrap.slideUp(150);
            return;
        }

        try {
            const boxCss = await loadBoxCss();
            const bgBlock = buildBgCss(currentImageSource, currentPalette.overlay_color || '', true);
            $('#tp-css-output').val(bgBlock + boxCss);
            $wrap.slideDown(150);
        } catch (err) {
            appendLog(`✗ 读取样式模板失败：${err.message}`, 'error');
        }
    });

    // 复制 CSS
    $('#tp-copy-css').off('click').on('click', () => {
        const text = String($('#tp-css-output').val() || '');
        navigator.clipboard.writeText(text).then(() => {
            toastr.success('CSS 已复制到剪贴板', 'Theme Painter');
        }).catch(() => {
            $('#tp-css-output').trigger('select');
            document.execCommand('copy');
            toastr.success('CSS 已复制', 'Theme Painter');
        });
    });
}

// ── 初始化（带重试上限，避免无限轮询）──────────────────────────────

$(document).ready(() => {
    let attempts = 0;
    const maxAttempts = 30;

    function tryInject() {
        if ($('#themes').length > 0) {
            renderPanel();
            console.log('[Theme Painter] 改色盒子 v2.0 已加载');
            return;
        }
        attempts++;
        if (attempts < maxAttempts) {
            setTimeout(tryInject, 500);
        } else {
            console.warn('[Theme Painter] 未找到 #themes 挂载点，停止注入');
        }
    }

    tryInject();
});
