#!/bin/bash
#
# https://github.com/P3TERX/Actions-OpenWrt
# File name: diy-part2.sh
# Description: 自定义插件 (在 feeds update 之后、feeds install 之前执行)
#
# 为什么在这个时机:
#   - 必须在 feeds update -a 之后: 否则 packages feed 会把 golang 目录重新拉回覆盖
#   - 必须在 feeds install -a 之前: 否则删除 OpenAppFilter 会残留 package/feeds 下的旧符号链接
#
set -e

echo "==== [diy-part2] 替换 golang feed 为 sbwml 26.x ===="
rm -rf feeds/packages/lang/golang
git clone https://github.com/sbwml/packages_lang_golang -b 26.x feeds/packages/lang/golang

echo "==== [diy-part2] 清理源码中已有的 v2ray-geodata / mosdns ===="
find ./ | grep Makefile | grep v2ray-geodata | xargs -r rm -f
find ./ | grep Makefile | grep mosdns | xargs -r rm -f

echo "==== [diy-part2] 删除仓库原有 OpenAppFilter, 重新拉取 destan19 最新版 ===="
find . -type d \( -name "OpenAppFilter" -o -name "luci-app-oaf" -o -name "open-app-filter" \) -exec rm -rf {} +
rm -rf package/feeds/*/luci-app-oaf package/feeds/*/OpenAppFilter
git clone https://github.com/destan19/OpenAppFilter package/OpenAppFilter

echo "==== [diy] OAF 页面注入 client-rates 速率桥接脚本 ===="
# 目的: 仪表盘右上角 WAN 实时速率卡片 + 终端列表上下行速率改用本机 HNAT 采样值。
# 只追加一段 <script>, 不改动 OAF 自身逻辑; 重复执行会跳过(幂等)。
for f in package/OpenAppFilter/luci-app-oaf/luasrc/view/oaf/dashboard.htm \
         package/OpenAppFilter/luci-app-oaf/luasrc/view/oaf/user_status.htm \
         package/OpenAppFilter/luci-app-oaf/luasrc/view/oaf/user_detail.htm; do
  if [ -f "$f" ]; then
    if grep -q 'client-rates/oaf-bridge.js' "$f"; then
      echo "    已存在, 跳过: $f"
    else
      printf '\n<script src="/luci-static/resources/client-rates/oaf-bridge.js?v=6"></script>\n' >> "$f"
      grep -q 'client-rates/oaf-bridge.js' "$f" \
        && echo "    注入成功: $f" || { echo "    [错误] 注入失败: $f"; exit 1; }
    fi
  else
    echo "    [警告] 未找到 $f (OAF 目录结构可能变化)"
  fi
done

echo "==== [diy-part2] 克隆 luci-app-mosdns (v5) 与 v2ray-geodata ===="
git clone https://github.com/sbwml/luci-app-mosdns -b v5 package/mosdns
git clone https://github.com/sbwml/v2ray-geodata package/v2ray-geodata

echo "==== [diy-part2] 修复 S20P 两个 2.5G 口指示灯 (0x001b -> 0x321b) ===="
LED_DTS="target/linux/mediatek/dts-ext/mt7986a-clx-s20p.dts"
if [ -f "$LED_DTS" ]; then
  sed -i 's/realtek,led-act-select = <0x001b>/realtek,led-act-select = <0x321b>/g' "$LED_DTS"
  if grep -q 'realtek,led-act-select = <0x321b>' "$LED_DTS"; then
    echo "    DTS LED 配置已应用: modeA + 400ms/12.5%/60ms + 10M LPI"
  else
    echo "    [警告] 未匹配到 0x001b, 请确认是否已修复或路径变化"
  fi
else
  echo "    [警告] 未找到 $LED_DTS, 跳过 LED 修复"
fi

echo "==== [diy-part2] 修复 realtek 驱动丢失的 LED 配置调用(根因) ===="
# 内核 6.12 的 733 补丁只定义了 rtl8221b_config_led() 却从未调用它(死代码),
# 导致 realtek,led-act-select 等属性完全不生效、2.5G 灯不亮。
# 6.6 的 790 补丁是在 rtl822xb_config_init 末尾调用, 此处把调用补回去。
LED_PATCH="target/linux/mediatek/patches-6.12/734-net-phy-realtek-call-rtl8221b_config_led.patch"
if [ -d target/linux/mediatek/patches-6.12 ]; then
cat > "$LED_PATCH" <<'EOF'
From: S20P build fix
Subject: net: phy: realtek: call rtl8221b_config_led from rtl822xb_config_init

