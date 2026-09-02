import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = new URL('../', import.meta.url)

async function readProjectJson(relativePath) {
  const text = await readFile(new URL(relativePath, projectRoot), 'utf8')
  return JSON.parse(text)
}

async function collectFiles(directoryUrl, predicate) {
  const directoryPath = fileURLToPath(directoryUrl)
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(new URL(`${entry.name}/`, directoryUrl), predicate))
    } else if (predicate(fullPath)) {
      files.push(fullPath)
    }
  }

  return files
}

test('npm audit v2 remediation pins direct dependencies to patched major lines', async () => {
  const packageJson = await readProjectJson('package.json')

  assert.equal(packageJson.engines.node, '>=22.22.0')
  assert.equal(packageJson.dependencies['better-auth'], '^1.6.25')
  assert.equal(packageJson.dependencies.express, '^4.22.2')
  assert.equal(packageJson.dependencies.react, '^19.2.8')
  assert.equal(packageJson.dependencies['react-dom'], '^19.2.8')
  assert.equal(packageJson.dependencies['react-router'], '^8.3.0')
  assert.equal(packageJson.dependencies.mysql2, '^3.24.3')
  assert.equal(packageJson.dependencies['react-router-dom'], undefined)
  assert.equal(packageJson.dependencies.uuid, '^11.1.1')
  assert.equal(packageJson.devDependencies.eslint, '^10.8.0')
  assert.equal(packageJson.devDependencies['@eslint/js'], '^10.0.1')
  assert.equal(packageJson.devDependencies['eslint-plugin-react-hooks'], '^7.1.1')
  assert.equal(packageJson.devDependencies['eslint-plugin-react-refresh'], '^0.5.3')
  assert.equal(packageJson.devDependencies.vite, '^6.4.3')
  assert.equal(packageJson.devDependencies['@vitejs/plugin-react'], '^4.3.1')
  assert.equal(packageJson.devDependencies['@types/react'], '^19.2.17')
  assert.equal(packageJson.devDependencies['@types/react-dom'], '^19.2.3')
})

test('npm audit remediation keeps patched transitive dependencies without unsafe cross-major overrides', async () => {
  const packageJson = await readProjectJson('package.json')
  const packageLock = await readProjectJson('package-lock.json')

  assert.deepEqual(packageJson.overrides, {
    '@babel/core': '7.29.7',
    'body-parser': '1.20.6',
    'js-yaml': '4.3.0',
    kysely: '0.28.17',
    postcss: '8.5.23',
    qs: '6.16.0',
    '@humanfs/node': '0.16.8',
  })
  assert.equal(Object.keys(packageJson.overrides).some((key) => key.startsWith('brace-expansion')), false)
  assert.equal(Object.keys(packageJson.overrides).some((key) => key.startsWith('nanoid')), false)

  assert.equal(packageLock.packages['node_modules/brace-expansion']?.version, '5.0.9')
  assert.equal(packageLock.packages['node_modules/nanoid']?.version, '3.3.18')
  assert.match(packageLock.packages['node_modules/minimatch']?.dependencies?.['brace-expansion'] ?? '', /^\^5\.0\.8$/)
  assert.match(packageLock.packages['node_modules/postcss']?.dependencies?.nanoid ?? '', /^\^3\.3\.16$/)
})

test('security checks are part of the normal test suite and available as explicit npm scripts', async () => {
  const packageJson = await readProjectJson('package.json')

  assert.match(packageJson.scripts.test, /test\/dependency-security\.test\.js/)
  assert.equal(packageJson.scripts['test:security'], 'node --test test/dependency-security.test.js')
  assert.equal(packageJson.scripts['security:audit'], 'npm audit --audit-level=low')
})

