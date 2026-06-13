/*
 *  Image Prompt Extractor (图像提示词提取器)
 *  SillyTavern 1.18+ — 使用 SillyTavern.getContext() API
 */

const EXT_NAME = "image-prompt-extractor";
const DEFAULTS = {
    enabled: true, apiEndpoint: "", apiKey: "", model: "",
    systemPrompt: "", baseTemplate: "", characterAnchors: "", extractionRules: "",
};

let currentDesc = "", currentIdx = -1, processing = false, initialized = false;

/* ── ST 上下文（懒加载）── */
function ctx() { return SillyTavern.getContext(); }

/* ── 设置 ── */
function loadSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[EXT_NAME]) extensionSettings[EXT_NAME] = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (extensionSettings[EXT_NAME][k] === undefined) extensionSettings[EXT_NAME][k] = v;
    }
}
function cfg() { return ctx().extensionSettings[EXT_NAME]; }
function save(key, val) {
    ctx().extensionSettings[EXT_NAME][key] = val;
    ctx().saveSettingsDebounced();
}

/* ── 工具 ── */
function esc(s) {
    if (!s) return "";
    const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}
function q(s) { return document.querySelector(s); }

/* ════════════════════════════════════════
   UI
   ════════════════════════════════════════ */

function createUI() {
    createBall();
    createPanel();
    createDrawer();
    bindAll();
}

function createBall() {
    if (q("#ipe-ball")) return;
    const ball = document.createElement("div");
    ball.id = "ipe-ball";
    ball.className = "ipe-ball";
    ball.title = "图像提示词提取器";
    ball.addEventListener("click", () => {
        const p = q("#ipe-panel");
        if (p) p.classList.toggle("visible");
    });
    document.body.appendChild(ball);
}

function createPanel() {
    if (q("#ipe-panel")) return;
    const c = cfg();
    const panel = document.createElement("div");
    panel.id = "ipe-panel";
    panel.className = "ipe-panel";
    panel.innerHTML = `
    <div class="ipe-panel-header">
        <span class="ipe-panel-title">图像提示词提取器</span>
        <label class="ipe-toggle">
            <input type="checkbox" id="ipe-enabled" ${c.enabled?"checked":""}>
            <span class="ipe-toggle-slider"></span>
        </label>
    </div>
    <div class="ipe-sections">
        ${sec("api-config","API 配置",`
            <label>API 地址<input type="text" id="ipe-api-endpoint" value="${esc(c.apiEndpoint)}" placeholder="https://api.openai.com/v1/chat/completions"></label>
            <label>API 密钥<input type="password" id="ipe-api-key" value="${esc(c.apiKey)}" placeholder="sk-..."></label>
            <label>模型<input type="text" id="ipe-model" value="${esc(c.model)}" placeholder="gpt-4o-mini"></label>`)}
        ${sec("system-prompt","系统提示",`
            <textarea id="ipe-system-prompt" rows="5" placeholder="你是一个专精中文文学场景视觉化的提示词专家…">${esc(c.systemPrompt)}</textarea>`)}
        ${sec("base-template","基础模板",`
            <textarea id="ipe-base-template" rows="6" placeholder="image###...{Description}...###">${esc(c.baseTemplate)}</textarea>
            <div class="ipe-hint">用 {Description} 标记描述文本的插入位置</div>`)}
        ${sec("char-anchors","角色锚点",`
            <textarea id="ipe-char-anchors" rows="5" placeholder="陆冀北：a man, early 30s, tall…">${esc(c.characterAnchors)}</textarea>`)}
        ${sec("extract-rules","提取规则",`
            <textarea id="ipe-extract-rules" rows="5" placeholder="先写场景1-2句，再按在场人数逐人描述…">${esc(c.extractionRules)}</textarea>`)}
        ${sec("preview","预览",`
            <div id="ipe-status" class="ipe-preview-status">等待新消息…</div>
            <textarea id="ipe-preview-text" rows="6" placeholder="生成的 Description 将显示在这里…"></textarea>
            <label>补充指令<input type="text" id="ipe-supplement" placeholder="例：这段是冷战不是撒娇"></label>
            <div class="ipe-preview-actions">
                <button id="ipe-btn-extract" class="ipe-btn">手动提取</button>
                <button id="ipe-btn-reroll" class="ipe-btn" disabled>重新生成</button>
                <button id="ipe-btn-inject" class="ipe-btn ipe-btn-primary" disabled>确认注入</button>
            </div>`,false)}
    </div>`;
    document.body.appendChild(panel);
}

