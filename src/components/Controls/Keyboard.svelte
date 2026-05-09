<script>
	import { userGrid, cellKey } from '@sudoku/stores/grid';
	import { cursor } from '@sudoku/stores/cursor';
	import { notes } from '@sudoku/stores/notes';
	import { candidates } from '@sudoku/stores/candidates';

	import { keyboardDisabled } from '@sudoku/stores/keyboard';

	function handleKeyButton(num) {
		if (!$keyboardDisabled) {
			if ($notes) {
				if (num === 0) {
					candidates.clear($cursor);
				} else {
					candidates.add($cursor, num);
				}
				userGrid.set($cursor, 0);
			} else {
				if ($candidates.hasOwnProperty(cellKey($cursor.x, $cursor.y))) {
					candidates.clear($cursor);
				}

				userGrid.set($cursor, num);
			}
		}
	}

	function handleKey(e) {
		switch (e.key) {
			case 'ArrowUp':
			case 'w':
				cursor.move(0, -1);
				break;

			case 'ArrowDown':
			case 's':
				cursor.move(0, 1);
				break;

			case 'ArrowLeft':
			case 'a':
				cursor.move(-1);
				break;

			case 'ArrowRight':
			case 'd':
				cursor.move(1);
				break;

			case 'Backspace':
			case 'Delete':
				handleKeyButton(0);
				break;

			default:
				if (e.key >= '0' && e.key <= '9') {
					handleKeyButton(parseInt(e.key, 10));
				}
				break;
		}
	}
</script>

<svelte:window on:keydown={handleKey} />

<div class="keyboard-grid">

	{#each Array(10) as _, keyNum}
		{#if keyNum === 9}
			<button class="btn btn-key" disabled={$keyboardDisabled} title="清除选定格" on:click={() => handleKeyButton(0)}>
				<svg class="icon-outline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l3.343 3.343a2 2 0 001.414.586H19a2 2 0 002-2V8a2 2 0 00-2-2H7.757a2 2 0 00-1.414.586L3 12z" />
				</svg>
			</button>
		{:else}
			<button class="btn btn-key" disabled={$keyboardDisabled} title="Insert {keyNum + 1}" on:click={() => handleKeyButton(keyNum + 1)}>
				{keyNum + 1}
			</button>
		{/if}
	{/each}

</div>

<style>
	.keyboard-grid {
		@apply grid grid-rows-2 grid-cols-5 gap-3;
	}


	.btn-key {
		@apply py-4 px-0;
	}
</style>