The 6.12 backport (patch 733) defines rtl8221b_config_led() but never
calls it, so the realtek,led-*-select DT properties have no effect and
the 2.5G port LEDs stay dark (e.g. CLX S20P). Restore the call that
exists in the 6.6 patch (790).
---
--- a/drivers/net/phy/realtek/realtek_main.c
+++ b/drivers/net/phy/realtek/realtek_main.c
@@ -1520,6 +1520,12 @@
 static int rtl822xb_config_init(struct phy_device *phydev)
 {
-	return rtl822x_set_serdes_option_mode(phydev, false);
+	int ret;
+
+	ret = rtl822x_set_serdes_option_mode(phydev, false);
+	if (ret < 0)
+		return ret;
+
+	return rtl8221b_config_led(phydev);
 }
 
 static int rtl822xb_read_status(struct phy_device *phydev)
EOF
  echo "    已生成补丁: $LED_PATCH"
else
  echo "    [警告] 未找到 patches-6.12 目录, 跳过"
fi

echo "==== [diy-part2] 默认管理 IP 改为 192.168.6.1 ===="
CONFIG_GEN="package/base-files/files/bin/config_generate"
if [ -f "$CONFIG_GEN" ]; then
  sed -i 's/192\.168\.1\.1/192.168.6.1/g' "$CONFIG_GEN"
  grep -q '192.168.6.1' "$CONFIG_GEN" && echo "    默认 IP 已改为 192.168.6.1" || echo "    [警告] 替换失败"
else
  echo "    [警告] 未找到 $CONFIG_GEN, 跳过"
fi

echo "==== [diy-part2] argon: 拉取最新主题 + 主题设置 (v3.1.1) ===="
# v3.x 起「Argon 主题设置」已并入主题包(同一 Makefile, LUCI_BASENAME=argon-config),
# 因此只需一份源码; 另外把 compat/ 下的 luci-app-argon-config 空壳兼容包放进 package/,
# 保证 .config 里历史的 CONFIG_PACKAGE_luci-app-argon-config=y 仍能解析。
# 注意: 必须先清掉 feeds/源码里自带的旧版 argon, 否则同名包重复会导致编译失败。
# 升级主题版本时只改 ARGON_REF 即可。
ARGON_REPO=https://github.com/jerrykuku/luci-theme-argon
ARGON_REF=v3.1.1
rm -rf package/luci-theme-argon package/luci-app-argon-config
find ./feeds ./package -maxdepth 4 -type d \
  \( -name "luci-theme-argon*" -o -name "luci-app-argon-config*" \) \
  -exec rm -rf {} + 2>/dev/null || true
# feeds install 生成的符号链接指向已删除的旧目录, 一并清掉(rm 只删链接本身)
find ./package/feeds -maxdepth 3 \
  \( -name "luci-theme-argon*" -o -name "luci-app-argon-config*" \) \
  -exec rm -rf {} + 2>/dev/null || true
git clone --depth 1 -b "$ARGON_REF" "$ARGON_REPO" package/luci-theme-argon
if [ -d package/luci-theme-argon/compat/luci-app-argon-config ]; then
  cp -a package/luci-theme-argon/compat/luci-app-argon-config package/luci-app-argon-config
  echo "    已放入 luci-app-argon-config 兼容包"
fi
echo "    argon 版本: $ARGON_REF / $(grep -m1 '^PKG_VERSION' package/luci-theme-argon/Makefile)"

echo "==== [diy-part2] argon 默认值: 登录页「居中卡片」+ 壁纸来源 Bing ===="
# 主题包自带 /etc/config/argon(conffile) 与 /etc/uci-defaults/30_luci-theme-argon,
# 两处都要改: 前者决定新装固件的初值, 后者在配置缺项时补默认(只会补缺, 不覆盖已有值)。
ARGON_CFG=package/luci-theme-argon/root/etc/config/argon
ARGON_DEF=package/luci-theme-argon/root/etc/uci-defaults/30_luci-theme-argon
if [ -f "$ARGON_CFG" ]; then
  sed -i \
    -e "s/^\([[:space:]]*option login_style\).*/\1 'centered'/" \
    -e "s/^\([[:space:]]*option online_wallpaper\).*/\1 'bing'/" \
    "$ARGON_CFG"
  echo "    config: $(grep -E 'login_style|online_wallpaper' "$ARGON_CFG" | tr -d '\t' | tr '\n' ' ')"
else
  echo "    [警告] 未找到 $ARGON_CFG"
fi
if [ -f "$ARGON_DEF" ]; then
  sed -i \
    -e 's/^login_style classic$/login_style centered/' \
    -e 's/^online_wallpaper none$/online_wallpaper bing/' \
    "$ARGON_DEF"
  echo "    uci-defaults: $(grep -E '^(login_style|online_wallpaper) ' "$ARGON_DEF" | tr '\n' ' ')"
else
  echo "    [警告] 未找到 $ARGON_DEF"
fi

