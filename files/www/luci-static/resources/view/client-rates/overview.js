'use strict';
'require view';
'require rpc';
'require client-rates.brand as brand';

var callStatus = rpc.declare({
	object: 'luci.client_rates',
	method: 'status'
});

/* 速率: 数值大时自动减小数位, 9 列后每个数值列只剩 80px 左右 */
function fmtRate(v) {
	v = v || 0;
	var f = (v >= 102400) ? '%1024.0mB/s' : ((v >= 10240) ? '%1024.1mB/s' : '%1024.2mB/s');
	return String.format(f, v);
}

function fmtB(v) { return String.format('%1024.2mB', v || 0); }

/* 今日流量是累计值, 两位小数没意义: 按量级降精度 —— "629 MiB" / "16.9 MiB"。
 * 精确值放 title(设备行里有两行, 太长的数字会挤掉 IPv6 那一行) */
function fmtDay(v) {
	v = v || 0;
	if (v < 1) return '0\u00a0B';
	var u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'], i = 0, n = v;
	while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
	var d = (n >= 100) ? 0 : (n >= 10 ? 1 : 2);
	return n.toFixed(d) + '\u00a0' + u[i];
}

/* 后端的 up_today/down_today 是「v4 + v6」的总量(v6 也并入设备总量),
 * 所以 v4 那一行要用差值算, 否则和下面 v6 行重复计数 */
function v4Today(c, dir) {
	var all = (dir == 'up' ? c.up_today : c.down_today) || 0;
	var s6 = (dir == 'up' ? c.up6_today : c.down6_today) || 0;
	return (all > s6) ? (all - s6) : 0;
}

function dayTitle(c, v6, dir) {
	var up = dir == 'up';
	if (v6 && !c.ip6) return '';
	return (v6 ? 'IPv6' : 'IPv4') + ' ' + _('今日') + ': ↑\u00a0'
		+ fmtB(v6 ? c.up6_today : v4Today(c, 'up')) + '\u00a0\u00a0↓\u00a0'
		+ fmtB(v6 ? c.down6_today : v4Today(c, 'down'));
}

function rateTitle(c, v6, dir) {
	if (v6 && !c.ip6) return '';
	var up = dir == 'up';
	return (v6 ? 'IPv6' : 'IPv4') + ': ↑\u00a0' + fmtRate(v6 ? c.up6 : c.up)
		+ '\u00a0\u00a0↓\u00a0' + fmtRate(v6 ? c.down6 : c.down);
}

/* 离线设备只在列表里保留最近 24h 出现过的(与后端 cr-sampler 的 OFFLINE_WIN 一致) */
var OFFLINE_WIN = 86400;

/* 后端已过滤, 这里兜底: 兼容只更新了前端的旧固件 */
function keepRecent(list, ts) {
	var nowSec = ts || Math.floor(Date.now() / 1000);
	var hid = 0;
	var out = list.filter(function (c) {
		if (c.online) return true;
		/* last_seen 缺失时退回 first_seen, 与后端口径一致 */
		var ref = c.last_seen || c.first_seen || 0;
		if (!ref || (nowSec - ref) <= OFFLINE_WIN) return true;
		hid++;
		return false;
	});
	return { list: out, hidden: hid };
}

