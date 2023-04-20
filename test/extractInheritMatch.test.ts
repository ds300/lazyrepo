import { extractInheritMatch } from '../src/config/config.js'

describe('extractInheritMatch', () => {
  it('should extract the inherit match for the plain string', () => {
    expect(extractInheritMatch('lazy inherit')).toMatchInlineSnapshot(`
      {
        "envVars": null,
        "extraArgs": null,
      }
    `)
    expect(extractInheritMatch('yarn run -T lazy inherit')).toMatchInlineSnapshot(`
      {
        "envVars": null,
        "extraArgs": null,
      }
    `)
    expect(extractInheritMatch('yarn run --top-level lazy inherit')).toMatchInlineSnapshot(`
      {
        "envVars": null,
        "extraArgs": null,
      }
    `)
    expect(extractInheritMatch('yarn run lazy inherit')).toMatchInlineSnapshot(`
      {
        "envVars": null,
        "extraArgs": null,
      }
    `)
  })

  it('should return null if no inherit match is found', () => {
    expect(extractInheritMatch('test')).toBeNull()
    expect(extractInheritMatch('lazy test')).toBeNull()
  })

  it('should handle parsing env vars', () => {
    expect(extractInheritMatch('FORCE_COLOR=1 lazy inherit')).toMatchInlineSnapshot(`
      {
        "envVars": "FORCE_COLOR=1",
        "extraArgs": null,
      }
    `)
    expect(extractInheritMatch('FORCE_COLOR=1 yarn run lazy inherit')).toMatchInlineSnapshot(`
      {
        "envVars": "FORCE_COLOR=1",
        "extraArgs": null,
      }
    `)
    expect(extractInheritMatch('FORCE_COLOR=1 yarn run -T lazy inherit')).toMatchInlineSnapshot(`
      {
        "envVars": "FORCE_COLOR=1",
        "extraArgs": null,
      }
    `)
    expect(extractInheritMatch('FORCE_COLOR=1 BANANA=yes lazy inherit')).toMatchInlineSnapshot(`
      {
        "envVars": "BANANA=yes",
        "extraArgs": null,
      }
    `)
    expect(extractInheritMatch('FORCE_COLOR=1 BANANA=yes yarn run --top-level lazy inherit'))
      .toMatchInlineSnapshot(`
          {
            "envVars": "BANANA=yes",
            "extraArgs": null,
          }
      `)
  })

  it('should handle extracting more args', () => {
    expect(extractInheritMatch('lazy inherit --banana yes')).toMatchInlineSnapshot(`
      {
        "envVars": null,
        "extraArgs": "--banana yes",
      }
    `)
    expect(extractInheritMatch('lazy inherit --banana yes --apple no')).toMatchInlineSnapshot(`
      {
        "envVars": null,
        "extraArgs": "--banana yes --apple no",
      }
    `)

    expect(extractInheritMatch('yarn run lazy inherit --banana yes --apple no'))
      .toMatchInlineSnapshot(`
      {
        "envVars": null,
        "extraArgs": "--banana yes --apple no",
      }
    `)
  })

  it('should handle extracting both env vars and more args', () => {
    expect(extractInheritMatch('FORCE_COLOR=1 lazy inherit --banana yes')).toMatchInlineSnapshot(`
      {
        "envVars": "FORCE_COLOR=1",
        "extraArgs": "--banana yes",
      }
    `)
    expect(extractInheritMatch('FORCE_COLOR=1 lazy inherit --banana yes --apple no'))
      .toMatchInlineSnapshot(`
      {
        "envVars": "FORCE_COLOR=1",
        "extraArgs": "--banana yes --apple no",
      }
    `)

    expect(extractInheritMatch('FORCE_COLOR=1 yarn run -T lazy inherit --banana yes --apple no'))
      .toMatchInlineSnapshot(`
    {
      "envVars": "FORCE_COLOR=1",
      "extraArgs": "--banana yes --apple no",
    }
  `)
  })
})
