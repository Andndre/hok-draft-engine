import { readFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    for (const extension of ['.ts', '.tsx']) if (existsSync(new URL(url.href + extension))) return { url: url.href + extension, shortCircuit: true };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (/\.ts$/.test(url)) return {
    format: 'module', shortCircuit: true,
    source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
  };
  return next(url, context);
}
