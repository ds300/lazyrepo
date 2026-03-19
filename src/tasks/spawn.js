import cp from 'child_process'
import cs from 'cross-spawn'

// cross-spawn has some problematic behaviours on windows, so let's copy execa and just use cross-spawn for parsing args.

/** @type {(command: string, args?: ReadonlyArray<string>, options?: import('child_process').SpawnOptionsWithoutStdio) => import('child_process').ChildProcessWithoutNullStreams} */
export const spawn = (...props) => {
  // @ts-ignore
  const { command, args, options } = cs._parse(...props)
  return cp.spawn(command, args, options)
}
