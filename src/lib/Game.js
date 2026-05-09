import {Sudoku, createSudokuFromJSON} from './Sudoku.js'
import {History } from './History.js';

/**
 * 游戏状态枚举
 * NORMAL    — 正常游戏模式，用户填写/撤销/重做
 * EXPLORING — 探索模式，用户可尝试多条分支路径，支持提交或放弃
 */
export const GameState = Object.freeze({
	NORMAL: 'normal',
	EXPLORING: 'exploring'
});


/**
 * 游戏核心控制器（领域服务类）
 * 负责协调数独棋盘状态与历史记录管理
 * 遵循单一职责、不可变数据设计、封装性原则
 * 对外提供 guess / undo / redo / 探索模式 标准游戏接口
 */
export class Game{
    _currentSudoku;
    _history;

	// 探索模式状态机
	#state = GameState.NORMAL;       // 当前游戏状态
	#exploreOrigin = null;           // 进入探索时的棋盘快照（用于回滚）
	#branchRootId = null;            // 进入探索时的 History 节点 ID（Undo 边界 + 剪枝锚点）
	#exploreWarning = null;          // 探索警告类型：null=无, 'conflict'=冲突, 'abandoned'=曾放弃
	#conflictStates = new Set();     // 客观冲突路径指纹（isValid === false）
	#abandonedStates = new Set();    // 主观放弃路径指纹（用户主动 abandon）

    constructor(sudoku, history){
        this._currentSudoku = sudoku.snapshot();
        this._history = history ?? new History();
    }

    getSudoku(){
        return this._currentSudoku.snapshot();
    }

    /**
     * 获取指定格子的候选数集合（提示用）
     * 委托给当前数独实例的推理方法，返回该格所有可能填入的数字
     * @param {number} row - 行号 0~8
     * @param {number} col - 列号 0~8
     * @returns {Set<number>} 候选数字集合
     */
    getHintForCell(row, col){
        return this._currentSudoku.getCandidates(row, col);
    }

    /**
     * 获取下一步可唯一确定的格子（提示用）
     * 委托给当前数独实例的推理方法，返回第一个推定值的位置与数值
     * @returns {{row:number, col:number, value:number}|null} 推定格子，无则返回 null
     */
    getNextHint(){
        return this._currentSudoku.findNextHint();
    }

    /**
     * 执行一次猜测（唯一入口）
     * 操作成功后自动记录历史快照
     * 探索模式下会额外检测盘面合法性与失败路径指纹
     * @param {object} move
     * @returns {boolean} 猜测是否成功
     */
    guess(move){
        const {row, col, value} = move;

        // 统一格式：null/undefined → 0，并且转数字
        const val = value == null ? 0 : Number(value);
        const oldValue = this._currentSudoku.getCell(row, col);

        // 数字相同不存储
        if (oldValue === val){
            return false;
        }

        const newSudoku = this._currentSudoku.guess(move);
        if(newSudoku == null) return false;

        this._history.push({row, col, oldValue, newValue: val});
        this._currentSudoku = newSudoku;

		// 探索模式：重评估盘面合法性及失败路径指纹，同步冲突信号
		if (this.#state === GameState.EXPLORING) {
			this._updateExploreConflict();
		}

        return true;
    }

    /**
     * 应用提示值到棋盘（语义包装器）
     * 复用 guess() 的完整填写流程：校验 → 写盘 → 记录历史 → 支持 Undo
     * 与 guess() 仅调用意图不同，行为完全一致
     * @param {object} move - 提示动作
     * @param {number} move.row - 行号 0~8
     * @param {number} move.col - 列号 0~8
     * @param {number} move.value - 提示值 1~9
     * @returns {boolean} 填写是否成功
     */
    applyHint(move){
        return this.guess(move);
    }

