/**
 * 历史节点类（多叉树结构）
 * 用于记录每一步数独操作的快照及父子关系，支持多分支回溯
 * @internal 仅在 History 内部使用，不对外暴露
 */
export class HistoryNode{

    id;
    parent = null;
    children = [];             // 保存多个分支节点
    snapshot;
    activeChild = null;         // 当前活跃子节点（用于保持 redo 行为与栈结构一致）

    constructor(id, snapshot, parent){
        this.id = id;
        this.snapshot = snapshot;
        this.parent = parent;
    }
}


/**
 * 历史记录管理类（领域对象）
 * 专注管理数独操作的增量快照，实现 Undo / Redo / 分支跳转 / 剪枝
 * 遵循单一职责原则，与 Game 逻辑完全解耦，支持多叉树结构
 */
export class History{
    
    #root;
    #currentNode;
    #nodeIdCounter = 1;         // 节点自增 ID 计数器


    constructor(){
        // 创建一个【空白根节点】作为初始状态
        const emptyNode = new HistoryNode(0, null, null);
        this.#root = emptyNode;
        this.#currentNode = emptyNode;
    }

    /**
     * 推入新的操作快照，自动创建树节点
     * 若当前节点存在，则将新节点加入子节点，并设为活跃子节点
     * @param {object} snapshot - 增量快照
     */
    push(snapshot){
        const newNode = new HistoryNode(this.#nodeIdCounter++, snapshot, this.#currentNode);
        // 无论当前节点是否为根，都添加子节点
        if(this.#currentNode){
            this.#currentNode.children.push(newNode);
            this.#currentNode.activeChild = newNode;
        } else {
            // 极端情况：根节点为空时初始化
            this.#root = newNode;
        }
        this.#currentNode = newNode;
    }


    /**
     * 根据节点 ID 查找节点（广度优先遍历 BFS）
     * @param {number} targetId - 目标节点 ID
     * @returns {HistoryNode|null}
     */
    findNodeById(targetId){
        if(!this.#root){
            return null;
        }
        const queue = [this.#root];
        while(queue.length > 0){
            const node = queue.shift();
            if(node.id == targetId){
                return node;
            }
            queue.push(...node.children);
        }
        return null;
    }

    /**
     * 跳转到指定 ID 的节点，并自动更新整条链路的活跃子节点
     * 确保 redo 能正确回到当前分支
     * @param {number} targetId
     * @returns {boolean} 是否跳转成功
     */
    jumpToNode(targetId){
        const node = this.findNodeById(targetId);
        if(!node){
            return false;
        }
        let current = node
        while(current.parent){
            current.parent.activeChild = current;
            current = current.parent;
        }
        this.#currentNode = node;
        return true;
    }

    /**
     * 剪枝：清空当前节点的所有子分支
     * 同时清空活跃子节点，确保无内存泄漏
     */
     pruneChildren(){
        if(this.#currentNode){
            this.#currentNode.children = [];
            this.#currentNode.activeChild = null;
        }
     }

     /**
     * 剪枝：删除指定 ID 的分支
     * 若删除的是活跃子节点，则清空活跃标记
     * @param {number} targetId
     * @returns {boolean} 是否删除成功
     */
     pruneBranch(targetId){
        const node = this.findNodeById(targetId);
        if(!node || !node.parent){
            return false;
        }
        const siblings = node.parent.children;
        node.parent.children = siblings.filter(s => s.id !== targetId);

        if(node.parent.activeChild == node){
            node.parent.activeChild = null;
        }
        return true;
     }

    /**
     * 取出一条撤销记录（给 Game 使用）
     * 撤销操作：返回上一个节点
     * @returns {object|null} 增量快照
     */
    popUndo(){
        if(!this.canUndo()){
            return null;
        }
        const node = this.#currentNode;
        this.#currentNode = node.parent;
        return node.snapshot;
    }

    /**
     * 取出一条重做记录（给 Game 使用）
     * 重做操作：进入当前活跃子节点
     * @returns {object|null} 增量快照
     */
    popRedo(){
        if(!this.canRedo()){
            return null;
        }
        const next = this.#currentNode.activeChild;
        this.#currentNode = next;
        return next.snapshot;
    }

    canUndo(){
        return this.#currentNode?.parent !== null;
    }

    canRedo(){
        return this.#currentNode?.activeChild !== null;
    }

    /** 清空所有历史 */
    clear(){
        const emptyNode = new HistoryNode(0, null, null);
        this.#root = emptyNode;
        this.#currentNode = emptyNode;
        this.#nodeIdCounter = 1;
    }

    /**
     * 序列化历史树为扁平结构（节点列表 + ID 引用）
     * @returns {object} 可 JSON 序列化的对象
     */
    toJSON(){
        const nodes = [];
        const queue = [this.#root];
        while (queue.length > 0) {
            const node = queue.shift();
            nodes.push({
                id: node.id,
                parentId: node.parent ? node.parent.id : null,
                childrenIds: node.children.map(c => c.id),
                activeChildId: node.activeChild ? node.activeChild.id : null,
                snapshot: node.snapshot
            });
            queue.push(...node.children);
        }
        return { nodes, rootId: this.#root.id, currentNodeId: this.#currentNode.id, nodeIdCounter: this.#nodeIdCounter };
    }

    /**
     * 从序列化数据重建历史树
     * @param {object} json - toJSON 的输出
     * @returns {History}
     */
    static fromJSON(json){
        // 先建空节点，再恢复引用关系
        const nodeMap = new Map();
        for (const d of json.nodes) {
            nodeMap.set(d.id, new HistoryNode(d.id, d.snapshot, null));
        }
        for (const d of json.nodes) {
            const node = nodeMap.get(d.id);
            node.parent = d.parentId !== null ? nodeMap.get(d.parentId) : null;
            node.children = d.childrenIds.map(id => nodeMap.get(id));
            node.activeChild = d.activeChildId !== null ? nodeMap.get(d.activeChildId) : null;
        }

        const history = new History();
        history.#root = nodeMap.get(json.rootId);
        history.#currentNode = nodeMap.get(json.currentNodeId);
        history.#nodeIdCounter = json.nodeIdCounter;
        return history;
    }

    toString(){
        return `TreeHistory { current: ${this.#currentNode?.id || 0} }`;
    }

    /**
     * 获取当前节点 ID
     * @returns {number|null}
     */
    getCurrentNodeId(){
        return this.#currentNode?.id || null;
    }

    /**
     * 获取当前节点的所有子节点（分支列表）
     * @returns {HistoryNode[]}
     */
    getCurrentChildren(){
        return this.#currentNode?.children || [];
    }
}