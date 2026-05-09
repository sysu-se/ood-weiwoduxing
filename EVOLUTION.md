# EVOLUTION.md — Homework 2 设计演进文档

> 本文档记录从 Homework 1.1 到 Homework 2 的设计演进，涵盖提示功能、探索模式的实现思路，以及对象模型如何适应新需求。

---

## 1. 你如何实现提示功能？

提示功能按自底向上的分层架构实现：

### Sudoku 领域层（纯推理）

新增两个推理方法，不感知任何游戏状态：

- **`getCandidates(row, col)`**：从全集 {1..9} 出发，排除当前行、列、3x3 宫中已出现的数字，返回 `Set<number>`。纯规则推理，不涉及 Hint 次数、光标位置等游戏概念。
- **`findNextHint()`**：遍历所有空格，调用 `getCandidates()` 获取候选集，返回第一个候选数恰好唯一的 `{row, col, value}`。若无唯一推定格则返回 `null`。

### Game 服务层（状态感知编排）

Game 层将 Sudoku 的推理能力与游戏状态（光标、History）连接：

- **`getHintForCell(row, col)`**：委托 `Sudoku.getCandidates()`，作为 Game 对外的候选查询接口。调用方不需要知道推理细节。
- **`getNextHint()`**：委托 `Sudoku.findNextHint()`，为将来"自动跳转到下一步"UI 预留。
- **`applyHint(move)`**：语义包装器，复用 `guess()` 的完整流程（校验 → 写盘 → 记 History → 可 Undo），与用户手动填写行为一致。

### Svelte Store 适配层（响应式桥接）

- **`hintCandidates` writable store**（新增于 `hints.js`）：以 `"x,y"` 字符串为键，候选数字数组为值。写入后触发 Board→Cell→Candidates 组件链的响应式渲染。
- **`userGrid.getHintForCell(pos)`**：委托 `gameInstance.getHintForCell()`，返回候选集合供 UI 消费。
- **`userGrid.applyHint(pos)`**：从 `gameInstance` 获取候选数，若唯一则委托 `gameInstance.applyHint()` 填入，再调用 `syncFromGame()` 同步盘面。原框架桩代码直接调 `solveSudoku()` 暴力写 store 的问题已修正。

### UI 层（Actions.svelte + Cell.svelte + Candidates.svelte）

- **`handleHint()`** 完整流程：检查光标格是否已显示提示（防重复扣减）→ 清除用户笔记 → 调用 `userGrid.getHintForCell()` 获取候选 → 写入 `hintCandidates` store（触发渲染）→ 扣减提示次数 → 若候选唯一则调用 `userGrid.applyHint()` 自动填入。
- **Cell.svelte** 渲染优先级调整为：填入数字 > 提示候选数 > 用户笔记 > 空白。确保提示不遮挡已填数字。
- **Candidates.svelte** 新增 `variant` prop（`'notes'` / `'hint'`），两种模式使用不同样式区分。

---

## 2. 你认为提示功能更属于 Sudoku 还是 Game？为什么？

**提示功能由 Sudoku 和 Game 协作完成，各有明确边界：**

| 职责 | 归属 | 理由 |
|------|------|------|
| 候选数推理（排除法） | **Sudoku** | 纯规则计算，不依赖游戏状态。输入是棋盘（#grid），输出是候选集。可独立单元测试。 |
| 唯一推定值查找 | **Sudoku** | 同样是纯推理——遍历空格、调用 getCandidates、判断 size===1。与游戏进度无关。 |
| 提示次数管理 | **Game** | 提示次数是游戏会话级别的资源，属于 Game 的会话状态。 |
| 提示执行（填入+记录历史） | **Game** | 填入需要校验固定格、写盘、记 History。这些都是 Game 的编排职责。 |
| 提示与光标联动 | **Store/UI** | 当前在哪个格子按 Hint 按钮是 UI 交互，不应污染领域层。 |

**协作模式**：Sudoku 提供"给定棋盘状态，能推出什么"的纯推理能力；Game 提供"在当前游戏会话中，对某格执行提示"的状态感知接口。这种分离使 Sudoku 可独立验证正确性，Game 可在不改变推理逻辑的情况下切换策略（如不同难度使用不同推理算法）。

---

## 3. 你如何实现探索模式？

探索模式通过 **Game 内部状态机 + 棋盘快照 + History 树分支** 三个机制协同实现。

### 状态机设计

```text
NORMAL ──enterExplore()──▶ EXPLORING
EXPLORING ──commitExplore()──▶ NORMAL
EXPLORING ──abandonExplore()──▶ NORMAL
```

