// Theme Painter · 改色盒子
// 基于"双色盒子"浅色版结构，使用酒馆当前 API 进行图片视觉分析

import { getContext, extension_settings } from '../../../extensions.js';
import { power_user } from '../../../power-user.js';
import { getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { oai_settings } from '../../../openai.js';

const EXT_NAME = 'theme-painter';

// ── 双色盒子浅色版基础模板 ──────────────────────────────────────────
// 颜色字段会被 AI 生成结果覆盖，其余字段保持原版默认值
const BASE_THEME = {
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
    reduced_motion: true,
    compact_input_area: true,
    show_swipe_num_all_messages: false,
    click_to_edit: false,
    media_display: 'list',
};

// 双色盒子的完整 custom_css（从浅色版提取，背景图注入在此基础上 prepend）
// 直接嵌入原版 CSS，使用模板字面量
const DUOSETBOX_CSS = `/* ---注入的背景图--- */
#bg1 {
    background-image: url('{{BG_URL}}') !important;
    background-repeat: no-repeat !important;
    background-attachment: fixed !important;
    background-size: cover !important;
    background-position: center !important;
}

/* 背景遮罩（可选）*/
{{OVERLAY_CSS}}

`;

// ── AI 分析的提示词 ────────────────────────────────────────────────
const ANALYSIS_PROMPT = `你是一位有审美品位的界面设计师。请分析这张图片，为一个以该图片为背景的页面生成完整配色方案。页面上的文字将直接浮现于图片之上，因此配色以文字可读性为首要原则，同时追求与图片的和谐统一。

请按以下步骤思考，但只输出最终 JSON，不要输出思考过程：

第一步：判断图片整体明度和对比度，决定使用深色文字还是浅色文字。
第二步：判断图片是否存在复杂纹理或强烈明暗对比，决定是否需要模糊处理（0 = 不需要，1-5 = 模糊强度递增）以及是否需要半透明遮罩来提升可读性。
第三步：从图片的色彩中提取一套内聚的配色方案。所有颜色必须来自图片本身的色调，不得凭空引入图片中不存在的色相。具体要求：
- 正文文本色：接近纯黑或纯白（取决于深浅模式），不带明显色相
- 次级文字色：在正文色基础上降低对比度，用于辅助信息
- 引用文本色：从图片中提取最具代表性的主色调，饱和度适中，用于强调
- 点缀色：从图片中挑选一个相对鲜明的色彩，用于装饰性文字
- 菜单底色：与图片主色同色系，调整为适合作为 UI 背景的浅色或深色，透明度需保证菜单文字清晰可读
- 文字阴影色：深色或浅色，用于微妙地增强文字层次感，透明度控制在 30% 以内
- 背景遮罩色：仅在图片对比度过于复杂、文字难以辨认时才使用，透明度尽量低，优先保留背景图片的视觉效果

透明度参考范围（根据图片氛围灵活判断，体现设计品味）：
- 次级文字、点缀色：清透风格 alpha 0.5-0.65，厚重风格 alpha 0.75-0.9
- 菜单底色：清透风格 alpha 0.88-0.93，厚重风格 alpha 0.93-0.97
- 文字阴影：alpha 固定 0.3
- 背景遮罩：非必要不加，需要时 alpha 0.1-0.3

只输出 JSON，不要任何解释、注释或代码块标记：
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

字段对应说明：
- name：一个英文单词或 1-2 个汉字，体现图片核心气质，如 Dusk、晨雾、深渊
- mode：light（浅色文字）或 dark（深色文字）
- blur_strength：0-5 整数
- main_text_color：正文文本，alpha 固定 1
- italics_text_color：次级文字（对应界面斜体文本），根据氛围调整 alpha
- underline_text_color：点缀色（对应界面下划线文本），从图片提取鲜明色，根据氛围调整 alpha
- quote_text_color：引用文本，图片主色调，alpha 固定 1
- blur_tint_color：菜单底色（对应界面 UI 背景），根据氛围调整 alpha
- chat_tint_color：背景遮罩（对应界面聊天背景），非必要填 rgba(0,0,0,0)
- user_mes_blur_tint_color / bot_mes_blur_tint_color / border_color：固定全透明，不要修改
- shadow_color：文字阴影色，alpha 固定 0.3
- overlay_color：CSS 层遮罩，通常为空字符串 ""，比 chat_tint_color 更激进，一般不用
`

// ── 工具函数 ──────────────────────────────────────────────────────

/** 把 rgba 字符串解析为 {r,g,b,a} */
function parseRgba(str) {
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

/** 生成背景图注入的 CSS 片段 */
function buildBgCss(imageUrl, overlayColor) {
    const overlayBlock = overlayColor
        ? `#bg1::after {\n    content: '';\n    position: fixed;\n    inset: 0;\n    background: ${overlayColor};\n    pointer-events: none;\n    z-index: 0;\n}`
        : '';

    return DUOSETBOX_CSS
        .replace('{{BG_URL}}', imageUrl)
        .replace('{{OVERLAY_CSS}}', overlayBlock);
}

/** 双色盒子 CSS（内嵌，避免网络请求失败导致丢失）*/
async function fetchBoxCss() {
    return `/*
 * 作者：KAKAA | Discord: @rech0_viixi
 * 发布社区：类脑ΟΔΥΣΣΕΙΑ（https://discord.com/channels/1134557553011998840/1340273995018141757）
 * 发布社区：旅程ΟΡΙΖΟΝΤΑΣ（https://discord.com/channels/1291925535324110879/1374963777115656214）
 * 许可协议：CC BY-NC-SA 4.0
 * 二改分享需注明原作者
 * 禁止任何形式的商用及商用目的的引流！
 */

/* ！！！---全局---！！！ */
/* 主题色配置 */
:root {
  --theme-color-1: var(--SmartThemeQuoteColor);
  /* 对应引用文本 */
  --theme-color-2: var(--SmartThemeUnderlineColor);
  /* 对应下划线 */
  --ui-color-main: var(--SmartThemeBlurTintColor);
  /* 对应UI背景 */
  --ui-color-sec: color-mix(
    in srgb,
    var(--ui-color-main) 88%,
    var(--text-color-main)
  );
  /* 自适应UI次级颜色 */
  --top-bar-color: var(--SmartThemeBorderColor);
  /* 顶栏颜色 */
  --top-bar-underline-color: var(--theme-color-1);
  /* 顶栏下边缘颜色 */
  --top-bar-icon-color: var(--text-color-main);
  /* 顶栏图标颜色 */
  --chat-background-color: var(--SmartThemeChatTintColor);
  /* 对应聊天背景 */
  --text-color-main: var(--SmartThemeBodyColor);
  /* 对应主要文本 */
  --text-color-sec: var(--SmartThemeEmColor);
  /* 对应斜体文本 */
  --user-color: var(--SmartThemeUserMesBlurTintColor);
  /* 对应用户消息模糊色调 */
  --char-color: var(--SmartThemeBotMesBlurTintColor);
  /* 对应AI消息模糊色调 */
  --code-color: var(--SmartThemeShadowColor);
  /* 对应阴影颜色 */
  --gradient-main: linear-gradient(
    135deg,
    var(--theme-color-1) 30%,
    color-mix(in srgb, var(--theme-color-1) 50%, var(--theme-color-2) 50%) 50%,
    var(--theme-color-2) 70%
  );
  /* 主题渐变 */
}

:root {
  --mes-width: 100%;
  /* 此百分比调整聊天气泡与整体聊天界面的距离 */
  --mes-block-width: 98%;
  /* 此百分比调整聊天记录文字与气泡左右边框的距离 */
  --box-border-radius: 0px;
  /* 所有盒子的圆角大小 */
  --top-distance: 0px;
  /* 顶栏与上边沿的距离 */
  --bottom-distance: 0px;
  /* 底栏与下边沿的距离 */
  --chat-send-spacing: 0px;
  /* 聊天界面与发送框的距离 */
  --leftRight-chat-spacing: 0px;
  /* 聊天界面与左右边沿的距离，电脑端专供 */
  --scroll-width: 5px;
  /* 滚动条宽度 */
  --icon-size: var(--mainFontSize);
  /* 图标大小 */
  --border-radius-small: 5px;
  --border-radius-medium: 10px;
  --spacing-long: 10px;
  --spacing-short: 5px;
  --topBarIconSize: calc(var(--icon-size) * 2);
}

/* ---标题--- */

/* 标题装饰 */
.standoutHeader strong,
#right-nav-panel h2,
.drawer-content h3.margin0,
.popup h3:not(dialog *) {
  font-size: calc(var(--mainFontSize) * 1.2);
  font-weight: 600;
  color: var(--text-color-main);
  letter-spacing: 0.1em;
  white-space: nowrap;
  line-height: 2;
}

.standoutHeader strong::before,
#right-nav-panel h2::before,
.drawer-content h3.margin0::before,
.popup h3:not(dialog *)::before {
  content: "✦";
  position: relative;
  background: var(--gradient-main);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-size: calc(var(--mainFontSize) * 1.3);
  text-shadow: none;
  padding-bottom: 0.5px;
}

@supports (-webkit-touch-callout: none) {
  .standoutHeader strong::before,
  #right-nav-panel h2::before,
  .drawer-content h3.margin0::before,
  .popup h3:not(dialog *)::before {
    font-size: calc(var(--mainFontSize) * 1.7);
  }
}

/* 增加标题下横线 */
.standoutHeader:not(h4),
#rm_PinAndTabs,
#top-settings-holder
  .drawer:not(:first-child):not(:last-child)
  .drawer-content
  .alignItemsBaseline.wide100p,
#rm_api_block .flex-container.alignItemsBaseline,
#title_api,
#AdvancedFormatting .flex-container.alignItemsBaseline:not(h3),
#WorldInfo .alignitemscenter:not(#world_popup *),
#Backgrounds .bg-header-row-1,
#user-settings-block div[name="userSettingsRowOne"],
#rm_extensions_block
  .alignitemscenter.flex-container.wide100p:not(.justifyCenter) {
  background-image: none;
  border-radius: 0;
  border: none;
  border-bottom: 1px solid var(--ui-color-sec);
  margin-bottom: calc(var(--mainFontSize) * 0.4);
  padding-bottom: calc(var(--mainFontSize) * 0.2);
}

/* 修正标题没对齐的问题 */
.drawer-content .alignItemsBaseline {
  align-items: center !important;
}

#title_api {
  padding-bottom: 0;
}

#title_api::before,
#Backgrounds h3.margin0.flex2::before,
#rm_extensions_block .margin0.flex1::before,
#rm_button_selected_ch h2::before {
  margin-right: calc(var(--mainFontSize) * 0.4);
}

/* ---抽屉--- */
/* 覆盖样式 */
.inline-drawer-header,
#extensions_settings .inline-drawer-toggle.inline-drawer-header,
#extensions_settings2 .inline-drawer-toggle.inline-drawer-header,
#top-settings-holder h4:not(#ai-config-button *):not(#rightNavHolder *) {
  border-width: 0 0 0 3px !important;
  border-color: transparent !important;
  border-style: solid;
  border-radius: 0;
  background-image: none !important;
  padding-left: 7px;
  border-image: linear-gradient(
      to bottom,
      transparent 25%,
      var(--theme-color-1) 25%,
      var(--theme-color-1) 75%,
      transparent 75%
    )
    1 100%;
}

/* 缩小箭头图标 */
.inline-drawer-icon {
  font-size: var(--icon-size);
}

/* ---滚动条--- */
::-webkit-scrollbar {
  width: var(--scroll-width);
}

::-webkit-scrollbar:horizontal {
  height: var(--scroll-width);
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb:vertical,
::-webkit-scrollbar-thumb:horizontal {
  background-color: color-mix(in srgb, var(--theme-color-1) 70%, transparent);
  box-shadow: none;
  border: 0;
}

/* ---输入框--- */
input[type="text"],
input[type="number"],
input[type="switch"],
input:not([type]),
textarea:not([type="search"]) {
  background-color: var(--ui-color-sec) !important;
  border: 1px solid var(--ui-color-sec) !important;
}

input[type="text"]:focus,
input[type="number"]:focus,
input[type="switch"]:focus,
input:not([type]):focus,
textarea:not([type="search"]):focus {
  border: 1px solid var(--theme-color-1) !important;
}

textarea[type="search"] {
  background-color: transparent !important;
  border: none !important;
}

.range-block {
  margin: calc(var(--mainFontSize) * 0.6) 0;
}

.range-block-counter {
  margin-left: 20px;
}

.text_pole:not(.objective-task) {
  background-color: var(--ui-color-sec);
  border: none;
}

/* ---按键--- */
.menu_button:not(.mes_edit_buttons *) {
  background-color: var(--ui-color-sec);
  border-color: var(--ui-color-sec);
  color: var(--text-color-main);
}

.menu_button_icon i {
  font-size: calc(var(--icon-size) * 0.8);
}

#delete_button,
#dialogue_del_mes_ok,
#dialogue_popup_ok,
#bulk_tag_popup_reset,
#bulk_tag_popup_remove_mutual,
.mes_edit_cancel.menu_button,
.menu_button.popup-button-ok,
.redWarningBG,
.red_button {
  background-color: var(--crimson70a) !important;
  color: var(--white100) !important;
}

#openai_api-presets .title_restorable.standoutHeader .flex-container.gap3px {
  align-items: center;
}

#openai_api-presets
  .title_restorable.standoutHeader
  .flex-container.gap3px
  div:not(label) {
  margin: 5px 0;
}

/* 去除阴影 */
.mes_button,
.mes_edit_buttons,
#completion_prompt_manager
  #completion_prompt_manager_list
  li.completion_prompt_manager_prompt
  span
  span
  span {
  filter: none !important;
}

.fa-solid:not(#load-spinner) {
  font-size: var(--icon-size);
  text-shadow: none !important;
}

/* ---下拉框--- */
select {
  background-color: var(--ui-color-sec) !important;
  color: var(--text-color-main);
  border: none !important;
  margin: calc(var(--mainFontSize) * 0.3) 0 !important;
}

select option:not(:checked) {
  color: var(--text-color-sec);
}

select option:checked {
  color: var(--ui-color-sec);
  background-color: var(--text-color-main) !important;
}

select option {
  background-color: var(--ui-color-sec) !important;
}

.ui-widget-content .ui-state-active {
  color: var(--theme-color-1) !important;
}

/* ---勾选框--- */
input[type="checkbox"] {
  width: calc(var(--mainFontSize) * 0.9);
  height: calc(var(--mainFontSize) * 0.9);
  border: none;
  outline: none;
  background-color: var(--ui-color-main);
  filter: none;
  box-shadow: 0 0 0 1px var(--text-color-sec);
  transform: translateY(0);
  margin-left: 1px;
}

input[type="checkbox"]::before {
  box-shadow: inset 1em 1em var(--theme-color-1);
}

input[type="checkbox"].del_checkbox {
  margin-right: 0;
}

/* ---滑动条--- */
input[type="range"] {
  box-shadow: none;
  background-color: var(--ui-color-sec) !important;
}

input[type="range"]:hover {
  background-color: color-mix(
    in srgb,
    var(--ui-color-sec) 70%,
    black 30%
  ) !important;
}

input[type="range"]::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px
    color-mix(in srgb, var(--theme-color-1) 50%, transparent);
  background-color: var(--theme-color-1);
  width: 10px;
  height: 10px;
}

.neo-range-slider {
  box-shadow: inset 0 0 0 3px rgba(0, 0, 0, 0.2) !important;
}

/* ---盒子--- */
/* 统一样式 */
#left-nav-panel,
#right-nav-panel,
#character_popup,
#dialogue_popup,
#chat,
.draggable,
#select_chat_popup,
.popup:not(.transparent_dialogue_popup),
.drawer-content {
  padding: var(--spacing-long);
  background-color: var(--ui-color-main);
  border-radius: var(--box-border-radius);
  border: none;
}

#dialogue_popup_text {
  padding: 0 var(--spacing-long) 0 0;
}

#left-nav-panel,
#right-nav-panel {
  top: var(--top-distance);
  height: 100dvh !important;
  max-height: calc(100dvh - var(--top-distance) - var(--bottom-distance) - 1px);
}

@media screen and (max-width: 1000px) {
  #left-nav-panel,
  #right-nav-panel,
  .drawer-content {
    margin-top: var(--top-distance);
  }

  #left-nav-panel,
  #right-nav-panel {
    height: calc(100dvh - 45px) !important;
    max-height: calc(100dvh - var(--topBarBlockSize)) !important;
    border-radius: 0 0 var(--border-radius-small) var(--border-radius-small);
  }
}

/* ---列表--- */
.list-group,
.options-content {
  border: none;
  border-radius: var(--border-radius-small);
  background-color: var(--ui-color-sec) !important;
}

#options {
  background-color: transparent !important;
  padding: 0;
}

/* ---图标--- */
.fa-fw:not(#qr--modal-icon) {
  width: auto;
}

/* 缩小锁定图标 */
#rm_button_characters,
#rm_button_panel_pin_div,
#lm_button_panel_pin_div,
#WI_button_panel_pin_div {
  font-size: var(--icon-size);
}

/* ---头像--- */
.avatar img,
body.big-avatars .avatar img {
  box-shadow: none;
  border: none;
}

/* ---代码块--- */
code {
  margin: 0;
  border: none;
  background-color: var(--code-color);
}

body[data-stscript-style] .hljs.language-stscript,
.hljs {
  background: var(--code-color);
}

.custom-mermaid {
  background-color: var(--code-color);
}

/* 折叠框标题 */
.standoutHeader.inline-drawer-header {
  padding: 5px 0;
}
/*
 * 作者：KAKAA | Discord: @rech0_viixi
 * 发布社区：类脑ΟΔΥΣΣΕΙΑ（https://discord.com/channels/1134557553011998840/1340273995018141757）
 * 发布社区：旅程ΟΡΙΖΟΝΤΑΣ（https://discord.com/channels/1291925535324110879/1374963777115656214）
 * 许可协议：CC BY-NC-SA 4.0
 * 二改分享需注明原作者
 * 禁止任何形式的商用及商用目的的引流！
 */

/* ！！！---局部---！！！ */

/* ---顶栏与通用扩展界面--- */
body.no-blur #top-bar,
#top-bar {
  border-radius: var(--border-radius-small) var(--border-radius-small) 0 0;
  box-shadow: none;
  background-color: transparent !important;
}

body.waifuMode #top-bar {
  border: none;
}

#top-settings-holder {
  top: var(--top-distance);
  box-shadow: 0 2px 0 0 var(--top-bar-underline-color);
}

#top-settings-holder > :first-child {
  border-radius: var(--box-border-radius) 0 0 0;
}

#top-settings-holder > :last-child {
  border-radius: 0 var(--box-border-radius) 0 0;
}

.drawer {
  color: var(--top-bar-icon-color);
  background-color: var(--top-bar-color);
}

.drawer:has(.openDrawer) {
  background-color: var(--ui-color-main);
}

.drawer-content:not(#left-nav-panel):not(#right-nav-panel) {
  border-radius: 0 0 var(--border-radius-small) var(--border-radius-small);
}

/* IOS 适配 */
@supports (-webkit-touch-callout: none) {
  .drawer-content:not(#left-nav-panel):not(#right-nav-panel) {
    max-width: 100dvw;
    top: var(--topBarBlockSize);
  }
}
/* IPAD 适配 */
@supports (-webkit-touch-callout: none) {
  @media screen and (min-width: 1000px) {
    #character_popup,
    #world_popup,
    .drawer-content {
      margin-top: 0px;
    }
    #top-settings-holder .drawer .drawer-content {
      right: 0;
      left: 0;
      width: var(--sheldWidth);
    }
    #left-nav-panel,
    #right-nav-panel {
      margin: 0 auto;
      top: calc(var(--topBarBlockSize) + var(--top-distance));
      max-height: calc(
        100dvh - var(--topBarBlockSize) - var(--bottomFormBlockSize)
      );
      border-radius: 0 0 var(--border-radius-small) var(--border-radius-small);
      border-bottom: 1px solid var(--top-bar-underline-color);
    }
  }
}

.drawer-icon {
  opacity: 0.3;
  font-size: calc(var(--icon-size) * 1.1);
  text-shadow: none !important;
}

.drawer-icon:hover,
.drawer-icon.openIcon {
  opacity: 1;
  background: var(--gradient-main);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* border-bottom在背景图库会有样式问题 */
.drawer-content {
  box-shadow: 0 2px 0 var(--top-bar-underline-color);
  border-radius: 0 0 var(--border-radius-small) var(--border-radius-small);
}

/* 抽屉小标题 */
.drawer-content h4 {
  font-weight: 600;
}

#AdvancedFormatting h3.flex-container {
  flex-wrap: nowrap;
}

/* 调整竖排间距 */
#user-settings-block-content,
#AdvancedFormatting .flex-container.spaceEvenly {
  gap: 10px;
}

/* 反代警告 */
.reverse_proxy_warning {
  border: 1px solid var(--ui-color-sec) !important;
  background-color: transparent !important;
}

/* ---聊天界面--- */
#sheld {
  top: calc(var(--topBarBlockSize) + var(--top-distance));
  height: calc(100dvh - var(--topBarBlockSize) - var(--top-distance) - 1px);
}

#chat {
  overflow-y: scroll;
  align-items: center;
  max-height: calc(100dvh - var(--topBarBlockSize) - 20px) !important;
  padding: calc(var(--scroll-width) + 4px) 0 var(--scroll-width)
    var(--scroll-width);
  border-radius: 0 0 var(--box-border-radius) var(--box-border-radius);
  background-color: var(--chat-background-color);
}

@supports (-webkit-touch-callout: none) {
  #chat {
    padding-right: var(--scroll-width);
  }
}

.mesAvatarWrapper {
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.mesAvatarWrapper .avatar {
  margin: calc(var(--mainFontSize)) 0 calc(var(--mainFontSize) * 0.4) 0;
}

.mesIDDisplay,
.mes_timer,
.tokenCounterDisplay {
  display: contents;
  color: var(--text-color-sec);
}

#chat .ch_name {
  position: relative;
  align-items: flex-end;
  padding: calc(var(--mainFontSize) * 0.8) 0;
}

#chat .ch_name::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 1px;
  background-color: var(--text-color-sec);
}

.mes {
  width: var(--mes-width);
  flex-direction: column;
  align-items: center;
  border: none !important;
  background-color: var(--ui-color-main) !important;
  margin: 0;
}

.mes_text {
  padding: calc(var(--mainFontSize) * 0.8) 0 0 0;
}

.mes_block {
  width: var(--mes-block-width);
  padding-left: 0;
}

.last_mes .mes_text {
  padding-right: 0;
}

.last_mes .mesAvatarWrapper {
  padding-bottom: 0;
}

/* 只对AI消息生效，因为用户消息不需要滑动箭头 */
div[is_user="false"].last_mes .mes_block {
  padding-bottom: 50px;
}

.last_mes .swipeRightBlock {
  margin: 0 var(--spacing-long) 0 0;
}

div[is_user="true"] {
  background-color: var(--user-color) !important;
}

div[is_user="true"] .avatar img {
  box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--theme-color-2) 60%, transparent),
    0 0 10px 2px color-mix(in srgb, var(--theme-color-1) 60%, transparent);
}

div[is_user="false"] {
  background-color: var(--char-color) !important;
}

div[is_user="false"] .avatar img {
  box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--theme-color-1) 60%, transparent),
    0 0 10px 2px color-mix(in srgb, var(--theme-color-2) 60%, transparent);
}

.swipe_left {
  left: calc(var(--scroll-width) + var(--spacing-short));
}

.swipeRightBlock {
  flex-direction: row-reverse;
  bottom: calc(var(--swipeCounterHeight) + var(--swipeCounterMargin));
}

.swipes-counter {
  margin-bottom: 4px;
}

#chat .mes.selected {
  background-color: var(--crimson70a) !important;
}

/* 文档模式 */

body.documentstyle #chat .ch_name::after {
  width: 0;
}

body.documentstyle #chat .mes .mes_block {
  margin-right: 0;
  padding-bottom: 15px;
}

body.documentstyle #chat .last_mes .mes_block {
  padding-bottom: 50px;
}

body.documentstyle #chat .last_mes {
  padding-top: var(--border-radius-medium);
}

body.documentstyle #chat .mes_text {
  margin-left: 0 !important;
}

body.documentstyle #chat .last_mes .swipe_left {
  left: var(--scroll-width);
}

/* 视觉小说模式 */
body.waifuMode #chat {
  border: none;
  box-shadow: none;
  border-radius: var(--border-radius-small);
}

body.waifuMode .zoomed_avatar {
  top: 70px;
}

/* 推理块 */
.mes_reasoning_header {
  margin: 1em 0;
  padding: 7px calc(var(--mainFontSize) + 14px) 7px
    calc(var(--mainFontSize) * 0.8);
  background: color-mix(in srgb, var(--theme-color-1) 30%, transparent);
  border: 1px solid var(--theme-color-1);
  color: var(--text-color-main);
}

.mes_reasoning_header span::before {
  content: "✦";
  position: relative;
  text-shadow: none;
  font-size: var(--mainFontSize);
  line-height: 1;
  margin-right: 3px;
}
.mes_reasoning_details .mes_reasoning_arrow {
  right: 10px;
  font-size: calc(var(--mainFontSize) * 0.7) !important;
}

.mes_reasoning {
  border-left: 2px solid var(--theme-color-1);
}

/* ---提示词管理器--- */
#left-nav-panel {
  width: calc((100vw - var(--sheldWidth)) / 2 - var(--leftRight-chat-spacing));
  padding-right: 0;
}

@supports (-webkit-touch-callout: none) {
  @media screen and (min-width: 1000px) {
    #left-nav-panel {
      padding-right: var(--spacing-long);
    }
    .fillLeft .scrollableInner {
      padding-right: 0.5em;
    }
  }
}

#range_block_openai > .range-block .toggle-description {
  margin-right: 0;
}

.range-block-title {
  text-align: left;
}

label[for="openai_image_inlining"] + div,
#openai_settings .inline-drawer-header .flex-container {
  gap: 0;
  text-align: left;
}

#openai_settings .inline-drawer-header .flex-container b {
  margin-right: 5px;
}

#completion_prompt_manager {
  width: 100%;
}

#completion_prompt_manager_list .completion_prompt_manager_list_separator {
  display: none !important;
}

#completion_prompt_manager .completion_prompt_manager_header {
  color: var(--text-color-main);
  padding: 0;
}

.completion_prompt_manager_footer {
  padding: 0 !important;
}

#completion_prompt_manager .completion_prompt_manager_header_advanced span {
  margin-left: 0;
}

#completion_prompt_manager
  #completion_prompt_manager_list
  li.completion_prompt_manager_prompt {
  border-radius: var(--border-radius-medium);
  border-color: var(--white20a);
  background-color: var(--ui-color-main);
}

#completion_prompt_manager
  #completion_prompt_manager_list
  li.completion_prompt_manager_prompt:hover,
#completion_prompt_manager
  #completion_prompt_manager_list
  li.completion_prompt_manager_prompt:focus {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: var(--theme-color-1);
  background-color: color-mix(in srgb, var(--theme-color-1) 15%, transparent);
  outline: none;
}

#completion_prompt_manager
  #completion_prompt_manager_list
  .completion_prompt_manager_prompt:not(
    .completion_prompt_manager_prompt_disabled
  )
  .prompt-manager-toggle-action {
  color: var(--theme-color-1);
}

#completion_prompt_manager
  #completion_prompt_manager_list
  .completion_prompt_manager_prompt_disabled
  .completion_prompt_manager_prompt_name
  .prompt-manager-inspect-action,
#completion_prompt_manager
  #completion_prompt_manager_list
  .completion_prompt_manager_prompt
  .completion_prompt_manager_prompt_name
  .fa-solid {
  color: color-mix(in srgb, var(--text-color-main) 30%, transparent);
}

#completion_prompt_manager > .range-block > .text_pole {
  padding: 0 15px 10px 15px;
}

#completion_prompt_manager .completion_prompt_manager_header_advanced span {
  filter: none;
}

/* ---世界书--- */
#WorldInfo {
  margin-top: var(--top-distance);
}

@supports (-webkit-touch-callout: none) {
  #world_popup {
    margin-top: 0;
    width: 100%;
  }
}

#WorldInfo .select2 {
  margin-top: 5px;
}

.world_entry {
  margin-top: var(--spacing-short);
}

.wi-card-entry {
  border: none;
}

.world_entry_form_control {
  margin: 0;
}

.select2-container .select2-selection--multiple {
  background-color: var(--ui-color-sec);
  border: none;
}

.select2-container .select2-selection--multiple .select2-selection__choice,
.select2-container .select2-selection--single .select2-selection__choice {
  background-color: color-mix(in srgb, var(--theme-color-2) 30%, transparent);
}

span.select2.select2-container .select2-selection__choice__remove,
.select2_choice_clickable_buttonstyle
  + span.select2-container
  .select2-selection__choice__display {
  color: var(--text-color-main);
  line-height: 1.5;
  background-color: transparent;
  margin: 0px;
}

.select2-container
  .select2-selection--multiple
  .select2-selection__choice__remove {
  padding: 0 5px;
}

@media screen and (max-width: 1000px) {
  .world_entry_form .inline-drawer-header {
    border-width: 0 0 0 3px !important;
    border-color: var(--theme-color-1) !important;
    border-style: solid;
    border-image: none;
  }
}

/* ---用户管理器--- */
.avatar-container.selected {
  border-color: var(--theme-color-2);
}

/* ---图库--- */
#bg-header-fixed {
  padding: 0;
}

#bg-header-fixed .flex-container.alignItemsBaseline.wide100p {
  margin-bottom: 0 !important;
}

#bg-header-title::before {
  margin-right: var(--spacing-short);
}

#Backgrounds.drawer-content.openDrawer.bg-drawer-layout {
  padding: var(--spacing-long);
}

.bg_example {
  box-shadow: none;
  border-color: var(--ui-color-sec);
}

.bg_example.selected {
  border-color: var(--theme-color-2);
}

.bg_button {
  color: var(--theme-color-1);
  filter: drop-shadow(0px 0px 2px white);
}

.bg_button:hover {
  background-color: var(--crimson70a);
}

.BGSampleTitle {
  color: #eeeeee !important;
}

/* ---用户设置--- */
#movingUIPresets {
  margin-bottom: 0 !important;
}

/* ---角色管理器--- */
#right-nav-panel {
  width: calc((100vw - var(--sheldWidth)) / 2 - var(--leftRight-chat-spacing));
}

#right-nav-panel hr:first-of-type {
  display: none;
}

#CharListButtonAndHotSwaps {
  margin-bottom: calc(var(--mainFontSize) * 0.8);
}

label[for="char-management-dropdown"] {
  width: 100%;
}

#avatar_div {
  flex-direction: column;
}

#avatar_controls {
  align-items: center;
}

.character_select,
.bogus_folder_select {
  margin-top: calc(var(--mainFontSize) * 0.8);
}

.character_select.is_fav .avatar {
  outline: 2px solid var(--theme-color-1);
}

.character_select.is_fav .ch_name {
  color: var(--theme-color-1);
}

.tag.excluded::after {
  font-size: calc(var(--icon-size) * 2);
}

.tag.actionable {
  font-size: calc(var(--icon-size) * 1);
  min-height: calc(var(--icon-size) * 2);
  min-width: calc(var(--icon-size) * 2);
}

/* 收藏区左右拖动 */
#HotSwapWrapper {
  overflow: hidden;
}

#HotSwapWrapper > div {
  overflow: auto hidden;
  flex-wrap: nowrap;
  height: calc(var(--avatar-base-height) + var(--scroll-width) + 10px);
  max-height: calc(var(--avatar-base-height) * 2);
}
body.big-avatars #HotSwapWrapper > div {
  height: calc(
    var(--avatar-base-height) * var(--big-avatar-height-factor) +
      var(--scroll-width) + 10px
  );
  max-height: calc(
    var(--avatar-base-height) * var(--big-avatar-height-factor) * 2
  );
}

#HotSwapWrapper > div::-webkit-scrollbar-thumb {
  background-color: var(--ui-color-sec);
}

/* ---底栏--- */
#form_sheld {
  margin: var(--chat-send-spacing) auto var(--bottom-distance) auto;
}

body.no-blur #send_form,
#send_form {
  background-color: color-mix(
    in srgb,
    var(--theme-color-1) 20%,
    var(--ui-color-main) 60%
  ) !important;
  border: none;
  border-radius: var(--box-border-radius);
  backdrop-filter: none;
  padding: 0 5px;
}

#send_form textarea {
  background-color: transparent !important;
  border: none !important;
}

#send_form textarea::placeholder {
  color: color(var(--text-color-sec)) !important;
}

#send_form .fa-solid {
  font-size: calc(var(--icon-size) * 1.2);
}

#leftSendForm > div:nth-child(2) {
  width: auto;
}

/* QR */
#qr--bar > .qr--buttons .qr--button,
#qr--popout > .qr--body > .qr--buttons .qr--button {
  background-color: color-mix(in srgb, var(--theme-color-1) 30%, transparent);
  border-color: var(--theme-color-1) !important;
  border-radius: var(--border-radius-small) !important;
  border-width: 0 0 0px 0 !important;
  font-size: calc(var(--mainFontSize) * 0.9);
}

#qr--bar > .qr--buttons .qr--button:hover,
#qr--popout > .qr--body > .qr--buttons .qr--button:hover {
  background-color: color-mix(
    in srgb,
    var(--theme-color-1) 50%,
    transparent
  ) !important;
}

#qr--popoutTrigger {
  background-color: transparent;
  border: none;
}

/* ---QR编辑器--- */
.popup:has(#qr--modalEditor)
  .popup-content
  > #qr--modalEditor
  > #qr--main
  > .qr--modal-messageContainer
  > #qr--modal-messageHolder
  > #qr--modal-message {
  color: var(--text-color-main) !important;
}

.popup:has(#qr--modalEditor) .popup-content #qr--modal-message::selection {
  color: var(--text-color-main) !important;
}

@supports (color: rgb(from white r g b / 0.25)) {
  .popup:has(#qr--modalEditor) .popup-content #qr--modal-message::selection {
    background-color: rgb(from var(--theme-color-1) r g b / 0.25) !important;
  }
}

/*
 * 作者：KAKAA | Discord: @rech0_viixi
 * 发布社区：类脑ΟΔΥΣΣΕΙΑ（https://discord.com/channels/1134557553011998840/1340273995018141757）
 * 发布社区：旅程ΟΡΙΖΟΝΤΑΣ（https://discord.com/channels/1291925535324110879/1374963777115656214）
 * 许可协议：CC BY-NC-SA 4.0
 * 二改分享需注明原作者
 * 禁止任何形式的商用及商用目的的引流！
 */

`;
}

/**
 * 调用 Caption 扩展的 multimodal 后端读取图片色彩（复刻 shared.js 的核心逻辑，无需 import）
 * @param {string} base64Img 带前缀的完整 data URL
 * @param {string} prompt 提示词
 * @returns {Promise<string>} 图片描述
 */
async function callMultimodalCaption(base64Img, prompt) {
    const captionSettings = extension_settings.caption;
    if (!captionSettings || captionSettings.source !== 'multimodal') {
        throw new Error('请先在扩展页面将 Image Captioning 的 Source 设置为 Multimodal');
    }

    const api = captionSettings.multimodal_api || 'openai';
    const model = captionSettings.multimodal_model || '';

    // 处理 custom model 实际名称（与 shared.js 一致）
    let resolvedModel = model;
    if (api === 'custom') {
        if (model === 'custom_current') resolvedModel = oai_settings.custom_model || '';
        if (model === 'custom_custom') resolvedModel = captionSettings.custom_model || oai_settings.custom_model || '';
    }

    const requestBody = {
        image: base64Img,
        prompt: prompt,
        reverse_proxy: '',
        proxy_password: '',
        api: api,
        model: resolvedModel,
    };

    // custom 端点需要带 server_url（与 shared.js 一致）
    if (api === 'custom') {
        requestBody.server_url = oai_settings.custom_url || '';
        requestBody.custom_include_headers = oai_settings.custom_include_headers;
        requestBody.custom_include_body = oai_settings.custom_include_body;
        requestBody.custom_exclude_body = oai_settings.custom_exclude_body;
    }

    // 根据 api 类型选择端点（与 shared.js getEndpointUrl 一致）
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
        default:
            endpoint = '/api/openai/caption-image';
    }

    const resp = await fetch(endpoint, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
        const err = await resp.text().catch(() => resp.status);
        throw new Error(`视觉 API 请求失败 (${resp.status})：${err}`);
    }

    const { caption } = await resp.json();
    return String(caption).trim();
}

/** 调用酒馆当前 API 进行视觉分析（两步：先 caption 读图，再 generateRaw 生成配色）*/
async function analyzeImageWithCurrentApi(imageUrl) {
    const context = getContext();

    // ── 第一步：把图片 URL 下载并转成 base64 data URL ──
    appendLog('<span class="tp-spinner"></span> 正在下载图片…', '', 'tp-step-1');
    let base64Data;
    try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('FileReader 失败'));
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        throw new Error(`图片下载失败：${e.message}（请确认链接可公开访问）`);
    }

    // ── 第二步：用 multimodal caption 让视觉模型描述图片色彩 ──
    appendLog('<span class="tp-spinner"></span> 正在读取图片色彩…', '', 'tp-step-2');
    let imageDescription = '';
    try {
        const colorPrompt = '请详细描述这张图片的整体色调、明暗（亮色调还是暗色调）、主要颜色（列举具体色彩名称）、色彩饱和度高低、以及整体视觉氛围风格。只关注色彩信息，不需要描述画面内容。';
        imageDescription = await callMultimodalCaption(base64Data, colorPrompt);
        console.log('[Theme Painter] 图片色彩描述：', imageDescription);
        appendLog('✓ 图片色彩读取完成', '', 'tp-step-2');
    } catch (e) {
        console.warn('[Theme Painter] 视觉分析失败，降级为纯文字模式', e);
        appendLog(`⚠ 视觉读取失败：${e.message}`, 'warn', 'tp-step-2');
    }

    // ── 第三步：把描述喂给 generateRaw 生成配色 JSON ──
    appendLog('<span class="tp-spinner"></span> 正在生成配色方案…', '', 'tp-step-3');

    if (typeof context.generateRaw !== 'function') {
        throw new Error('当前 ST 版本不支持 generateRaw，请更新 SillyTavern');
    }

    const visionContext = imageDescription
        ? `\n\n以下是视觉模型对该图片色彩的分析结果，请基于此生成配色方案：\n${imageDescription}`
        : `\n\n（图片链接：${imageUrl}，视觉分析不可用，请根据链接文件名或常识推断配色风格）`;

    const result = await context.generateRaw({
        systemPrompt: '你是一位有审美品位的界面设计师，擅长从图片色彩描述中生成配色方案。只输出 JSON，不要任何解释或代码块标记。',
        prompt: ANALYSIS_PROMPT + visionContext,
    });

    if (!result) throw new Error('模型未返回内容，请检查当前 API 是否可用');

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('模型未返回有效 JSON\n原始回复：' + result.slice(0, 300));

    return JSON.parse(jsonMatch[0]);
}