echo "==== [diy-part2] argon 主题: 追加 client-rates 自定义样式 ===="
# 目的(全部针对 argon v3 的 DOM/CSS 特性):
#   1) 防火墙「区域」表格: 区域徽标被拉成整列宽色条 / 顶到单元格边缘, 桌面宽度下还原真实表格;
#   2) 「设备流量」表格: 窄屏时主题把 .table 拆成 thead/tbody 两个匿名表格导致表头错位,
#      本页强制真实表格 + 表头按列对齐 + 容器内横向滚动;
#   3) 首页「端口状态」卡片: 主题栅格带 !important, 用同款选择器缩到 100px 等距排列。
# 做法: 构建时把样式追加进 argon 主题 cascade.css, 带 '==== client-rates:' 标记幂等(重复执行会跳过)。
CR_CSS_MARK='==== client-rates:'
CR_THEME_CSS=$(find feeds package -path '*argon*' -name cascade.css -type f 2>/dev/null || true)
if [ -n "$CR_THEME_CSS" ]; then
  for f in $CR_THEME_CSS; do
    if grep -q "$CR_CSS_MARK" "$f"; then
      echo "    已存在, 跳过: $f"
    else
      cat >> "$f" <<'CR_CUSTOM_CSS'
/* ==== client-rates: 防火墙「区域」表格排版修正 (begin) ==== */
/* 1) 区域徽标被主题拉成整列宽的色条、wan 与 ACCEPT 徽标分散到列尾并顶到单元格边缘，
      改为紧凑徽标并左对齐: [lan] ⇒ [wan] / [ACCEPT all others] */
#cbi-firewall-zone .zone-forwards {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	gap: .45rem;
}
#cbi-firewall-zone .zone-forwards > span {
	flex: 0 0 auto;
}
#cbi-firewall-zone .zone-src,
#cbi-firewall-zone .zone-dest {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: .2rem;
	flex: 0 0 auto;
	min-width: 0;
}
#cbi-firewall-zone .zonebadge {
	display: inline-block;
	width: auto;
	max-width: 100%;
	white-space: nowrap;
	padding: .1rem .55rem;
	border-radius: 6px;
	line-height: 1.5;
	font-size: 90%;
	text-align: center;
}
#cbi-firewall-zone .table > thead > tr > th:first-child {
	text-align: left;
	padding-left: 1.25rem;
}

/* 2) 桌面宽度下区域表恢复成真实表格：主题的 .table{display:block} 会把表格拆成
      独立的 thead / tbody 匿名表格，列宽各算各的；同时在窄窗口下 LuCI 会退化成
      卡片式（每行 250px 高、字段名重复显示），与上方「通用设置」区块风格不一致。 */
@media (min-width: 1100px) {
	#cbi-firewall-zone .table {
		display: table !important;
		width: 100% !important;
	}
	#cbi-firewall-zone .table > thead {
		display: table-header-group !important;
	}
	#cbi-firewall-zone .table > tbody {
		display: table-row-group !important;
	}
	#cbi-firewall-zone .table tr {
		display: table-row !important;
	}
	#cbi-firewall-zone .table th,
	#cbi-firewall-zone .table td {
		display: table-cell !important;
		width: auto !important;
		float: none !important;
	}
	#cbi-firewall-zone .table th::before,
	#cbi-firewall-zone .table td::before {
		content: none !important;
	}
}
/* ==== client-rates: 防火墙「区域」表格排版修正 (end) ==== */

/* ==== client-rates: 防火墙区块底部留白 (begin) ==== */
/* 区块内最后一行(如「转发」下拉、「流量卸载类型」)原本贴住卡片底边(gap=0),
   与行间 14px 的间距不协调, 统一补 1rem 下内边距。 */
#cbi-firewall-defaults > .cbi-section-node,
#cbi-firewall-zone > .cbi-section-node,
#cbi-firewall-forwarding > .cbi-section-node {
	padding-bottom: 1rem !important;
}
/* ==== client-rates: 防火墙区块底部留白 (end) ==== */

/* ==== client-rates: 「设备流量」表格列对齐 (begin) ==== */
/* 主题在窄窗口(<1100px)会把 .table 改成 display:block，并把 tr/td 变成 flex/block，
   原生表格被拆成 thead / tbody 两个匿名表格，列宽各算各的 → 表头与数据错位。
   本页是纯数据表(非 CBI 表单)，统一保持真实表格，窄屏改为容器内横向滚动。 */