function sec(id, title, body, collapsed = true) {
    return `<div class="ipe-section${collapsed?" collapsed":""}" id="ipe-section-${id}">
        <div class="ipe-section-header"><span>${title}</span><span class="ipe-collapse-icon">▾</span></div>
        <div class="ipe-section-body">${body}</div></div>`;
}

function createDrawer() {
    if (q("#ipe-drawer")) return;
    const c = cfg();
    const html = `<div id="ipe-drawer">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🎨 图像提示词提取器</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div style="margin-bottom:6px"><label>启用 <input type="checkbox" id="iped-enabled" ${c.enabled?"checked":""}></label></div>
                <hr><small><b>API 配置</b></small>
                <label>API 地址</label><input type="text" id="iped-api-endpoint" class="text_pole" value="${esc(c.apiEndpoint)}" placeholder="https://api.openai.com/v1/chat/completions">
                <label>API 密钥</label><input type="password" id="iped-api-key" class="text_pole" value="${esc(c.apiKey)}" placeholder="sk-...">
                <label>模型</label><input type="text" id="iped-model" class="text_pole" value="${esc(c.model)}" placeholder="gpt-4o-mini">
                <hr><small><b>系统提示</b></small>
                <textarea id="iped-system-prompt" class="text_pole" rows="4" placeholder="你是一个专精中文文学场景视觉化的提示词专家…">${esc(c.systemPrompt)}</textarea>
                <hr><small><b>基础模板</b></small>
                <textarea id="iped-base-template" class="text_pole" rows="5" placeholder="image###...{Description}...###">${esc(c.baseTemplate)}</textarea>
                <small style="color:#888">用 {Description} 标记插入位置</small>
                <hr><small><b>角色锚点</b></small>
                <textarea id="iped-char-anchors" class="text_pole" rows="4" placeholder="陆冀北：a man, early 30s, tall…">${esc(c.characterAnchors)}</textarea>
                <hr><small><b>提取规则</b></small>
                <textarea id="iped-extract-rules" class="text_pole" rows="4" placeholder="先写场景1-2句，再按在场人数逐人描述…">${esc(c.extractionRules)}</textarea>
                <hr><small><b>预览</b></small>
                <div id="iped-status" style="color:#888;font-size:12px;margin:4px 0">等待新消息…</div>
                <textarea id="iped-preview-text" class="text_pole" rows="5" placeholder="生成的 Description 将显示在这里…"></textarea>
                <label>补充指令</label><input type="text" id="iped-supplement" class="text_pole" placeholder="例：这段是冷战不是撒娇">
                <div style="display:flex;gap:6px;margin-top:6px">
                    <input type="button" id="iped-btn-extract" class="menu_button" value="手动提取">
                    <input type="button" id="iped-btn-reroll" class="menu_button" value="重新生成" disabled>
                    <input type="button" id="iped-btn-inject" class="menu_button" value="确认注入" disabled>
                </div>
            </div>
        </div>
    </div>`;
    const target = jQuery("#extensions_settings2");
    if (target.length) {
        target.append(html);
        console.log("[IPE] 抽屉已挂载");
    }
}

/* ════════════════════════════════════════
   事件绑定
   ════════════════════════════════════════ */

