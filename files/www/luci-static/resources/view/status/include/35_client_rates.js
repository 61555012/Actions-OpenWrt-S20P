'use strict';
'require baseclass';
'require rpc';
'require client-rates.brand as brand';

var callStatus = rpc.declare({
	object: 'luci.client_rates',
	method: 'status'
});

var STYLE_ID = 'cr-hosts-style';
var CSS = ''
	+ '.cr-hosts-head{display:flex;flex-wrap:wrap;gap:26px;align-items:baseline;padding:10px 14px;'
	+ 'border-radius:8px;background:rgba(127,127,127,.09);font-size:13px;margin:0 0 10px}'
	+ '.cr-hosts-head .k{opacity:.6;margin-right:6px}'
	+ '.cr-hosts-head .v{font-weight:600;font-variant-numeric:tabular-nums}'
	+ '.cr-hosts-table{display:table;width:100%;min-width:66rem;font-size:13px;border-collapse:collapse;table-layout:fixed}'
	+ '.cr-hosts-table th{font-weight:600;white-space:nowrap;padding:8px 5px !important;text-align:left;'
	+ 'border-bottom:1px solid rgba(127,127,127,.25);overflow:hidden;text-overflow:ellipsis}'
	+ '.cr-hosts-table td{padding:7px 5px !important;vertical-align:middle;overflow:hidden;white-space:nowrap;'
	+ 'text-overflow:ellipsis;border-bottom:1px solid rgba(127,127,127,.12)}'
	+ '.cr-hosts-table td.num{text-align:right !important;font-variant-numeric:tabular-nums;font-size:11.5px}'
	+ '.cr-hosts-table th.num{text-align:right !important}'
	+ '.cr-hosts-table th.ctr,.cr-hosts-table td.ctr{text-align:center !important}'
	+ '.cr-hosts-table tr{display:table-row}'
	+ '.cr-hosts-table th,.cr-hosts-table td{display:table-cell}'
	/* argon 在 <1100px 把 .table 改成 block、.tr 改成 flex, 表头与数据各算各的列宽;
	   本表必须保持真实表格, 窄屏改成 .cr-hosts-wrap 内横向滚动(与「设备流量」页同口径)。
	   选择器要压过主题的 .table .tr(0,2,0), 所以都带 !important + 双层类名 */
	+ '.cr-hosts-wrap .cr-hosts-table{display:table !important;width:100% !important}'
	+ '.cr-hosts-wrap .cr-hosts-table>thead{display:table-header-group !important}'
	+ '.cr-hosts-wrap .cr-hosts-table>tbody{display:table-row-group !important}'
	+ '.cr-hosts-wrap .cr-hosts-table tr{display:table-row !important}'
	+ '.cr-hosts-wrap .cr-hosts-table th,.cr-hosts-wrap .cr-hosts-table td{display:table-cell !important;'
	+ 'float:none !important;width:auto !important}'
	+ '.cr-hosts-wrap .cr-hosts-table th::before,.cr-hosts-wrap .cr-hosts-table td::before{content:none !important}'
	+ '@media (max-width:1099px){'
	+ '.cr-hosts-wrap .cr-hosts-table th,.cr-hosts-wrap .cr-hosts-table td{'
	+ 'padding-left:6px !important;padding-right:6px !important}'
	+ '.cr-hosts-wrap .cr-hosts-table{font-size:12.5px}'
	+ '}'
	+ '.cr-hosts-table tr.off td{opacity:.68}'
	+ '.cr-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#2ecc71;'
	+ 'box-shadow:0 0 0 2px rgba(46,204,113,.2)}'
	+ '.cr-dot.off{background:#9aa0a6;box-shadow:none}'
	+ '.cr-hostname{display:flex;align-items:center;justify-content:flex-start;min-width:0}'
	+ '.cr-hostname .ic{flex:0 0 auto;margin-right:0;display:flex;align-items:center}'
	+ '.cr-hostname .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0;max-width:100%}'
	+ '.cr-hostname .vd{opacity:.55;font-size:88%;margin-left:5px;white-space:nowrap;flex:0 0 auto;'
	+ 'overflow:hidden;text-overflow:ellipsis;max-width:40%}'
	/* MAC / IPv6 与主机名同为正文字体(不再用等宽小字), 三列观感一致 */
	+ '.cr-mac,.cr-v6{font-family:inherit;font-size:inherit}'
	/* IPv4 / IPv6 叠在同一列: 上 v4 下 v6, 省一列宽度 */
	+ '.cr-ipwrap{display:flex;flex-direction:column;line-height:1.24;min-width:0}'
	+ '.cr-ipwrap>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
	/* IPv6 那行与 IPv4 同字号同颜色(不再压字号/降透明度) */
	/* 上传 / 下载 / 今日流量: v4 在上, v6 叠在下面一行小字。
	   两行始终存在(无 v6 时给占位符), 所以同表各行的数值基线与行高都对齐 */
	+ '.cr-2v{display:flex;flex-direction:column;align-items:flex-end;line-height:1.26;'
	+ 'font-variant-numeric:tabular-nums}'
	+ '.cr-2v>span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;'
	+ 'white-space:nowrap}'
	/* v6 副行同样与 v4 主行同字号同颜色 */
	/* 连接方式: 短文本整列居中; 两侧都是右对齐的数字列(今日流量 / 接收速率),
	   数字宽度每秒都在变, 纯 CSS 居中会一直偏心 —— 平移量由 JS 量出两边文字的
	   中点后写进 --cr-lk-shift, 整列共用一个值(不会各行参差) */
	+ '.cr-link,.cr-lk-in{font-size:12.5px;position:relative;left:var(--cr-lk-shift,0px);display:inline-block}'
	+ '.cr-hosts-table th .cr-lk-in{font-size:inherit}'
	+ '.cr-td-neg{font-variant-numeric:tabular-nums;line-height:1.2;text-align:right !important}'
	+ '.cr-neg{display:flex;flex-direction:column;align-items:flex-end;font-size:11px;white-space:nowrap}'
	+ '.cr-neg .cr-mhz{font-style:normal;font-size:10px;opacity:.62}'
	+ '.cr-rssi{font-variant-numeric:tabular-nums;font-size:12px}'
