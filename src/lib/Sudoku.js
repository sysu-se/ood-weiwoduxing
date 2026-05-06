/**
 * 数独领域模型
 * 封装 9x9 数独棋盘的状态与核心规则，保证状态不可变、不可外部篡改
 * 内部使用真私有字段 #grid 存储盘面，外部只能通过公开方法访问
 */
export class Sudoku{
  // 真私有棋盘：9x9 二维数组，0 = 空格，1~9 = 填入数字
  #grid;          // 当前棋盘（用户填写）
  #question;      // 题目棋盘（固定不可修改）

  /**
   * 构造数独实例
   * @param {number[][]} grid - 9x9 二维数组，0 表示空格
   * @throws {Error} 尺寸或数值不合法时抛出
   */
  constructor(grid, question){
    if (!Array.isArray(grid) || grid.length !== 9) {
      throw new Error('棋盘必须是 9x9');
    }
    for (const row of grid) {
      if (!Array.isArray(row) || row.length !== 9) {
        throw new Error('每行必须是长度为 9 的数组');
      }
      for (const cell of row) {
        const num = cell == null ? 0 : Number(cell);
        if (isNaN(num) || num < 0 || num > 9) {
          throw new Error('格子值必须在 0~9 范围内');
        }
      }
    }

    const normalized = grid.map(row => row.map(cell => cell == null ? 0 : Number(cell)));
    this.#grid = normalized;
    this.#question = question ? question.map(row => row.map(c => c == null ? 0 : Number(c))) : normalized;
  }

  /**
   * 获取当前棋盘的只读副本（防止外部篡改内部状态）
   * @returns {number[][]} 9x9 数字数组副本
   */
  getGrid(){
    return this.#grid.map(row => row.map(cell => cell));
  }

  /**
   * 获取指定位置的格子值
   * @param {number} row - 行号
   * @param {number} col - 列号
   * @returns {number} 格子值 (0=空)
   */
  getCell(row, col){
    return this.#grid[row][col];
  }

  /**
   * 判断格子是否为题目固定数字（不可修改）
   */
  isFixed(row, col){
    return this.#question[row][col] !== 0;
  }

