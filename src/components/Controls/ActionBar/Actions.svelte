<script>
	import { candidates } from '@sudoku/stores/candidates';
	import { userGrid, grid, cellKey } from '@sudoku/stores/grid';
	import { cursor } from '@sudoku/stores/cursor';
	import { hints, hintCandidates, hasNextHint } from '@sudoku/stores/hints';
	import { notes } from '@sudoku/stores/notes';
	import { settings } from '@sudoku/stores/settings';
	import { keyboardDisabled } from '@sudoku/stores/keyboard';
	import { gamePaused, isExploring, exploreWarning } from '@sudoku/stores/game';
	import { canUndo, canRedo } from '@sudoku/stores/explore';

	$: hintsAvailable = $hints > 0;

	/**
	 * 处理提示按钮点击
	 * UI 层职责：前置检查（次数/光标/重复扣减）+ 清除笔记
	 * 领域逻辑委托给 userGrid.requestHint()
	 */
	function handleHint() {
		if (!hintsAvailable) return;
		if ($cursor.x === null || $cursor.y === null) return;

		const key = cellKey($cursor.x, $cursor.y);

		// 该格已有提示候选数时不再重复扣减
		if ($hintCandidates[key] && $hintCandidates[key].length > 0) {
			return;
		}

		// 清除该格已有的用户笔记
		if ($candidates.hasOwnProperty(key)) {
			candidates.clear($cursor);
		}

		// 委托 store 层执行完整提示流程
		const success = userGrid.requestHint($cursor);
		if (success) hints.useHint();
	}

	/** 下一步提示：查找唯一推定格，光标跳转并展示候选数 */
	function handleNextHint() {
		if (!hintsAvailable) return;
		const hint = userGrid.getNextHint();
		if (!hint) return;
		// 光标跳转到推定格
		cursor.set(hint.col, hint.row);
		// 复用 handleHint 逻辑：展示候选数 + 唯一候选自动填入
		handleHint();
	}

	function handleUndo() {
		userGrid.undo();
	}

	function handleRedo() {
		userGrid.redo();
	}

	function handleEnterExplore() {
		userGrid.enterExplore();
	}

	function handleCommitExplore() {
		userGrid.commitExplore();
	}

	function handleAbandonExplore() {
		userGrid.abandonExplore();
	}
</script>

<div class="action-buttons relative space-x-3">

	<button class="btn btn-round" disabled={$gamePaused || !$canUndo} on:click={handleUndo} title="Undo">
		<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
		</svg>
	</button>

	<button class="btn btn-round" disabled={$gamePaused || !$canRedo} on:click={handleRedo} title="Redo">
		<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10h-10a8 8 90 00-8 8v2M21 10l-6 6m6-6l-6-6" />
		</svg>
	</button>

	<button class="btn btn-round btn-badge"
	        disabled={$cursor.x === null || $cursor.y === null || $keyboardDisabled || !hintsAvailable || $userGrid[$cursor.y][$cursor.x] !== 0}
	        on:click={handleHint}
	        title="Hints ({$hints})">
		<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
		</svg>

		{#if $settings.hintsLimited}
			<span class="badge" class:badge-primary={hintsAvailable}>{$hints}</span>
		{/if}
	</button>

	<button class="btn btn-round btn-badge"
		        disabled={$gamePaused || !hintsAvailable || !$hasNextHint || $isExploring}
		        on:click={handleNextHint}
		        title="下一步提示 ({$hints})">
			<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
			</svg>

			{#if $settings.hintsLimited}
				<span class="badge" class:badge-primary={hintsAvailable}>{$hints}</span>
			{/if}
		</button>

		<button class="btn btn-round btn-badge" on:click={notes.toggle} title="Notes ({$notes ? 'ON' : 'OFF'})">
		<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
		</svg>

		<span class="badge tracking-tighter" class:badge-primary={$notes}>{$notes ? 'ON' : 'OFF'}</span>
	</button>

	<button class="btn btn-round" disabled={$gamePaused} on:click={() => userGrid.clearAnswers()} title="清空全部答案">
			<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
			</svg>
		</button>

		<!-- 探索模式按钮组 -->
	{#if $isExploring}
		<button class="btn btn-round" on:click={handleCommitExplore} title="提交探索">
			<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
			</svg>
		</button>
		<button class="btn btn-round" on:click={handleAbandonExplore} title="放弃探索">
			<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	{:else}
		<button class="btn btn-round" disabled={$gamePaused} on:click={handleEnterExplore} title="进入探索">
			<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
			</svg>
		</button>
	{/if}

	<!-- 探索警告提示，绝对定位于按钮组外侧右侧，不影响按钮位置也不重叠 -->
	{#if $exploreWarning === 'conflict'}
		<span class="conflict-badge">棋盘冲突</span>
	{:else if $exploreWarning === 'abandoned'}
		<span class="conflict-badge">曾放弃此路径</span>
	{/if}

</div>


<style>

	.action-buttons {
		@apply flex flex-wrap justify-evenly self-end;
	}

	.btn-badge {
		@apply relative;
	}

	.badge {
		min-height: 20px;
		min-width:  20px;
		@apply p-1 rounded-full leading-none text-center text-xs text-white bg-gray-600 inline-block absolute top-0 left-0;
	}

	.badge-primary {
		@apply bg-primary;
	}

	.conflict-badge {
		@apply absolute inline-flex items-center text-red-500 text-xs px-2 py-1 bg-red-100 rounded font-semibold;
		left: calc(100% + 6px);
		top: 50%;
		transform: translateY(-50%);
		white-space: nowrap;
	}
</style>