- **`GameState` 枚举**：`NORMAL`（正常游戏）和 `EXPLORING`（探索模式）。
- `enterExplore()` 为幂等操作——已在探索中再次调用直接返回 `false`。

### 进入探索（enterExplore）

1. 保存当前棋盘快照到 `#exploreOrigin`（通过 `Sudoku.snapshot()` 深拷贝）。
2. 记录当前 History 节点 ID 到 `#branchRootId`（后续 Undo 边界 + 放弃时的剪枝锚点）。
3. 切换 `#state` 为 `EXPLORING`。
4. 检查当前棋盘指纹是否命中已知失败路径（`#conflictStates` 或 `#abandonedStates`），若命中则设置 `#exploreWarning`。

### 探索中的操作

- **填写/撤销/重做**：复用现有的 `guess()`/`undo()`/`redo()` 流程，因为这些操作都走 History 记录，自然成为 History 树的新分支。
- **每次操作后自动调用 `_updateExploreConflict()`**：若当前棋盘 `isValid() === false`，标记 `#exploreWarning = 'conflict'` 并将指纹加入 `#conflictStates`；否则按优先级（冲突 > 已放弃 > 无警告）重新评估。
- **Undo 边界保护**（`canUndo()`）：若当前 History 节点恰好位于 `#branchRootId`（探索起点），禁止撤销，防止跨过探索边界回退到探索前的历史。

### 提交探索（commitExplore）

保留探索期间的所有操作（History 分支自然保留），清空失败路径记忆（`#conflictStates`、`#abandonedStates`），退回 `NORMAL` 状态。探索分支成为主干历史的一部分。

### 放弃探索（abandonExplore）

1. 记录当前棋盘指纹到 `#abandonedStates`（主观放弃记忆）。
2. 回滚棋盘：`this.#currentSudoku = this.#exploreOrigin`（`enterExplore` 时已深拷贝，直接复用）。
3. History 剪枝：`jumpToNode(#branchRootId)` + `pruneChildren()`，探索分支被完全移除。
4. 退回 `NORMAL` 状态。

### 失败路径记忆（两级指纹）

- **`#conflictStates`**（Set）：客观冲突——棋盘 `isValid() === false` 时自动记录。
- **`#abandonedStates`**（Set）：主观放弃——用户主动 `abandonExplore()` 时记录。
- **指纹生成**（`_getBoardFingerprint()`）：将 9×9 网格 `flat()` 后 `join('')`，得到 81 字符字符串。简单高效，足够去重。
- UI 区分提示："棋盘冲突"（客观）vs "曾放弃此路径"（主观），帮助用户区分失败原因。

---

## 4. 主局面与探索局面的关系是什么？

**两者共享同一个 History 树，但在不同的分支上操作。**

### 进入探索时

- 通过 `Sudoku.snapshot()` 深拷贝棋盘（`#grid` 和 `#question` 各 `map(row => [...row])`），保存为 `#exploreOrigin`。
- 探索中的操作作用在当前棋盘（`this._currentSudoku`）上，不修改快照。
- History 架构保证了探索操作形成独立分支（新节点挂在 `#branchRootId` 节点的 children 下）。

### 提交时

- 不产生合并操作。探索期间的所有 History 节点本身就是合法历史，`pruneChildren()` 不会被调用。
- 棋盘保持不变（即探索的最终状态就是新的主局面）。

### 放弃时

- 从 `#exploreOrigin` 重新 `snapshot()` 得到干净副本，赋值给 `this._currentSudoku`——完全恢复到探索前状态。
- History 通过 `jumpToNode(#branchRootId)` 回到分支起点，再 `pruneChildren()` 物理删除探索分支节点。
- 不存在引用污染：`snapshot()` 每次返回全新实例，探索期间的棋盘状态不会"泄漏"到回滚后的主局面。

### 深拷贝安全性

`Sudoku.snapshot()` 对 `#grid` 和 `#question` 都做了行级 `[...row]` 拷贝。`Sudoku` 构造函数内部再做一次 `map(row => row.map(...))` 标准化。双重拷贝确保快照与当前棋盘完全隔离。

---

## 5. 你的 history 结构在本次作业中是否发生了变化？

**History 的树状结构设计在 HW1 已经存在，但 HW2 才真正使用其分支能力。**

### HW1 状态

- `HistoryNode` 已包含 `children[]`、`activeChild`、`parent` 等字段，天然支持多叉树。
- `History.toJSON()`/`fromJSON()` 已实现完整的树结构序列化。
- 但在 HW1 的实际使用中，Undo/Redo 只沿着 `parent ← → activeChild` 单链操作，`children[]` 始终最多一个元素。
- `pruneChildren()`、`pruneBranch()`、`jumpToNode()` 等分支操作虽然已实现，但从未被调用。

