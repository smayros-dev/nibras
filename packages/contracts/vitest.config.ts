import { baseVitestConfig } from '@tt/config/vitest/base';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(baseVitestConfig, defineConfig({}));
