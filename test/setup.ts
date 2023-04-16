jest.mock('../src/workspaceRoot.js', () => {
  return {
    get workspaceRoot() {
      return global.__test__workspaceRoot
    },
  }
})

declare global {
  // See: https://stackoverflow.com/a/68328575/12292636
  // eslint-disable-next-line no-var
  var __test__workspaceRoot: string
}
export {}

afterEach(() => {
  global.__test__workspaceRoot = 'TEST_WORKSPACE_ROOT'
})
