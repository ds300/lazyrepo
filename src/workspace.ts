import { existsSync, readFileSync } from 'fs'
import glob from 'fast-glob'
import path from 'path'

export type PackageDetails = {
	name: string
	dir: string
	localDeps: string[]
	version: string
	scripts?: Record<string, string>
}

function getPackageDetails({
	dir,
	allLocalPackageNames,
}: {
	dir: string
	allLocalPackageNames: string[]
}): PackageDetails | null {
	const packageJsonPath = path.join(dir, 'package.json')
	if (!existsSync(packageJsonPath)) {
		return null
	}
	const packageJson = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
	return {
		name: packageJson.name,
		dir,
		version: packageJson.version,
		scripts: packageJson.scripts,
		localDeps: Object.keys(packageJson.dependencies ?? {}).filter((dep) =>
			allLocalPackageNames.includes(dep)
		),
	}
}

export function getAllPackageDetails(): Record<string, PackageDetails> {
	const rootDir = process.cwd()
	const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
	if (!packageJson.workspaces) {
		return {
			[packageJson.name]: getPackageDetails({
				dir: rootDir,
				allLocalPackageNames: [packageJson.name],
			}) as PackageDetails,
		}
	}

	const packageJsonsPaths: string[] = packageJson.workspaces.flatMap((workspace: string) =>
		glob.sync(path.join(workspace, 'package.json'))
	)

	const packageJsons = packageJsonsPaths.map((path: string) =>
		JSON.parse(readFileSync(path, 'utf8'))
	)

	const allLocalPackageNames = packageJsons.map((packageJson) => packageJson.name)

	return Object.fromEntries(
		packageJsonsPaths
			.map((path, i) => [
				packageJsons[i].name,
				getPackageDetails({ dir: path.replace('/package.json', ''), allLocalPackageNames }),
			])
			.filter(([, result]) => result !== null)
	)
}

export function topologicalSortPackages(packages: Record<string, PackageDetails>) {
	const sorted: PackageDetails[] = []
	const visited = new Set<string>()

	function visit(packageName: string, path: string[]) {
		if (visited.has(packageName)) {
			return
		}
		visited.add(packageName)
		const packageDetails = packages[packageName]
		if (!packageDetails) {
			throw new Error(`Could not find package ${packageName}. path: ${path.join(' -> ')}`)
		}
		packageDetails.localDeps.forEach((dep) => visit(dep, [...path, dep]))
		sorted.push(packageDetails)
	}

	Object.keys(packages).forEach((packageName) => visit(packageName, [packageName]))

	return sorted
}