/* ===== 移动端: 卡片视图 (参考 OAF 用户列表的 user-card) ===== */
var STYLE_ID = 'cr-dev-style';
var CSS = ''
	+ '.cr-dev-cards{display:none;flex-direction:column;gap:10px}'
	+ '.cr-dev-card{border:1px solid rgba(127,127,127,.22);border-radius:12px;padding:11px 13px;'
	+ 'display:flex;flex-direction:column;gap:8px;box-sizing:border-box}'
	+ '.cr-dev-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}'
	+ '.cr-dev-card-dev{display:flex;align-items:center;gap:8px;min-width:0}'
	+ '.cr-dev-card-titwrap{min-width:0}'
	+ '.cr-dev-card-title{font-weight:700;font-size:14px;line-height:1.3;overflow:hidden;'
	+ 'text-overflow:ellipsis;white-space:nowrap}'
	+ '.cr-dev-card-sub{margin-top:2px;font-size:11.5px;opacity:.6;overflow:hidden;text-overflow:ellipsis;'
	+ 'white-space:nowrap}'
	/* 状态胶囊: 在线=绿, 离线=中性灰。不用 LuCI 的 label.notice —— 主题把 notice 渲染成
	 * 主色蓝青, 和「在线」一样抢眼, 语义反了; 暗色下再用浅一档的字色保证对比度 */
	+ '.cr-dev-pill{display:inline-block;white-space:nowrap;font-size:12px;line-height:1.5;font-weight:600;'
	+ 'padding:1px 9px;border-radius:999px;border:1px solid transparent;box-sizing:border-box}'
	+ '.cr-dev-pill.on{color:#15803d;background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.38)}'
	+ '.cr-dev-pill.off{color:#6b7280;background:rgba(148,163,184,.14);border-color:rgba(148,163,184,.32)}'
	+ '.cr-dev-card-pill{flex:0 0 auto;font-size:11.5px;padding:2px 8px}'
	+ '.cr-dev-card-body{display:flex;flex-direction:column;gap:6px}'
	+ '.cr-dev-card-line{display:flex;align-items:baseline;justify-content:space-between;gap:12px;'
	+ 'font-size:12.5px;line-height:1.35}'
	+ '.cr-dev-card-k{flex:0 0 auto;opacity:.6}'
	+ '.cr-dev-card-v{min-width:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
	+ 'font-variant-numeric:tabular-nums}'
	/* 数值列两行: 上 IPv4, 下 IPv6(淡色小字)。opacity 只压第二行,
	 * 父级的下行蓝 / 上行橙仍保留 —— 一眼能看出是同一个指标的两条路径 */
	+ '.cr-dv{display:inline-flex;flex-direction:column;align-items:flex-end;line-height:1.26;'
	+ 'font-variant-numeric:tabular-nums;vertical-align:middle;max-width:100%;min-width:0}'
	+ '.cr-dv>span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
	+ '.cr-dv .cr-dv6{font-size:11px;opacity:.55;font-weight:400}'
	+ '.cr-dip{display:inline-flex;flex-direction:column;line-height:1.26;vertical-align:middle;'
	+ 'min-width:0;max-width:100%}'
	+ '.cr-dip>span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
	+ '.cr-dip .cr-dv6{font-size:11px;opacity:.6}'
	/* 状态列表头居中(cascade.css 里 th:nth-child(8)), 单元格原来带 .td.left 左对齐,
	 * 两边一个居中一个贴左, 看着永远差半格 → 单元格也居中。
	 * 新增「连接数」列后状态列从第 8 列变成第 9 列, 一并接管表头对齐 */
	+ '.cr-table-wrap > .cr-dev-table th:nth-child(8){text-align:right!important}'
	+ '.cr-table-wrap > .cr-dev-table th:nth-child(9){text-align:center!important}'
	+ '.cr-table-wrap > .cr-dev-table > tbody > tr > td:nth-child(9){text-align:center!important}'
	+ '.cr-dev-empty{padding:14px 4px;opacity:.6;text-align:center}'
	+ '.cr-tup{margin-left:.55em}'
	+ '.cr-legend{font-size:78%;opacity:.5;margin-left:.2em}'
	/* 统计卡两行: 上行 IPv4(继承 170% 字号), 下行 IPv6(.62em 淡色)。
	 * 用 em 而非 px, 手机端 .cr-dev-stats 把字号压到 140% 时能跟着缩 */
	+ '.cr-sv4{display:block;line-height:1.2}'
	+ '.cr-sv6{display:block;font-size:.62em;font-weight:400;opacity:.6;line-height:1.3;'
	+ 'font-variant-numeric:tabular-nums}'
	/* 2K/4K 下所有列按比例一起拉宽, 数值离表头太远显得散 —— 与「在线主机」页同口径:
	 * 整块限宽 1800px(左对齐), 超过 2000px 再把字号提一档, 让密度跟着宽度放大 */
	+ '.cr-dev-box{max-width:1800px}'
	+ '@media (min-width:2000px){'
	+ '.cr-dev-box .cr-dev-table{font-size:0.875rem}'
	+ '.cr-dv .cr-dv6{font-size:12px}'
	+ '.cr-dip .cr-dv6{font-size:12px}'
	+ '}'
	+ '@media (max-width:768px){'
	+ '.cr-dev-cards{display:flex}'
	+ '.cr-table-wrap{display:none!important}'
	+ '.cr-dev-stats{gap:8px!important;margin-bottom:12px!important}'
	+ '.cr-dev-stats>div{padding:9px 11px!important;flex:1 1 7rem}'
	+ '.cr-dev-stats .cr-dev-stat-val{font-size:140%!important}'
	+ '.cr-tup{display:block;margin-left:0}'
	+ '}'
	+ '@media (prefers-color-scheme:dark){'
	+ '.cr-dev-pill.on{color:#4ade80;background:rgba(34,197,94,.2);border-color:rgba(34,197,94,.42)}'
	+ '.cr-dev-pill.off{color:#9aa0a6;background:rgba(148,163,184,.16);border-color:rgba(148,163,184,.34)}'
	+ '.cr-dv .cr-dv6{opacity:.7}'
	+ '.cr-dip .cr-dv6{opacity:.72}'
	+ '.cr-sv6{opacity:.72}'
	+ '}';

