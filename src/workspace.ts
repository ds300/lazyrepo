import glob from 'fast-glob'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

export type PackageDetails = {
	name: string
	dir: string
	localDeps: string[]
	version: string
	scripts: Record<string, string>
}

export type RepoDetails = {
	packagesByName: Record<string, PackageDetails>
	packagesInTopologicalOrder: PackageDetails[]
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
		scripts: packageJson.scripts ?? {},
		localDeps: Object.keys(packageJson.dependencies ?? {}).filter((dep) =>
			allLocalPackageNames.includes(dep),
		),
	}
}

let _repoDetails: RepoDetails | null = null

export function getRepoDetails(): RepoDetails {
	if (_repoDetails) {
		return _repoDetails
	}

	const rootDir = process.cwd()
	const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))

	const packageJsonsPaths: string[] = packageJson.workspaces
		? packageJson.workspaces.flatMap((workspace: string) =>
				glob.sync(path.join(workspace, 'package.json')),
		  )
		: ['./package.json']

	const packageJsons = packageJson.workspaces
		? packageJsonsPaths.map((path: string) => JSON.parse(readFileSync(path, 'utf8')))
		: [packageJson]

	const allLocalPackageNames = packageJsons.map((packageJson) => packageJson.name)

	const packages = Object.fromEntries(
		packageJsonsPaths
			.map((path, i) => [
				packageJsons[i].name,
				getPackageDetails({ dir: path.replace('/package.json', ''), allLocalPackageNames }),
			])
			.filter(([, result]) => result !== null),
	)

	_repoDetails = {
		packagesByName: packages,
		packagesInTopologicalOrder: topologicalSortPackages(packages),
	}
	return _repoDetails
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
