// SPDX-License-Identifier: MIT
// @ts-check
import antfu from '@antfu/eslint-config'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  antfu({
    // ...@antfu/eslint-config options
    // Vue ESLint Rule: https://eslint.vuejs.org/rules/
    markdown: false,
    // antfu 10 turns the pnpm rules on whenever a pnpm-workspace.yaml
    // exists (5.4 defaulted to false). Their autofix adds install
    // settings (trustPolicy, shellEmulator, ...) to pnpm-workspace.yaml,
    // which would change how installs behave: keep them off (#48).
    pnpm: false,
    rules: {
      'style/comma-dangle': ['warn', 'never'],
      'style/brace-style': 'off',
      'style/operator-linebreak': 'off',
      'vue/comma-dangle': 'off',
      'vue/eqeqeq': 'off',
      'vue/max-attributes-per-line': 'warn',
      'vue/no-unused-refs': 'off',
      'antfu/top-level-function': 'off',
      // Enabled by antfu 10. Its autofix splits every ternary and
      // single-item array over several lines: ~1,300 changed lines in
      // 80 files, many of them under server/api/stripe/ where open PRs
      // work. Off until those land; adopting it is tracked in #47.
      'antfu/reasonable-newline': 'off',
      'node/prefer-global/process': 'off',
      'eqeqeq': 'off',
      'no-console': 'off',
      'no-debugger': 'off',
      'no-async-promise-executor': 'off'
    }
  })
  // Your custom configs here
)
