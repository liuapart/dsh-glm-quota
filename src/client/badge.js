// 徽标注入（浏览器半部）：定位「对话 / 轨迹」tab 行，行尾挂 5h 剩余百分比 pill。
// ----------------------------------------------------------------------------
// 定位策略（结构匹配，多语言对，sessionlog 同款防漂移套路）：
//   1) 找文本 ∈ {对话,Chats} 与 {轨迹,Trajectory} 的叶子节点
//   2) 各向上爬 ≤8 层，取第一个「同时是两者祖先」的最小容器 = tab 行
//   3) 行 position:static 时改为 relative，徽标 absolute 右缘垂直居中
// 防重：WeakSet 记录已注入的行；MO + 2s interval 自愈；行消失自动重找。
// 显示条件：glmModelSelected()（P0 启发式，见函数注释；P1 升级为 model store 直读）。
// ----------------------------------------------------------------------------
var { fetchUsage } = require("./usage.js");

var REFRESH_MS = 60 * 1000;   // 打开期间自动刷新间隔
var HEAL_MS = 2000;           // 定位/注入自愈间隔
var ROW_A = ["对话", "Chats"];
var ROW_B = ["轨迹", "Trajectory", "Trajectories"];
var OTHER_VENDOR = /gpt|o1|o3|o4|claude|deepseek|kimi|qwen|doubao/i;

var styleTag = null;
var badge = null;
var badgeInRows = new WeakSet();
var lastFetchAt = 0;
var lastPaint = 0;

function ensureStyles() {
	if (styleTag) return;
	styleTag = document.createElement("style");
	styleTag.textContent = [
		"#dsh-gq-badge{position:absolute;right:12px;top:50%;transform:translateY(-50%);" +
		"z-index:5;display:inline-flex;align-items:center;height:18px;padding:0 7px;" +
		"border-radius:9px;font-size:10.5px;line-height:1;font-weight:600;letter-spacing:.2px;" +
		"font-family:ui-monospace,'SF Mono',Menlo,monospace;white-space:nowrap;" +
		"background:rgba(9,105,218,.10);color:#0969da;pointer-events:none;user-select:none;-webkit-user-select:none}",
		"#dsh-gq-badge.dsh-gq-ok{background:rgba(46,160,67,.12);color:#1a7f37}",
		"#dsh-gq-badge.dsh-gq-warn{background:rgba(154,103,0,.12);color:#9a6700}",
		"#dsh-gq-badge.dsh-gq-low{background:rgba(207,34,46,.12);color:#cf222e}",
		"#dsh-gq-badge.dsh-gq-stale{opacity:.55}",
		"body[data-ds-dark-theme] #dsh-gq-badge{background:rgba(56,139,253,.16);color:#58a6ff}",
		"body[data-ds-dark-theme] #dsh-gq-badge.dsh-gq-ok{background:rgba(63,185,80,.16);color:#7ee787}",
		"body[data-ds-dark-theme] #dsh-gq-badge.dsh-gq-warn{background:rgba(187,128,9,.18);color:#e3b341}",
		"body[data-ds-dark-theme] #dsh-gq-badge.dsh-gq-low{background:rgba(248,81,73,.16);color:#ff7b72}"
	].join("\n");
	document.head.appendChild(styleTag);
}

function isLeafText(el, texts) {
	if (el.children.length > 0) return false;
	var tx = (el.textContent || "").trim();
	if (tx === "") return false;
	for (var i = 0; i < texts.length; i++) if (tx === texts[i]) return true;
	return false;
}

function findLeaf(texts) {
	var all = document.getElementsByTagName("*");
	for (var i = 0; i < all.length; i++) {
		if (isLeafText(all[i], texts)) return all[i];
	}
	return null;
}

/** 定位 tab 行：两个 tab 叶子的最小公共祖先（≤8 层）。 */
function findTabRow() {
	var a = findLeaf(ROW_A);
	if (!a) return null;
	var b = findLeaf(ROW_B);
	if (!b) return null;
	var ancestors = [];
	var n = a;
	for (var i = 0; i < 8 && n; i++) { ancestors.push(n); n = n.parentElement; }
	n = b;
	for (var j = 0; j < 8 && n; j++) {
		if (ancestors.indexOf(n) >= 0 && n !== document.body && n !== document.documentElement) return n;
		n = n.parentElement;
	}
	return null;
}