.cr-table-wrap {
	overflow-x: auto;
	-webkit-overflow-scrolling: touch;
}
.cr-table-wrap > .cr-dev-table {
	display: table !important;
	width: 100% !important;
	min-width: 40rem;
	font-size: 0.78125rem;
}
.cr-table-wrap > .cr-dev-table > thead {
	display: table-header-group !important;
}
.cr-table-wrap > .cr-dev-table > tbody {
	display: table-row-group !important;
}
.cr-table-wrap > .cr-dev-table tr {
	display: table-row !important;
}
.cr-table-wrap > .cr-dev-table th,
.cr-table-wrap > .cr-dev-table td {
	display: table-cell !important;
	width: auto !important;
	float: none !important;
	white-space: nowrap;
	vertical-align: middle;
	/* 主题默认 20px/20px，8 列光内边距就吃掉 320px，压到 6px 才放得下 */
	padding-left: 0.375rem !important;
	padding-right: 0.375rem !important;
}
.cr-table-wrap > .cr-dev-table th::before,
.cr-table-wrap > .cr-dev-table td::before {
	content: none !important;
}
/* 表头对齐到各自数据列：文本列左对齐、数值列右对齐、状态列居中
   （主题默认把所有 th 居中，导致「设备/IP/MAC」表头浮在数据中间，看着没对齐） */
.cr-table-wrap > .cr-dev-table th:nth-child(1),
.cr-table-wrap > .cr-dev-table th:nth-child(2),
.cr-table-wrap > .cr-dev-table th:nth-child(3) {
	text-align: left !important;
}
.cr-table-wrap > .cr-dev-table th:nth-child(4),
.cr-table-wrap > .cr-dev-table th:nth-child(5),
.cr-table-wrap > .cr-dev-table th:nth-child(6),
.cr-table-wrap > .cr-dev-table th:nth-child(7) {
	text-align: right !important;
}
.cr-table-wrap > .cr-dev-table th:nth-child(8) {
	text-align: center !important;
}
/* ==== client-rates: 「设备流量」表格列对齐 (end) ==== */

/* ==== client-rates: 首页「端口状态」卡片尺寸 (begin) ==== */
/* 以 192.168.1.1（argon 2.4.7）的观感为准：卡片固定 100px 宽、整行等距铺开，
   内边距收紧、流量行强制单行不换行，避免 7 张卡片撑满一行显得笨重。
   主题自带 minmax(min(100%,8.5rem),1fr) 的栅格带 !important，必须用同款选择器覆盖。 */
[data-page="admin-status-overview"] #view div:has(> .ifacebox > .ifacebox-body > img[src*="/icons/port_"]),
[data-page="admin-status"] #view div:has(> .ifacebox > .ifacebox-body > img[src*="/icons/port_"]) {
	display: flex !important;
	flex-wrap: wrap !important;
	justify-content: space-evenly !important;
	align-items: center !important;
	gap: 0 !important;
}
[data-page="admin-status-overview"] #view .ifacebox:has(.argon-port-traffic),
[data-page="admin-status"] #view .ifacebox:has(.argon-port-traffic) {
	width: 100px !important;
	max-width: 100px !important;
	margin: .25em !important;
}
[data-page="admin-status-overview"] #view .ifacebox:has(.argon-port-traffic) .ifacebox-head,
[data-page="admin-status"] #view .ifacebox:has(.argon-port-traffic) .ifacebox-head {
	padding: 3.5px 4px !important;
	font-size: 14px !important;
	line-height: 1.3 !important;
}
[data-page="admin-status-overview"] #view .ifacebox:has(.argon-port-traffic) .ifacebox-body,
[data-page="admin-status"] #view .ifacebox:has(.argon-port-traffic) .ifacebox-body {
	padding: 12px 4px !important;
}
[data-page="admin-status-overview"] #view .ifacebox:has(.argon-port-traffic) .ifacebox-body img,
[data-page="admin-status"] #view .ifacebox:has(.argon-port-traffic) .ifacebox-body img {
	width: 30px !important;
	height: 30px !important;
}
[data-page="admin-status-overview"] #view .argon-port-traffic,
[data-page="admin-status"] #view .argon-port-traffic {
	margin: 0 !important;
	font-size: 80% !important;
}
[data-page="admin-status-overview"] #view .argon-port-traffic > div,
[data-page="admin-status"] #view .argon-port-traffic > div {
	flex-wrap: nowrap !important;
	gap: 4px !important;
}
[data-page="admin-status-overview"] #view .argon-port-traffic dt,
[data-page="admin-status-overview"] #view .argon-port-traffic dd,
[data-page="admin-status"] #view .argon-port-traffic dt,
[data-page="admin-status"] #view .argon-port-traffic dd {
	font-size: 11px !important;
}
/* ==== client-rates: 首页「端口状态」卡片尺寸 (end) ==== */
CR_CUSTOM_CSS
      grep -q "$CR_CSS_MARK" "$f" \
        && echo "    追加完成: $f" || { echo "    [错误] 追加失败: $f"; exit 1; }
    fi
  done
else
  echo "    [警告] 未找到 argon cascade.css, 跳过"
fi

echo "==== [diy-part2] 完成 ===="