/* ===== 宽屏自适应 =====
   2K/4K 下 12 列全是百分比, 会按比例一起拉宽: 数字右对齐后又离表头很远,
   整行看着散。把「统计条 + 表格」整块限宽 1800px(左对齐, 与页面其他内容
   共用同一条左边线), 超过 1800px 再把字号/内边距提一档 —— 让密度跟着宽度
   一起放大, 而不是只把列拉宽 */
	+ '.cr-hosts-box{max-width:1800px}'
	+ '@media (min-width:2000px){'
	+ '.cr-hosts-table{font-size:14px}'
	+ '.cr-hosts-table th,.cr-hosts-table td{padding-left:7px !important;padding-right:7px !important}'
	+ '.cr-hosts-table td.num{font-size:12.5px}'
	+ '.cr-rssi{font-size:13px}'
	+ '.cr-link{font-size:13.5px}'
	+ '.cr-neg{font-size:12px}'
	+ '.cr-neg .cr-mhz{font-size:11px}'
	+ '}'
	+ '.cr-empty{padding:14px 4px;opacity:.6}'
	/* ===== 移动端: 卡片视图 (参考 OAF 用户列表的 user-card) ===== */
	+ '.cr-hosts-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}'
	+ '.cr-cards{display:none;flex-direction:column;gap:10px}'
	+ '.cr-card{border:1px solid rgba(127,127,127,.22);border-radius:12px;padding:11px 13px;'
	+ 'display:flex;flex-direction:column;gap:8px;box-sizing:border-box}'
	+ '.cr-card.off{opacity:.86}'
	+ '.cr-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}'
	+ '.cr-card-dev{display:flex;align-items:center;gap:8px;min-width:0}'
	+ '.cr-card-titwrap{min-width:0}'
	+ '.cr-card-title{font-weight:700;font-size:14px;line-height:1.3;overflow:hidden;'
	+ 'text-overflow:ellipsis;white-space:nowrap}'
	+ '.cr-card-sub{margin-top:2px;font-size:11.5px;opacity:.6;overflow:hidden;text-overflow:ellipsis;'
	+ 'white-space:nowrap}'
	+ '.cr-card-pill{flex:0 0 auto;white-space:nowrap;font-size:11.5px;font-weight:600;padding:2px 8px;'
	+ 'border-radius:999px;border:1px solid transparent;box-sizing:border-box}'
	+ '.cr-card-pill.on{color:#15803d;background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.38)}'
	+ '.cr-card-pill.off{color:#6b7280;background:rgba(148,163,184,.14);border-color:rgba(148,163,184,.32)}'
	+ '@media (prefers-color-scheme:dark){'
	+ '.cr-card-pill.on{color:#4ade80;background:rgba(34,197,94,.2);border-color:rgba(34,197,94,.42)}'
	+ '.cr-card-pill.off{color:#9aa0a6;background:rgba(148,163,184,.16);border-color:rgba(148,163,184,.34)}'
	+ '.cr-card-v2 .cr-card-ip6st{opacity:.66}'
	+ '}'
	+ '.cr-card-body{display:flex;flex-direction:column;gap:6px}'
	+ '.cr-card-line{display:flex;align-items:baseline;justify-content:space-between;gap:12px;'
	+ 'font-size:12.5px;line-height:1.35}'
	+ '.cr-card-k{flex:0 0 auto;opacity:.6}'
	+ '.cr-card-v{min-width:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
	+ 'font-variant-numeric:tabular-nums}'
	+ '.cr-card-line-top{align-items:flex-start}'
	+ '.cr-card-v2{display:flex;flex-direction:column;align-items:flex-end;line-height:1.3;gap:1px}'
	+ '.cr-card-v2>span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
	+ '.cr-card-v2 .cr-card-ip6{font-size:11.5px;opacity:.62}'
	+ '.cr-card-v2 .cr-card-ip6st{font-size:11px;opacity:.55;font-variant-numeric:tabular-nums}'
	+ '@media (max-width:768px){'
	+ '.cr-hosts-wrap{display:none!important}'
	+ '.cr-cards{display:flex}'
	+ '.cr-hosts-head{gap:10px 16px;padding:9px 11px;font-size:12.5px}'
	+ '}';

