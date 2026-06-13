/*
 * ============================================================
 *  Image Prompt Extractor (图像提示词提取器)
 *  SillyTavern 第三方扩展  v1.1.0
 *
 *  功能：从 RP 正文提取场景，通过独立 API 生成 image### 标签，
 *        注入正文消息供生图插件读取。主 API 不感知此过程。
 *
 *  入口位置可在设置中切换：
 *    - topbar   顶部导航栏按钮（手机推荐）
 *    - ball     右下角悬浮球
 *    - sidebar  扩展面板内嵌区域
 * ============================================================
 */

import { extension_settings, getContext } from "../../../extensions.js";
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    saveChatConditional,
} from "../../../../script.js";

/* ────────────────────────────────────────────
   常量与默认设置
   ──────────────────────────────────────────── */

const EXT_NAME = "image-prompt-extractor";

const DEFAULT_SETTINGS = {
    enabled: true,
    entryMode: "topbar",   // "topbar" | "ball" | "sidebar"
    apiEndpoint: "",
    apiKey: "",
    model: "",
    systemPrompt: "",
    baseTemplate: "",
    characterAnchors: "",
    extractionRules: "",
};

/* ────────────────────────────────────────────
   运行时状态
   ──────────────────────────────────────────── */

let currentDescription = "";
let currentMessageIndex = -1;
let isProcessing = false;

/* ────────────────────────────────────────────
   设置管理
   ──────────────────────────────────────────── */

function loadSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[EXT_NAME][key] === undefined) {
            extension_settings[EXT_NAME][key] = val;
        }
    }
}

function s() {
    return extension_settings[EXT_NAME];
}

function save(key, value) {
    extension_settings[EXT_NAME][key] = value;
    saveSettingsDebounced();
}

/* ────────────────────────────────────────────
   工具函数
   ──────────────────────────────────────────── */