### HW2 变化

- **`getChildrenCount(nodeId)`**（新增）：通过 BFS 查找指定节点，返回 `children.length`。用于 `getExploreBranchCount()` 查询从探索起点出发尝试了多少条第一手路径。
- **`getCurrentNodeId()` Bug 修复**：原代码 `this.#currentNode?.id || null` 在根节点 `id === 0` 时因 JavaScript falsy 语义返回 `null`，导致 `abandonExplore()` 中 `jumpToNode(null)` 静默失败。改为 `this.#currentNode ? this.#currentNode.id : null`。
- **`pruneChildren()` 在 `abandonExplore()` 中首次被调用**：放弃探索时物理删除探索分支节点，防止内存泄漏。
- **`jumpToNode()` 在 `abandonExplore()` 中首次被调用**：回退到探索起点。
- **`children[]` 真正承载了多分支**：从探索起点出发，用户可多次进入→放弃，每次放弃产生一条已剪枝的分支记录，再次进入时尝试新的分支路径。

### 结构未变，语义被激活

History 的数据结构（`HistoryNode` + `children[]` + `activeChild`）在 HW1 和 HW2 之间没有改变。变化的是**对已有能力的实际使用**：HW1 用树实现了一个"有 redo 记忆的栈"，HW2 让树的 `children[]` 分支能力真正服务于探索模式的多路径尝试。

---

## 6. Homework 1 中的哪些设计，在 Homework 2 中暴露出了局限？

### 6.1 Game 缺少状态机

HW1 的 Game 只有单一的"正常游戏"状态。探索模式需要 Game 在 NORMAL 和 EXPLORING 之间切换，且不同状态下 `guess()`、`undo()`、`canUndo()` 的行为有所不同（如探索中需检测冲突，探索边界需阻止 Undo）。HW1 完全没有状态建模，新增状态只能在 Game 上直接加字段。

### 6.2 History 分支设计闲置

HW1 设计了 `children[]` + `activeChild` 的多叉树结构，但 Undo/Redo 只用到了主干链。`pruneChildren()`、`jumpToNode()`、`pruneBranch()` 等方法虽然实现完整，但在 HW1 中从未被调用。说明 HW1 的 History 设计是"过度设计但恰好为 HW2 提供了基础"。

### 6.3 Sudoku 缺乏推理接口

HW1 的 Sudoku 只有 `isSafe()` 用于单格校验和 `isValid()` 用于全盘校验，没有"基于当前棋盘能推出什么"的推理方法。提示功能需要的 `getCandidates()` 和 `findNextHint()` 必须新增。如果 HW1 就预见到需要推理接口，Sudoku 的边界会更清晰。

### 6.4 undo/redo 通过 guess 恢复状态（HW1.1 原实现）

HW1.1 原始代码中 `undo()`/`redo()` 将历史值重新传入 `Sudoku.guess()`，让历史恢复强依赖当前校验规则。HW2 改用 `restoreCell()` 直接恢复格子值（不可变操作、不做校验），使 Undo/Redo 更加稳健——不会因为校验策略变化导致历史回放失败。

### 6.5 `getCurrentNodeId()` 的 `0 || null` 缺陷

根节点 ID 为 0，`this.#currentNode?.id || null` 在根节点时返回 `null`。HW1 中这个问题不致命（因为 Undo/Redo 用的是 `canUndo()`/`canRedo()` 而非 `getCurrentNodeId()`），但在 HW2 中 `abandonExplore()` 依赖 `jumpToNode(branchRootId)` 回退到探索起点，若 `branchRootId` 被误存为 `null` 则回滚静默失败。

### 6.6 没有 store 适配层模式

HW1.1 原始提交中 Svelte 组件通过 `let` 变量手动镜像 Game 状态，每个操作后必须显式调用 `updateState()`。HW2 建立了 `grid.js` 作为 Game → Svelte 的适配层，`syncFromGame()` 自动将领域状态同步到 writable stores，形成可订阅的响应式桥接。如果 HW1 就建立这个模式，HW2 新增 store（如 `isExploring`、`exploreWarning`、`canUndo`）会更顺畅。

---

## 7. 如果重做一次 Homework 1，你会如何修改原设计？

### 7.1 预置状态枚举

```js
export const GameState = Object.freeze({
    NORMAL: 'normal',
    EXPLORING: 'exploring'
});
```