// ── 构建完整主题对象 ───────────────────────────────────────────────

async function buildThemeFromAnalysis(themeName, imageUrl, palette) {
    const blurStrength = palette.blur_strength ?? 0;
    const overlayColor = palette.overlay_color || '';

    // 读取双色盒子原版 CSS
    const boxCss = await fetchBoxCss();

    // 背景图 CSS 注入到最顶部
    const bgCssBlock = buildBgCss(imageUrl, overlayColor);
    const finalCss = bgCssBlock + (boxCss || '/* 双色盒子 CSS 未找到，请手动粘贴 */');

    return {
        ...BASE_THEME,
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

// ── 主题保存与应用（绕过未导出的 saveTheme/applyTheme）─────────────────

async function saveThemeViaApi(name, themeObj) {
    const response = await fetch('/api/themes/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(themeObj),
    });
    if (!response.ok) {
        throw new Error(`主题保存失败 (${response.status})`);
    }
    // 更新主题下拉列表
    if ($(`#themes option[value="${name}"]`).length === 0) {
        const option = document.createElement('option');
        option.value = name;
        option.innerText = name;
        option.selected = true;
        $('#themes').append(option);
    } else {
        $(`#themes option[value="${name}"]`).prop('selected', true);
    }
    power_user.theme = name;
    saveSettingsDebounced();
}


/** 把主题颜色写入 power_user 并触发 ST 的 CSS 变量更新 */
function applyThemeColors(theme) {
    const colorFields = [
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

    colorFields.forEach(([key, selector, cssVar]) => {
        if (!theme[key]) return;
        power_user[key] = theme[key];
        document.documentElement.style.setProperty(cssVar, theme[key]);
        // 触发 color picker 更新（ST 用 toolcool-color-picker 组件）
        const picker = document.querySelector(selector);
        if (picker) {
            picker.setAttribute('color', theme[key]);
        }
    });

    // custom_css（复刻 ST 的 applyCustomCSS）
    power_user.custom_css = theme.custom_css || '';
    $('#customCSS').val(power_user.custom_css);
    let styleEl = document.getElementById('custom-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.setAttribute('type', 'text/css');
        styleEl.setAttribute('id', 'custom-style');
        document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = power_user.custom_css;

    // 模糊强度
    if (theme.blur_strength !== undefined) {
        power_user.blur_strength = theme.blur_strength;
        document.documentElement.style.setProperty('--blurStrength', String(theme.blur_strength));
        $('#blur_strength_counter').val(theme.blur_strength);
        $('#blur_strength').val(theme.blur_strength);
    }

    saveSettingsDebounced();
}

// ── UI 面板 ────────────────────────────────────────────────────────

function renderPanel() {
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

            <!-- 区块一：输入 -->
            <div class="tp-section tp-input-section">
                <div class="tp-row">
                    <input id="tp-image-url" class="text_pole" type="text" placeholder="粘贴图片直链…" />
                    <button id="tp-load-preview" class="menu_button tp-icon-btn" title="载入并预览">
                        <i class="fa-solid fa-cloud-arrow-down"></i>
                    </button>
                </div>
                <button id="tp-analyze" class="menu_button tp-analyze-btn" disabled>
                    <i class="fa-solid fa-wand-magic-sparkles"></i> 分析配色
                </button>
            </div>

            <!-- 区块二：预览 + 色卡 + 日志 -->
            <div class="tp-section tp-preview-section">
                <div class="tp-preview-wrap">
                    <img id="tp-preview-img" alt="背景图预览" crossorigin="anonymous" />
                    <div id="tp-palette"></div>
                </div>
                <div id="tp-status" class="tp-status">等待输入图片链接…</div>
            </div>

            <!-- 区块三：输出 -->
            <div class="tp-section tp-output-section">
                <div class="tp-output-row">
                    <input id="tp-theme-name" class="text_pole tp-name-input" type="text" placeholder="主题名称" />
                    <button id="tp-apply" class="menu_button" disabled>
                        <i class="fa-solid fa-check"></i> 应用并保存到酒馆
                    </button>
                    <button id="tp-export-css" class="menu_button" disabled>
                        <i class="fa-solid fa-code"></i> 导出 CSS
                    </button>
                </div>
                <div id="tp-css-output-wrap">
                    <textarea id="tp-css-output" readonly></textarea>
                    <button id="tp-copy-css" class="menu_button">
                        <i class="fa-solid fa-copy"></i> 复制 CSS
                    </button>
                </div>
            </div>

        </div><!-- /tp-body -->
    </div>`;

    // 注入到主题选择器下方
    if ($('#theme-painter-panel').length === 0) {
        $('#themes').closest('.flex-container').after(html);
    }

    bindEvents();
}

// ── 配色自检 ──────────────────────────────────────────────────────

function validatePalette(palette) {
    const warnings = [];

    function parseAlpha(str) {
        if (!str) return null;
        const m = str.match(/rgba?\([^)]+,\s*([\d.]+)\)/);
        return m ? parseFloat(m[1]) : null;
    }

    function checkField(key, label) {
        if (!palette[key]) {
            warnings.push(`${label} 字段缺失，主题可能显示异常`);
            return false;
        }
        if (!/rgba?\(/.test(palette[key])) {
            warnings.push(`${label} 格式不正确`);
            return false;
        }
        return true;
    }

    // 必填字段检查
    checkField('main_text_color', '主要文本');
    checkField('quote_text_color', '引用文本');
    checkField('blur_tint_color', 'UI背景');
    checkField('shadow_color', '阴影颜色');

    // name 检查
    if (!palette.name) {
        warnings.push('主题名称未生成，请手动填写');
    }

    // blur_strength 检查
    const blur = palette.blur_strength;
    if (blur !== undefined && (blur < 0 || blur > 5 || !Number.isInteger(blur))) {
        warnings.push(`模糊强度值 ${blur} 超出范围（应为 0-5 的整数）`);
    }

    // UI背景透明度
    if (checkField('blur_tint_color', 'UI背景')) {
        const a = parseAlpha(palette.blur_tint_color);
        if (a !== null && a < 0.8) {
            warnings.push(`UI背景透明度偏低（${Math.round(a*100)}%），菜单文字可能难以辨认`);
        }
    }

    // 阴影颜色透明度
    if (palette.shadow_color) {
        const a = parseAlpha(palette.shadow_color);
        if (a !== null && a > 0.5) {
            warnings.push(`阴影颜色透明度偏高（${Math.round(a*100)}%），阴影效果可能过重`);
        }
    }

    return warnings;
}

// ── 事件绑定 ──────────────────────────────────────────────────────

let currentPalette = null;
let currentImageUrl = '';

function setStatus(msg, isError = false) {
    // 兼容旧调用：清空日志并写入一条
    clearLog();
    appendLog(msg, isError ? 'error' : '');
}

function clearLog() {
    $('#tp-status').empty();
}

function appendLog(msg, type = '', id = '') {
    const $s = $('#tp-status');
    // 如果有 id，先尝试替换已有同 id 的行
    if (id && $s.find(`[data-log-id="${id}"]`).length > 0) {
        const $existing = $s.find(`[data-log-id="${id}"]`);
        $existing.html(msg).removeClass('error warn');
        if (type === 'error') $existing.addClass('error');
        if (type === 'warn') $existing.addClass('warn');
        return;
    }
    // 追加新行前，把所有含 spinner 的行末尾 spinner 移除，保留行内文字
    $s.find('.tp-log-line').each(function() {
        const $line = $(this);
        $line.find('.tp-spinner').remove();
        // 清理多余空白
        const text = $line.html().trim();
        if (text) $line.html(text);
    });
    const $line = $('<div class="tp-log-line"></div>').html(msg);
    if (id) $line.attr('data-log-id', id);
    if (type === 'error') $line.addClass('error');
    if (type === 'warn') $line.addClass('warn');
    $s.append($line);
}

function renderSwatches(palette) {
    const fields = [
        ['main_text_color', '正文色'],
        ['italics_text_color', '次级文字'],
        ['underline_text_color', '点缀色2'],
        ['quote_text_color', '主色调'],
        ['blur_tint_color', 'UI背景'],
        ['user_mes_blur_tint_color', '用户气泡'],
        ['bot_mes_blur_tint_color', 'AI气泡'],
        ['shadow_color', '阴影/代码块'],
        ['border_color', '边框'],
    ];
    const $p = $('#tp-palette').empty();
    fields.forEach(([key, label]) => {
        if (palette[key]) {
            $p.append(`<div class="tp-swatch" style="background:${palette[key]}" title="${label}: ${palette[key]}"></div>`);
        }
    });
}

function bindEvents() {
    // 折叠/展开面板
    $('#tp-toggle').off('click').on('click', () => {
        const $body = $('#tp-body');
        const $chevron = $('#tp-chevron');
        const isOpen = $body.is(':visible');
        $body.slideToggle(200);
        $chevron.toggleClass('tp-chevron-open', !isOpen);
    });

    // 预览图片
    $('#tp-load-preview').off('click').on('click', () => {
        const url = $('#tp-image-url').val().trim();
        if (!url) return;
        currentImageUrl = url;
        const $img = $('#tp-preview-img');
        $img.attr('src', url).show();
        $img.off('load error')
            .on('load', () => {
                setStatus('图片加载成功，可以开始分析');
                $('#tp-analyze').prop('disabled', false);
            })
            .on('error', () => {
                setStatus('⚠ 图片加载失败，请检查链接', true);
            });
    });

    // 回车触发预览
    $('#tp-image-url').off('keydown').on('keydown', (e) => {
        if (e.key === 'Enter') $('#tp-load-preview').trigger('click');
    });

    // 分析配色
    $('#tp-analyze').off('click').on('click', async () => {
        const url = $('#tp-image-url').val().trim();
        if (!url) return;
        currentImageUrl = url;

        $('#tp-analyze').prop('disabled', true);
        clearLog();
        appendLog('<span class="tp-spinner"></span> 正在分析图片配色，请稍候…', '', 'tp-step-0');
        $('#tp-palette').empty();
        currentPalette = null;
        $('#tp-apply, #tp-export-css').prop('disabled', true);
        $('#tp-css-output-wrap').hide();

        try {
            const palette = await analyzeImageWithCurrentApi(url);
            currentPalette = palette;

            // 清除所有进度日志
            clearLog();
            console.log('[Theme Painter] 原始返回：', palette);

            // 自检
            const warnings = validatePalette(palette);
            if (warnings.length > 0) {
                warnings.forEach(w => appendLog(`⚠ ${w}`, 'warn'));
            }

            renderSwatches(palette);

            if (palette.name) {
                $('#tp-theme-name').val(palette.name);
            }

            const checkResult = warnings.length > 0
                ? `自检完成，共 ${warnings.length} 条提醒`
                : '✓ 自检通过';
            appendLog(checkResult, warnings.length > 0 ? 'warn' : '');

            $('#tp-apply, #tp-export-css').prop('disabled', false);
        } catch (err) {
            appendLog(`✗ ${err.message}`, 'error');
            console.error('[Theme Painter]', err);
        } finally {
            $('#tp-analyze').prop('disabled', false);
        }
    });

    // 应用到酒馆
    $('#tp-apply').off('click').on('click', async () => {
        if (!currentPalette) return;
        const name = $('#tp-theme-name').val().trim() || `底图主题_${Date.now()}`;

        try {
            appendLog('<span class="tp-spinner"></span> 正在保存主题…', '', 'saving');
            const themeObj = await buildThemeFromAnalysis(name, currentImageUrl, currentPalette);
            await saveThemeViaApi(name, themeObj);
            applyThemeColors(themeObj);
            appendLog(`✓ 主题「${name}」已保存并应用`, '', 'saving');
            toastr.success(`主题「${name}」已应用`, 'Theme Painter');
        } catch (err) {
            appendLog(`✗ 保存失败：${err.message}`, 'error', 'saving');
            console.error('[Theme Painter]', err);
        }
    });

    // 导出 CSS（点击展开/收起）
    $('#tp-export-css').off('click').on('click', async () => {
        if (!currentPalette) return;

        const $wrap = $('#tp-css-output-wrap');
        if ($wrap.is(':visible')) {
            $wrap.slideUp(150);
            return;
        }

        const blurStrength = currentPalette.blur_strength ?? 0;
        const overlayColor = currentPalette.overlay_color || '';
        const boxCss = await fetchBoxCss();
        const bgBlock = buildBgCss(currentImageUrl, overlayColor);
        const fullCss = bgBlock + (boxCss || '/* 双色盒子 CSS 未找到 */');

        $('#tp-css-output').val(fullCss);
        $wrap.slideDown(150);
    });

    // 复制 CSS
    $('#tp-copy-css').off('click').on('click', () => {
        const text = $('#tp-css-output').val();
        navigator.clipboard.writeText(text).then(() => {
            toastr.success('CSS 已复制到剪贴板', 'Theme Painter');
        }).catch(() => {
            // 降级方案
            $('#tp-css-output').select();
            document.execCommand('copy');
            toastr.success('CSS 已复制', 'Theme Painter');
        });
    });
}

// ── 初始化 ─────────────────────────────────────────────────────────

$(document).ready(() => {
    // 等待用户设置页面渲染完成后注入面板
    // ST 的设置页面在 DOM ready 后即可操作
    function tryInject() {
        if ($('#themes').length > 0) {
            renderPanel();
        } else {
            setTimeout(tryInject, 500);
        }
    }
    tryInject();
    console.log('[Theme Painter] 改色盒子已加载');
});