  /**
   * 重置到题目初始状态（清空用户填写的数字）
   * @returns {Sudoku} 新实例
   */
  resetToQuestion(){
    return new Sudoku(this.#question);
  }

  /**
   * 检查在指定位置填入指定值是否安全（无冲突）
   * 校验规则：检查所在行、列、3x3 宫，排除当前格子自身
   * @private 内部工具方法，不对外暴露
   * @param {number} row - 目标行号 0~8
   * @param {number} col - 目标列号 0~8
   * @param {number} value - 待填入的数字 0~9
   * @returns {boolean} 安全无冲突返回 true，存在冲突返回 false
   */
  isSafe(row, col, value){
    if(value === 0) return true;

    // 检查行，跳过自己
    for(let c = 0; c < 9; c++){
      if(c === col) continue;
      if(this.#grid[row][c] === value) return false;
    }

    // 检查列，跳过自己
    for(let r = 0; r < 9; r++){
      if(r === row) continue;
      if(this.#grid[r][col] === value) return false;
    }

    // 检查宫，跳过自己
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for(let r = br; r < br + 3; r++){
      for(let c = bc; c < bc + 3; c++){
        if(r === row && c === col) continue;
        if(this.#grid[r][c] === value) return false;
      }
    }

    return true;
}

  /**
   * 在指定位置进行一次猜测（遵循数独规则）
   * @param {object} move - 猜测动作
   * @param {number} move.row - 行 0~8
   * @param {number} move.col - 列 0~8
   * @param {number|null} move.value - 猜测值，0/null=清空，1~9=数字
   * @returns {Sudoku|null} 返回猜测后的新副本，非法则为null
   */
  guess(move){
    const {row, col, value} = move;

    // 坐标越界检查
    if (row < 0 || row >= 9 || col < 0 || col >= 9){
      return null;
    }

    // 禁止修改题目固定格
    if (this.isFixed(row, col)) {
      return null;
    }

    // 值合法性检查（0-9，null → 0）
    let val = value == null ? 0 : value;
    if (val < 0 || val > 9){
      return null;
    }

    // 允许冲突输入，由 UI 侧（invalidCells derived store）高亮提示（反馈 #2）
    const newGrid = this.#grid.map((rowArr, r) => 
      r === row ? rowArr.map((cell, c) => c === col ? val : cell) : [...rowArr]);


    return new Sudoku(newGrid, this.#question);
  }

  /**
   * 恢复指定格子的值（不可变操作，不做规则校验）
   * 用于 undo/redo 等历史回放场景，跳过 isSafe/isFixed 等业务校验
   * @param {number} row - 行号 0~8
   * @param {number} col - 列号 0~8
   * @param {number} value - 格子值 0~9
   * @returns {Sudoku} 新实例
   */
  restoreCell(row, col, value){
    const newGrid = this.#grid.map((rowArr, r) =>
      r === row ? rowArr.map((cell, c) => c === col ? value : cell) : [...rowArr]);
    return new Sudoku(newGrid, this.#question);
  }

  /**
   * 校验整个数独盘面是否合法
   * 遍历所有非0数字，检查是否有行/列/宫冲突
   * @returns {boolean}
   */
  isValid(){
    for(let row = 0; row < 9; row++){
      for(let col = 0; col < 9; col++){
        const value = this.getCell(row, col);
        if (value === 0) continue;

        // 复用单格检验
        if (!this.isSafe(row, col, value)){
          return false;
        }
      }
    }
    return true;
  }

  isCompleted(){
    for(let row = 0; row < 9; row++){
      for(let col = 0; col < 9; col++){
        const value = this.getCell(row, col);
        if (value === 0){
          return false;
        }

        // 复用单格检验
        if (!this.isSafe(row, col, value)){
          return false;
        }
      }
    }
    return true;
  }

  /**
   * 深克隆当前数独实例（用于 undo/redo/历史快照）
   * @returns {Sudoku}
   */
  snapshot(){
    const snapshotGrid = this.#grid.map(row => [...row]);
    const snapshotQuestion = this.#question.map(row => [...row]);
    return new Sudoku(snapshotGrid, snapshotQuestion);
  }

  /**
   * 深克隆当前数独实例（对外暴露 clone 方法，满足契约要求）
   * @returns {Sudoku} 新实例
   */
  clone(){
    return this.snapshot(); // 复用已有快照逻辑，减少冗余
  }
  
  toJSON(){
    return{
      grid: this.getGrid(),
      question: this.#question.map(row => [...row])
    };
  }

  toString(){
    const SUDOKU_SIZE = 9;
    const BOX_SIZE = 3;
    let out = '╔═══════╤═══════╤═══════╗\n';

    for (let row = 0; row < SUDOKU_SIZE; row++) {
      if (row !== 0 && row % BOX_SIZE === 0) {
        out += '╟───────┼───────┼───────╢\n';
      }

      for (let col = 0; col < SUDOKU_SIZE; col++) {
        if (col === 0) {
          out += '║ ';
        } else if (col % BOX_SIZE === 0) {
          out += '│ ';
        }

        out += (this.#grid[row][col] === 0 ? '·' : this.#grid[row][col]) + ' ';

        if (col === SUDOKU_SIZE - 1) {
          out += '║';
        }
      }

      out += '\n';
    }

    out += '╚═══════╧═══════╧═══════╝';

    return out;
    }
}

export function createSudoku(input){
  return new Sudoku(input);
}

/**
 * 从 JSON 格式反序列化创建 Sudoku（带结构安全校验）
 * @param {object|string} json
 * @throws {Error} 格式不合法则抛出
 * @returns {Sudoku}
 */
export function createSudokuFromJSON(json){
  const data = typeof json === "string" ? JSON.parse(json) : json;

  // 校验 grid 必须存在且是数组
  if (!data.grid || !Array.isArray(data.grid) || data.grid.length !== 9){
    throw new Error("非法棋盘格式");
  }

  // 校验每一行
  for (let row of data.grid){
    if (!Array.isArray(row) || row.length !== 9){
      throw new Error("棋盘必须是 9x9");
    }
  }

  return new Sudoku(data.grid, data.question);
}