function bindAll() {
    // 折叠
    document.querySelectorAll(".ipe-section-header").forEach(h =>
        h.addEventListener("click", () => h.parentElement.classList.toggle("collapsed"))
    );
    // 设置同步
    const fields = [
        ["apiEndpoint","ipe-api-endpoint","iped-api-endpoint"],
        ["apiKey","ipe-api-key","iped-api-key"],
        ["model","ipe-model","iped-model"],
        ["systemPrompt","ipe-system-prompt","iped-system-prompt"],
        ["baseTemplate","ipe-base-template","iped-base-template"],
        ["characterAnchors","ipe-char-anchors","iped-char-anchors"],
        ["extractionRules","ipe-extract-rules","iped-extract-rules"],
    ];
    for (const [key, id1, id2] of fields) {
        for (const id of [id1, id2]) {
            const el = q("#"+id);
            if (!el) continue;
            el.addEventListener("input", () => {
                save(key, el.value);
                const o = q("#"+(id===id1?id2:id1));
                if (o && o!==el) o.value = el.value;
            });
        }
    }
    // 开关
    for (const id of ["ipe-enabled","iped-enabled"]) {
        const el = q("#"+id);
        if (!el) continue;
        el.addEventListener("change", () => {
            save("enabled", el.checked);
            const o = q("#"+(id==="ipe-enabled"?"iped-enabled":"ipe-enabled"));
            if (o) o.checked = el.checked;
        });
    }
    // 按钮
    for (const p of ["ipe","iped"]) {
        q("#"+p+"-btn-extract")?.addEventListener("click", onExtract);
        q("#"+p+"-btn-reroll")?.addEventListener("click", onReroll);
        q("#"+p+"-btn-inject")?.addEventListener("click", onInject);
    }
    // ST 消息事件
    const { eventSource, event_types } = ctx();
    if (eventSource && event_types.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMsgReceived);
        console.log("[IPE] 已绑定消息事件");
    }
}

/* ════════════════════════════════════════
   API
   ════════════════════════════════════════ */

async function callAPI(text, supplement) {
    const c = cfg();
    if (!c.apiEndpoint || !c.model) throw new Error("请先配置 API");
    let user = "";
    if (c.characterAnchors) user += "【角色外貌锚点】\n"+c.characterAnchors+"\n\n";
    if (c.extractionRules) user += "【提取规则】\n"+c.extractionRules+"\n\n";
    user += "【正文内容】\n"+text;
    if (supplement) user += "\n\n【补充指令】\n"+supplement;
    user += "\n\n请根据以上正文内容，按照提取规则，输出一段英文 Description。只输出 Description 本身，不要附加任何解释或格式标记。";
    const headers = {"Content-Type":"application/json"};
    if (c.apiKey) headers["Authorization"] = "Bearer "+c.apiKey;
    const res = await fetch(c.apiEndpoint, {
        method:"POST", headers,
        body: JSON.stringify({
            model: c.model,
            messages: [
                {role:"system", content: c.systemPrompt || "You are an expert at extracting visual scene descriptions from Chinese literary roleplay text and writing them as English image generation prompts."},
                {role:"user", content: user},
            ],
            max_tokens: 600, temperature: 0.7,
        }),
    });
    if (!res.ok) throw new Error("API "+res.status);
    const data = await res.json();
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content.trim();
    if (data.content?.[0]?.text) return data.content[0].text.trim();
    throw new Error("无法解析响应");
}

/* ════════════════════════════════════════
   操作逻辑
   ════════════════════════════════════════ */

function setStatus(t, color) {
    for (const id of ["#ipe-status","#iped-status"]) {
        const e = q(id); if (e) { e.textContent = t; e.style.color = color||""; }
    }
}
function setPreview(t) {
    for (const id of ["#ipe-preview-text","#iped-preview-text"]) {
        const e = q(id); if (e) { e.value = t; e.disabled = false; }
    }
}
function setBtns(r, j) {
    for (const p of ["ipe","iped"]) {
        const br = q("#"+p+"-btn-reroll"), bj = q("#"+p+"-btn-inject");
        if (br) br.disabled = !r; if (bj) bj.disabled = !j;
    }
}

