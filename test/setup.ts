jest.mock('../src/workspaceRoot.js', () => {
  return {
    workspaceRoot: process.cwd(),
  }
})