/**
 * 当前选中模型文本（P0：锚定 model-selection 的 CSS 模块类名）。
 * `[class*="modelName"]` 稳定命中 composer model seat / 弹窗行的模型名元素
 * （CSS Modules 哈希前缀不固定，但源类名后缀 modelName 稳定）。
 *   - 弹窗打开时：选中行带 aria-checked="true"（向上爬 ≤6 层找）→ 优先取它
 *   - 弹窗关闭时：只有 seat 一个元素 → 取第一个
 * 找不到任何元素 → null（无信号）。
 */
function currentModelText() {
	var els = document.querySelectorAll('[class*="modelName"]');
	if (!els.length) return null;
	var best = null;
	for (var i = 0; i < els.length; i++) {
		var el = els[i];
		var n = el, checked = false;
		for (var k = 0; k < 6 && n; k++) {
			if (n.getAttribute && n.getAttribute("aria-checked") === "true") { checked = true; break; }
			n = n.parentElement;
		}
		if (checked) return (el.textContent || "").trim();
		if (best === null) best = (el.textContent || "").trim();
	}
	return best;
}

var lastDiagAt = 0;
function diagOnce(msg) {
	var now = Date.now();
	if (now - lastDiagAt < 30000) return;
	lastDiagAt = now;
	try { console.info("[glm-quota] " + msg); } catch (e) { }
}

/**
 * 是否显示徽标：选中模型文本含 glm → 显示；命中其他已知厂商 → 隐藏；
 * 无信号（元素未挂载等）→ 默认显示（自用配额，展示无害）。
 */
function glmModelSelected() {
	var t = currentModelText();
	if (t === null) { diagOnce("no [modelName] element yet"); return true; }
	if (/glm/i.test(t)) return true;
	if (OTHER_VENDOR.test(t)) { diagOnce("hidden: selected model = " + t); return false; }
	return true;   // 未知命名 → 显示（GLM 表匹配留给 P1 精确化）
}

function ensureBadge(row) {
	if (badgeInRows.has(row)) return;
	var st = getComputedStyle(row);
	if (st.position === "static") row.style.position = "relative";
	if (!badge) {
		badge = document.createElement("span");
		badge.id = "dsh-gq-badge";
		badge.textContent = "…";
	}
	row.appendChild(badge);
	badgeInRows.add(row);
}

function paint(j) {
	if (!badge) return;
	var remaining = typeof j.remaining === "number" ? j.remaining : null;
	if (remaining === null) { badge.textContent = "–"; badge.className = "dsh-gq-stale"; return; }
	badge.textContent = remaining + "%";
	var cls = "dsh-gq-ok";
	if (remaining <= 20) cls = "dsh-gq-low";
	else if (remaining <= 50) cls = "dsh-gq-warn";
	if (j.stale) cls += " dsh-gq-stale";
	badge.className = cls;
	var reset = "";
	if (j.nextResetTime) {
		try {
			var d = new Date(j.nextResetTime);
			if (!isNaN(d.getTime())) reset = " · " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + " 重置";
		} catch (e) { }
	}
	badge.title = "GLM 5h 窗口剩余 " + remaining + "%" + reset + (j.stale ? "（缓存值）" : "");
}

function refresh(force) {
	var now = Date.now();
	if (!force && now - lastFetchAt < REFRESH_MS) return;
	lastFetchAt = now;
	fetchUsage(force, function (err, j) {
		if (err) { paint({}); return; }
		paint(j);
	});
}

function tick() {
	if (!document.body) return;
	if (!badge && document.getElementById("dsh-gq-badge")) badge = document.getElementById("dsh-gq-badge");
	var row = findTabRow();
	if (!row) { diagOnce("tab row not found（对话/轨迹叶子未命中）"); return; }   // 未挂载 → 静默等下轮
	ensureBadge(row);
	diagOnce("tab row ok, badge injected");
	var now = Date.now();
	if (now - lastPaint < 900) return;      // MO 风暴节流：可见状态每秒最多算一次
	lastPaint = now;
	if (!glmModelSelected()) {
		badge.style.display = "none";
		return;
	}
	badge.style.display = "";
	refresh(false);
}

function install() {
	if (!document.body) {
		document.addEventListener("DOMContentLoaded", install);
		return;
	}
	ensureStyles();
	setInterval(tick, HEAL_MS);
	tick();
	// SPA 重渲染后尽快补位（先于 2s 自愈）
	new MutationObserver(function () {
		if (!badgeInRows.size || !badge || !badge.isConnected) setTimeout(tick, 50);
	}).observe(document.body, { childList: true, subtree: true });
}

module.exports = { installBadge: install };
