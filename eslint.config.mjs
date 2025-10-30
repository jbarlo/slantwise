import tseslint from '@electron-toolkit/eslint-config-ts';
import eslintPluginReact from 'eslint-plugin-react';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // Catch bare .js(x)/ .ts(x) imports (without ./ or ../) that should be relative
      // This is to ensure Electron can resolve the imports
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^[^.@].*\\.js$/]',
          message:
            "Use a relative './' or '../' for local .js files. Bare imports like 'utils.js' should be './utils.js'"
        },
        {
          selector: 'ImportDeclaration[source.value=/^[^.@].*\\.jsx$/]',
          message:
            "Use a relative './' or '../' for local .jsx files. Bare imports like 'utils.jsx' should be './utils.jsx'"
        },
        {
          selector: 'ImportDeclaration[source.value=/^[^.@].*\\.ts$/]',
          message:
            "Use a relative './' or '../' for local .ts files. Bare imports like 'utils.ts' should be './utils.ts'"
        },
        {
          selector: 'ImportDeclaration[source.value=/^[^.@].*\\.tsx$/]',
          message:
            "Use a relative './' or '../' for local .tsx files. Bare imports like 'utils.tsx' should be './utils.tsx'"
        }
      ]
    }
  },
  // eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-refresh/only-export-components': 'off'
    }
  }
);