    /**
     * 撤销上一步操作
     * 探索模式下撤销后重评估冲突状态，冲突可能在回退后消除
     * @returns {void}
     */
    undo(){
        if(!this.canUndo()){
            return;
        }
        const {row, col, oldValue} = this._history.popUndo();

        // 直接恢复棋盘，不走 guess() 业务校验（反馈 #7）
        this._currentSudoku = this._currentSudoku.restoreCell(row, col, oldValue);

		// 探索模式下撤销后重评估冲突状态（冲突可能在撤销后消除）
		if (this.#state === GameState.EXPLORING) {
			this._updateExploreConflict();
		}
    }

    /**
     * 重做上一步撤销的操作
     * 探索模式下重做后重评估冲突状态
     * @returns {void}
     */
    redo(){
        if(!this.canRedo()){
            return;
        }
        const {row, col, newValue} = this._history.popRedo();

        // 直接恢复棋盘，不走 guess() 业务校验（反馈 #7）
        this._currentSudoku = this._currentSudoku.restoreCell(row, col, newValue);

		// 探索模式下重做后重评估冲突状态
		if (this.#state === GameState.EXPLORING) {
			this._updateExploreConflict();
		}
    }

    // 对外暴露撤销权限接口，封装内部History实现
	// 探索模式下若已在分支起点则禁止 undo，防止跨越探索边界（5.8）
    canUndo() {
		if (this.#state === GameState.EXPLORING &&
		    this._history.getCurrentNodeId() === this.#branchRootId) {
			return false;
		}
        return this._history.canUndo();
    }

    // 对外暴露重做权限接口，封装内部History实现
    canRedo() {
        return this._history.canRedo();
    }

	// ───────────────────────────────────────
	// 探索模式接口
	// ───────────────────────────────────────

	/**
	 * 进入探索模式
	 * 保存当前棋盘快照与 History 分支锚点，后续操作记录为新的树分支
	 * 若当前棋盘指纹已存在于失败路径集合中，仍允许进入但标记冲突提示
	 * @returns {boolean} 是否成功进入
	 */
	enterExplore(){
		if (this.#state === GameState.EXPLORING) {
			return false; // 已在探索中，幂等拒绝
		}

		this.#state = GameState.EXPLORING;
		this.#exploreOrigin = this._currentSudoku.snapshot();
		this.#branchRootId = this._history.getCurrentNodeId();
		this.#exploreWarning = null;

		// 进入时检查当前状态是否为已知冲突/放弃路径
		const fingerprint = this._getBoardFingerprint();
		if (this.#conflictStates.has(fingerprint)) {
			this.#exploreWarning = 'conflict';
		} else if (this.#abandonedStates.has(fingerprint)) {
			this.#exploreWarning = 'abandoned';
		}

		return true;
	}

	/**
	 * 提交探索模式
	 * 保留当前分支的所有操作，退出探索状态，清空失败路径记忆
	 * @returns {boolean} 是否成功提交
	 */
	commitExplore(){
		if (this.#state !== GameState.EXPLORING) {
			return false;
		}

		this.#state = GameState.NORMAL;
		this.#exploreOrigin = null;
		this.#branchRootId = null;
		this.#exploreWarning = null;
		this.#conflictStates.clear();
		this.#abandonedStates.clear();

		return true;
	}

