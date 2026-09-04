// ============================================================================
// @apanoo/dsh-glm-quota — 浏览器半部【构建物，勿手改；改 src/client/ 后 npm run build】
// ============================================================================

window.__ModuleLoader__.load({
	id: "@apanoo/dsh-glm-quota",
	factory: () => {
		var __mod = {
		"/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/usage.js": function (module, exports, require) {
			// 配额取数（浏览器半部）：GET /glm-quota，同源带凭据。
			// 容错策略：请求失败或服务端无数据时，回退到模块内缓存的上次成功值（标 stale），
			// 让徽标永远有得显示、不闪烁。
			var lastGood = null;

			function fetchUsage(force, cb) {
				var url = "/glm-quota" + (force ? "?refresh=1" : "");
				fetch(url, { credentials: "same-origin" })
					.then(function (r) { return r.json(); })
					.then(function (j) {
						if (j && j.ok) {
							lastGood = j;
							cb(null, j);
						} else if (lastGood) {
							var s = Object.assign({}, lastGood);
							s.stale = true;
							cb(null, s);
						} else {
							cb(new Error((j && j.reason) || "no-data"));
						}
					})
					.catch(function (e) {
						if (lastGood) {
							var s2 = Object.assign({}, lastGood);
							s2.stale = true;
							cb(null, s2);
						} else {
							cb(e);
						}
					});
			}

			module.exports = { fetchUsage: fetchUsage };

		}, // ↑ src/client/usage.js
		"/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/badge.js": function (module, exports, require) {
			// 徽标注入（浏览器半部）：定位「对话 / 轨迹」tab 行，行尾挂 5h 剩余百分比 pill。
			// ----------------------------------------------------------------------------
			// 定位策略（本地化无关，三级递降，sessionlog 同款防漂移套路）：
			//   ① [role="tablist"]（标准语义，最稳）
			//   ② CSS Modules tab 类 token：<hash>_tab 结尾的可见元素 ≥2 个 → 最小公共容器
			//      （英文界面下「对话」文本可能不是叶子，纯文本匹配会漏，v0.1.2 教训）
			//   ③ 兜底：{对话,Chats}×{轨迹,Trajectory} 双标签叶子的最小公共祖先
			// 行 position:static 时改 relative；徽标 top 由首个 tab 元素中心校准
			// （行常带底部留白，CSS 50% 居中会偏低）。防重：WeakSet；MO + 2s 自愈。
			// ----------------------------------------------------------------------------
			var { fetchUsage } = require("/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/usage.js");

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

			/** 类名 token（SVG 的 className 是对象，按字符串处理）。 */
			function classTokens(el) {
				var cn = el.className;
				if (typeof cn !== "string") return [];
				return cn.split(/\s+/).filter(Boolean);
			}

			function rectOf(el) {
				return el.getBoundingClientRect ? el.getBoundingClientRect() : null;
			}

			function isVisible(el) {
				var r = rectOf(el);
				return !!r && r.width > 0 && r.height > 0;
			}

			/** 类名含 <hash>_tab token 的元素（CSS Modules 哈希前缀随构建变，_tab 后缀稳）。 */
			function tabTokenEls() {
				var out = [], all = document.getElementsByTagName("*");
				for (var i = 0; i < all.length; i++) {
					var toks = classTokens(all[i]);
					for (var j = 0; j < toks.length; j++) {
						if (/_tab$/.test(toks[j])) { out.push(all[i]); break; }
					}
				}
				return out;
			}

			/** a、b 的最小公共祖先（≤8 层，排除 body/documentElement）。 */
			function smallestContainerOf(a, b) {
				var ancestors = [], n = a;
				for (var i = 0; i < 8 && n; i++) { ancestors.push(n); n = n.parentElement; }
				n = b;
				for (var j = 0; j < 8 && n; j++) {
					if (ancestors.indexOf(n) >= 0 && n !== document.body && n !== document.documentElement) return n;
					n = n.parentElement;
				}
				return null;
			}

			/**
			 * 定位 tab 行（三级递降，本地化无关）：
			 * ① role="tablist"
			 * ② 可见 <hash>_tab 元素（实测仅激活 tab 带该类）→ 自它向上 ≤2 层找含已知
			 *    标签文本的容器；多个 _tab 元素则先试最小公共容器
			 * ③ 双标签叶子文本（v0.1.1 原逻辑，兜底）。
			 */
			function findTabRow() {
				var tl = document.querySelector('[role="tablist"]');
				if (tl) return tl;

				var tabs = tabTokenEls().filter(isVisible);
				var fallbackPair = null;
				for (var i = 0; i < tabs.length; i++) {
					for (var j = i + 1; j < tabs.length; j++) {
						var pair = smallestContainerOf(tabs[i], tabs[j]);
						if (!pair) continue;
						if (hasKnownLabel(pair)) return pair;
						if (!fallbackPair) fallbackPair = pair;
					}
				}
				for (var k = 0; k < tabs.length; k++) {
					var n = tabs[k];
					for (var up = 0; up < 2 && n; up++) {
						n = n.parentElement;
						if (!n || n === document.body) break;
						if (hasKnownLabel(n)) return n;
					}
				}
				if (fallbackPair) return fallbackPair;

				var a = findLeaf(ROW_A);
				if (!a) return null;
				var b = findLeaf(ROW_B);
				if (!b) return null;
				return smallestContainerOf(a, b);
			}

			function hasKnownLabel(el) {
				var tx = el.textContent || "";
				for (var i = 0; i < ROW_A.length; i++) if (tx.indexOf(ROW_A[i]) >= 0) return true;
				for (var j = 0; j < ROW_B.length; j++) if (tx.indexOf(ROW_B[j]) >= 0) return true;
				return false;
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

			/**
			 * 徽标垂直校准：top 对齐行内首个 tab 元素的中心。
			 * 行常带底部留白/边框，CSS 50% 居中会整体偏低（v0.1.1 用户反馈），改为按
			 * tab 元素实测中心定位；CSS 的 top:50% + translateY(-50%) 仅作兜底。
			 */
			function alignBadge(row) {
				if (!badge) return;
				var ref = null;
				var tabs = tabTokenEls();
				for (var i = 0; i < tabs.length; i++) {
					if (row.contains(tabs[i]) && isVisible(tabs[i])) { ref = tabs[i]; break; }
				}
				if (!ref) {
					var leaves = row.getElementsByTagName ? row.getElementsByTagName("*") : [];
					for (var j = 0; j < leaves.length; j++) {
						if (isLeafText(leaves[j], ROW_A) || isLeafText(leaves[j], ROW_B)) { ref = leaves[j]; break; }
					}
				}
				if (!ref) return;
				var rowRect = rectOf(row), r = rectOf(ref);
				if (!rowRect || !r || rowRect.height <= 0 || r.height <= 0) return;
				badge.style.top = (r.top + r.height / 2 - rowRect.top) + "px";
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
				if (!row) { diagOnce("tab row not found（tablist/_tab 类/标签叶子三级均未命中）"); return; }   // 未挂载 → 静默等下轮
				ensureBadge(row);
				alignBadge(row);
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

		}, // ↑ src/client/badge.js
		"/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/index.js": function (module, exports, require) {
			// ============================================================================
			// @apanoo/dsh-glm-quota — 浏览器半部入口（打包器生成到 lib/client.js）
			// ----------------------------------------------------------------------------
			// 会话选中 GLM Coding Plan 模型时，在「对话 / 轨迹」tab 行右侧显示
			// 5 小时用量剩余百分比徽标。无外部服务依赖，无注入面。
			// ============================================================================
			const { installBadge } = require("/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/badge.js");

			function apply(ctx) {
				installBadge();
			}

			module.exports = { name: "glm-quota", inject: [], apply: apply };

		}, // ↑ src/client/index.js
		};
		var __cache = {};
		function __req(id) {
			if (__cache[id] !== undefined) return __cache[id].exports;
			if (__mod[id] === undefined) throw new Error("module not found: " + id);
			var m = { exports: {} };
			__cache[id] = m;
			__mod[id](m, m.exports, __req);
			return m.exports;
		}
		var m = { exports: {} };
		__cache["/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/index.js"] = m;
		__mod["/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/index.js"](m, m.exports, __req);
		return m.exports;
	}
});
