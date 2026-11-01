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
	+ '.cr-ipwrap .cr-v6{font-size:11px;opacity:.66}'
	/* v6 自己的实时速率 + 今日流量: 第三行小字, 叠在 v6 地址下面 */
	+ '.cr-ipwrap .cr-v6st{font-size:10.5px;opacity:.5;font-variant-numeric:tabular-nums;'
	+ 'font-feature-settings:tnum}'
	+ '@media (prefers-color-scheme:dark){.cr-ipwrap .cr-v6st{opacity:.64}}'
	/* 连接方式: 短文本整列居中, 表头和数据同一中线; 右移 6px 让表头两侧留白均衡
	   (左邻「连接数」是右对齐数字, 贴得较近) */
	+ '.cr-link,.cr-lk-in{font-size:12.5px;position:relative;left:6px;display:inline-block}'
	+ '.cr-hosts-table th .cr-lk-in{font-size:inherit}'
	+ '.cr-td-neg{font-variant-numeric:tabular-nums;line-height:1.2;text-align:right !important}'
	+ '.cr-neg{display:flex;flex-direction:column;align-items:flex-end;font-size:11px;white-space:nowrap}'
	+ '.cr-neg .cr-mhz{font-style:normal;font-size:10px;opacity:.62}'
	+ '.cr-rssi{font-variant-numeric:tabular-nums;font-size:12px}'
	/* ===== 宽屏自适应 =====
	   2K/4K 下 11 列全是百分比, 会按比例一起拉宽: 数字右对齐后又离表头很远,
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
	+ '.cr-ipwrap .cr-v6{font-size:12px}'
	+ '.cr-ipwrap .cr-v6st{font-size:11.5px}'
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

/* 速率格式化: 数值大时自动减少小数位 —— 7 个数值列等宽 76px,
 * "216.33 KiB/s" 会顶到省略号, 而 "216 KiB/s" 正好放得下 */
function fmtRate(v) {
	v = v || 0;
	var f = (v >= 102400) ? '%1024.0mB/s' : ((v >= 10240) ? '%1024.1mB/s' : '%1024.2mB/s');
	return String.format(f, v);
}

function fmtSize(v) {
	return String.format('%1024.2mB', v || 0);
}

/* IPv6 行下面的小字: 实时速率 + 今日流量。
 * 三行(IPv4 / IPv6 / 计量)统一格式, 没 v6 地址时给占位符, 保证行高一致。
 * 箭头顺序跟「上传 / 下载」两列一致: ↑ 上行, ↓ 下行; 今日为 0 时省略该段 */
function v6HasStat(c) {
	return (c.ip6 != null) &&
		((c.up6 || 0) + (c.down6 || 0) + (c.up6_today || 0) + (c.down6_today || 0)) > 0;
}

function v6StatText(c) {
	if (!c.ip6) return '\u2013';
	var s = '\u2191\u00a0' + fmtRate(c.up6) + '\u00a0\u00a0\u2193\u00a0' + fmtRate(c.down6);
	var tot = (c.up6_today || 0) + (c.down6_today || 0);
	if (tot > 0) s += '\u00a0\u00b7\u00a0' + _('今日') + '\u00a0' + fmtSize(tot);
	return s;
}

function v6StatTitle(c) {
	if (!v6HasStat(c)) return '';
	return _('IPv6 今日') + ': \u2191\u00a0' + fmtSize(c.up6_today) + '\u00a0/\u00a0\u2193\u00a0' + fmtSize(c.down6_today)
		+ '\n' + _('实时') + ': \u2191\u00a0' + fmtRate(c.up6) + '\u00a0/\u00a0\u2193\u00a0' + fmtRate(c.down6);
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

/* 卡片里的 IP: IPv4 / IPv6 / IPv6 计量 三行, 右对齐同一块 */
function cardIpLine() {
	var v4 = E('span', { 'class': 'cr-card-ip4' }, ['-']);
	var v6 = E('span', { 'class': 'cr-card-ip6' }, ['-']);
	var st = E('span', { 'class': 'cr-card-ip6st' }, ['-']);
	var box = E('span', { 'class': 'cr-card-v cr-card-v2' }, [v4, v6, st]);
	return {
		line: E('div', { 'class': 'cr-card-line cr-card-line-top' }, [
			E('span', { 'class': 'cr-card-k' }, [_('IP 地址')]),
			box
		]),
		v4: v4, v6: v6, st: st
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
	var cUp = cardLine(_('上传'));
	var cDown = cardLine(_('下载'));
	var cConn = cardLine(_('连接数'));
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
			cIp.line, cMac.line, cUp.line, cDown.line, cConn.line,
			cLink.line, cRx.line, cTx.line, cRssi.line
		])
	]);

	var ip4El = E('span', {}, [c.ip || '-']);
	var ip6El = E('span', { 'class': 'cr-v6', 'title': c.ip6 || '' }, [c.ip6 || '-']);
	var ip6stEl = E('span', { 'class': 'cr-v6st' }, ['-']);

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
		ip6st: ip6stEl,
		ipWrap: E('div', { 'class': 'cr-ipwrap' }, [ip4El, ip6El, ip6stEl]),
		mac: E('span', { 'class': 'cr-mac' }, [c.mac || '-']),
		up: E('span', {}, ['-']),
		down: E('span', {}, ['-']),
		rssi: E('span', { 'class': 'cr-rssi' }, ['-']),
		conn: E('span', {}, ['-']),
		link: E('span', { 'class': 'cr-link' }, [c.link || '-']),
		rx: E('span', { 'class': 'cr-neg' }, [c.link ? (c.rate ? '\u2013' : '-') : '-']),
		tx: E('span', { 'class': 'cr-neg' }, [c.link ? (c.rate ? '\u2013' : '-') : '-']),
		card: card, cPill: cPill, cIp: cIp.v4, cIp6: cIp.v6, cIp6st: cIp.st, cMac: cMac.v,
		cUp: cUp.v, cDown: cDown.v, cConn: cConn.v, cLink: cLink.v,
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
	cl.ip6st.textContent = v6StatText(c);
	cl.ip6st.title = v6StatTitle(c);
	cl.mac.textContent = c.mac || '-';
	cl.up.textContent = fmtRate(c.up);
	cl.down.textContent = fmtRate(c.down);
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
	cl.conn.textContent = (c.conn != null) ? String(c.conn) : '-';
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
	cl.cIp6st.textContent = v6StatText(c);
	cl.cIp6st.title = v6StatTitle(c);
	cl.cMac.textContent = c.mac || '-';
	cl.cUp.textContent = fmtRate(c.up);
	cl.cDown.textContent = fmtRate(c.down);
	cl.cConn.textContent = (c.conn != null) ? String(c.conn) : '-';
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
						E('col', { 'style': 'width:3.5%' }),
						E('col', { 'style': 'width:12.8%' }),
						E('col', { 'style': 'width:11.2%' }),
						E('col', { 'style': 'width:22.1%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:7.2%' }),
						E('col', { 'style': 'width:7.2%' })
					]),
					E('thead', {}, [E('tr', { 'class': 'cr-row' }, [
						E('th', { 'class': 'ctr' }, [_('状态')]),
						E('th', {}, [_('主机名')]),
						E('th', {}, [_('MAC 地址')]),
						E('th', {}, [_('IPv4 / IPv6')]),
						E('th', { 'class': 'num' }, [_('上传')]),
						E('th', { 'class': 'num' }, [_('下载')]),
						E('th', { 'class': 'num' }, [_('连接数')]),
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
