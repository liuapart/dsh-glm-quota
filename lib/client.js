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
			var popup = null;        // 点击徽标弹出的全量信息浮层（单例，挂 body）
			var popupOpen = false;
			var lastData = null;     // 最近一次成功拉取的全量数据（popup 内容来源）

			function ensureStyles() {
				if (styleTag) return;
				styleTag = document.createElement("style");
				styleTag.textContent = [
					"#dsh-gq-badge{display:inline-flex;align-items:center;flex:none;" +
					"margin:0 2px 0 0;padding:0;height:20px;line-height:20px;" +
					"font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:10px;" +
					"font-weight:500;letter-spacing:.15px;white-space:nowrap;cursor:pointer;" +
					"user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;" +
					"-webkit-touch-callout:none;outline:none;" +
					"color:var(--dsw-alias-label-tertiary,#8b949e);opacity:.9}",
					"#dsh-gq-badge .dsh-gq-value{font-weight:600;color:#2da44e}",
					"#dsh-gq-badge.dsh-gq-warn .dsh-gq-value{color:#bf8700}",
					"#dsh-gq-badge.dsh-gq-low .dsh-gq-value{color:#cf222e}",
					"#dsh-gq-badge.dsh-gq-stale{opacity:.48}",
					"body[data-ds-dark-theme] #dsh-gq-badge .dsh-gq-value{color:#7ee787}",
					"body[data-ds-dark-theme] #dsh-gq-badge.dsh-gq-warn .dsh-gq-value{color:#e3b341}",
					"body[data-ds-dark-theme] #dsh-gq-badge.dsh-gq-low .dsh-gq-value{color:#ff7b72}",
					// —— 点击徽标弹出的全量信息 popup（v0.3.0）：固定定位、双主题、移动端无 tap 高亮 ——
					"#dsh-gq-popup{position:fixed;z-index:2147482002;min-width:200px;max-width:76vw;" +
					"padding:10px 12px;border-radius:10px;background:#ffffff;color:#1f2328;" +
					"border:1px solid #d8dee4;box-shadow:0 10px 30px rgba(0,0,0,.16);display:none;" +
					"font-family:-apple-system,'SF Pro Text','PingFang SC','Microsoft YaHei',sans-serif;" +
					"font-size:12px;line-height:2;" +
					"user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}",
					"#dsh-gq-popup .dsh-gq-ptitle{font-weight:600;font-size:11.5px;color:#57606a;margin-bottom:2px}",
					"#dsh-gq-popup .dsh-gq-prow{display:flex;align-items:baseline;justify-content:space-between;gap:16px;white-space:nowrap}",
					"#dsh-gq-popup .dsh-gq-plabel{color:#57606a;flex:none}",
					"#dsh-gq-popup .dsh-gq-pval{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-weight:600}",
					"#dsh-gq-popup .dsh-gq-pval.dsh-gq-ok{color:#2da44e}",
					"#dsh-gq-popup .dsh-gq-pval.dsh-gq-warn{color:#bf8700}",
					"#dsh-gq-popup .dsh-gq-pval.dsh-gq-low{color:#cf222e}",
					"body[data-ds-dark-theme] #dsh-gq-popup{background:#161b22;color:#c9d1d9;border-color:#30363d;box-shadow:0 10px 30px rgba(0,0,0,.45)}",
					"body[data-ds-dark-theme] #dsh-gq-popup .dsh-gq-ptitle,body[data-ds-dark-theme] #dsh-gq-popup .dsh-gq-plabel{color:#8b949e}",
					"body[data-ds-dark-theme] #dsh-gq-popup .dsh-gq-pval.dsh-gq-ok{color:#7ee787}",
					"body[data-ds-dark-theme] #dsh-gq-popup .dsh-gq-pval.dsh-gq-warn{color:#e3b341}",
					"body[data-ds-dark-theme] #dsh-gq-popup .dsh-gq-pval.dsh-gq-low{color:#ff7b72}",
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
				// 徽标在模型选择器按钮内部：拦截传播，避免点徽标误开模型菜单；
				// click 切换 popup 显隐。移动端 tap 高亮已由样式去掉。
				badge.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
				badge.addEventListener("click", function (e) {
					e.preventDefault();
					e.stopPropagation();
					if (popupOpen) closePopup();
					else openPopup();
				});
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
				if (remaining !== null) lastData = data;   // popup 全量信息来源（只在有有效数据时更新）
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

			// ---------- 点击徽标弹出的全量信息 popup（v0.3.0） ----------

			function two(n) { return ("0" + n).slice(-2); }
			function fmtHM(d) { return two(d.getHours()) + ":" + two(d.getMinutes()); }

			function ensurePopup() {
				if (popup) return;
				popup = document.createElement("div");
				popup.id = "dsh-gq-popup";
				// 弹层内的点击不外传：既不关闭自己，也不触发底下 composer 的任何交互
				popup.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
				popup.addEventListener("click", function (e) { e.stopPropagation(); });
				document.body.appendChild(popup);
			}

			function pRow(parent, labelText, valueText, valueCls) {
				var r = document.createElement("div");
				r.className = "dsh-gq-prow";
				var l = document.createElement("span");
				l.className = "dsh-gq-plabel";
				l.textContent = labelText;
				var v = document.createElement("span");
				v.className = "dsh-gq-pval" + (valueCls ? " " + valueCls : "");
				v.textContent = valueText;
				r.appendChild(l);
				r.appendChild(v);
				parent.appendChild(r);
			}

			/** 用最近一次全量数据渲染弹层；没有数据时给出占位行。 */
			function renderPopup() {
				if (!popup) return;
				popup.textContent = "";
				var title = document.createElement("div");
				title.className = "dsh-gq-ptitle";
				title.textContent = "GLM Coding Plan · 5h 窗口";
				popup.appendChild(title);
				var d = lastData;
				var remaining = d && typeof d.remaining === "number" ? d.remaining : null;
				if (remaining === null) {
					pRow(popup, "剩余", "–");
					pRow(popup, "状态", "暂无数据");
					return;
				}
				var vcls = "dsh-gq-ok";
				if (remaining <= 20) vcls = "dsh-gq-low";
				else if (remaining <= 50) vcls = "dsh-gq-warn";
				pRow(popup, "剩余", remaining + "%（已用 " + d.percentage + "%）", vcls);
				if (d.nextResetTime) {
					try {
						var dt = new Date(d.nextResetTime);
						if (!isNaN(dt.getTime())) pRow(popup, "窗口重置", fmtHM(dt));
					} catch (e) { }
				}
				if (d.stale) pRow(popup, "数据", "缓存值（上次刷新失败）");
			}

			/** 弹层出现在徽标正上方，水平方向夹在视口内（composer 在底部，向上弹不会出屏）。 */
			function positionPopup() {
				if (!popup || !badge) return;
				popup.style.top = "auto";
				popup.style.left = "0px";
				popup.style.bottom = "0px";
				var pw = popup.offsetWidth;
				var r = badge.getBoundingClientRect();
				var left = Math.round(Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), Math.max(8, window.innerWidth - pw - 8)));
				var bottom = Math.round(window.innerHeight - r.top + 8);
				popup.style.left = left + "px";
				popup.style.bottom = bottom + "px";
			}

			function openPopup() {
				ensurePopup();
				popupOpen = true;
				renderPopup();
				popup.style.display = "block";
				positionPopup();
				refresh(false);   // 节流内直接用缓存；有新数据时由 refresh 回调就地重绘
			}

			function closePopup() {
				popupOpen = false;
				if (popup !== null) popup.style.display = "none";
			}

			/** 点弹层/徽标以外任意位置关闭（pointerdown 观察不拦截，不吞外部点击）。 */
			function onDocPointerDown(e) {
				if (!popupOpen) return;
				if (popup !== null && popup.contains(e.target)) return;
				if (badge !== null && badge.contains(e.target)) return;
				closePopup();
			}

			function onDocKeyDown(e) {
				if (popupOpen && e.key === "Escape") closePopup();
			}

			var lastFetchAt = 0;
			function refresh(force) {
				var now = Date.now();
				if (!force && now - lastFetchAt < REFRESH_MS) return;
				lastFetchAt = now;
				fetchUsage(force, function (err, data) {
					if (err) { paint({}); return; }
					paint(data);
					// 弹层开着时数据有更新 → 就地重绘（位置也随内容高度微调）
					if (popupOpen) { renderPopup(); positionPopup(); }
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
				ensurePopup();
				document.addEventListener("pointerdown", onDocPointerDown);
				document.addEventListener("keydown", onDocKeyDown);
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