function onMsgReceived(idx) {
    if (!cfg().enabled || processing) return;
    const msg = ctx().chat?.[idx];
    if (!msg || msg.is_user) return;
    currentIdx = idx;
    runExtract(msg.mes);
}

async function onExtract() {
    if (processing) return;
    const chat = ctx().chat;
    if (!chat?.length) { setStatus("无法读取聊天","#d4726a"); return; }
    for (let i = chat.length-1; i >= 0; i--) {
        if (!chat[i].is_user) { currentIdx = i; await runExtract(chat[i].mes); return; }
    }
    setStatus("未找到 AI 消息","#d4726a");
}

async function runExtract(text, supplement) {
    processing = true;
    const ball = q("#ipe-ball");
    if (ball) ball.classList.add("processing");
    setStatus("正在提取…","#6ec577");
    setBtns(false,false);
    try {
        const desc = await callAPI(text, supplement||"");
        currentDesc = desc;
        setPreview(desc);
        setStatus("提取完成 — 可编辑后确认注入","#6ec577");
        setBtns(true,true);
        if (ball) { ball.classList.remove("processing"); ball.classList.add("has-result"); }
        const s = q("#ipe-section-preview"); if (s) s.classList.remove("collapsed");
    } catch(e) {
        console.error("[IPE]", e);
        setStatus("失败: "+e.message,"#d4726a");
        setBtns(false,false);
        if (ball) ball.classList.remove("processing");
    }
    processing = false;
}

async function onReroll() {
    if (processing || currentIdx < 0) return;
    const msg = ctx().chat?.[currentIdx]; if (!msg) return;
    const sup = q("#ipe-supplement")?.value || q("#iped-supplement")?.value || "";
    await runExtract(msg.mes, sup);
}

function onInject() {
    if (currentIdx < 0) return;
    const desc = q("#ipe-preview-text")?.value || q("#iped-preview-text")?.value || currentDesc;
    if (!desc) { setStatus("没有内容","#d4726a"); return; }
    const tpl = cfg().baseTemplate || "image###{Description}###";
    const tag = tpl.includes("{Description}") ? tpl.replace("{Description}", desc) : tpl+desc;
    try {
        const c = ctx();
        const msg = c.chat?.[currentIdx];
        if (!msg) throw new Error("消息不存在");
        msg.mes = msg.mes.trimEnd()+"\n\n"+tag;
        if (typeof c.saveChat === "function") c.saveChat();
        const el = document.querySelector('#chat .mes[mesid="'+currentIdx+'"] .mes_text');
        if (el) el.innerHTML += "<p>"+esc(tag)+"</p>";
        setStatus("已注入 ✓","#6ec577");
        setBtns(false,false);
        const ball = q("#ipe-ball"); if (ball) ball.classList.remove("has-result");
        for (const id of ["#ipe-supplement","#iped-supplement"]) { const e = q(id); if (e) e.value = ""; }
        console.log("[IPE] 注入 #"+currentIdx);
    } catch(e) {
        console.error("[IPE]",e);
        setStatus("注入失败: "+e.message,"#d4726a");
    }
}

/* ════════════════════════════════════════
   启动 — 等待 SillyTavern 就绪
   ════════════════════════════════════════ */

function init() {
    if (initialized) return;
    try {
        loadSettings();
        createUI();
        initialized = true;
        console.log("[IPE] ✓ 图像提示词提取器已加载");
    } catch(e) {
        console.error("[IPE] 初始化失败:", e);
    }
}

// 使用 SillyTavern 官方推荐的 APP_READY 事件
// 如果 app 已就绪，绑定监听时会自动触发
function waitAndInit() {
    if (typeof SillyTavern === "undefined" || !SillyTavern.getContext) {
        setTimeout(waitAndInit, 300);
        return;
    }
    try {
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.APP_READY, () => setTimeout(init, 100));
    } catch(e) {
        // 兜底：直接尝试初始化
        setTimeout(init, 2000);
    }
}

waitAndInit();
