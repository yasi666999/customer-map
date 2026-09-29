---
name: customer-address-map
description: Turn an order or customer table (CSV/Excel) into an offline, double-clickable customer-distribution map with time / platform / shop / region dimensions plus a coarse customer profile. Use when the user asks 客户分布、地址聚合、客户地图、门店覆盖、客户画像、订单地址上地图, or hands over an order export containing address text or 省市区编码 columns. Not for charting data that has no geography.
---

# 客户地址地图（离线）

把一张订单/客户表变成**本机可用**的客户分布地图：先聚合，再拼一个"双击就能用"的文件夹交给用户。
全程不联网、不上传、不需要任何地图密钥 —— 这是这个 skill 的前提，不是可选项。

## 硬约束

1. **不引入任何在线依赖**：不加 CDN、不要地图密钥、不调用在线地理编码接口。底图允许用在线瓦片，但必须能切到自带的「本地边界」。
2. **大表先聚合**：超过 50 MB 的原始表**不要**直接给浏览器导入，先跑 `scripts/aggregate.js`。
3. **手机号只做计数**：任何输出文件里都不写手机号原文；画像只用"复购/高频/活跃客户数"这类计数。
4. **口径要说明**：界面上"客户数"是分组去重口径；对外结论要用数据体检里的**全站去重**口径（见 `references/metrics.md`）。
5. 数据是用户的，不要为了"方便"把文件拷到工作区之外、也不要发到任何地方。

## 流程

### 1. 看表头，确认能不能定位

用 `references/schema.md` 对照列名。三种地理来源任选其一：地址文本 / 省市区编码 / 只有省市。
**没有任何地理列 → 停下来告诉用户缺哪一列**，不要自己编造位置。

### 2. 聚合

```bash
node scripts/aggregate.js --input <用户的表.csv> --out <输出目录>            # 城市 × 平台 × 月份
node scripts/aggregate.js --input <用户的表.csv> --out <目录> --shop        # 再加店铺维度
```

留意它打印的**数据体检**：行数、解析成功率、去重客户、复购率、平台/城市/店铺 TOP、重复 id、掩码手机号占比。
这些数字后面写结论时要原样用，别自己另算一套。

**完成判据**：解析成功率 ≥ 99%、聚合行数 > 0、聚合行数 < 源行数。任一条不满足，先按 `references/troubleshooting.md` 排查，不要往下走。

### 3. 拼分发包

```bash
node scripts/make-bundle.mjs --data <汇总表.csv> [--data <带店铺的汇总表.csv>] --out <给用户的目录>
```

产物是一个文件夹：`打开地图.html` + 程序文件 + 数据 csv + `使用说明.txt`。
**必须整个文件夹一起给**（html 依赖同目录的 js/vendor，单独拷 html 打不开）。

### 4. 验证（别跳过）

```bash
node scripts/selfcheck.mjs        # 资产齐全 + 脚本能跑 + 分发包完整
```

真实数据再核一遍：分发包里的 csv 行数 = 聚合时打印的"聚合后行数"；用浏览器打开 `打开地图.html` 导入后，页面上"共 N 条"应与之一致、地图上点数 > 0。

### 5. 给结论

按下面几块写，数字全部来自第 2 步的报告：

- 规模：源表行数 / 去重客户 / 复购率 / 人均单量
- 分布：平台 TOP、城市 TOP、店铺 TOP（有店铺列时）
- 画像：主力档是谁（一次性为主 / 复购型 / 高频复购 / 重度客户），以及它在哪个平台上最明显
- 数据质量：掩码手机号占比、重复 id、没能定位的行数
- 交付物：分发包的绝对路径 + 怎么打开

## 可选

- 想要后台解析线程（几十万行导入更顺）：`node scripts/serve.js --dir <分发包目录>`，浏览器开 http://localhost:5173/
- 需要 DuckDB 的 SQL 通道（http 模式下的加速）：把主项目 `vendor/duckdb/` 拷进 `assets/app/vendor/` 即可，本 skill 默认不带（省 34 MB）。

## 参考文件

- `references/schema.md` —— 认哪些列名、精度到哪一级
- `references/metrics.md` —— 客户数/复购率/画像的两种口径，写结论前必读
- `references/troubleshooting.md` —— 乱码、掩码手机号、没有时间列、内存吃紧等处置