function esc(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function q(sel) {
    return document.querySelector(sel);
}

/* ────────────────────────────────────────────
   面板 HTML
   ──────────────────────────────────────────── */

function buildPanelHTML() {
    const c = s();
    return `
    <div class="ipe-panel-header">
        <span class="ipe-panel-title">🎨 图像提示词提取器</span>
        <label class="ipe-toggle">
            <input type="checkbox" id="ipe-enabled" ${c.enabled ? "checked" : ""}>
            <span class="ipe-toggle-slider"></span>
        </label>
    </div>
    <div class="ipe-sections">

        ${section("entry-mode", "入口位置", `
            <div class="ipe-radio-group">
                <label class="ipe-radio-label">
                    <input type="radio" name="ipe-entry" value="topbar" ${c.entryMode === "topbar" ? "checked" : ""}>
                    <span>顶部导航栏按钮 <small>（手机推荐）</small></span>
                </label>
                <label class="ipe-radio-label">
                    <input type="radio" name="ipe-entry" value="ball" ${c.entryMode === "ball" ? "checked" : ""}>
                    <span>右下角悬浮球</span>
                </label>
                <label class="ipe-radio-label">
                    <input type="radio" name="ipe-entry" value="sidebar" ${c.entryMode === "sidebar" ? "checked" : ""}>
                    <span>扩展面板内嵌</span>
                </label>
            </div>
            <div class="ipe-hint">切换后立即生效，无需刷新页面</div>
        `, false)}

        ${section("api-config", "API 配置", `
            <label>API 地址
                <input type="text" id="ipe-api-endpoint"
                       value="${esc(c.apiEndpoint)}"
                       placeholder="https://api.openai.com/v1/chat/completions">
            </label>
            <label>API 密钥
                <input type="password" id="ipe-api-key"
                       value="${esc(c.apiKey)}"
                       placeholder="sk-...">
            </label>
            <label>模型
                <input type="text" id="ipe-model"
                       value="${esc(c.model)}"
                       placeholder="gpt-4o-mini">
            </label>
        `)}

        ${section("system-prompt", "系统提示", `
            <textarea id="ipe-system-prompt" rows="5"
                placeholder="你是一个专精中文文学场景视觉化的提示词专家…"
            >${esc(c.systemPrompt)}</textarea>
        `)}

        ${section("base-template", "基础模板", `
            <textarea id="ipe-base-template" rows="6"
                placeholder="image###Premium otome game CG illustration...{Description}...###"
            >${esc(c.baseTemplate)}</textarea>
            <div class="ipe-hint">用 {Description} 标记描述文本的插入位置</div>
        `)}

        ${section("char-anchors", "角色锚点", `
            <textarea id="ipe-char-anchors" rows="5"
                placeholder="陆冀北：a man, early 30s, tall with broad shoulders, deep-set eyes…"
            >${esc(c.characterAnchors)}</textarea>
        `)}

        ${section("extract-rules", "提取规则", `
            <textarea id="ipe-extract-rules" rows="5"
                placeholder="先写场景1-2句，再按在场人数逐人描述…"
            >${esc(c.extractionRules)}</textarea>
        `)}

        ${section("preview", "预览 & 注入", `
            <div id="ipe-preview-status" class="ipe-preview-status">等待新消息…</div>
            <textarea id="ipe-preview-text" rows="6"
                placeholder="生成的 Description 将显示在这里…"></textarea>
            <label>补充指令
                <input type="text" id="ipe-supplement"
                       placeholder="例：这段是冷战不是撒娇">
            </label>
            <div class="ipe-preview-actions">
                <button id="ipe-btn-extract" class="ipe-btn">手动提取</button>
                <button id="ipe-btn-reroll" class="ipe-btn" disabled>重新生成</button>
                <button id="ipe-btn-inject" class="ipe-btn ipe-btn-primary" disabled>确认注入</button>
            </div>
        `, false)}

    </div>`;
}

function section(id, title, body, collapsed = true) {
    return `
    <div class="ipe-section ${collapsed ? "collapsed" : ""}" id="ipe-section-${id}">
        <div class="ipe-section-header" data-section="${id}">
            <span>${title}</span>
            <span class="ipe-collapse-icon">▾</span>
        </div>
        <div class="ipe-section-body">${body}</div>
    </div>`;
}

/* ────────────────────────────────────────────
   入口管理：三种模式互斥
   ──────────────────────────────────────────── */

function applyEntryMode(mode) {
    // 先全部隐藏/移除
    const ball = q("#ipe-ball");
    if (ball) ball.style.display = "none";

    const topBtn = q("#ipe-topbar-btn");
    if (topBtn) topBtn.style.display = "none";

    // sidebar 面板由 ST 扩展框架控制显示，直接操作其容器
    const sidebarWrap = q("#ipe-sidebar-wrap");
    if (sidebarWrap) sidebarWrap.style.display = "none";

    // 浮动面板：topbar/ball 模式下使用
    const floatPanel = q("#ipe-panel");
    if (floatPanel && mode === "sidebar") floatPanel.style.display = "none";

    if (mode === "topbar") {
        if (topBtn) topBtn.style.display = "";
    } else if (mode === "ball") {
        if (ball) ball.style.display = "";
    } else if (mode === "sidebar") {
        if (sidebarWrap) sidebarWrap.style.display = "";
    }
}

/* ────────────────────────────────────────────
   创建 UI 元素
   ──────────────────────────────────────────── */

function createUI() {
    // ── 1. 浮动面板（topbar / ball 模式共用） ──
    if (!q("#ipe-panel")) {
        const panel = document.createElement("div");
        panel.id = "ipe-panel";
        panel.className = "ipe-panel";
        panel.innerHTML = buildPanelHTML();
        document.body.appendChild(panel);
    }

    // ── 2. 悬浮球 ──
    if (!q("#ipe-ball")) {
        const ball = document.createElement("div");
        ball.id = "ipe-ball";
        ball.className = "ipe-ball";
        ball.title = "图像提示词提取器";
        ball.addEventListener("click", toggleFloatPanel);
        document.body.appendChild(ball);
    }

    // ── 3. 顶部导航栏按钮 ──
    // ST 顶部栏选择器：#top-bar 或 #topbar，兼容多版本
    if (!q("#ipe-topbar-btn")) {
        const topbar = q("#top-bar") || q("#topbar") || q(".top-bar") || q("nav");
        if (topbar) {
            const btn = document.createElement("div");
            btn.id = "ipe-topbar-btn";
            btn.className = "ipe-topbar-btn";
            btn.title = "图像提示词提取器";
            btn.textContent = "🎨";
            btn.addEventListener("click", toggleFloatPanel);
            topbar.appendChild(btn);
        } else {
            // 顶部栏找不到时降级：固定在顶部右侧
            const btn = document.createElement("div");
            btn.id = "ipe-topbar-btn";
            btn.className = "ipe-topbar-btn ipe-topbar-fallback";
            btn.title = "图像提示词提取器";
            btn.textContent = "🎨";
            btn.addEventListener("click", toggleFloatPanel);
            document.body.appendChild(btn);
        }
    }

    // ── 4. 扩展面板内嵌区域 ──
    // ST 扩展设置区：#extensions_settings
    if (!q("#ipe-sidebar-wrap")) {
        const target = q("#extensions_settings");
        if (target) {
            const wrap = document.createElement("div");
            wrap.id = "ipe-sidebar-wrap";
            wrap.className = "ipe-sidebar-wrap";
            // 用 ST 标准折叠组件风格包裹
            wrap.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🎨 图像提示词提取器</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" id="ipe-sidebar-inner"></div>
            </div>`;
            target.appendChild(wrap);

            // 把面板内容克隆一份放进侧边栏
            // （侧边栏模式下直接在此渲染，不弹浮动面板）
            const inner = q("#ipe-sidebar-inner");
            if (inner) {
                inner.innerHTML = buildPanelHTML();
                bindPanelEvents(inner);
            }
        }
    }

    // ── 绑定浮动面板事件 ──
    bindPanelEvents(q("#ipe-panel"));

    // ── 绑定折叠 ──
    document.querySelectorAll(".ipe-section-header").forEach((header) => {
        if (!header.dataset.bound) {
            header.dataset.bound = "1";
            header.addEventListener("click", () => {
                header.parentElement.classList.toggle("collapsed");
            });
        }
    });

    // ── 应用当前模式 ──
    applyEntryMode(s().entryMode);
}

/* ────────────────────────────────────────────
   事件绑定（面板内）
   ──────────────────────────────────────────── */

function bindPanelEvents(root) {
    if (!root) return;

    const qr = (sel) => root.querySelector(sel);

    // 总开关
    qr("#ipe-enabled")?.addEventListener("change", (e) => {
        save("enabled", e.target.checked);
    });

    // 入口模式切换
    root.querySelectorAll("input[name='ipe-entry']").forEach((radio) => {
        radio.addEventListener("change", (e) => {
            save("entryMode", e.target.value);
            applyEntryMode(e.target.value);
            // 同步另一个面板里的 radio（sidebar 和 float 各有一套）
            document.querySelectorAll(`input[name='ipe-entry'][value='${e.target.value}']`)
                .forEach(r => { r.checked = true; });
        });
    });

    // 设置项自动保存
    const bindings = [
        ["ipe-api-endpoint", "apiEndpoint"],
        ["ipe-api-key",      "apiKey"],
        ["ipe-model",        "model"],
        ["ipe-system-prompt","systemPrompt"],
        ["ipe-base-template","baseTemplate"],
        ["ipe-char-anchors", "characterAnchors"],
        ["ipe-extract-rules","extractionRules"],
    ];
    for (const [elId, key] of bindings) {
        const el = qr(`#${elId}`);
        if (el) el.addEventListener("input", () => save(key, el.value));
    }

    // 操作按钮
    qr("#ipe-btn-extract")?.addEventListener("click", onManualExtract);
    qr("#ipe-btn-reroll")?.addEventListener("click",  onReroll);
    qr("#ipe-btn-inject")?.addEventListener("click",  onConfirmInject);

    // 折叠头
    root.querySelectorAll(".ipe-section-header").forEach((header) => {
        if (!header.dataset.bound) {
            header.dataset.bound = "1";
            header.addEventListener("click", () => {
                header.parentElement.classList.toggle("collapsed");
            });
        }
    });
}

/* ────────────────────────────────────────────
   浮动面板开关
   ──────────────────────────────────────────── */

function toggleFloatPanel() {
    const panel = q("#ipe-panel");
    if (!panel) return;
    panel.classList.toggle("visible");
}

/* ────────────────────────────────────────────
   状态更新（同时更新两个面板）
   ──────────────────────────────────────────── */

function setStatus(text, type = "") {
    document.querySelectorAll(".ipe-preview-status").forEach(el => {
        el.textContent = text;
        el.className = "ipe-preview-status" + (type ? ` ${type}` : "");
    });
}

function setBallState(state) {
    const ball = q("#ipe-ball");
    if (!ball) return;
    ball.classList.remove("processing", "has-result");
    if (state) ball.classList.add(state);
}

function setTopbarState(state) {
    const btn = q("#ipe-topbar-btn");
    if (!btn) return;
    btn.classList.remove("processing", "has-result");
    if (state) btn.classList.add(state);
}

function setEntryState(state) {
    setBallState(state);
    setTopbarState(state);
}

function setButtonsEnabled(reroll, inject) {
    document.querySelectorAll("#ipe-btn-reroll").forEach(b => { b.disabled = !reroll; });
    document.querySelectorAll("#ipe-btn-inject").forEach(b => { b.disabled = !inject; });
}

function setPreviewText(text) {
    document.querySelectorAll("#ipe-preview-text").forEach(el => {
        el.value = text;
        el.disabled = false;
    });
}

/* ────────────────────────────────────────────
   API 调用
   ──────────────────────────────────────────── */

async function callExtractionAPI(rpText, supplement = "") {
    const c = s();

    if (!c.apiEndpoint || !c.model) {
        throw new Error("请先配置 API 地址和模型");
    }

    let userContent = "";
    if (c.characterAnchors) userContent += `【角色外貌锚点】\n${c.characterAnchors}\n\n`;
    if (c.extractionRules)  userContent += `【提取规则】\n${c.extractionRules}\n\n`;

    userContent += `【正文内容】\n${rpText}`;
    if (supplement) userContent += `\n\n【补充指令】\n${supplement}`;
    userContent += `\n\n请根据以上正文内容，按照提取规则，输出一段英文 Description。只输出 Description 本身，不要附加任何解释或格式标记。`;

    const headers = { "Content-Type": "application/json" };
    if (c.apiKey) headers["Authorization"] = `Bearer ${c.apiKey}`;

    const body = {
        model: c.model,
        messages: [
            {
                role: "system",
                content: c.systemPrompt || "You are an expert at extracting visual scene descriptions from Chinese literary roleplay text and writing them as English image generation prompts.",
            },
            { role: "user", content: userContent },
        ],
        max_tokens: 600,
        temperature: 0.7,
    };

    const response = await fetch(c.apiEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`API 返回 ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();

    let result = "";
    if (data.choices?.[0]?.message?.content) {
        result = data.choices[0].message.content.trim();
    } else if (data.content?.[0]?.text) {
        result = data.content[0].text.trim();
    } else {
        throw new Error("无法解析 API 响应");
    }

    return result;
}

function assembleTag(description) {
    const template = s().baseTemplate || "image###{Description}###";
    return template.includes("{Description}")
        ? template.replace("{Description}", description)
        : template + description;
}

/* ────────────────────────────────────────────
   消息处理
   ──────────────────────────────────────────── */

async function onMessageReceived(messageIndex) {
    if (!s().enabled || isProcessing) return;

    const context = getContext();
    const msg = context.chat?.[messageIndex];
    if (!msg || msg.is_user) return;

    currentMessageIndex = messageIndex;
    await runExtraction(msg.mes);
}

async function onManualExtract() {
    if (isProcessing) return;

    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return;

    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user) {
            currentMessageIndex = i;
            await runExtraction(chat[i].mes);
            return;
        }
    }

    setStatus("未找到 AI 消息", "error");
}

async function runExtraction(rpText, supplement = "") {
    isProcessing = true;
    setEntryState("processing");
    setStatus("正在提取…", "active");
    setButtonsEnabled(false, false);

    try {
        const description = await callExtractionAPI(rpText, supplement);
        currentDescription = description;

        setPreviewText(description);
        setStatus("提取完成 — 可编辑后确认注入", "active");
        setButtonsEnabled(true, true);
        setEntryState("has-result");

        // 展开预览区
        document.querySelectorAll("#ipe-section-preview").forEach(el => {
            el.classList.remove("collapsed");
        });

    } catch (err) {
        console.error("[IPE] 提取失败:", err);
        setStatus(`提取失败: ${err.message}`, "error");
        setButtonsEnabled(false, false);
        setEntryState("");
    }

    isProcessing = false;
}

async function onReroll() {
    if (isProcessing || currentMessageIndex < 0) return;

    const context = getContext();
    const msg = context.chat?.[currentMessageIndex];
    if (!msg) return;

    // 取任意一个可见的补充指令输入框的值
    const supplement = q("#ipe-supplement")?.value
        || q("#ipe-sidebar-inner #ipe-supplement")?.value
        || "";
    await runExtraction(msg.mes, supplement);
}

async function onConfirmInject() {
    if (currentMessageIndex < 0) return;

    // 优先取用户可能已编辑过的预览框内容
    const description = q("#ipe-preview-text")?.value
        || q("#ipe-sidebar-inner #ipe-preview-text")?.value
        || currentDescription;

    if (!description) {
        setStatus("没有可注入的内容", "error");
        return;
    }

    const tag = assembleTag(description);

    try {
        injectTag(currentMessageIndex, tag);
        setStatus("已注入 ✓", "active");
        setButtonsEnabled(false, false);
        setEntryState("");

        document.querySelectorAll("#ipe-supplement").forEach(el => { el.value = ""; });
    } catch (err) {
        console.error("[IPE] 注入失败:", err);
        setStatus(`注入失败: ${err.message}`, "error");
    }
}

/* ────────────────────────────────────────────
   标签注入
   ──────────────────────────────────────────── */

function injectTag(messageIndex, tag) {
    const context = getContext();
    const msg = context.chat?.[messageIndex];
    if (!msg) throw new Error("消息不存在");

    msg.mes = msg.mes.trimEnd() + "\n\n" + tag;

    if (typeof saveChatConditional === "function") {
        saveChatConditional();
    }

    const mesEl = document.querySelector(
        `#chat .mes[mesid="${messageIndex}"] .mes_text`
    );
    if (mesEl) {
        mesEl.innerHTML = mesEl.innerHTML + `<p>${esc(tag)}</p>`;
    }

    if (typeof eventSource !== "undefined" && event_types?.MESSAGE_UPDATED) {
        eventSource.emit(event_types.MESSAGE_UPDATED, messageIndex);
    }

    console.log(`[IPE] 标签已注入到消息 #${messageIndex}`);
}

/* ────────────────────────────────────────────
   初始化
   ──────────────────────────────────────────── */

jQuery(async () => {
    loadSettings();
    createUI();

    // 注册消息事件
    if (typeof eventSource !== "undefined" && event_types?.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    }

    // Termux 控制台确认日志
    console.log("[IPE] ✅ 图像提示词提取器已加载");
    console.log(`[IPE] 当前入口模式: ${s().entryMode}`);
    console.log(`[IPE] 插件启用状态: ${s().enabled}`);
});