test('runtime container and package engine satisfy the React Router v8 declarative-mode baseline', async () => {
  const dockerfile = await readFile(new URL('Dockerfile', projectRoot), 'utf8')
  const packageJson = await readProjectJson('package.json')

  assert.match(dockerfile, /^FROM node:22-bookworm-slim/m)
  assert.equal(packageJson.engines.node, '>=22.22.0')
})

test('uuid usage remains on the v4 named export supported by the upgraded uuid line', async () => {
  const serverFiles = await collectFiles(new URL('server/', projectRoot), (file) => file.endsWith('.js'))
  const uuidImports = []

  for (const file of serverFiles) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/import\s+([^\n]+?)\s+from\s+['"]uuid['"]/g)) {
      uuidImports.push({ file, clause: match[1].trim() })
    }
  }

  assert.ok(uuidImports.length > 0, 'Expected the application to import uuid')
  for (const { file, clause } of uuidImports) {
    assert.match(clause, /^\{\s*v4\s+as\s+uuidv4\s*\}$/, `Unexpected uuid API usage in ${file}`)
  }
})

test('React Router v8 migration uses the primary react-router package and remains declarative-only', async () => {
  const sourceFiles = await collectFiles(new URL('src/', projectRoot), (file) => /\.(?:ts|tsx)$/.test(file))
  const forbiddenApis = [
    'createBrowserRouter',
    'createHashRouter',
    'RouterProvider',
    'HydratedRouter',
    'ServerRouter',
    'Form',
    'useFetcher',
    'useFetchers',
    'useLoaderData',
    'useActionData',
    'redirect',
    'data',
    'unstable_matchRSCServerRequest',
    'unstable_RSCStaticRouter',
  ]
  let routerImportCount = 0

  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /from\s+['"]react-router-dom['"]/, `react-router-dom is removed in React Router v8: ${file}`)

    for (const match of source.matchAll(/import\s+([^\n]+?)\s+from\s+['"]react-router['"]/g)) {
      routerImportCount += 1
      const importClause = match[1]
      for (const api of forbiddenApis) {
        assert.doesNotMatch(importClause, new RegExp(`\\b${api}\\b`), `Keep GolfHomiez on Declarative Mode; found ${api} in ${file}`)
      }
    }
  }

  assert.ok(routerImportCount > 0, 'Expected frontend files to import React Router')
  const main = await readFile(new URL('src/main.tsx', projectRoot), 'utf8')
  assert.match(main, /import\s+\{\s*BrowserRouter\s*\}\s+from\s+['"]react-router['"]/)
  assert.match(main, /<BrowserRouter>/)
})

test('React 19 migration avoids removed legacy rendering APIs and zero-argument refs', async () => {
  const sourceFiles = await collectFiles(new URL('src/', projectRoot), (file) => /\.(?:ts|tsx)$/.test(file))

  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /\bReactDOM\.render\s*\(/, `ReactDOM.render is incompatible with React 19 in ${file}`)
    assert.doesNotMatch(source, /\bfindDOMNode\s*\(/, `findDOMNode is incompatible with React 19 in ${file}`)
    assert.doesNotMatch(source, /\buseRef(?:<[^>]+>)?\(\s*\)/, `React 19 requires an explicit useRef initial value in ${file}`)
  }
})

test('ESLint 10 config uses flat config and plugin APIs compatible with upgraded lint packages', async () => {
  const config = await readFile(new URL('eslint.config.js', projectRoot), 'utf8')

  assert.match(config, /import\s+\{\s*defineConfig\s*\}\s+from\s+['"]eslint\/config['"]/)
  assert.match(config, /import\s+\{\s*reactRefresh\s*\}\s+from\s+['"]eslint-plugin-react-refresh['"]/)
  assert.match(config, /'react-hooks':\s*reactHooks/)
  assert.match(config, /'react-hooks\/rules-of-hooks':\s*'error'/)
  assert.match(config, /'react-hooks\/exhaustive-deps':\s*'warn'/)
  assert.match(config, /reactRefresh\.configs\.vite\(\)/)
})