/* 速率格式化: 数值大时自动减少小数位 —— 数值列只有 80px 左右,
 * "216.33 KiB/s" 会顶到省略号, 而 "216 KiB/s" 正好放得下 */
function fmtRate(v) {
	v = v || 0;
	var f = (v >= 102400) ? '%1024.0mB/s' : ((v >= 10240) ? '%1024.1mB/s' : '%1024.2mB/s');
	return String.format(f, v);
}

function fmtSize(v) {
	return String.format('%1024.2mB', v || 0);
}

/* 今日流量是累计值, 两位小数没意义, 列宽又只有 64px:
 * 按量级降精度 —— "629 MiB" / "16.9 MiB" / "1.86 GiB"。
 * 精确到字节的值放在鼠标悬停的 title 里(fmtSize) */
function fmtDay(v) {
	v = v || 0;
	if (v < 1) return '0\u00a0B';
	var u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'], i = 0, n = v;
	while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
	var d = (n >= 100) ? 0 : (n >= 10 ? 1 : 2);
	return n.toFixed(d) + '\u00a0' + u[i];
}

/* 上传 / 下载 / 今日流量三列都是「v4 一行 + v6 一行」。
 * 没有 v6 地址时第二行给占位符, 让整张表的行高与数字基线保持一致。
 * 今日流量 = 上行 + 下行 合计(明细放在 title 里)。
 * 注意: 后端的 up_today/down_today 是「v4 + v6」的总量(v6 也并入设备总量),
 * 所以 v4 行要用差值算, 否则和下面的 v6 行重复计数 */
function v6RateText(c, dir) {
	if (!c.ip6) return '\u2013';
	return fmtRate(dir == 'up' ? c.up6 : c.down6);
}

function v4Today(c, dir) {
	var all = (dir == 'up' ? c.up_today : c.down_today) || 0;
	var s6 = (dir == 'up' ? c.up6_today : c.down6_today) || 0;
	return (all > s6) ? (all - s6) : 0;
}

function todayOf(c, v6) {
	if (v6) return (c.up6_today || 0) + (c.down6_today || 0);
	return v4Today(c, 'up') + v4Today(c, 'down');
}

function todayText(c, v6) {
	if (v6 && !c.ip6) return '\u2013';
	return fmtDay(todayOf(c, v6));
}

function dayTitle(c, v6) {
	if (v6 && !c.ip6) return '';
	var up = v6 ? (c.up6_today || 0) : v4Today(c, 'up');
	var dn = v6 ? (c.down6_today || 0) : v4Today(c, 'down');
	return (v6 ? 'IPv6' : 'IPv4') + '\u00a0' + _('今日') + ': \u2191\u00a0'
		+ fmtSize(up) + '\u00a0\u00a0\u2193\u00a0' + fmtSize(dn);
}

