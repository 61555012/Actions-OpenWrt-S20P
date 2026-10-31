'use strict';
'require view';
'require rpc';
'require client-rates.brand as brand';

var callStatus = rpc.declare({
	object: 'luci.client_rates',
	method: 'status'
});

function fmtRate(v) { return String.format('%1024.2mB/s', v || 0); }
function fmtB(v) { return String.format('%1024.2mB', v || 0); }

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
	+ '.cr-dev-card-pill{flex:0 0 auto;white-space:nowrap;font-size:11.5px;font-weight:600;padding:2px 8px;'
	+ 'border-radius:999px;color:#22c55e;background:rgba(34,197,94,.16)}'
	+ '.cr-dev-card-pill.off{color:#9aa0a6;background:rgba(148,163,184,.22)}'
	+ '.cr-dev-card-body{display:flex;flex-direction:column;gap:6px}'
	+ '.cr-dev-card-line{display:flex;align-items:baseline;justify-content:space-between;gap:12px;'
	+ 'font-size:12.5px;line-height:1.35}'
	+ '.cr-dev-card-k{flex:0 0 auto;opacity:.6}'
	+ '.cr-dev-card-v{min-width:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
	+ 'font-variant-numeric:tabular-nums}'
	+ '.cr-dev-card-v.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px}'
	+ '.cr-dev-empty{padding:14px 4px;opacity:.6;text-align:center}'
	+ '.cr-tup{margin-left:.4em}'
	+ '@media (max-width:768px){'
	+ '.cr-dev-cards{display:flex}'
	+ '.cr-table-wrap{display:none!important}'
	+ '.cr-dev-stats{gap:8px!important;margin-bottom:12px!important}'
	+ '.cr-dev-stats>div{padding:9px 11px!important;flex:1 1 7rem}'
	+ '.cr-dev-stats .cr-dev-stat-val{font-size:140%!important}'
	+ '.cr-tup{display:block;margin-left:0}'
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
	var val = E('div', { 'class': 'cr-dev-stat-val',
		'style': 'font-size:170%;font-weight:600;line-height:1.25' + (color ? ';color:' + color : '') }, ['-']);
	var box = E('div', {
		// flex-basis 用 rem、min-width:0 + border-box，4 张卡片才能等分且不溢出容器
		'style': 'flex:1 1 8rem;min-width:0;box-sizing:border-box;padding:12px 14px;border:1px solid rgba(128,128,128,.22);border-radius:10px;background:rgba(128,128,128,.04)'
	}, [
		E('div', { 'style': 'font-size:85%;opacity:.65;margin-bottom:4px' }, [label]),
		val
	]);
	return { box: box, val: val };
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
		/* 今日流量拆成两段: 桌面同行, 手机上各占一行(避免「↑」被挤到行尾) */
		var tdnEl = E('span', { 'class': 'cr-tdn' }, ['-']);
		var tupEl = E('span', { 'class': 'cr-tup' }, ['-']);
		while (sToday.val.firstChild) sToday.val.removeChild(sToday.val.firstChild);
		sToday.val.appendChild(tdnEl);
		sToday.val.appendChild(tupEl);

		var tbody = E('tbody', {});
		var cardsEmpty = E('div', { 'class': 'cr-dev-empty' }, [_('暂无活动设备')]);
		var cardsEl = E('div', { 'class': 'cr-dev-cards' }, [cardsEmpty]);
		var hint = E('div', { 'style': 'font-size:85%;opacity:.6;margin:6px 0 10px' },
			[data.hnat ? _('数据源：conntrack + HNAT 硬件流表双源采样，硬件加速下同样计入')
			           : _('未检测到 HNAT 硬件流表，当前仅统计软件路径')]);

		function cell(text, style) {
			return E('td', { 'class': 'td left', 'style': style || '' }, [text]);
		}

		function cardLine(label, mono) {
			var v = E('span', { 'class': 'cr-dev-card-v' + (mono ? ' mono' : '') }, ['-']);
			return { line: E('div', { 'class': 'cr-dev-card-line' }, [
				E('span', { 'class': 'cr-dev-card-k' }, [label]), v
			]), v: v };
		}

		function rowFor(c) {
			var key = c.mac || ('ip:' + c.ip);
			var r = rows[key];
			if (r) return r;
			var nameEl = E('span', { 'style': 'font-weight:600;display:inline-block;max-width:8.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle' }, ['-']);
			var subEl = E('span', { 'style': 'font-size:85%;opacity:.6;margin-left:6px' }, ['']);
			var ipEl = E('span', {}, ['-']);
			var macEl = E('span', {}, ['-']);
			var downEl = E('span', { 'style': 'color:#2f7ed8;font-weight:600' }, ['-']);
			var upEl = E('span', { 'style': 'color:#e08b2c;font-weight:600' }, ['-']);
			var tDown = E('span', {}, ['-']);
			var tUp = E('span', {}, ['-']);
			var statEl = E('span', { 'class': 'ifacebadge' }, ['-']);
			var iconWrap = E('span', { 'style': 'vertical-align:middle' });

			var tr = E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'style': 'white-space:nowrap' }, [iconWrap, nameEl, subEl]),
				cell(ipEl),
				cell(macEl),
				E('td', { 'class': 'td right' }, [downEl]),
				E('td', { 'class': 'td right' }, [upEl]),
				E('td', { 'class': 'td right' }, [tDown]),
				E('td', { 'class': 'td right' }, [tUp]),
				E('td', { 'class': 'td left' }, [statEl])
			]);

			/* 移动端卡片 */
			var cTitle = E('div', { 'class': 'cr-dev-card-title' }, ['-']);
			var cSub = E('div', { 'class': 'cr-dev-card-sub' }, ['']);
			var cPill = E('span', { 'class': 'cr-dev-card-pill' }, [_('在线')]);
			var cIp = cardLine(_('IP 地址'));
			var cMac = cardLine(_('MAC'), true);
			var cDown = cardLine(_('下行'));
			var cUp = cardLine(_('上行'));
			var cTDown = cardLine(_('今日下行'));
			var cTUp = cardLine(_('今日上行'));
			cDown.v.style.color = '#2f7ed8'; cDown.v.style.fontWeight = '600';
			cUp.v.style.color = '#e08b2c'; cUp.v.style.fontWeight = '600';

			var card = E('div', { 'class': 'cr-dev-card' }, [
				E('div', { 'class': 'cr-dev-card-head' }, [
					E('div', { 'class': 'cr-dev-card-dev' }, [
						E('span', { 'class': 'cr-dev-card-ic' }, [brand.icon(c.mac, 24)]),
						E('div', { 'class': 'cr-dev-card-titwrap' }, [cTitle, cSub])
					]),
					cPill
				]),
				E('div', { 'class': 'cr-dev-card-body' }, [
					cIp.line, cMac.line, cDown.line, cUp.line, cTDown.line, cTUp.line
				])
			]);

			r = { tr: tr, iconWrap: iconWrap, nameEl: nameEl, subEl: subEl, ipEl: ipEl, macEl: macEl,
			      downEl: downEl, upEl: upEl, tDown: tDown, tUp: tUp, statEl: statEl, iconKey: null,
			      card: card, cTitle: cTitle, cSub: cSub, cPill: cPill, cIp: cIp.v, cMac: cMac.v,
			      cDown: cDown.v, cUp: cUp.v, cTDown: cTDown.v, cTUp: cTUp.v };
			rows[key] = r;
			tbody.appendChild(tr);
			return r;
		}

		function update(d) {
			var wan = (d && d.wan) || {};
			sDown.val.textContent = fmtRate(wan.down);
			sUp.val.textContent = fmtRate(wan.up);
			tdnEl.textContent = '↓ ' + fmtB(wan.down_today);
			tupEl.textContent = '↑ ' + fmtB(wan.up_today);
			sOnline.val.textContent = String((d && d.online) || 0);

			var list = ((d && d.clients) || []).slice();
			list.sort(function (a, b) { return (b.up + b.down) - (a.up + a.down); });

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
				r.ipEl.textContent = c.ip || '-';
				r.macEl.textContent = c.mac || '-';
				r.downEl.textContent = fmtRate(c.down);
				r.upEl.textContent = fmtRate(c.up);
				r.tDown.textContent = fmtB(c.down_today);
				r.tUp.textContent = fmtB(c.up_today);
				r.statEl.textContent = c.online ? _('在线') : _('离线');
				r.statEl.className = 'label ' + (c.online ? 'success' : 'notice');

				/* 卡片视图 */
				r.cTitle.textContent = title;
				r.cTitle.title = title;
				r.cSub.textContent = (c.host && vname) ? vname : '';
				r.cPill.textContent = c.online ? _('在线') : _('离线');
				r.cPill.className = 'cr-dev-card-pill' + (c.online ? '' : ' off');
				r.cIp.textContent = c.ip || '-';
				r.cMac.textContent = c.mac || '-';
				r.cDown.textContent = fmtRate(c.down);
				r.cUp.textContent = fmtRate(c.up);
				r.cTDown.textContent = fmtB(c.down_today);
				r.cTUp.textContent = fmtB(c.up_today);

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
						E('td', { 'class': 'td left', 'colspan': 8, 'style': 'opacity:.6' }, [_('暂无活动设备')])
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
					E('th', { 'class': 'th' }, [_('状态')])
				])
			]),
			tbody
		]);

		ensureStyle();

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [_('设备流量')]),
			hint,
			E('div', { 'class': 'cr-dev-stats', 'style': 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px' },
				[sDown.box, sUp.box, sToday.box, sOnline.box]),
			E('div', { 'class': 'cr-table-wrap' }, [table]),
			cardsEl
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
