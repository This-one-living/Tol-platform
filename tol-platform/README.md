# React + TypeScript + Vite

## Direct messaging setup

The Messages page uses Supabase Auth, Postgres, and Realtime. Before deploying it, apply [`supabase/migrations/20261115000000_direct_messages.sql`](./supabase/migrations/20261115000000_direct_messages.sql) to the Supabase project that contains the app's `profiles` table. The migration creates direct conversations, message storage, participant-only row-level security, and Realtime publication for new messages.

Users must be signed in and have a profile before they can start a conversation. Profile search only returns display name, niche, and community.

## Connections

Apply [`supabase/migrations/20261116000004_connections.sql`](./supabase/migrations/20261116000004_connections.sql) after the core schema. The Connections page lists accepted network connections and returns their phone number only to the connected member. Opening a profile shows its details; Chat opens that person's conversation in Messages.

## Member discovery setup

Apply [`supabase/migrations/20261116000000_discover_profile_search.sql`](./supabase/migrations/20261116000000_discover_profile_search.sql) to the same Supabase project. It adds an authenticated search function that searches registered profiles by name, skill, and community while excluding the signed-in member.

## Built-in communities setup

Apply [`supabase/migrations/20261116000001_builtin_community_groups.sql`](./supabase/migrations/20261116000001_builtin_community_groups.sql) to seed one group per niche and LGA and enable private user memberships, group counts, and join/leave actions.

## Seeding test accounts

To create 20 confirmed test accounts with matching Discover profiles, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in a local PowerShell session, then run `npm run seed:test-accounts`. The script prints the generated emails and one shared random password. The service-role key is read only by this local script; never add it to frontend `VITE_` variables or commit it.

## Profile editing and password recovery

Apply [`supabase/migrations/20261116000002_profile_editing.sql`](./supabase/migrations/20261116000002_profile_editing.sql) to add the profile photo column, private profile read/update functions, and the per-user photo upload bucket. Add `https://<your-app-domain>/reset-password` to the Supabase Auth redirect URL allowlist so recovery links can return to the app.

## Account activity log

Apply [`supabase/migrations/20261116000003_account_activity_log.sql`](./supabase/migrations/20261116000003_account_activity_log.sql) to enable the account activity history in Settings. It records successful sign-ins/outs, account creation, profile/password changes, and group membership changes. It does not record message content.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
