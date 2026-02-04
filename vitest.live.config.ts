import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/live/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		globals: true,
		testTimeout: 30000, // Live tests may be slow
		hookTimeout: 30000
	}
});