/* 速率列的 hover: 同时给出 v4 / v6 的精确值, 一眼对比两条路径 */
function rateTitle(c) {
	return 'IPv4 \u2191\u00a0' + fmtRate(c.up) + '\u00a0\u00a0\u2193\u00a0' + fmtRate(c.down)
		+ (c.ip6 ? ('\nIPv6 \u2191\u00a0' + fmtRate(c.up6) + '\u00a0\u00a0\u2193\u00a0' + fmtRate(c.down6)) : '');
}

function connTitle(c) {
	return 'IPv4 ' + (c.conn || 0) + '\u00a0' + _('条')
		+ (c.ip6 ? ('\nIPv6 ' + (c.conn6 || 0) + '\u00a0' + _('条')) : '');
}

/* 无线协商速率: iwinfo 给的是 1201.0, 取整显示; 2.4G 老模式没有频宽则只有速率。
 * dir=rx 是客户端发来的(上行), dir=tx 是发给客户端的(下行)。
 * 拆成两个节点(速率 + 频宽) 上下两行, 一行太长会把表格撑宽 40px。 */
function setNegRate(el, r, dir) {
	while (el.firstChild) el.removeChild(el.firstChild);
	if (!r) { el.textContent = '-'; return; }
	var v = (dir == 'rx') ? r.rx : r.tx;
	var m = (dir == 'rx') ? r.rxm : r.txm;
	if (v == null) { el.textContent = '-'; return; }
	el.appendChild(document.createTextNode(Math.round(v) + '\u00a0Mbit/s'));
	if (m) el.appendChild(E('em', { 'class': 'cr-mhz' }, [m + '\u00a0MHz']));
}

/* 卡片里是单行 label/value, 用这个拼成一整串 */
function negRateText(r, dir) {	if (!r) return '-';
	var v = (dir == 'rx') ? r.rx : r.tx;
	var m = (dir == 'rx') ? r.rxm : r.txm;
	if (v == null) return '-';
	return Math.round(v) + '\u00a0Mbit/s' + (m ? ', ' + m + '\u00a0MHz' : '');
}

/* 把「连接方式」列平移到「今日流量」最后一个数字 与「接收速率」第一个数字 的正中间。
   两边都是右对齐的数字列, 宽度每秒都在变, 光靠 CSS 居中永远会偏;
   这里量出左边数字的右边缘(右对齐 -> 各行一致)和右边数字最宽那行的左边缘(取最左),
   把中点写进表格的 --cr-lk-shift, 表头和数据行共用一个偏移, 列不会参差也不会每秒抖。 */
function alignLinkCol(table, links) {
	if (!table || !links || !links.length) return;
	function textBox(el) {
		if (!el) return null;
		var r = document.createRange();
		r.selectNodeContents(el);
		var b = r.getBoundingClientRect();
		return (b.width > 0 && b.height > 0) ? b : null;
	}
	var aRight = 0, bLeft = 0, got = false, i, a, b, t;
	for (i = 0; i < links.length; i++) {
		/* 有线设备没有协商速率, 右列只是占位的「-」, 拿它算中点是错的 */
		t = links[i].rx ? String(links[i].rx.textContent || '') : '';
		if (t.replace(/[\s\u00a0]+/g, '').length < 4) continue;
		a = textBox(links[i].today);
		b = textBox(links[i].rx);
		if (!a || !b) continue;
		if (a.right > aRight) aRight = a.right;
		if (!got || b.left < bLeft) bLeft = b.left;
		got = true;
	}
	if (!got || bLeft <= aRight) return;
	var lr = links[0].link ? links[0].link.getBoundingClientRect() : null;
	if (!lr || !lr.width) return;
	var cur = parseFloat(table.style.getPropertyValue('--cr-lk-shift')) || 0;
	var nat = (lr.left + lr.width / 2) - cur;        // 偏移为 0 时的自然中心
	var want = Math.round((aRight + bLeft) / 2 - nat);
	if (want < -8) want = -8;                        // 量歪了也不至于把标签甩出本列
	if (want > 56) want = 56;
	if (Math.abs(want - cur) < 2) return;            // 1px 抖动不重设, 免得每秒微跳
	table.style.setProperty('--cr-lk-shift', want + 'px');
}

