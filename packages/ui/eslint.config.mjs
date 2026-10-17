import base, {
  SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS,
  TENANCY_SQL_RESTRICTIONS,
} from '@tt/config/eslint/base';
import { LOGICAL_CSS_EXEMPT_FILES, LOGICAL_CSS_RESTRICTIONS } from '@tt/config/eslint/logical-css';
import { defineConfig } from 'eslint/config';

// Base rules + the logical-CSS ban (no Next plugin: this is a component library). Rule options
// replace, not merge: the base bans are spread back in.
export default defineConfig(
  base,
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        ...TENANCY_SQL_RESTRICTIONS,
        ...SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS,
        ...LOGICAL_CSS_RESTRICTIONS,
      ],
    },
  },
  {
    files: LOGICAL_CSS_EXEMPT_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...TENANCY_SQL_RESTRICTIONS,
        ...SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS,
      ],
    },
  },
);
