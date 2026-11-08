# 银行系统 API（/api/bank）

> 2026-11 新增。基于统一积分的活期 / 定期存款（含利息）+ 基金投资。
> 全部端点需登录（`Authorization: Bearer <令牌>`）；受 `bank` 功能开关控制（管理员豁免）。
> 积分规则见统一积分体系；交易纯函数在 `server/src/lib/bankRules.ts`，事务服务在 `server/src/services/bankService.ts`。

## 功能概述

- **活期存款**：积分随存随取，年化 2%，**每 40 分钟一期槽位计息**（每天 36 期）、向下取整；利息在**读取时惰性结算**（无定时器），发进积分余额；不足 1 积分的利息不推进水位、自动滚存到下一槽。
- **定期存款**：7 天 / 30 天 / 90 天三档，开单锁定年化利率；到期全额计息，提前支取按活期年化 × 实际经过毫秒连续计息（本金永不亏损）。
- **基金投资**：3 只虚构基金，净值（NAV）从纪元日起逐日确定性复利，**日收益率恒 ≥ 0（净值只涨不跌）**；买卖各收 0.25% 手续费，份额允许小数，支持分批与部分卖出。
- **官方贷款**：向公共银行（CrisisPool）借款，利率 = 民间贷款最高档利率 + 5%，30 天期，到期一次还清（见下方「官方贷款」章节）。
- 前端页面 `/bank`（侧边栏「探索 → 银行」），15 秒轮询、页面隐藏时暂停。

## 利率 / 费率表

| 项目 | 数值 |
| --- | --- |
| 活期年化利率 | 2%（每槽利率 = 2% ÷ (365 × 36)，按槽数 × 余额向下取整） |
| 活期结算周期 | 40 分钟 / 期（每天 36 期；epoch 槽号 = `floor(unixMs / 2_400_000)`） |
| 定期 7 天 | 年化 5% |
| 定期 30 天 | 年化 10% |
| 定期 90 天 | 年化 18% |
| 定期到期利息 | `floor(本金 × 年化 × 期限天数 ÷ 365)` |
| 定期提前支取 | `floor(本金 × 活期年化 2% × 已过毫秒 ÷ 31_536_000_000)`（毫秒连续计息） |
| 基金手续费 | 买入 / 卖出各 0.25%（单笔最少 1 积分） |
| 基金买入份额 | `（投入积分 − 手续费）÷ 当日 NAV` |
| 基金卖出到账 | `floor(份额 × 当日 NAV − 手续费)` |
| 官方贷款年利率 | 民间贷款最高档利率 + 5%（放款时锁定，30 天期） |

基金目录（`BANK_FUNDS`，code 为稳定标识）：

| code | 名称 | 年化漂移 | 日波动 |
| --- | --- | --- | --- |
| `fund_stable` | 稳健货币 🛟 | 4% | 0.4% |
| `fund_balanced` | 均衡混合 ⚖️ | 10% | 1.2% |
| `fund_growth` | 进取股票 🚀 | 18% | 2.8% |

## 端点清单

读取限流 60 次/5min，写入限流 60 次/5min（均按用户，admin 豁免）。

### GET /api/bank — 总览

读取时先惰性结息再返回全量。响应：

```jsonc
{
  "dateKey": "2026-11-04",          // Asia/Shanghai 日期键
  "balance": 12345,                  // 可用积分余额
  "demand": {
    "balance": 5000,                 // 活期本金
    "annualRate": 0.02,
    "interestToday": 1               // 本次读取刚结算的利息（0 = 本次无入账）
  },
  "fixedTerms": [                    // 3 档，含当前持有 active 存单数
    { "key": "7d", "label": "7天", "days": 7, "annualRate": 0.05, "holdings": 1 }
  ],
  "deposits": [ /* 最近 50 张存单（active 在前），字段见下 */ ],
  "funds": [ /* 3 只，字段见下 */ ],
  "trades": [ /* 最近 30 条银行 / 基金积分流水 */ ],
  "rules": { "minAmount": 100, "maxAmount": 100000, "fundFeeRate": 0.0025 }
}
```

- `deposits[i]`：`{ id, termKey, termLabel, principal, annualRate, startAt, maturityAt, status: "active"|"redeemed", remainingDays, matured, matureInterest, currentInterestEstimate }`（`currentInterestEstimate` = 现在支取的预估利息：到期 = 全额，未到期 = 按活期）。
- `funds[i]`：`{ code, name, emoji, color, nav, prevNav, changePct, navSeries(近 14 天 {date, nav}), holding: { shares, costPoints, value } }`。`changePct` 为百分比数值（1.23 = +1.23%），NAV 保留 4 位小数。
- `trades[i]`：`{ id, amount, balance, reason, note, createdAt }`，reason 取值：`bank_deposit_in` / `bank_demand_withdraw` / `bank_fixed_open` / `bank_fixed_redeem` / `bank_interest` / `fund_buy` / `fund_sell` / `official_loan_borrow` / `official_loan_repay`（对应中文：活期存入 / 活期取出 / 定期存入 / 定期支取 / 利息发放 / 基金买入 / 基金卖出 / 官方借款 / 官方还款）。