function ensureStyle() {
	if (document.getElementById(STYLE_ID))
		return;
	var s = document.createElement('style');
	s.id = STYLE_ID;
	s.appendChild(document.createTextNode(CSS));
	document.head.appendChild(s);
}

function stat(label, color) {
	/* 两行: 上 IPv4(主, 继承卡片字号), 下 IPv6(.62em 淡色)。
	 * 子元素用 em 而不是固定 px —— 手机上 .cr-dev-stats 会把字号压到 140%,
	 * em 才能跟着一起缩 */
	var v4 = E('span', { 'class': 'cr-sv4' }, ['-']);
	var v6 = E('span', { 'class': 'cr-sv6' }, ['-']);
	var val = E('div', { 'class': 'cr-dev-stat-val',
		'style': 'font-size:170%;font-weight:600;line-height:1.2' + (color ? ';color:' + color : '') },
		[v4, v6]);
	var box = E('div', {
		// flex-basis 用 rem、min-width:0 + border-box，4 张卡片才能等分且不溢出容器
		'style': 'flex:1 1 8rem;min-width:0;box-sizing:border-box;padding:12px 14px;border:1px solid rgba(128,128,128,.22);border-radius:10px;background:rgba(128,128,128,.04)'
	}, [
		E('div', { 'style': 'font-size:85%;opacity:.65;margin-bottom:4px' }, [label]),
		val
	]);
	return { box: box, val: val, v4: v4, v6: v6 };
}