	/**
	 * 放弃探索模式
	 * 回滚棋盘到进入探索前的快照，剪除探索期间产生的 History 分支
	 * 将当前棋盘指纹记录为失败路径，后续探索到达相同状态时提前告知
	 * @returns {boolean} 是否成功放弃
	 */
	abandonExplore(){
		if (this.#state !== GameState.EXPLORING) {
			return false;
		}

		// 记录放弃路径指纹
		this.#abandonedStates.add(this._getBoardFingerprint());

		// 回滚棋盘到探索原点
		this._currentSudoku = this.#exploreOrigin.snapshot();

		// History 跳回分支锚点并剪除所有探索分支
		this._history.jumpToNode(this.#branchRootId);
		this._history.pruneChildren();

		// 退出探索状态
		this.#state = GameState.NORMAL;
		this.#exploreOrigin = null;
		this.#branchRootId = null;
		this.#exploreWarning = null;

		return true;
	}

	/**
	 * 是否处于探索模式
	 * @returns {boolean}
	 */
	isExploring(){
		return this.#state === GameState.EXPLORING;
	}

	/**
	 * 获取探索模式当前警告类型
	 * @returns {null|'conflict'|'abandoned'} null=无警告, 'conflict'=棋盘冲突, 'abandoned'=曾放弃此路径
	 */
	getExploreWarning(){
		return this.#exploreWarning;
	}

	/**
	 * 获取探索分支根节点的子分支数量
	 * 反映从探索起点出发尝试了多少条不同的第一手路径
	 * @returns {number}
	 */
	getExploreBranchCount(){
		if (this.#branchRootId == null) return 0;
		return this._history.getChildrenCount(this.#branchRootId);
	}

	/**
	 * 重评估探索模式冲突状态
	 * 根据盘面合法性及冲突/放弃路径指纹确定警告类型，在 guess/undo/redo 后调用
	 */
	_updateExploreConflict(){
		if (!this._currentSudoku.isValid()) {
			this.#exploreWarning = 'conflict';
			this.#conflictStates.add(this._getBoardFingerprint());
			return;
		}
		// 盘面合法时按优先级判断：冲突 > 曾放弃 > 无警告
		const fingerprint = this._getBoardFingerprint();
		if (this.#conflictStates.has(fingerprint)) {
			this.#exploreWarning = 'conflict';
		} else if (this.#abandonedStates.has(fingerprint)) {
			this.#exploreWarning = 'abandoned';
		} else {
			this.#exploreWarning = null;
		}
	}

	/**
	 * 生成当前棋盘的指纹字符串
	 * 将 9x9 网格扁平化为 81 字符字符串，用于失败路径去重匹配
	 * @returns {string} 棋盘指纹
	 */
	_getBoardFingerprint(){
		return this._currentSudoku.getGrid().flat().join('');
	}

	// ───────────────────────────────────────

    /**
     * 清空当前节点的所有子分支（清理无用尝试）
     */
    clearBranchChildren(){
        this._history.pruneChildren();
    }

    /**
     * 删除指定 ID 的单条分支
     * @param {number} targetId
     * @returns {boolean}
     */
    deleteBranch(targetId){
        return this._history.pruneBranch(targetId);
    }

    /**
     * 清空所有历史记录（重置撤销/重做）
     */
    clearHistory() {
        this._history.clear();
    }

    /**
     * 清空用户填写的所有答案
     * 恢复到初始题目状态，并清空历史
     * @returns {void}
     */
    clearAnswers(){
        // 重置数独（恢复初始空白答题状态）
        this._currentSudoku = this._currentSudoku.resetToQuestion();

        // 清空历史记录
        this._history.clear();
    }

    toJSON(){
        return {
            current: this._currentSudoku.toJSON(),
            history: this._history.toJSON()
        }
    }

    /**
     * 返回游戏状态的可读字符串表示
     * @returns {string} 游戏状态摘要
     */
    toString() {
        return this._history.toString();
    }
}

export function createGame({sudoku}){
    return new Game(sudoku);
}


/**
 * 从 JSON 反序列化游戏（带安全校验）
 * @param {object|string} json
 * @throws {Error} 格式非法则抛出
 * @returns {Game}
 */
export function createGameFromJSON(json){
    const data = typeof json === "string" ? JSON.parse(json) : json;

    if(!data.current || !data.history){
        throw new Error('游戏存档格式非法');
    }

    // 恢复子模块
    const current = createSudokuFromJSON(data.current);
    const history = History.fromJSON(data.history);

    // 构建游戏对象
    const game = new Game(current,history);
    return game;
}
