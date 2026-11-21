import { defineConfig } from 'vitest/config'
import { guideControls } from './scripts/guideControls'

export default defineConfig({
  plugins: [guideControls()],
  // Agent worktrees under .claude/ hold copies of the tests.
  test: { exclude: ['**/node_modules/**', '.claude/**'] },
})