/* 两行 value: 第一行 v4, 第二行 v6 小字 */
function cardLine2(label) {
	var v4 = E('span', {}, ['-']);
	var v6 = E('span', { 'class': 'cr-card-ip6st' }, ['-']);
	var box = E('span', { 'class': 'cr-card-v cr-card-v2' }, [v4, v6]);
	return {
		line: E('div', { 'class': 'cr-card-line' }, [
			E('span', { 'class': 'cr-card-k' }, [label]),
			box
		]),
		v4: v4, v6: v6
	};
}

function rssiColor(v) {
	if (v >= -60) return '#2ecc71';
	if (v >= -75) return '#e0a72c';
	return '#e05c5c';
}

function ensureStyle() {
	if (document.getElementById(STYLE_ID))
		return;
	var s = document.createElement('style');
	s.id = STYLE_ID;
	s.appendChild(document.createTextNode(CSS));
	document.head.appendChild(s);
}

function keyOf(c) {
	return c.mac || ('ip:' + c.ip);
}

/* 离线设备只在列表里保留最近 24h 出现过的(与后端 cr-sampler 的 OFFLINE_WIN 一致);
 * 后端已过滤, 这里兜底, 兼容只更新了前端的旧固件 */
var OFFLINE_WIN = 86400;

function keepRecent(list, ts) {
	var nowSec = ts || Math.floor(Date.now() / 1000);
	return list.filter(function (c) {
		if (c.online) return true;
		var ref = c.last_seen || c.first_seen || 0;
		return (!ref || (nowSec - ref) <= OFFLINE_WIN);
	});
}

function cardLine(label) {
	var v = E('span', { 'class': 'cr-card-v' }, ['-']);
	var line = E('div', { 'class': 'cr-card-line' }, [
		E('span', { 'class': 'cr-card-k' }, [label]),
		v
	]);
	return { line: line, v: v };
}

/* 卡片里的 IP: IPv4 / IPv6 两行, 右对齐同一块 */
function cardIpLine() {
	var v4 = E('span', { 'class': 'cr-card-ip4' }, ['-']);
	var v6 = E('span', { 'class': 'cr-card-ip6' }, ['-']);
	var box = E('span', { 'class': 'cr-card-v cr-card-v2' }, [v4, v6]);
	return {
		line: E('div', { 'class': 'cr-card-line cr-card-line-top' }, [
			E('span', { 'class': 'cr-card-k' }, [_('IP 地址')]),
			box
		]),
		v4: v4, v6: v6
	};
}

