import {Sudoku, createSudokuFromJSON} from './Sudoku.js'
import {History } from './History.js';


/**
 * 游戏核心控制器（领域服务类）
 * 负责协调数独棋盘状态与历史记录管理
 * 遵循单一职责、不可变数据设计、封装性原则
 * 对外提供 guess / undo / redo 标准游戏接口
 */
export class Game{
    _currentSudoku;
    _history;

    constructor(sudoku, history){
        this._currentSudoku = sudoku.snapshot();
        this._history = history ?? new History();
    }

    getSudoku(){
        return this._currentSudoku.snapshot();
    }

    /**
     * 执行一次猜测（唯一入口）
     * 遵循不可变原则：仅生成新实例，不修改原对象
     * 操作成功后自动记录历史快照
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

        return true;
    }

    /**
     * 撤销上一步操作
     * 从历史节点取回旧值，通过 restoreCell 直接恢复棋盘状态
     * @returns {void}
     */
    undo(){
        if(!this.canUndo()){
            return;
        }
        const {row, col, oldValue} = this._history.popUndo();

        // 直接恢复棋盘，不走 guess() 业务校验（反馈 #7）
        this._currentSudoku = this._currentSudoku.restoreCell(row, col, oldValue);
    }

    /**
     * 重做上一步撤销的操作
     * 从历史节点取回新值，通过 restoreCell 直接恢复棋盘状态
     * @returns {void}
     */
    redo(){
        if(!this.canRedo()){
            return;
        }
        const {row, col, newValue} = this._history.popRedo();

        // 直接恢复棋盘，不走 guess() 业务校验（反馈 #7）
        this._currentSudoku = this._currentSudoku.restoreCell(row, col, newValue);
    }

    // 对外暴露撤销权限接口，封装内部History实现
    canUndo() {
        return this._history.canUndo();
    }

    // 对外暴露重做权限接口，封装内部History实现
    canRedo() {
        return this._history.canRedo();
    }

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