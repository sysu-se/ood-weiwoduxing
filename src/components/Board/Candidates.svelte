<script>
	import { CANDIDATE_COORDS } from '@sudoku/constants';

	export let candidates = [];
	/**
	 * 渲染变体：'notes' 为用户手动笔记（灰色），'hint' 为系统提示候选数（teal 色区分）
	 */
	export let variant = 'notes';
</script>

<div class="candidate-grid">
	{#each CANDIDATE_COORDS as [row, col], index}
		<div class="candidate row-start-{row} col-start-{col}"
		     class:invisible={!candidates.includes(index + 1)}
		     class:visible-notes={variant === 'notes' && candidates.includes(index + 1)}
		     class:visible-hint={variant === 'hint' && candidates.includes(index + 1)}>
			{index + 1}
		</div>
	{/each}
</div>

<style>
	.candidate-grid {
		@apply grid h-full w-full p-1;
	}

	.candidate {
		@apply h-full w-full row-end-auto col-end-auto leading-full;
	}

	/* 用户笔记：灰色小字 */
	.visible-notes {
		@apply text-gray-500 text-xs;
	}

	/* 系统提示：teal 色加粗小字，与灰色笔记明显区分 */
	.visible-hint {
		@apply text-teal-600 text-xs font-semibold;
	}
</style>
