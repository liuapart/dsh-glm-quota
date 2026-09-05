// ============================================================================
// @apanoo/dsh-glm-quota — 浏览器半部【构建物，勿手改；改 src/client/ 后 npm run build】
// ============================================================================

window.__ModuleLoader__.load({
	id: "@apanoo/dsh-glm-quota",
	factory: () => {
		var __mod = {
		"/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/usage.js": function (module, exports, require) {
			// 配额取数（浏览器半部）：GET /glm-quota，同源带凭据。
			// 请求失败时保留上次成功值，并通过 stale 标记提示数据不是最新。
			var lastGood = null;
			var lastFetchAt = 0;
			var REFRESH_MS = 60 * 1000;

			function fetchUsage(force, cb) {
				var now = Date.now();
				if (!force && lastGood && now - lastFetchAt < REFRESH_MS) {
					cb(null, lastGood);
					return;
				}
				lastFetchAt = now;
				var url = "/glm-quota" + (force ? "?refresh=1" : "");
				fetch(url, { credentials: "same-origin" })
					.then(function (r) { return r.json(); })
					.then(function (j) {
						if (j && j.ok) {
							lastGood = j;
							cb(null, j);
						} else if (lastGood) {
							var stale = Object.assign({}, lastGood);
							stale.stale = true;
							cb(null, stale);
						} else {
							cb(new Error((j && j.reason) || "no-data"));
						}
					})
					.catch(function (e) {
						if (lastGood) {
							var stale = Object.assign({}, lastGood);
							stale.stale = true;
							cb(null, stale);
						} else {
							cb(e);
						}
					});
			}

			module.exports = { fetchUsage: fetchUsage };

		}, // ↑ src/client/usage.js
		"/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/badge.js": function (module, exports, require) {
			// GLM Coding Plan 用量元信息：挂在 composer 模型选择器按钮内部、模型文案左侧。
			// ----------------------------------------------------------------------------
			// 锚定策略：
			//   1) 找 CSS Modules 的 <hash>_triggerLabel（model-selection 已确认的源类名）；
			//   2) 向上找到 aria-haspopup="menu" 的模型选择器按钮；
			//   3) badge 作为该按钮的第一个子项插入，不依赖 tab 文本、语言或页面宽度。
			//
			// 视觉策略：只显示纯文字百分比「10%」，不重复显示已知的 GLM provider；不使用
			// 背景 pill，避免和页面右上角下载按钮产生第二个按钮状元素。
			//
			// 移动端适配（v0.2.5）：窄屏下底行（InputBar 的 .row，flex-wrap:wrap）放不下
			// 「工具组 + 模型簇」时会整体换行，模型按钮掉到第二行。模型选择器存在时即给
			// 底行打标记类 dsh-gq-row（对所有模型生效），媒体查询（≤600px）内：行强制
			// nowrap、右侧簇改为可收缩、权限按钮可省略、行内 gap 压缩到 8px——空间不足时
			// 模型名先省略让位，结构上不可能再换行。百分比徽标仍仅 GLM 模型显示；
			// 桌面端不受影响。
			// ----------------------------------------------------------------------------
			var { fetchUsage } = require("/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/client/usage.js");

			var REFRESH_MS = 60 * 1000;
			var HEAL_MS = 2000;
			var OTHER_VENDOR = /gpt|o1|o3|o4|claude|deepseek|kimi|qwen|doubao/i;

			var styleTag = null;
			var badge = null;
			var badgeValue = null;
			var badgeHost = null;
			var lastPaint = 0;
			var lastDiagAt = 0;

			function ensureStyles() {
				if (styleTag) return;
				styleTag = document.createElement("style");
				styleTag.textContent = [
					"#dsh-gq-badge{display:inline-flex;align-items:center;flex:none;" +
					"margin:0 2px 0 0;padding:0;height:20px;line-height:20px;" +
					"font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:10px;" +
					"font-weight:500;letter-spacing:.15px;white-space:nowrap;" +
					"pointer-events:none;user-select:none;-webkit-user-select:none;" +
					"color:var(--dsw-alias-label-tertiary,#8b949e);opacity:.9}",
					"#dsh-gq-badge .dsh-gq-value{font-weight:600;color:#2da44e}",
					"#dsh-gq-badge.dsh-gq-warn .dsh-gq-value{color:#bf8700}",
					"#dsh-gq-badge.dsh-gq-low .dsh-gq-value{color:#cf222e}",
					"#dsh-gq-badge.dsh-gq-stale{opacity:.48}",
					"body[data-ds-dark-theme] #dsh-gq-badge .dsh-gq-value{color:#7ee787}",
					"body[data-ds-dark-theme] #dsh-gq-badge.dsh-gq-warn .dsh-gq-value{color:#e3b341}",
					"body[data-ds-dark-theme] #dsh-gq-badge.dsh-gq-low .dsh-gq-value{color:#ff7b72}",
					// 移动端底行防换行（v0.2.4）：仅压间距不够——最差组合（长名+effort 文案+徽标）
					// 仍可能越过临界宽度。改为结构上禁止换行：行 nowrap；右侧簇由 flex:none 改为
					// 可收缩；权限按钮允许省略。空间不足时模型名先省略让位，两行不可能出现。
					// 选择器用 [class$=] 后缀匹配 CSS Modules 的 hash 前缀类名，
					// scoped 到 dsh-gq-row，不碰其他区域。
					"@media (max-width:600px){",
					"body .dsh-gq-row{flex-wrap:nowrap;gap:8px}",
					"body .dsh-gq-row>[class$='_tools']{gap:8px}",
					"body .dsh-gq-row [class$='_modes']{gap:8px}",
					"body .dsh-gq-row>[class$='_trailing']{flex:0 1 auto;min-width:0;gap:8px}",
					"body .dsh-gq-row [class$='_select']{min-width:0;overflow:hidden;text-overflow:ellipsis}",
					"}"
				].join("\n");
				document.head.appendChild(styleTag);
			}

			function classTokens(el) {
				var cn = el && el.className;
				if (typeof cn !== "string") return [];
				return cn.split(/\s+/).filter(Boolean);
			}

			function hasClassSuffix(el, suffix) {
				var toks = classTokens(el);
				for (var i = 0; i < toks.length; i++) if (toks[i].slice(-suffix.length) === suffix) return true;
				return false;
			}

			function isVisible(el) {
				if (!el || !el.getBoundingClientRect) return true;
				var r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0;
			}

			function findTriggerLabel() {
				var all = document.getElementsByTagName("*");
				for (var i = 0; i < all.length; i++) {
					var el = all[i];
					if (!hasClassSuffix(el, "_triggerLabel") || !isVisible(el)) continue;
					var n = el;
					for (var up = 0; up < 4 && n; up++) {
						if (n.getAttribute && n.getAttribute("aria-haspopup") === "menu") return el;
						n = n.parentElement;
					}
				}
				return null;
			}

			function currentModelText(label) {
				return label ? (label.textContent || "").trim() : null;
			}

			function diagOnce(msg) {
				var now = Date.now();
				if (now - lastDiagAt < 30000) return;
				lastDiagAt = now;
				try { console.info("[glm-quota] " + msg); } catch (e) { }
			}

			function findHost(label) {
				var n = label;
				for (var i = 0; i < 4 && n; i++) {
					if (n.getAttribute && n.getAttribute("aria-haspopup") === "menu") return n;
					n = n.parentElement;
				}
				return null;
			}

			// 从模型按钮向上找 composer 底行（InputBar 的 .row，类名形如 <hash>_row），
			// 打上标记类 dsh-gq-row —— 移动端媒体查询据此禁止换行并压缩间距。
			// v0.2.5 起对所有模型生效（不再随徽标显隐开关）。
			// 爬 8 层：若 slot 渲染时插入额外包装层，也能落到真正的行元素上。
			function syncRow(host) {
				var n = host;
				for (var i = 0; i < 8 && n; i++) {
					if (hasClassSuffix(n, "_row")) {
						if (typeof n.classList !== "undefined") n.classList.add("dsh-gq-row");
						return;
					}
					n = n.parentElement;
				}
			}

			function makeBadge(label) {
				badge = document.createElement("span");
				badge.id = "dsh-gq-badge";
				badgeValue = document.createElement("span");
				badgeValue.className = "dsh-gq-value";
				badgeValue.textContent = "–";
				badge.appendChild(badgeValue);
				badge.title = "GLM Coding Plan · 5h 窗口";
				return badge;
			}

			function ensureBadge(host, label) {
				if (!badge) makeBadge(label);
				if (badge.parentElement !== host) host.insertBefore(badge, label);
				badgeHost = host;
			}

			function paint(data) {
				if (!badge || !badgeValue) return;
				var remaining = typeof data.remaining === "number" ? data.remaining : null;
				if (remaining === null) {
					badgeValue.textContent = "–";
					badge.className = "dsh-gq-badge dsh-gq-stale";
					badge.title = "GLM Coding Plan · 5h 窗口暂无数据";
					return;
				}
				badgeValue.textContent = remaining + "%";
				var cls = "dsh-gq-badge dsh-gq-ok";
				if (remaining <= 20) cls = "dsh-gq-badge dsh-gq-low";
				else if (remaining <= 50) cls = "dsh-gq-badge dsh-gq-warn";
				if (data.stale) cls += " dsh-gq-stale";
				badge.className = cls;
				var reset = "";
				if (data.nextResetTime) {
					try {
						var date = new Date(data.nextResetTime);
						if (!isNaN(date.getTime())) reset = " · " + ("0" + date.getHours()).slice(-2) + ":" + ("0" + date.getMinutes()).slice(-2) + " 重置";
					} catch (e) { }
				}
				badge.title = "GLM Coding Plan · 5h 窗口剩余 " + remaining + "%" + reset + (data.stale ? "（缓存值）" : "");
			}

			var lastFetchAt = 0;
			function refresh(force) {
				var now = Date.now();
				if (!force && now - lastFetchAt < REFRESH_MS) return;
				lastFetchAt = now;
				fetchUsage(force, function (err, data) {
					if (err) { paint({}); return; }
					paint(data);
				});
			}

			function tick() {
				if (!document.body) return;
				var label = findTriggerLabel();
				if (!label) { diagOnce("model triggerLabel not found"); return; }
				var text = currentModelText(label);
				var host = findHost(label);
				if (!host) { diagOnce("model trigger host not found"); return; }
				if (!badge) makeBadge(label);
				ensureBadge(host, label);
				// 单行适配（v0.2.5）：对所有模型生效——只要模型选择器存在就标记底行；
				// 徽标本身仍然只在 GLM 模型上显示。
				syncRow(host, true);
				var now = Date.now();
				if (now - lastPaint < 900) return;
				lastPaint = now;
				if (!/glm/i.test(text || "")) {
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
				new MutationObserver(function () {
					if (!badge || !badge.isConnected || badge.parentElement !== badgeHost) setTimeout(tick, 50);
				}).observe(document.body, { childList: true, subtree: true, characterData: true });
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
