import { Dir, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const simpleDir = {
  packages: {
    core: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/core',
        scripts: {
          build: 'echo $RANDOM > .out.txt',
        },
        dependencies: {
          '@test/utils': '*',
        },
      }),
    },
    utils: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/utils',
        scripts: {
          build: 'echo $RANDOM > .out.txt',
        },
      }),
    },
  },
} satisfies Dir

describe('on ci', () => {
  test('the full manifest is logged', async () => {
    await runIntegrationTest(
      {
        structure: simpleDir,
        packageManager: 'npm',
        workspaceGlobs: ['packages/*'],
      },
      async (t) => {
        const { output, status } = await t.exec(['build'], {
          env: {
            __test__IS_CI_OVERRIDE: 'true',
            GITHUB_ACTIONS: 'true',
            __test__CONSTANT_MTIME: 'true',
          },
        })

        expect(status).toBe(0)
        expect(output).toMatchInlineSnapshot(`
          "lazyrepo 0.0.0-test
          -------------------
          No config files found, using default configuration.

          build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
          build::packages/utils Finding files matching lazy.config.* took 1.00s
          build::packages/utils Finding files matching packages/utils/**/* took 1.00s
          build::packages/utils Hashed 3/3 files in 1.00s
          build::packages/utils cache miss, no previous manifest found
          build::packages/utils RUN echo $RANDOM > .out.txt in packages/utils
          build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
          ::group::build::packages/utils  input manifest
          file	package-lock.json	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855	100.000
          file	packages/utils/index.js	e7fb2f4978d27e4f9e23fe22cea20bb3da1632fabb50362e2963c68700a6f1a5	100.000
          file	packages/utils/package.json	66a4aa54ada27c4596c6e5c7103b46bedef607d952c8985ca520a85c27a16543	100.000

          ::endgroup::
          build::packages/utils ✔ done in 1.00s
          build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
          build::packages/core Finding files matching lazy.config.* took 1.00s
          build::packages/core Finding files matching packages/core/**/* took 1.00s
          build::packages/core Hashed 3/3 files in 1.00s
          build::packages/core cache miss, no previous manifest found
          build::packages/core RUN echo $RANDOM > .out.txt in packages/core
          build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
          ::group::build::packages/core  input manifest
          upstream package inputs	build::packages/utils	2699f1c1aec310b2069f1c207e86385d8f65cb7d9c8a03e9b31be18a5ebde35e
          file	package-lock.json	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855	100.000
          file	packages/core/index.js	e7fb2f4978d27e4f9e23fe22cea20bb3da1632fabb50362e2963c68700a6f1a5	100.000
          file	packages/core/package.json	ea5dc87ceba8dcac6a0c56e525f861a648ee06094ccf5a8fa33b75ac1f3e75c4	100.000

          ::endgroup::
          build::packages/core ✔ done in 1.00s

               Tasks:  2 successful, 2 total
              Cached:  0/2 cached
                Time:  1.00s

          "
        `)
      },
    )
  })

  test('the full diff is logged', async () => {
    await runIntegrationTest(
      {
        structure: simpleDir,
        packageManager: 'npm',
        workspaceGlobs: ['packages/*'],
      },
      async (t) => {
        const firstRun = await t.exec(['build'], {
          env: {
            __test__IS_CI_OVERRIDE: 'true',
            GITHUB_ACTIONS: 'true',
            __test__CONSTANT_MTIME: 'true',
          },
        })

        expect(firstRun.status).toBe(0)

        t.remove('packages/utils/index.js')
        t.write('packages/core/fun.js', 'console.log("ok")')

        const secondRun = await t.exec(['build'], {
          env: {
            __test__IS_CI_OVERRIDE: 'true',
            GITHUB_ACTIONS: 'true',
            __test__CONSTANT_MTIME: 'true',
          },
        })

        expect(secondRun.status).toBe(0)
        expect(secondRun.output).toMatchInlineSnapshot(`
          "lazyrepo 0.0.0-test
          -------------------
          No config files found, using default configuration.

          build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
          build::packages/utils Finding files matching lazy.config.* took 1.00s
          build::packages/utils Finding files matching packages/utils/**/* took 1.00s
          build::packages/utils Hashed 1/2 files in 1.00s
          build::packages/utils cache miss
          ::group::build::packages/utils  changes since last run
          - removed file packages/utils/index.js

          ::endgroup::
          build::packages/utils RUN echo $RANDOM > .out.txt in packages/utils
          build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
          ::group::build::packages/utils  input manifest
          file	package-lock.json	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855	100.000
          file	packages/utils/package.json	66a4aa54ada27c4596c6e5c7103b46bedef607d952c8985ca520a85c27a16543	100.000

          ::endgroup::
          build::packages/utils ✔ done in 1.00s
          build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
          build::packages/core Finding files matching lazy.config.* took 1.00s
          build::packages/core Finding files matching packages/core/**/* took 1.00s
          build::packages/core Hashed 1/4 files in 1.00s
          build::packages/core cache miss
          ::group::build::packages/core  changes since last run
          ± changed upstream package inputs build::packages/utils
          + added file packages/core/fun.js

          ::endgroup::
          build::packages/core RUN echo $RANDOM > .out.txt in packages/core
          build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
          ::group::build::packages/core  input manifest
          upstream package inputs	build::packages/utils	8b4a40e0f67481c7690f423d943417fa32b97951ccff33e6a167396c6be4be74
          file	package-lock.json	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855	100.000
          file	packages/core/fun.js	02a83cd560777ec0e33d85bc9dc50fec8de108c55c945443cb608bfa65be9884	100.000
          file	packages/core/index.js	e7fb2f4978d27e4f9e23fe22cea20bb3da1632fabb50362e2963c68700a6f1a5	100.000
          file	packages/core/package.json	ea5dc87ceba8dcac6a0c56e525f861a648ee06094ccf5a8fa33b75ac1f3e75c4	100.000

          ::endgroup::
          build::packages/core ✔ done in 1.00s

               Tasks:  2 successful, 2 total
              Cached:  0/2 cached
                Time:  1.00s

          "
        `)
      },
    )
  })

  test('the grouped outputs are suppressed if the CI provider does not support grouping', async () => {
    await runIntegrationTest(
      {
        structure: simpleDir,
        packageManager: 'npm',
        workspaceGlobs: ['packages/*'],
      },
      async (t) => {
        const { output, status } = await t.exec(['build'], {
          env: {
            __test__IS_CI_OVERRIDE: 'true',
            GITHUB_ACTIONS: undefined,
            CIRCLECI: '1',
            __test__CONSTANT_MTIME: 'true',
          },
        })

        expect(status).toBe(0)
        expect(output).toMatchInlineSnapshot(`
          "lazyrepo 0.0.0-test
          -------------------
          No config files found, using default configuration.

          build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
          build::packages/utils Finding files matching lazy.config.* took 1.00s
          build::packages/utils Finding files matching packages/utils/**/* took 1.00s
          build::packages/utils Hashed 3/3 files in 1.00s
          build::packages/utils cache miss, no previous manifest found
          build::packages/utils RUN echo $RANDOM > .out.txt in packages/utils
          build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
          build::packages/utils  input manifest
          [ grouped content suppressed on unsupported CI environment ]
          build::packages/utils ✔ done in 1.00s
          build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
          build::packages/core Finding files matching lazy.config.* took 1.00s
          build::packages/core Finding files matching packages/core/**/* took 1.00s
          build::packages/core Hashed 3/3 files in 1.00s
          build::packages/core cache miss, no previous manifest found
          build::packages/core RUN echo $RANDOM > .out.txt in packages/core
          build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
          build::packages/core  input manifest
          [ grouped content suppressed on unsupported CI environment ]
          build::packages/core ✔ done in 1.00s

               Tasks:  2 successful, 2 total
              Cached:  0/2 cached
                Time:  1.00s

          "
        `)
      },
    )
  })
})