function renderCell(c) {
	var title = c.host || brand.name(c.mac) || c.ip || '-';
	var vd = (c.host && brand.name(c.mac)) ? brand.name(c.mac) : '';
	var nameEl = E('span', { 'class': 'n', 'title': title }, [title]);
	var cName = E('div', { 'class': 'cr-card-title', 'title': title }, [title]);
	var cSub = E('div', { 'class': 'cr-card-sub' }, [vd]);
	var cPill = E('span', { 'class': 'cr-card-pill' + (c.online ? '' : ' off') },
		[c.online ? _('在线') : _('离线')]);
	var cIp = cardIpLine();
	var cMac = cardLine(_('MAC 地址'));
	var cUp = cardLine2(_('上传'));
	var cDown = cardLine2(_('下载'));
	var cConn = cardLine2(_('连接数'));
	var cToday = cardLine2(_('今日流量'));
	var cLink = cardLine(_('连接方式'));
	var cRx = cardLine(_('接收速率'));
	var cTx = cardLine(_('发送速率'));
	var cRssi = cardLine(_('信号强度'));

	var card = E('div', { 'class': 'cr-card' + (c.online ? '' : ' off') }, [
		E('div', { 'class': 'cr-card-head' }, [
			E('div', { 'class': 'cr-card-dev' }, [
				E('span', { 'class': 'ic' }, [brand.icon(c.mac, 24)]),
				E('div', { 'class': 'cr-card-titwrap' }, [cName, vd ? cSub : ''])
			]),
			cPill
		]),
		E('div', { 'class': 'cr-card-body' }, [
			cIp.line, cMac.line, cUp.line, cDown.line, cConn.line, cToday.line,
			cLink.line, cRx.line, cTx.line, cRssi.line
		])
	]);

	var ip4El = E('span', {}, [c.ip || '-']);
	var ip6El = E('span', { 'class': 'cr-v6', 'title': c.ip6 || '' }, [c.ip6 || '-']);

	/* 上传 / 下载 / 连接数 / 今日流量: 第一行 v4, 第二行 v6 */
	function pair() {
		var a = E('span', {}, ['-']);
		var b = E('span', { 'class': 'cr-v6v' }, ['-']);
		return { box: E('div', { 'class': 'cr-2v' }, [a, b]), a: a, b: b };
	}
	var upP = pair(), downP = pair(), connP = pair(), todayP = pair();

	return {
		dot: E('span', { 'class': 'cr-dot' + (c.online ? '' : ' off') }),
		host: E('div', { 'class': 'cr-hostname' }, [
			E('span', { 'class': 'ic' }, [brand.icon(c.mac, 18)]),
			nameEl,
			vd ? E('span', { 'class': 'vd' }, [vd]) : ''
		]),
		nameEl: nameEl,
		ip: ip4El,
		ip6: ip6El,
		ipWrap: E('div', { 'class': 'cr-ipwrap' }, [ip4El, ip6El]),
		mac: E('span', { 'class': 'cr-mac' }, [c.mac || '-']),
		up: upP.box, up4: upP.a, up6: upP.b,
		down: downP.box, down4: downP.a, down6: downP.b,
		conn: connP.box, conn4: connP.a, conn6: connP.b,
		today: todayP.box, t4: todayP.a, t6: todayP.b,
		rssi: E('span', { 'class': 'cr-rssi' }, ['-']),
		link: E('span', { 'class': 'cr-link' }, [c.link || '-']),
		rx: E('span', { 'class': 'cr-neg' }, [c.link ? (c.rate ? '\u2013' : '-') : '-']),
		tx: E('span', { 'class': 'cr-neg' }, [c.link ? (c.rate ? '\u2013' : '-') : '-']),
		card: card, cPill: cPill, cIp: cIp.v4, cIp6: cIp.v6, cMac: cMac.v,
		cUp: cUp.v4, cUp6: cUp.v6, cDown: cDown.v4, cDown6: cDown.v6,
		cConn: cConn.v4, cConn6: cConn.v6, cToday: cToday.v4, cToday6: cToday.v6, cLink: cLink.v,
		cRx: cRx.v, cTx: cTx.v, cRssi: cRssi.v
	};
}

function newRow(c) {
	var cl = renderCell(c);
	var tr = E('tr', { 'class': 'cr-row', 'data-key': keyOf(c) }, [
		E('td', { 'class': 'ctr' }, [cl.dot]),
		E('td', {}, [cl.host]),
		E('td', {}, [cl.mac]),
		E('td', {}, [cl.ipWrap]),
		E('td', { 'class': 'num' }, [cl.up]),
		E('td', { 'class': 'num' }, [cl.down]),
		E('td', { 'class': 'num' }, [cl.conn]),
		E('td', { 'class': 'num' }, [cl.today]),
		E('td', { 'class': 'ctr' }, [cl.link]),
		E('td', { 'class': 'cr-td-neg num' }, [cl.rx]),
		E('td', { 'class': 'cr-td-neg num' }, [cl.tx]),
		E('td', { 'class': 'num' }, [cl.rssi])
	]);
	tr._cr = cl;
	return tr;
}

