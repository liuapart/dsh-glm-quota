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
const { isTrustedRequest } = require("./fence.js");

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
