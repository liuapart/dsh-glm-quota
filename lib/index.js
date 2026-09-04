// ============================================================================
// @apanoo/dsh-glm-quota — 服务端半部【构建物，勿手改；改 src/server/ 后 npm run build】
// ============================================================================

import __ext0 from "node:fs";
import __ext1 from "node:os";
import __ext2 from "node:path";

var __mod = {
		"/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/server/fence.js": function (module, exports, require) {
			// ============================================================================
			// 服务端半部 · 信任围栏（安全模型核心，历史迭代结论，勿轻动）
			// ----------------------------------------------------------------------------
			// 语义对齐 dsh-client-connection 的 isTrustedApiRequest：
			//   - sec-fetch-site: cross-site → 拒绝（跨站请求直接拒绝）
			//   - 带 Origin 时必须与 Host 完全一致 → 否则拒绝
			//   - Host 必须是回环/私网字面量/部署域名白名单 → 否则拒绝
			//     （DNS-rebinding 防线：域名解析拦不住 IP 字面量，所以按字面量判断）
			// 域名入口（ai.apanoo.cn）：请求必经 Caddy（remote_ip 白名单 + basic_auth）
			// 才能到达 dsh（3080 只绑 loopback，外部无法直连），故域名 Host 等价于
			// 已通过认证的 LAN 来源；本围栏是纵深防御的第二层，非唯一防线。
			// ============================================================================
			const EXTRA_TRUSTED_HOSTNAMES = new Set(["ai.apanoo.cn"]);

			function trustedHostname(hostname) {
				if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") return true;
				if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(hostname)) return true;
				if (/^f[cd][0-9a-f]{2}:/.test(hostname)) return true;
				return EXTRA_TRUSTED_HOSTNAMES.has(hostname);
			}

			/** 请求级信任判定：false → 调用方必须 403，不得继续任何业务逻辑。 */
			function isTrustedRequest(req) {
				const host = String(req.headers.host ?? "");
				if (req.headers["sec-fetch-site"] === "cross-site") return false;
				const origin = req.headers.origin;
				if (origin !== undefined) {
					try {
						if (new URL(String(origin)).host !== host) return false;
					} catch {
						return false; // Origin 头畸形 → 视为不可信
					}
				}
				const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
				return trustedHostname(hostname);
			}

			module.exports = { isTrustedRequest };

		}, // ↑ src/server/fence.js
		"/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/server/index.js": function (module, exports, require) {
			// ============================================================================
			// @apanoo/dsh-glm-quota — 服务端半部入口（host plugin，ESM 由打包器生成到 lib/index.js）
			// ----------------------------------------------------------------------------
			// 职责：注册 /glm-quota 精确路由，为浏览器半部提供 GLM Coding Plan 的
			//       5 小时滚动 token 窗口用量（剩余百分比 + 重置时间）。
			//
			// 数据源（社区实证，pi-zai-usage / cc-switch 同款）：
			//   GET {base}/api/monitor/usage/quota/limit     Authorization: Bearer <key>
			//   响应 data.limits[]：type=TOKENS_LIMIT & unit=3 → 5h 窗口，字段 percentage
			//   （已用%，服务端算好）与 nextResetTime。剩余% = 100 − percentage。
			//   base：provider zai-coding-cn / 含 bigmodel → open.bigmodel.cn（本机固定走这个），
			//   可用环境变量 GLM_QUOTA_BASE 覆盖。
			//
			// 凭据（key 永不出服务端）：
			//   1) process.env.ZAI_CODING_CN_API_KEY   2) ~/.dsh/.credentials.yaml 的
			//   refs.ZAI_CODING_CN_API_KEY（dsh 自己的凭据解析路径，launchd 环境里没有 env，
			//   实测以文件为准）。
			//
			// 安全：/glm-quota 走 web-kit 同款信任围栏（fence.js，语义对齐
			//   dsh-client-connection 的 isTrustedApiRequest），域名入口另有 Caddy
			//   basic_auth + remote_ip 白名单，这里是纵深防御第二层。
			// ============================================================================
			const { readFileSync } = require("node:fs");
			const { join } = require("node:path");
			const { homedir } = require("node:os");
			const { isTrustedRequest } = require("/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/server/fence.js");

			const name = "glm-quota";
			const inject = ["webServer"];

			const ROUTE = "/glm-quota";
			const POLL_MS = 5 * 60 * 1000;
			const BASE = process.env.GLM_QUOTA_BASE || "https://open.bigmodel.cn";

			let cache = null;      // { percentage, nextResetTime, fetchedAt, stale }
			let inFlight = false;

			function readKey() {
				if (process.env.ZAI_CODING_CN_API_KEY) return process.env.ZAI_CODING_CN_API_KEY;
				try {
					const home = process.env.DSH_HOME || join(homedir(), ".dsh");
					const text = readFileSync(join(home, ".credentials.yaml"), "utf8");
					const m = text.match(/^[ \t]*ZAI_CODING_CN_API_KEY:[ \t]*(.+?)[ \t]*$/m);
					if (!m) return null;
					return m[1].replace(/^["']|["']$/g, "");
				} catch {
					return null;
				}
			}

			async function refresh(logger) {
				if (inFlight) return;
				inFlight = true;
				try {
					const key = readKey();
					if (!key) throw new Error("api key not found");
					const res = await fetch(BASE + "/api/monitor/usage/quota/limit", {
						headers: { Authorization: "Bearer " + key }
					});
					if (!res.ok) throw new Error("http " + res.status);
					const body = await res.json();
					const five = (body?.data?.limits ?? []).find(
						(l) => l.type === "TOKENS_LIMIT" && l.unit === 3
					);
					if (!five) throw new Error("no 5h limit entry");
					cache = {
						percentage: Number(five.percentage) || 0,
						nextResetTime: five.nextResetTime ?? null,
						fetchedAt: Date.now(),
						stale: false
					};
					if (logger?.info) logger.info("glm-quota: usage refreshed (used " + cache.percentage + "%)");
				} catch (error) {
					if (cache) cache.stale = true;   // 失败保留上次值，标 stale
					if (logger?.warn) logger.warn("glm-quota: refresh failed: " + (error instanceof Error ? error.message : String(error)));
				} finally {
					inFlight = false;
				}
			}

			function json(res, code, body) {
				res.writeHead(code, { "content-type": "application/json" });
				res.end(JSON.stringify(body));
			}

			/** dsh 生命周期入口：注册 /glm-quota 精确路由 + 轮询定时器，随插件卸载自动销毁。 */
			function apply(ctx) {
				const handler = async (req, res) => {
					try {
						// ---------- ① 信任围栏（先于一切业务逻辑） ----------
						if (!isTrustedRequest(req)) return json(res, 403, { error: "forbidden" });
						// ---------- ② 方法与路径 ----------
						if (req.method !== "GET") return json(res, 405, { error: "method-not-allowed" });
						const url = new URL(req.url ?? "/", "http://internal");
						if (url.pathname !== ROUTE) return json(res, 404, { error: "not-found" });
						// ---------- ③ 取数：?refresh=1 强制拉一次；否则缓存为空时拉 ----------
						const force = url.searchParams.get("refresh") === "1";
						if (force || cache === null) await refresh(ctx.logger);
						if (cache === null) return json(res, 200, { ok: false, reason: "no-data" });
						return json(res, 200, {
							ok: true,
							remaining: Math.max(0, 100 - cache.percentage),
							percentage: cache.percentage,
							nextResetTime: cache.nextResetTime,
							fetchedAt: cache.fetchedAt,
							stale: !!cache.stale
						});
					} catch (error) {
						return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
					}
				};
				ctx.effect(() => ctx.webServer.register({
					kind: "exact",
					path: ROUTE,
					handler
				}), "glm-quota: /glm-quota route");
				ctx.effect(() => {
					refresh(ctx.logger);
					const t = setInterval(() => refresh(ctx.logger), POLL_MS);
					return () => clearInterval(t);
				}, "glm-quota: poll timer");
			}

			module.exports = { name, inject, apply };

		}, // ↑ src/server/index.js
};
var __cache = {};
function __req(id) {
	if (__cache[id] !== undefined) return __cache[id].exports;
		if (id === "node:fs") return __ext0;
		if (id === "node:os") return __ext1;
		if (id === "node:path") return __ext2;
	if (__mod[id] === undefined) throw new Error("module not found: " + id);
	var m = { exports: {} };
	__cache[id] = m;
	__mod[id](m, m.exports, __req);
	return m.exports;
}
var __entry = { exports: {} };
__mod["/Users/apanoo/worsp/codex-workspace/test/dsh-repair/dsh-glm-quota/src/server/index.js"](__entry, __entry.exports, __req);
const name = __entry.exports.name;
const inject = __entry.exports.inject;
const apply = __entry.exports.apply;
export { name, inject, apply };