function fill(tr, c) {
	var cl = tr._cr;
	cl.dot.className = 'cr-dot' + (c.online ? '' : ' off');
	var title = c.host || brand.name(c.mac) || c.ip || '-';
	if (cl.nameEl.textContent !== title) {
		cl.nameEl.textContent = title;
		cl.nameEl.title = title;
	}
	cl.ip.textContent = c.ip || '-';
	cl.ip6.textContent = c.ip6 || '-';
	cl.ip6.title = c.ip6 || '';
	cl.mac.textContent = c.mac || '-';
	/* 上传 / 下载: v4 主行 + v6 副行 */
	cl.up4.textContent = fmtRate(c.up);
	cl.up6.textContent = v6RateText(c, 'up');
	cl.down4.textContent = fmtRate(c.down);
	cl.down6.textContent = v6RateText(c, 'down');
	cl.up.title = rateTitle(c);
	cl.down.title = rateTitle(c);
	/* 今日流量: v4 / v6 两条路径各自累计, 明细在 title */
	cl.t4.textContent = todayText(c, false);
	cl.t6.textContent = todayText(c, true);
	cl.t4.title = dayTitle(c, false);
	cl.t6.title = dayTitle(c, true);
	if (c.rssi != null) {
		cl.rssi.textContent = c.rssi + ' dBm';
		cl.rssi.style.color = rssiColor(c.rssi);
		cl.cRssi.textContent = c.rssi + ' dBm';
		cl.cRssi.style.color = rssiColor(c.rssi);
	}
	else {
		cl.rssi.textContent = '-';
		cl.rssi.style.color = '';
		cl.cRssi.textContent = '-';
		cl.cRssi.style.color = '';
	}
	cl.conn4.textContent = (c.conn != null) ? String(c.conn) : '-';
	cl.conn6.textContent = c.ip6 ? ((c.conn6 != null) ? String(c.conn6) : '-') : '\u2013';
	cl.conn.title = connTitle(c);
	cl.link.textContent = c.link || '-';
	setNegRate(cl.rx, c.link ? c.rate : null, 'rx');
	setNegRate(cl.tx, c.link ? c.rate : null, 'tx');
	tr.className = 'cr-row' + (c.online ? '' : ' off');

	/* 卡片视图 */
	cl.cPill.textContent = c.online ? _('在线') : _('离线');
	cl.cPill.className = 'cr-card-pill' + (c.online ? '' : ' off');
	cl.card.className = 'cr-card' + (c.online ? '' : ' off');
	cl.cIp.textContent = c.ip || '-';
	cl.cIp6.textContent = c.ip6 || '-';
	cl.cIp6.title = c.ip6 || '';
	cl.cMac.textContent = c.mac || '-';
	cl.cUp.textContent = fmtRate(c.up);
	cl.cUp6.textContent = v6RateText(c, 'up');
	cl.cDown.textContent = fmtRate(c.down);
	cl.cDown6.textContent = v6RateText(c, 'down');
	cl.cConn.textContent = (c.conn != null) ? String(c.conn) : '-';
	cl.cConn6.textContent = c.ip6 ? ((c.conn6 != null) ? String(c.conn6) : '-') : '\u2013';
	cl.cToday.textContent = todayText(c, false);
	cl.cToday6.textContent = todayText(c, true);
	cl.cToday.title = dayTitle(c, false);
	cl.cToday6.title = dayTitle(c, true);
	cl.cLink.textContent = c.link || '-';
	cl.cRx.textContent = negRateText(c.link ? c.rate : null, 'rx');
	cl.cTx.textContent = negRateText(c.link ? c.rate : null, 'tx');
}

var timer = null;

function stopTimer() {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}

