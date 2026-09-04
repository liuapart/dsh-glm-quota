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
