#!/usr/bin/env node
// ============================================================================
// 零依赖打包器：src/**（CommonJS）→ 单文件构建物
// ----------------------------------------------------------------------------
// 为什么自己写而不用 esbuild：本插件坚持零 npm 依赖（源码即资产、任何机器
// 可构建），而打包需求又非常收敛——相对路径 require + node:* 内建，无动态
// 加载、无循环依赖。于是用一个 ~百行的注册表式打包器：
//
//   产物形态（浏览器半部）：
//     window.__ModuleLoader__.load({ id, factory: () => { __mod 注册表 + 微型
//     require … entry(module, exports, require) … return module.exports } })
//   产物形态（服务端半部，dsh 以 ESM 加载）：
//     hoisted import node:* → 同样的注册表 → export { name, inject, apply }
//
// 源码纪律（违反会在构建期报错，而非运行期）：
//   1. 只允许相对 require，且必须显式带 .js 后缀：require("./util.js")
//   2. node 内建只允许 require("node:xxx")，统一按 default import 提升到顶部
//   3. 禁止循环依赖（DFS 检测，发现即失败）
// ============================================================================
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/** 解析一个 require 目标为源文件绝对路径（仅相对路径 + 显式 .js）。 */
function resolveFrom(fromFile, spec) {
	if (!spec.startsWith(".")) throw new Error(`非相对 require: "${spec}"（node:* 由外部表处理，其余禁止）`);
	const base = resolve(dirname(fromFile), spec);
	if (!spec.endsWith(".js")) throw new Error(`require 必须显式带 .js 后缀: "${spec}"`);
	return base;
}

/** 递归收集模块：返回 Map<absPath, {id, source, deps}>，DFS 后序（依赖在前）。 */
async function collect(entryAbs) {
	const order = new Map(); // absPath -> {id, code, deps[]}
	const stack = [];        // 循环检测
	async function visit(abs) {
		if (order.has(abs)) return;
		if (stack.includes(abs)) throw new Error(`循环依赖: ${stack.concat(abs).join(" -> ")}`);
		stack.push(abs);
		const code = await readFile(abs, "utf8");
		const deps = [];
		const resolvedRequires = new Map();
		const re = /require\(\s*["']([^"']+)["']\s*\)/g;
		let m;
		while ((m = re.exec(code)) !== null) {
			const spec = m[1];
			if (spec.startsWith("node:")) { deps.push(spec); continue; }
			const depAbs = resolveFrom(abs, spec);
			deps.push(depAbs);
			resolvedRequires.set(spec, depAbs);
			await visit(depAbs);
		}
		stack.pop();
		const id = abs;
		const bundledCode = code.replace(re, (_, spec) => {
			if (spec.startsWith("node:")) return _;
			return `require(${JSON.stringify(resolvedRequires.get(spec))})`;
		});
		order.set(abs, { id, code: bundledCode, deps });
	}
	await visit(entryAbs);
	return order;
}

/** 缩进整段源码（保持原文本，只加前缀，避免破坏模板串/正则）。 */
function indent(text, pad) {
	return text.split("\n").map((l) => l === "" ? "" : pad + l).join("\n");
}

/**
 * 打包。
 * @param {object} o
 * @param {string} o.entry   入口源文件（src/ 下）
 * @param {string} o.out     输出文件（lib/ 下）
 * @param {"browser"|"esm"} o.kind 产物形态
 * @param {string} o.banner  产物头注释（含"generated"警示）
 * @param {string} o.id      浏览器半部在 __ModuleLoader__ 注册的 id（必须等于包名）
 */
export async function bundle({ entry, out, kind, banner, id }) {
	const entryAbs = resolve(entry);
	const modules = await collect(entryAbs);
	const externals = new Set();
	for (const { deps } of modules.values()) {
		for (const d of deps) if (d.startsWith("node:")) externals.add(d);
	}

	// —— 注册表：依赖后序天然满足"先定义后使用"——
	const parts = [];
	for (const { id, code } of modules.values()) {
		const rel = relative(resolve(out, "../.."), id).split("\\").join("/");
		parts.push(`\t\t${JSON.stringify(id)}: function (module, exports, require) {\n${indent(code, "\t\t\t")}\n\t\t}, // ↑ ${rel}`);
	}
	const registry = parts.join("\n");
	const entryId = JSON.stringify(entryAbs);

	// —— 外部模块（仅服务端有）：hoisted import + require 表 ——
	const extList = [...externals].sort();
	const extImports = extList.map((s, i) => `import __ext${i} from ${JSON.stringify(s)};`).join("\n");
	const extMap = extList.map((s, i) => `\t\tif (id === ${JSON.stringify(s)}) return __ext${i};`).join("\n");

	let body;
	if (kind === "browser") {
		body = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(id)},
	factory: () => {
		var __mod = {
${registry}
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
		__cache[${entryId}] = m;
		__mod[${entryId}](m, m.exports, __req);
		return m.exports;
	}
});
`;
	} else {
		body = `${extImports ? extImports + "\n" : ""}
var __mod = {
${registry}
};
var __cache = {};
function __req(id) {
	if (__cache[id] !== undefined) return __cache[id].exports;
${extMap}
	if (__mod[id] === undefined) throw new Error("module not found: " + id);
	var m = { exports: {} };
	__cache[id] = m;
	__mod[id](m, m.exports, __req);
	return m.exports;
}
var __entry = { exports: {} };
__mod[${entryId}](__entry, __entry.exports, __req);
const name = __entry.exports.name;
const inject = __entry.exports.inject;
const apply = __entry.exports.apply;
export { name, inject, apply };
`;
	}

	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, banner + "\n" + body);
	return { modules: modules.size, externals: extList.length };
}
