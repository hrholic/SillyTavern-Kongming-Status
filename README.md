# 空明 · 状态栏统一美化

一个独立的 SillyTavern 前端扩展。为**能够明确识别的状态栏**套用统一的空明日 / 夜配色，保留原有内容、布局和交互。适合先小范围试用的 `0.1.0` 原型。

不需要 Extras、酒馆助手或原预设。不联网请求字体、脚本或模型服务，不上传聊天内容。

## 安装

1. 打开酒馆的「扩展」面板，选择「安装扩展」。
2. 填入仓库地址：`https://github.com/hrholic/SillyTavern-Kongming-Status`。
3. 安装完成后刷新酒馆。
4. 在扩展设置中展开「空明 · 状态栏统一美化」。

若手动安装，将本仓库放在 `public/scripts/extensions/third-party/SillyTavern-Kongming-Status/`，或酒馆当前用户的 `data/<user-handle>/extensions/` 中。插件根目录必须直接包含 `manifest.json`。

不需要导入原预设，也不需要修改角色卡。请先在一段已有聊天里试用；效果不合适可以关掉插件自身的启用开关，恢复原有显示。

## 设置

- **启用**：只处理助手消息。关闭立即移除本扩展添加的样式与标记处理。
- **配色**：跟随酒馆、空明日间、空明夜间。
- **深入配色**：默认关闭。开启会覆盖内部常见文字和底色；可能影响角色卡的特殊配色。
- **不识别名单**：填写标签名、类名或 ID，用逗号或换行隔开。例如 `special-status, my-panel`，也接受 `<special-status>`、`.my-panel`、`#my-panel`。
  - 精确匹配名称，不按模糊关键词排除。
  - 自动兼容酒馆给类名加的 `custom-` 前缀。
  - 命中后保留该容器及全部后代的原设计。
  - 为防止父级样式间接改变排除区，也不美化包住它的状态栏外框。
  - 改完后失去焦点立即生效，可点击「重新识别」。
- **额外状态栏选择器**：仅用于补充已经渲染为 HTML 容器的特殊卡片。例如 `.custom-my-panel, #custom-card`。只在当前聊天的助手消息内部查找，不会选中酒馆其他界面。排除名单与正文保护仍然优先。

## 自动识别范围

### 默认会尝试

- 名称明确的状态容器，例如 `status`、`status-bar`、`status_panel`、`character_status`、`state_bar`、`stats`，以及带相应 ID / class / data-type / data-role 的块级容器。
- 标有 `data-status` 或 `data-status-bar` 的块级容器。
- 标题明确写着「状态栏」「角色状态」「人物信息」「Status Panel」等的 `details` 折叠栏。
- 带明确状态标题的 `fieldset`、表格，或紧跟状态标题之后的表格。
- 整个段落 / div 已经显示为**独立纯文本**，并完整被已知状态标签包住的片段。例如一段可见的 `<status>心情：平静</status>`：只在显示层隐藏两端标签，内容不变；关闭插件恢复原显示。

不会因为普通正文里出现「时间」「心情」「HP」等词，就将其当作状态栏。

### 正文和隐藏内容保护

- `content` / `context` 是默认保护标签，不会作为状态栏，也不会美化其内部。
- 只读当前聊天消息的原文，识别原始正文保护区及排除标签。**不修改原文、提示词、聊天元数据或模型上下文。**
- 若酒馆已经剥掉原始标签，仅当候选状态栏的规范化显示文本能匹配到保护区外、且没有在保护区内重复出现时，才继续处理。无法可靠定位就跳过，因此有意允许漏识别。
- 数据中的 `content:` / JSON `"content"` 字段不等同于正文标签；普通 `class="content"` 也不会单独触发正文标签保护。若要排除该类名，可显式加入不识别名单。
- 不展开折叠栏，不取出隐藏内容展示，不复制隐藏源码。带 `hidden`、`aria-hidden`、隐藏样式或位于这些节点内的内容会被跳过。
- `pre` / `code`、表单控件、脚本、SVG、Canvas、iframe 不会被作为状态栏处理。

### 目前不支持的情况

- **不保证所有标签都能识别。** 酒馆默认会剥掉不少自定义 HTML 标签，类名也可能加上 `custom-`；标签在最终页面中不存在，就不能直接靠 CSS 选择器定位。
- 原始标签已消失、没有留下可识别容器或独立可见标签段落的纯文本状态栏。
- 任意 Markdown / YAML / JSON 代码块，例如 `myst` 状态块；第一版不会把代码块重新解释成面板。
- 各类 iframe 内的复杂状态页面。蓝图 TOP 等酒馆助手渲染页可能属于这种情况，第一版不跨 iframe 改色。
- 标签与正文混在同一个文本段落、未闭合标签、复杂嵌套文本标记、未知标签名，或混有 HTML / 隐藏节点的可见标签片段。
- 极强的原有 `!important`、背景图片、Shadow DOM 或其他插件反复重绘时，可能无法完全统一。

若某张卡没有被识别，优先补一个具体的额外选择器。若原始结构已经被渲染器丢弃，则需要针对那种格式增加专门适配器，不能靠“抓所有标签”的规则安全解决。

## 配色来源与实现

视觉配色参考「蓝图预设」全局美化的第一个选项 **空明（kongming）**，原预设作者署名 **@KKM**；其 TOP 模块另标注了 **@蛾摩拉、@鸦**。

- 日间：主文字 `#14161a`，强调色 `#36526a`，面板 `#f4f1ec`。
- 夜间：主文字 `#eceae6`，强调色 `#a7bfd3`，面板 `#17191d`。

本仓库代码独立编写，只参考配色，不包含原预设、原脚本、提示词、授权码或用户聊天。未复刻原预设的主题切换、动画、主脑等实现。原作品有其自己的使用与传播条件，本仓库不授予原作品的任何权利。

为可读性和轻量运行，首版采用实色底，不依赖外部字体、动画或背景模糊。它不是原「蓝图」的完整复刻。

## 开发与测试

无需构建，酒馆直接加载 `index.js`、`core.js` 和 `style.css`。

```sh
npm install
npm test
npm run test:dom
npm run test:browser
```

浏览器测试默认使用 `/usr/bin/chromium`；其他环境可设置 `CHROMIUM_PATH`。测试页位于 `tests/fixture.html`，可通过本地静态 HTTP 服务打开。

测试覆盖识别边界、排除与嵌套、正文保护、流式更新、编辑 / swipe、开关恢复、原按钮与折叠栏、可见标签处理、隐藏内容保护。具体本次验证情况见 [TESTING.md](TESTING.md)。

兼容参考：
- [SillyTavern 扩展开发文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [官方上下文 API](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js)
- [消息格式化与净化](https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js)
- [消息 class 前缀与净化钩子](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/chats.js)

此原型尚未宣称通过完整酒馆实机集成测试。不同酒馆版本、主题、预设正则和渲染扩展的组合仍需实际试用。
