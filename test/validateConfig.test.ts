import { produce } from 'immer'
import { LazyConfig } from '../src/config/resolveConfig.js'
import { validateConfig } from '../src/config/validateConfig.js'

const validConfig = {
  baseCacheConfig: {
    include: ['<rootDir>/package.json', 'yarn.lock', 'pnpm-lock.yaml', 'package-lock.json'],
    exclude: ['<rootDir>/package.json', 'dist/**/*'],
    envInputs: ['SOME_ENV_VAR', 'ANOTHER_ENV_VAR'],
  },

  scripts: {
    build: {
      workspaceOverrides: {
        'packages/workspace-1': {
          baseCommand: 'yarn build --override',
          cache: {
            inputs: ['src/**/*'],
            outputs: ['dist/**/*'],
            inheritsInputFromDependencies: true,
            usesOutputFromDependencies: true,
          },
        },
      },
      parallel: true,
      baseCommand: 'yarn build',
      cache: {
        inputs: ['src/**/*'],
        envInputs: ['NODE_ENV'],
        inheritsInputFromDependencies: true,
        outputs: ['dist/**/*'],
        usesOutputFromDependencies: true,
      },
    },

    test: {
      execution: 'independent',
      baseCommand: 'yarn test',
      parallel: false,
      runsAfter: {
        build: {},
      },
      cache: {
        envInputs: ['NODE_ENV'],
        inputs: {
          include: ['src/**/*', 'banana'],
          exclude: ['dist/**/*'],
        },
        outputs: ['dist/**/*'],
      },
    },

    publish: {
      execution: 'top-level',
      baseCommand: 'yarn publish',
      cache: {
        inputs: ['package.json'],
        outputs: {
          include: ['dist/**/*'],
          exclude: ['dist/**/node_modules/**/*'],
        },
        envInputs: ['NODE_ENV'],
      },
    },
  },

  ignoreWorkspaces: ['packages/workspace-1', 'packages/workspace-2'],
} satisfies LazyConfig

const editConfig = (fn: (config: typeof validConfig) => void) => {
  return produce(validConfig, fn)
}

describe('validateConfig', () => {
  it('should validate a valid config', () => {
    expect(validateConfig(validConfig)).toEqual(validConfig)
  })

  it('should throw if the config has extra stuff', () => {
    // add an extra key to the root config
    expect(() =>
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.extraRootKey = 'extra'
        }),
      ),
    ).toThrowErrorMatchingInlineSnapshot(`"Unrecognized key(s) in object: 'extraRootKey'"`)
    // add an extra key to the base cache config
    expect(() =>
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.baseCacheConfig.extraBaseCacheKey = 'extra'
        }),
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Unrecognized key(s) in object: 'extraBaseCacheKey' at "baseCacheConfig""`,
    )

    // add an extra key to the script
    expect(() =>
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.scripts.build.extraScriptKey = 'extra'
        }),
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Unrecognized key(s) in object: 'extraScriptKey' at "scripts.build""`,
    )

    // add an extra key to the workspace override
    expect(() =>
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.scripts.build.workspaceOverrides['packages/workspace-1'].extraOverrideKey = 'extra'
        }),
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Unrecognized key(s) in object: 'extraOverrideKey' at "scripts.build.workspaceOverrides.packages/workspace-1""`,
    )
  })

  it('should throw an error if the independent cache config has the depenent cache config keys', () => {
    expect(() =>
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.scripts.test.cache.inheritsInputFromDependencies = true
        }),
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Unrecognized key(s) in object: 'inheritsInputFromDependencies' at "scripts.test.cache""`,
    )

    expect(() =>
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.scripts.test.cache.usesOutputFromDependencies = true
        }),
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Unrecognized key(s) in object: 'usesOutputFromDependencies' at "scripts.test.cache""`,
    )
  })

  it('allows the cache config to be the string "none"', () => {
    expect(
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.scripts.test.cache = 'none'
        }),
      ).scripts?.test.cache,
    ).toEqual('none')
  })

  it('allows the baseCacheConfig to be undefined', () => {
    expect(
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          delete draft.baseCacheConfig
        }),
      ).baseCacheConfig,
    ).toBeUndefined()
  })

  it('allows the baseCacheConfig.include to be undefined', () => {
    expect(
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          delete draft.baseCacheConfig.include
        }),
      ).baseCacheConfig?.include,
    ).toBeUndefined()
  })

  it('allows the baseCacheConfig.exclude to be undefined', () => {
    expect(
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          delete draft.baseCacheConfig.exclude
        }),
      ).baseCacheConfig?.exclude,
    ).toBeUndefined()
  })

  it('allows the baseCacheConfig.envInputs to be undefined', () => {
    expect(
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          delete draft.baseCacheConfig.envInputs
        }),
      ).baseCacheConfig?.envInputs,
    ).toBeUndefined()
  })

  it('allows the scripts to be undefined', () => {
    expect(
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          delete draft.scripts
        }),
      ).scripts,
    ).toBeUndefined()
  })

  it('allows the scripts to be an empty object', () => {
    expect(
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.scripts = {}
        }),
      ).scripts,
    ).toEqual({})
  })

  it('allows scripts.build to be an empty object', () => {
    expect(
      validateConfig(
        editConfig((draft) => {
          // @ts-expect-error
          draft.scripts.build = {}
        }),
      ).scripts?.build,
    ).toEqual({})
  })
})
