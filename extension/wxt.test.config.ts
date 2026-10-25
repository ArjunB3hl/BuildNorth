import { defineConfig } from 'wxt';
import config from './wxt.config';

// Native-permission tests load this build. They must not overwrite the user's unpacked extension.
export default defineConfig({ ...config, outDir: '.output-tests' });