### POST /api/bank/demand/deposit — 活期存入

body：`{ "amount": 1000 }`。可用积分 → 活期本金（先结息再入账）。响应 `{ balance, demandBalance }`。

### POST /api/bank/demand/withdraw — 活期取出

body：`{ "amount": 1000 }`。条件更新防并发超取。响应 `{ balance, demandBalance }`。

### POST /api/bank/deposits — 开定期存单

body：`{ "termKey": "30d", "amount": 1000 }`。开单锁定年化利率，`maturityAt = startAt + 期限天数`。响应 `{ balance, deposit }`。

### POST /api/bank/deposits/:id/redeem — 支取存单

无 body。到期按 `floor(本金 × 年化 × 期限天数/365)` 全额计息；提前按 `floor(本金 × 活期日利率 × 已过天数)` 计息。响应 `{ balance, depositId, principal, interest, total, matured, elapsedDays }`。

### POST /api/bank/funds/buy — 买入基金

body：`{ "code": "fund_stable", "points": 1000 }`。按当日 NAV 成交，0.25% 手续费（最少 1 积分），持仓 upsert 可分批加仓。响应 `{ balance, fundCode, fundName, nav, points, fee, shares, holding }`。

### POST /api/bank/funds/sell — 卖出基金

body：`{ "code": "fund_stable", "shares": 12.5 }`。按当日 NAV 成交，支持部分卖出（成本等比分摊），整仓清空持仓行。响应 `{ balance, fundCode, fundName, nav, shares, gross, fee, proceeds, costPoints, remainingShares, closed }`。

### 错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `BANK_AMOUNT_INVALID` | 金额不是 100–100000 的整数积分 |
| 400 | `BANK_BALANCE_INSUFFICIENT` | 活期取出超过活期余额 |
| 400 | `BANK_TERM_INVALID` | termKey 不在 7d / 30d / 90d |
| 404 | `BANK_DEPOSIT_NOT_FOUND` | 存单不存在或非本人 |
| 400 | `BANK_DEPOSIT_REDEEMED` | 存单已支取 |
| 409 | `BANK_DEPOSIT_CONFLICT` | 并发支取，存单状态已变化 |
| 404 | `BANK_FUND_NOT_FOUND` | 未知基金代码 |
| 400 | `BANK_FUND_SHARES_ZERO` / `BANK_FUND_SHARES_INVALID` | 买入折算份额为 0 / 卖出份额非法 |
| 400 | `BANK_FUND_NO_HOLDING` / `BANK_FUND_CONFLICT` | 无持仓 / 并发卖出份额已变化 |
| 400 | （无 code）`积分不足` | spendPointsTx 余额不足 |

所有积分变动写 `PointsLedger`（reason 见上，`game = null` 不占游戏日上限）；基金成交另写 `FundTrade`（append-only，含 NAV / 份额 / 手续费，对账用）。

## 惰性计息口径（40 分钟槽位制）

- 每用户一行 `BankAccount`（`userId` 唯一，首次访问自动建行），存 `demandBalance`（活期本金）与 `lastInterestSlot`（结算水位 = 上次结算到的槽号；`0` 是未初始化哨兵——建行时写当前槽号，启动迁移会把旧 `lastInterestDateKey` 换算成槽号回填，旧字段已废弃仅供迁移读取）。
- 任何银行 / 基金事务（总览读取、存取、开单、买入）都先执行 `settleDemandInterestTx`：`槽数 = lastInterestSlot → 当前槽号`（`currentSettlementSlot(now) = floor(unixMs / 2_400_000)`），利息 = `floor(余额 × 每槽利率 × 槽数)`，> 0 时发进积分余额（reason `bank_interest`，note「活期利息（N 槽，年化 2%）」）。
- **滚存规则（40 分钟粒度下不丢利息的关键）**：利息 ≥ 1 才把水位推进到当前槽；利息 = 0（含 0 余额）不推进——不足 1 分的小数利息继续累积，攒够 1 分随下一槽一并入账（余额 10 万约每 7 槽入账 1 分）。
- **封顶**：槽差超过一年槽数（365 × 36 = 13140）按 13140 槽封顶计息并**强制推进水位**（即使利息为 0），防止水位永远落后 / 长期不登录补发天量利息。
- 定期存单不参与活期结算；支取时本金 + 利息一次性回到积分余额，提前支取按 `floor(本金 × 活期年化 × 已过毫秒 ÷ 31_536_000_000)` **连续计息**（半天、6.9 天这类非整天数不再被按日截断）。

