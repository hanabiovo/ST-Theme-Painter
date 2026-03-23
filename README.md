# ST Theme Painter · 改色盒子

一个 SillyTavern 插件，输入背景图直链，用 AI 自动生成匹配该图片色彩的完整界面配色主题。

基于"双色盒子"浅色版样式，使用酒馆当前连接的视觉模型分析图片色彩，再生成配色方案并直接写入主题文件。

## 使用前提

- SillyTavern 需连接支持视觉的模型（如 Gemini、Claude、GPT-4o）
- 在扩展页面将 **Image Captioning** 的 Source 设置为 **Multimodal**，选好对应的 API 和模型

## 使用方法

1. 在酒馆用户设置页面找到 **Theme Painter · 改色盒子** 面板
2. 粘贴图片直链，点击载入
3. 点击「分析配色」，等待 AI 读取图片并生成方案
4. 确认主题名称后点击「应用并保存到酒馆」

也可以点击「导出 CSS」获取完整样式代码，手动粘贴到酒馆自定义 CSS。

## 致谢

配色主题基于 [双色盒子 by KAKAA](https://discord.com/channels/1134557553011998840/1340273995018141757)，遵循 CC BY-NC-SA 4.0 协议。
