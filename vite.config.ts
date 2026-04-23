import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: '0.0.0.0',
		// VM hostname reaches the dev server from the host OS; Vite 5+ rejects
		// unknown hosts by default.
		allowedHosts: ['dev-1', 'localhost']
	}
});