即使 HW1 只有 NORMAL 一种状态，预置状态机也能让 HW2 的扩展变成"增加一个枚举值"而非"增加一组 if-else 字段"。Game 的方法可通过 `this.#state` 做行为分支，而非零散的布尔标志位。

### 7.2 为 Sudoku 提供推理方法

HW1 应该至少包含 `getCandidates(row, col)`。它不依赖任何 HW2 的概念，纯粹是数独基本运算（排除法）。有了它，Hint 的领域层实现只是暴露接口的问题；没有它，HW2 必须在 Sudoku 上"晚添加"核心能力。

### 7.3 建立 store 适配层模式

HW1 应该在 `grid.js` 中建立 `gameInstance` + `syncFromGame()` 的模式，而非让 `App.svelte` 手工维护 `let currentGrid` / `let canUndo` 等状态变量。适配层一次建立后，HW2 新增 `exploreWarning`、`canRedo` 等 store 只需在 `syncFromGame()` 中加一行赋值。

### 7.4 History 节点 ID 从 1 开始

根节点 ID 使用 1 而非 0，避免 JavaScript 中 `0 || null` 的 falsy 陷阱。或者从一开始就使用显式判空（`x != null ? x.id : null`）而非依赖短路求值。

### 7.5 undo/redo 使用 restoreCell 而非 guess

HW1.1 应使用直接状态恢复（`restoreCell`）来处理 Undo/Redo，而非将旧值重新送入 `guess()`。这不是 HW2 才需要的——HW1 就已经有 History 记录，直接恢复既快又安全，且不与业务校验耦合。

### 7.6 保留 History 的完整序列化

HW1.1 原始提交中 `History.toJSON()` 返回空对象。正确的做法（当前 HW2 已实现）是序列化完整的树结构（节点列表 + ID 引用），确保 `Game.toJSON()` / `createGameFromJSON()` 可以完整恢复包括 undo/redo 分支在内的游戏状态。

---

## 附录：HW1.1 Review 反馈修复对照

HW1.1 的 Code Review（`lab3/codex-review.md`）指出了 8 个缺点，HW2 中已全部修复：

| # | Review 指出的问题 | HW2 修复方式 |
|---|------------------|-------------|
| 1 | 领域对象没有接入 Svelte 流程 | `grid.js` 中 `gameInstance` 接管所有用户操作，`syncFromGame()` 同步到 Svelte stores |
| 2 | `guess()` 拒绝非法输入 | `Sudoku.guess()` 允许 0~9 任意值，冲突由 `invalidCells` derived store 高亮 |
| 3 | 重写实例方法伪造不可变性 | `guess()` 直接修改 `#grid`（可变），`restoreCell()` 返回新实例（不可变），边界清晰 |
| 4 | 手工 `updateState()` 同步 | 使用 Svelte writable stores + `syncFromGame()` 自动同步，形成可订阅适配层 |
| 5 | `getSudoku()` 频繁深拷贝 | `syncFromGame()` 集中同步，不在每格渲染时调用领域对象 |
| 6 | History 序列化空实现 | `History.toJSON()`/`fromJSON()` 完整实现树结构序列化/反序列化 |
| 7 | Undo/Redo 走 `guess()` | `undo()`/`redo()` 使用 `restoreCell()` 直接恢复，不与校验规则耦合 |
| 8 | 构造函数不校验不变量 | `Sudoku` 构造函数校验 9×9 维度 + 0~9 值范围，非法输入抛出 Error |

---

---

## 附录：关键设计决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 探索模式实现方式 | 状态机 / 子会话 / 快照回滚 | 状态机 + 快照回滚 | 与 Game 现有架构最契合，不引入新的会话对象 |
| 失败记忆粒度 | 统一 Set / 分级 Set | 分级（conflict + abandoned） | 用户需区分"客观上走不通"和"我主动放弃的"，决策建议不同 |
| 提示推理归属 | Sudoku / Game | Sudoku（纯推理）+ Game（编排） | 单一职责：Sudoku 不感知次数/光标，Game 不实现排除法 |
| History 结构 | 保留多叉树 / 退化为线性栈 | 保留多叉树 | HW1 设计恰好为 HW2 探索分支提供基础，不需重构 |
| Store 循环引用 | 合并文件 / 提取公共模块 | 提取 explore.js 为叶模块 | 最小改动，不改变 grid.js 和 game.js 的对外接口 |
| 冲突徽章定位 | 参与 flex 流 / 绝对定位 | 绝对定位 `left: calc(100% + 6px)` | 不推动其他按钮位移，不遮挡棋盘 |