## NAV 确定性口径

- 纪元 `2026-01-01` 起始 NAV = 1，逐日复利：`NAV(d) = NAV(d−1) × (1 + r(d))`，`r(d) = max(0, 年化漂移/365 + clamp((mulberry32(seed("lineweb-fund:<code>:<dateKey>"))() × 2 − 1) × 日波动, ±3 × 日波动) + 均值回归拉力)`。
- **同日恒定、跨日确定**：同一天任意次请求结果一致；重启 / 跨日重放历史都得到同一序列，无任何存储。
- **日收益率恒 ≥ 0（净值只涨不跌）**：负收益日一律按 0 横盘，NAV 序列单调不减、长期随年化漂移上涨。
- 单日涨幅有界（≤ 3 × 日波动 + 漂移项）；NAV 下限 0.01 兜底。

## 官方贷款（/api/bank/loans/official）

银行页内置的官方放贷通道：资金来自**公共银行积分池（CrisisPool）**，借款立即到账可用积分、到期一次还清，**还款全额回流公共银行**。

- **利率公式**：当前官方年利率 `ratePct` = 民间贷款最高档利率 `baseRatePct` + 固定上浮 `premiumPct`（5%），随民间利率动态变化，但**单笔贷款在放款时锁定**。
- **期限**：`dueDays`（30 天），到期应还 = 本金 + 利息，放款时一次算死。
- **单笔限额**：`minAmount` – `maxAmount`（整数积分），由服务端权威校验。
- **一人同时只能有一笔未结清官方贷款**；已逾期未还清时不能再借。

### GET /api/bank/loans/official — 官方贷款页信息

```jsonc
{
  "ratePct": 15,               // 当前官方年利率（百分数，15 表示 15%）
  "baseRatePct": 10,           // 民间贷款最高档利率
  "premiumPct": 5,             // 官方上浮
  "dueDays": 30,               // 期限（天）
  "poolAvailable": "500000",   // 公共银行可贷余额（字符串数字）
  "minAmount": 100,            // 单笔下限
  "maxAmount": 20000,          // 单笔上限
  "loans": [ /* 我的官方贷款（含已结清），OfficialLoanDto */ ]
}
```

`OfficialLoanDto`：`{ id, principal, dueAmount, ratePct, dueDays, repaid, remaining, status: "open"|"repaid"|"overdue", borrowedAt, dueAt, settledAt }`（`settledAt` 未结清为 null；`dueAmount` 放款时锁定）。

### POST /api/bank/loans/official — 借款

body：`{ "amount": 5000 }`。校验单笔限额、未结清互斥与池子余额，通过即放款到可用积分并写流水（reason `official_loan_borrow`）。响应 `{ loan: OfficialLoanDto, poolAvailable: "..." }`。

### POST /api/bank/loans/official/:id/repay — 一键还清

无 body。全额还清该笔贷款的 `remaining`（从可用积分扣除），写流水（reason `official_loan_repay`），还款全额回流公共银行。响应 `{ loan: OfficialLoanDto, poolAvailable: "..." }`。

### 官方贷款错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `OFFICIAL_LOAN_AMOUNT_INVALID` | 借款金额非法 / 不在单笔限额内 |
| 409 | `OFFICIAL_LOAN_UNSETTLED` | 已有未结清的官方贷款 |
| 409 | `OFFICIAL_LOAN_POOL_INSUFFICIENT` | 公共银行可贷余额不足 |

## 限制

- 单笔存入 / 取出 / 定期 / 基金买入均为 **100–100000 积分的整数**（取出同样受此限制，活期余额超过 100000 时需分多次取出）。
- 定期可随时支取（提前按活期计息），不设自动到期发放——到期后的利息在**支取那一刻**一次性结算。
- 基金份额精度 4 位小数；卖出毛收入不足 1 积分手续费时到账 0（不倒扣）。
- 数据库 4 张新表（`bank_accounts` / `bank_deposits` / `fund_holdings` / `fund_trades`）均为 additive，`prisma db push` 即可。

## 自检

```bash
cd server && npm run verify:bank
```

纯函数断言（不连库）：槽位活期利息（槽号边界 / 滚存 advance 语义 / 一年槽数封顶）/ 定期到期 vs 提前（毫秒连续计息精确值）/ 利率档表不变量 / NAV 确定性与日收益率恒 ≥ 0（NAV 单调不减）/ 申赎费用数学 / 金额钳制 / 日期键工具，共 17000+ 项断言。