return view.extend({
	load: function () {
		return Promise.all([L.resolveDefault(callStatus(), {}), brand.load()]);
	},

	render: function (res) {
		var data = res[0] || {};
		var rows = {};
		var order = [];

		var sDown = stat(_('实时下行'), '#2f7ed8');
		var sUp = stat(_('实时上行'), '#e08b2c');
		var sToday = stat(_('今日总流量'));
		var sOnline = stat(_('在线设备'));
		/* 今日流量每行是「↓ 下行 + ↑ 上行」两段: 桌面同行, 手机上 ↑ 换到第二行,
		 * 否则「↑」会被挤到卡片边缘 */
		var tdnEl = E('span', { 'class': 'cr-tdn' }, ['-']);
		var tupEl = E('span', { 'class': 'cr-tup' }, ['-']);
		var tdn6El = E('span', { 'class': 'cr-tdn' }, ['-']);
		var tup6El = E('span', { 'class': 'cr-tup' }, ['-']);
		while (sToday.v4.firstChild) sToday.v4.removeChild(sToday.v4.firstChild);
		sToday.v4.appendChild(tdnEl);
		sToday.v4.appendChild(tupEl);
		while (sToday.v6.firstChild) sToday.v6.removeChild(sToday.v6.firstChild);
		sToday.v6.appendChild(tdn6El);
		sToday.v6.appendChild(tup6El);
		/* 在线设备是一台数一台, 没有 v4/v6 之分 */
		sOnline.v6.style.display = 'none';

		var tbody = E('tbody', {});
		var cardsEmpty = E('div', { 'class': 'cr-dev-empty' }, [_('暂无活动设备')]);
		var cardsEl = E('div', { 'class': 'cr-dev-cards' }, [cardsEmpty]);
		var hiddenEl = E('span', { 'style': 'display:none;color:#b45309' }, ['']);
		var hint = E('div', { 'style': 'font-size:85%;margin:6px 0 10px;display:flex;flex-wrap:wrap;gap:2px 10px' }, [
			E('span', { 'style': 'opacity:.6' },
				[data.hnat ? _('数据源：conntrack + HNAT 硬件流表双源采样，硬件加速下同样计入')
				           : _('未检测到 HNAT 硬件流表，当前仅统计软件路径')]),
			E('span', { 'class': 'cr-legend' }, [_('统计卡与表格数值均为两行：上 IPv4、下 IPv6')]),
			hiddenEl
		]);

		function cell(text, style) {
			return E('td', { 'class': 'td left', 'style': style || '' }, [text]);
		}

		function cardLine(label) {
			var v = E('span', { 'class': 'cr-dev-card-v' }, ['-']);
			return { line: E('div', { 'class': 'cr-dev-card-line' }, [
				E('span', { 'class': 'cr-dev-card-k' }, [label]), v
			]), v: v };
		}

		/* 卡片里的两行值: 与表格同一套 .cr-dv, 保证两处字号口径一致 */
		function cardLine2(label) {
			var a = E('span', {}, ['-']);
			var b = E('span', { 'class': 'cr-dv6' }, ['-']);
			var box = E('span', { 'class': 'cr-dv' }, [a, b]);
			return { line: E('div', { 'class': 'cr-dev-card-line' }, [
				E('span', { 'class': 'cr-dev-card-k' }, [label]), box
			]), v4: a, v6: b, box: box };
		}

		/* 两行数值: 上 IPv4(主), 下 IPv6(淡色小字)。
		 * 没有 v6 地址时第二行给占位符, 行高与数字基线才不会跳 */
		function pair(color) {
			var a = E('span', {}, ['-']);
			var b = E('span', { 'class': 'cr-dv6' }, ['-']);
			var box = E('span', { 'class': 'cr-dv', 'style': color ? 'color:' + color : '' }, [a, b]);
			return { box: box, a: a, b: b };
		}

		function rowFor(c) {
			var key = c.mac || ('ip:' + c.ip);
			var r = rows[key];
			if (r) return r;
			var nameEl = E('span', { 'style': 'font-weight:600;display:inline-block;max-width:8.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle' }, ['-']);
			var subEl = E('span', { 'style': 'font-size:85%;opacity:.6;margin-left:6px' }, ['']);
			var ip4El = E('span', {}, ['-']);
			var ip6El = E('span', { 'class': 'cr-dv6' }, ['-']);
			var ipWrap = E('span', { 'class': 'cr-dip' }, [ip4El, ip6El]);
			var macEl = E('span', {}, ['-']);
			var downP = pair('#2f7ed8'), upP = pair('#e08b2c');
			var tDownP = pair(), tUpP = pair(), connP = pair();
			downP.box.style.fontWeight = '600';
			upP.box.style.fontWeight = '600';
			var statEl = E('span', { 'class': 'cr-dev-pill on' }, ['-']);
			var iconWrap = E('span', { 'style': 'vertical-align:middle' });

			var tr = E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'style': 'white-space:nowrap' }, [iconWrap, nameEl, subEl]),
				cell(ipWrap),
				cell(macEl),
				E('td', { 'class': 'td right' }, [downP.box]),
				E('td', { 'class': 'td right' }, [upP.box]),
				E('td', { 'class': 'td right' }, [tDownP.box]),
				E('td', { 'class': 'td right' }, [tUpP.box]),
				E('td', { 'class': 'td right' }, [connP.box]),
				E('td', { 'class': 'td left' }, [statEl])
			]);

			/* 移动端卡片 */
			var cTitle = E('div', { 'class': 'cr-dev-card-title' }, ['-']);
			var cSub = E('div', { 'class': 'cr-dev-card-sub' }, ['']);
			var cPill = E('span', { 'class': 'cr-dev-card-pill cr-dev-pill on' }, [_('在线')]);
			var cIp = cardLine2(_('IP 地址'));
			var cMac = cardLine(_('MAC'));
			var cDown = cardLine2(_('下行'));
			var cUp = cardLine2(_('上行'));
			var cTDown = cardLine2(_('今日下行'));
			var cTUp = cardLine2(_('今日上行'));
			var cConn = cardLine2(_('连接数'));
			cDown.box.style.color = '#2f7ed8'; cDown.box.style.fontWeight = '600';
			cUp.box.style.color = '#e08b2c'; cUp.box.style.fontWeight = '600';

			var card = E('div', { 'class': 'cr-dev-card' }, [
				E('div', { 'class': 'cr-dev-card-head' }, [
					E('div', { 'class': 'cr-dev-card-dev' }, [
						E('span', { 'class': 'cr-dev-card-ic' }, [brand.icon(c.mac, 24)]),
						E('div', { 'class': 'cr-dev-card-titwrap' }, [cTitle, cSub])
					]),
					cPill
				]),
				E('div', { 'class': 'cr-dev-card-body' }, [
					cIp.line, cMac.line, cDown.line, cUp.line,
					cTDown.line, cTUp.line, cConn.line
				])
			]);

			r = { tr: tr, iconWrap: iconWrap, nameEl: nameEl, subEl: subEl,
			      ip4El: ip4El, ip6El: ip6El, macEl: macEl,
			      down4: downP.a, down6: downP.b, up4: upP.a, up6: upP.b,
			      tDown4: tDownP.a, tDown6: tDownP.b, tUp4: tUpP.a, tUp6: tUpP.b,
			      conn4: connP.a, conn6: connP.b,
			      statEl: statEl, iconKey: null,
			      card: card, cTitle: cTitle, cSub: cSub, cPill: cPill,
			      cIp: cIp.v4, cIp6: cIp.v6, cMac: cMac.v,
			      cDown: cDown.v4, cDown6: cDown.v6, cUp: cUp.v4, cUp6: cUp.v6,
			      cTDown: cTDown.v4, cTDown6: cTDown.v6, cTUp: cTUp.v4, cTUp6: cTUp.v6,
			      cConn: cConn.v4, cConn6: cConn.v6 };
			rows[key] = r;
			tbody.appendChild(tr);
			return r;
		}

		function update(d) {
			var wan = (d && d.wan) || {};
			/* 后端 wan.up/down/up_today/down_today 都是 v4+v6 合计,
			 * 单独给了 v6 分量 → v4 = 总量 − v6, 三个数字互相自洽 */
			var u6 = wan.up6 || 0, dn6 = wan.down6 || 0;
			var tu6 = wan.up6_today || 0, td6 = wan.down6_today || 0;
			var u4 = Math.max(0, (wan.up || 0) - u6);
			var dn4 = Math.max(0, (wan.down || 0) - dn6);
			var tu4 = Math.max(0, (wan.up_today || 0) - tu6);
			var td4 = Math.max(0, (wan.down_today || 0) - td6);
			var hasV6 = (u6 + dn6 + tu6 + td6) > 0;

			sDown.v4.textContent = fmtRate(dn4);
			sDown.v6.textContent = fmtRate(dn6);
			sUp.v4.textContent = fmtRate(u4);
			sUp.v6.textContent = fmtRate(u6);
			tdnEl.textContent = '↓ ' + fmtB(td4);
			tupEl.textContent = '↑ ' + fmtB(tu4);
			tdn6El.textContent = '↓ ' + fmtB(td6);
			tup6El.textContent = '↑ ' + fmtB(tu6);
			/* 纯 v4 网络下不显示一行恒为 0 的 IPv6 */
			[sDown, sUp, sToday].forEach(function (s) {
				s.v6.style.display = hasV6 ? '' : 'none';
			});
			sOnline.v4.textContent = String((d && d.online) || 0);

			var list = ((d && d.clients) || []).slice();
			var recent = keepRecent(list, d && d.ts);
			list = recent.list;
			var hid = (d && d.hidden != null) ? (+d.hidden || 0) : recent.hidden;
			if (hid > 0) {
				hiddenEl.style.display = '';
				hiddenEl.textContent = String.format(_('另有 %d 台超过 24 小时未上线的设备已隐藏'), hid);
			}
			else {
				hiddenEl.style.display = 'none';
			}
			/* 按实时总速率(含 v6)排序, 与上一页同口径 */
			list.sort(function (a, b) {
				var sa = (a.up || 0) + (a.down || 0) + (a.up6 || 0) + (a.down6 || 0);
				var sb = (b.up || 0) + (b.down || 0) + (b.up6 || 0) + (b.down6 || 0);
				return sb - sa;
			});

			var keys = [];
			list.forEach(function (c) {
				var key = c.mac || ('ip:' + c.ip);
				keys.push(key);
				var r = rowFor(c);
				var title = c.host || brand.name(c.mac) || c.ip || c.mac || '?';
				var vname = brand.name(c.mac);
				r.nameEl.textContent = title;
				r.nameEl.title = title;
				r.subEl.textContent = (c.host && vname) ? vname : '';
				r.statEl.textContent = c.online ? _('在线') : _('离线');
				r.statEl.className = 'cr-dev-pill ' + (c.online ? 'on' : 'off');

				/* 表格: 每列两行, 上 v4 下 v6; 无 v6 地址时第二行给占位符 */
				var v6 = !!c.ip6;
				r.ip4El.textContent = c.ip || '-';
				r.ip6El.textContent = v6 ? c.ip6 : '\u2013';
				r.ip6El.title = c.ip6 || '';
				r.macEl.textContent = c.mac || '-';

				r.down4.textContent = fmtRate(c.down);
				r.down4.title = rateTitle(c, false, 'down');
				r.down6.textContent = v6 ? fmtRate(c.down6) : '\u2013';
				r.down6.title = rateTitle(c, true, 'down');
				r.up4.textContent = fmtRate(c.up);
				r.up4.title = rateTitle(c, false, 'up');
				r.up6.textContent = v6 ? fmtRate(c.up6) : '\u2013';
				r.up6.title = rateTitle(c, true, 'up');

				r.tDown4.textContent = fmtDay(v4Today(c, 'down'));
				r.tDown4.title = dayTitle(c, false, 'down');
				r.tDown6.textContent = v6 ? fmtDay(c.down6_today) : '\u2013';
				r.tDown6.title = dayTitle(c, true, 'down');
				r.tUp4.textContent = fmtDay(v4Today(c, 'up'));
				r.tUp4.title = dayTitle(c, false, 'up');
				r.tUp6.textContent = v6 ? fmtDay(c.up6_today) : '\u2013';
				r.tUp6.title = dayTitle(c, true, 'up');

				r.conn4.textContent = (c.conn != null) ? String(c.conn) : '-';
				r.conn4.title = 'IPv4';
				r.conn6.textContent = v6 ? String(c.conn6 || 0) : '\u2013';
				r.conn6.title = 'IPv6';

				/* 卡片视图 */
				r.cTitle.textContent = title;
				r.cTitle.title = title;
				r.cSub.textContent = (c.host && vname) ? vname : '';
				r.cPill.textContent = c.online ? _('在线') : _('离线');
				r.cPill.className = 'cr-dev-card-pill cr-dev-pill ' + (c.online ? 'on' : 'off');
				r.cIp.textContent = c.ip || '-';
				r.cIp6.textContent = v6 ? c.ip6 : '\u2013';
				r.cMac.textContent = c.mac || '-';
				r.cDown.textContent = fmtRate(c.down);
				r.cDown6.textContent = v6 ? fmtRate(c.down6) : '\u2013';
				r.cUp.textContent = fmtRate(c.up);
				r.cUp6.textContent = v6 ? fmtRate(c.up6) : '\u2013';
				r.cTDown.textContent = fmtDay(v4Today(c, 'down'));
				r.cTDown6.textContent = v6 ? fmtDay(c.down6_today) : '\u2013';
				r.cTUp.textContent = fmtDay(v4Today(c, 'up'));
				r.cTUp6.textContent = v6 ? fmtDay(c.up6_today) : '\u2013';
				r.cConn.textContent = (c.conn != null) ? String(c.conn) : '-';
				r.cConn6.textContent = v6 ? String(c.conn6 || 0) : '\u2013';

				var ik = (c.mac || '') + '|' + (c.online ? '1' : '0');
				if (r.iconKey !== ik) {
					r.iconKey = ik;
					while (r.iconWrap.firstChild) r.iconWrap.removeChild(r.iconWrap.firstChild);
					r.iconWrap.appendChild(brand.icon(c.mac, 22));
					var cic = r.card.querySelector('.cr-dev-card-ic');
					if (cic) {
						while (cic.firstChild) cic.removeChild(cic.firstChild);
						cic.appendChild(brand.icon(c.mac, 24));
					}
				}
			});

			/* 移除已消失的设备 */
			Object.keys(rows).forEach(function (k) {
				if (keys.indexOf(k) < 0) {
					var r = rows[k];
					if (r.tr.parentNode) r.tr.parentNode.removeChild(r.tr);
					if (r.card.parentNode) r.card.parentNode.removeChild(r.card);
					delete rows[k];
				}
			});

			/* 仅当顺序变化时重排，避免每秒抖动 */
			if (order.join(',') !== keys.join(',')) {
				order = keys;
				keys.forEach(function (k) {
					tbody.appendChild(rows[k].tr);
					cardsEl.appendChild(rows[k].card);
				});
			}

			if (!keys.length) {
				if (!tbody.querySelector('.empty-hint'))
					tbody.appendChild(E('tr', { 'class': 'tr empty-hint' }, [
						E('td', { 'class': 'td left', 'colspan': 9, 'style': 'opacity:.6' }, [_('暂无活动设备')])
					]));
			}
			else {
				var eh = tbody.querySelector('.empty-hint');
				if (eh) eh.parentNode.removeChild(eh);
			}
			cardsEmpty.style.display = keys.length ? 'none' : '';
		}

		var table = E('table', { 'class': 'table cr-dev-table' }, [
			E('thead', {}, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, [_('设备')]),
					E('th', { 'class': 'th' }, [_('IP 地址')]),
					E('th', { 'class': 'th' }, [_('MAC')]),
					E('th', { 'class': 'th', 'style': 'text-align:right' }, [_('下行')]),
					E('th', { 'class': 'th', 'style': 'text-align:right' }, [_('上行')]),
					E('th', { 'class': 'th', 'style': 'text-align:right' }, [_('今日下行')]),
					E('th', { 'class': 'th', 'style': 'text-align:right' }, [_('今日上行')]),
					E('th', { 'class': 'th', 'style': 'text-align:right' }, [_('连接数')]),
					E('th', { 'class': 'th' }, [_('状态')])
				])
			]),
			tbody
		]);

		ensureStyle();

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [_('设备流量')]),
			hint,
			E('div', { 'class': 'cr-dev-box' }, [
				E('div', { 'class': 'cr-dev-stats', 'style': 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px' },
					[sDown.box, sUp.box, sToday.box, sOnline.box]),
				E('div', { 'class': 'cr-table-wrap' }, [table]),
				cardsEl
			])
		]);

		update(data);

		var timer = setInterval(function () {
			if (document.hidden) return;
			callStatus().then(update).catch(function () {});
		}, 1000);

		this._timer = timer;
		return container;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
