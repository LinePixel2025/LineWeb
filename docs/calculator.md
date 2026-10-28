# 科学计算器

> 页面：`client/src/pages/CalculatorPage.tsx`
> 引擎：`client/src/lib/calculator/{tokenizer,parser,evaluate,format,history}.ts`

## 支持

`+ - * / ^ % !`、括号、隐式乘法（`2π`、`2(3+4)`）、`sin/cos/tan/asin/acos/atan/log/ln/sqrt/abs/exp`、`π/e`、DEG/RAD、M+/M-/MR/MC、历史（localStorage 最多 50 条）、复制结果、键盘输入。

## 约束

- 不使用 `eval` / `new Function`，全部为纯函数解析/求值。
- `%` 为后缀百分号（÷100），不是取模；阶乘仅非负整数且 ≤170。
- 域错误（`sqrt(-1)`、`log(0)`、`tan(90°)`、`asin(2)`）返回结构化中文错误；结果按 12 位有效数字规整。
- 路由受 `calculator` 功能开关控制（管理员仍可用）。
