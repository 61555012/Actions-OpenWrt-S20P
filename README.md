**English** | [中文](https://p3terx.com/archives/build-openwrt-with-github-actions.html)

# Actions-OpenWrt

[![LICENSE](https://img.shields.io/github/license/mashape/apistatus.svg?style=flat-square&label=LICENSE)](https://github.com/P3TERX/Actions-OpenWrt/blob/master/LICENSE)
![GitHub Stars](https://img.shields.io/github/stars/P3TERX/Actions-OpenWrt.svg?style=flat-square&label=Stars&logo=github)
![GitHub Forks](https://img.shields.io/github/forks/P3TERX/Actions-OpenWrt.svg?style=flat-square&label=Forks&logo=github)

A template for building OpenWrt with GitHub Actions

## S20P 固件编译 (本项目)

针对 **Super Gateway S20P** (mediatek / filogic, MT7986A) 的两套云编译，配置与 DIY 脚本按版本分文件夹存放，便于识别与维护：

| 版本 | 工作流 | 源码 | 分支 | 设备 | 关键特性 |
|------|--------|------|------|------|----------|
| **25.12** | `s20p-25.12-chasey.yml` | chasey-dev/immortalwrt-mt798x-rebase | `25.12` | `clx_s20p` | 闭源 MTK WiFi + HNAT/WARP、mosdns、OpenAppFilter |
| **24.10** | `s20p-24.10-yuzhii.yml` | Yuzhii0718/immortalwrt-mt798x-6.6-padavanonly | `openwrt-24.10-6.6` | `supergateway_s20p` | 同 25.12 插件 + **wrtbwmon**，闭源 WiFi + MTK 硬件加速强校验 |

目录约定：

```
configs/25.12/s20p-chasey-25.12.config   # 25.12 配置 (clx_s20p)
configs/24.10/s20p-yuzhii-24.10.config   # 24.10 配置 (supergateway_s20p, 含 wrtbwmon)
diy/25.12/diy-part{1,2}.sh               # 25.12 DIY
diy/24.10/diy-part{1,2}.sh               # 24.10 DIY
files/                                   # 公共文件, 构建时合并进固件 /files
```

说明：
- 两套均将根目录 `files/` 合并进固件。
- **argon 主题与主题设置统一拉取 jerrykuku/luci-theme-argon `v3.1.1`**（v3 起设置页已并入主题包），构建前会清掉源码/feeds 里自带的旧版，避免同名包冲突。
  - 默认值：登录页样式 `居中卡片(centered)`、壁纸来源 `Bing`（同时改 `/etc/config/argon` 与 `uci-defaults`）。
  - 主题 `cascade.css` 在构建时追加 client-rates 的自定义样式（防火墙区域表、设备流量表列对齐、首页端口状态卡片尺寸），带 `==== client-rates:` 标记幂等。
- `files/` 中的 `client-rates` 页面脚本（设备流量表格 `cr-dev-table` + 窄屏横向滚动）与上面的 CSS 配套。
- 24.10 的插件集与 25.12 相同，额外增加 `wrtbwmon`；并在编译前强校验闭源 WiFi (`kmod-mt_wifi`) 与 MTK 硬件加速 (`kmod-mediatek_hnat` / `kmod-warp`) 已启用。

## Usage

- Click the [Use this template](https://github.com/P3TERX/Actions-OpenWrt/generate) button to create a new repository.
- Generate `.config` files using [Lean's OpenWrt](https://github.com/coolsnowwolf/lede) source code. ( You can change it through environment variables in the workflow file. )
- Push `.config` file to the GitHub repository.
- Select `Build OpenWrt` on the Actions page.
- Click the `Run workflow` button.
- When the build is complete, click the `Artifacts` button in the upper right corner of the Actions page to download the binaries.

## Tips

- It may take a long time to create a `.config` file and build the OpenWrt firmware. Thus, before create repository to build your own firmware, you may check out if others have already built it which meet your needs by simply [search `Actions-Openwrt` in GitHub](https://github.com/search?q=Actions-openwrt).
- Add some meta info of your built firmware (such as firmware architecture and installed packages) to your repository introduction, this will save others' time.

## Credits

- [Microsoft Azure](https://azure.microsoft.com)
- [GitHub Actions](https://github.com/features/actions)
- [OpenWrt](https://github.com/openwrt/openwrt)
- [coolsnowwolf/lede](https://github.com/coolsnowwolf/lede)
- [Mikubill/transfer](https://github.com/Mikubill/transfer)
- [softprops/action-gh-release](https://github.com/softprops/action-gh-release)
- [Mattraks/delete-workflow-runs](https://github.com/Mattraks/delete-workflow-runs)
- [dev-drprasad/delete-older-releases](https://github.com/dev-drprasad/delete-older-releases)
- [peter-evans/repository-dispatch](https://github.com/peter-evans/repository-dispatch)

## License

[MIT](https://github.com/P3TERX/Actions-OpenWrt/blob/main/LICENSE) © [**P3TERX**](https://p3terx.com)
