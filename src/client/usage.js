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