return baseclass.extend({
	title: _('在线主机'),

	load: function () {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			brand.load()
		]);
	},

	render: function (res) {
		try {
			return this._render(res);
		}
		catch (e) {
			stopTimer();
			return E('div', { 'class': 'cr-empty' },
				['在线主机组件加载失败: ' + (e && e.message ? e.message : e)]);
		}
	},

	_render: function (res) {
		var data = (res && res[0]) || {};

		if (this.root) {
			try { this.update(data); } catch (e) { }
			return this.root;
		}

		ensureStyle();

		var onlineV = E('span', { 'class': 'v' }, ['0']);
		var upV = E('span', { 'class': 'v', 'style': 'color:#e08b2c' }, ['0 B/s']);
		var downV = E('span', { 'class': 'v', 'style': 'color:#2f7ed8' }, ['0 B/s']);
		var noteV = E('span', { 'class': 'v', 'style': 'font-weight:400;opacity:.6' }, ['']);

		var tbody = E('tbody', {});
		var cardsEl = E('div', { 'class': 'cr-cards' });
		var empty = E('div', { 'class': 'cr-empty' }, [_('暂无设备')]);

		var node = E('div', { 'class': 'cr-hosts-box' }, [
			E('div', { 'class': 'cr-hosts-head' }, [
				E('span', {}, [E('span', { 'class': 'k' }, [_('在线用户')]), onlineV]),
				E('span', {}, [E('span', { 'class': 'k' }, [_('上传总带宽')]), upV]),
				E('span', {}, [E('span', { 'class': 'k' }, [_('下载总带宽')]), downV]),
				E('span', {}, [noteV])
			]),
			E('div', { 'class': 'cr-hosts-wrap' }, [
				E('table', { 'class': 'table cr-hosts-table' }, [
					E('colgroup', {}, [
						E('col', { 'style': 'width:3.6%' }),
						E('col', { 'style': 'width:10.8%' }),
						E('col', { 'style': 'width:11.2%' }),
						E('col', { 'style': 'width:22.4%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:4.8%' }),
						E('col', { 'style': 'width:6%' }),
						E('col', { 'style': 'width:6%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:6.4%' })
					]),
					E('thead', {}, [E('tr', { 'class': 'cr-row' }, [
						E('th', { 'class': 'ctr' }, [_('状态')]),
						E('th', {}, [_('主机名')]),
						E('th', {}, [_('MAC 地址')]),
						E('th', {}, [_('IPv4 / IPv6')]),
						E('th', { 'class': 'num', 'title': _('上传: 第一行 IPv4, 第二行 IPv6') }, [_('上传')]),
						E('th', { 'class': 'num', 'title': _('下载: 第一行 IPv4, 第二行 IPv6') }, [_('下载')]),
						E('th', { 'class': 'num', 'title': _('连接数: 第一行 IPv4, 第二行 IPv6') }, [_('连接数')]),
						E('th', { 'class': 'num', 'title': _('今日累计: 第一行 IPv4, 第二行 IPv6') }, [_('今日流量')]),
						E('th', { 'class': 'ctr' }, [E('span', { 'class': 'cr-lk-in' }, [_('连接方式')])]),
						E('th', { 'class': 'num' }, [_('接收速率')]),
						E('th', { 'class': 'num' }, [_('发送速率')]),
						E('th', { 'class': 'num' }, [_('信号强度')])
					])]),
					tbody
				])
			]),
			cardsEl,
			empty
		]);

		this.root = node;
		this.body = tbody;
		this.table = node.querySelector('.cr-hosts-table');
		this.cardsEl = cardsEl;
		this.cardOrder = '';
		this.emptyEl = empty;
		this.rows = {};
		this.onlineEl = onlineV;
		this.upEl = upV;
		this.downEl = downV;
		this.noteEl = noteV;

		this.update = function (d) {
			var wan = d.wan || {};
			onlineV.textContent = String(d.online || 0);
			if (!d.online && d.total) onlineV.textContent = '0';
			upV.textContent = fmtRate(wan.up);
			downV.textContent = fmtRate(wan.down);
			noteV.textContent = d.hnat ? _('硬件加速已校正') : _('仅软件路径');

			var list = keepRecent(d.clients || [], d.ts);
			var seen = {}, i, c, tr;

			for (i = 0; i < list.length; i++) {
				c = list[i];
				var k = keyOf(c);
				seen[k] = 1;
				tr = this.rows[k];
				if (!tr) {
					tr = newRow(c);
					this.rows[k] = tr;
				}
				fill(tr, c);
				if (this.body.children[i] !== tr)
					this.body.insertBefore(tr, this.body.children[i] || null);
			}

			for (k in this.rows) {
				if (!seen[k]) {
					var cd = this.rows[k]._cr.card;
					if (cd.parentNode)
						cd.parentNode.removeChild(cd);
					if (this.rows[k].parentNode)
						this.rows[k].parentNode.removeChild(this.rows[k]);
					delete this.rows[k];
				}
			}

			/* 卡片视图: 与表格同序, 仅顺序变化时重排, 避免每秒抖动 */
			var ord = [];
			for (i = 0; i < list.length; i++)
				ord.push(keyOf(list[i]));
			if (ord.join('|') !== this.cardOrder) {
				this.cardOrder = ord.join('|');
				for (i = 0; i < list.length; i++)
					this.cardsEl.appendChild(this.rows[keyOf(list[i])]._cr.card);
			}

			this.emptyEl.style.display = list.length ? 'none' : '';

			/* 连接方式列: 平移量取决于两侧数字宽度, 每次刷新重算一遍 */
			var lks = [];
			for (k in this.rows) {
				var lc = this.rows[k]._cr;
				lks.push({ link: lc.link, today: lc.today, rx: lc.rx });
			}
			try { alignLinkCol(this.table, lks); } catch (e) { }
		};

		try { this.update(data); } catch (e) { }

		var self = this;
		timer = setInterval(function () {
			if (document.hidden || !self.root || !self.root.parentNode)
				return;
			callStatus().then(function (d) {
				if (!d || !d.wan) return;
				self.update(d);
			}).catch(function () { });
		}, 1000);

		return node;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
