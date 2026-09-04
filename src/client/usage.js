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
