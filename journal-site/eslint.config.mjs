import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Пустой catch — осознанный приём в работе с кэшем и сетью: там всегда
      // есть запасной путь, и падать из-за неудачного чтения файла нельзя.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];

export default config;
