import { readFileSync } from 'node:fs';

const REPO = 'unexplay0-crypto/unex_ota';
const FIELDS = [
  'schemaVersion', 'enabled', 'latestVersionCode', 'latestVersionName',
  'minSupportedVersionCode', 'apkUrl', 'sha256', 'apkSizeBytes',
  'releaseNotes', 'publishedAt',
];
const isCode = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 2100000000;
const isVersion = (s) => typeof s === 'string' && /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(s) && s.length <= 64;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function validateManifest(m) {
  assert(m && typeof m === 'object' && !Array.isArray(m), 'Manifesto inválido');
  assert(Object.keys(m).sort().join('|') === [...FIELDS].sort().join('|'), 'Campos do manifesto inesperados/ausentes');
  assert(m.schemaVersion === 1, 'schemaVersion inválido');
  assert(typeof m.enabled === 'boolean', 'enabled deve ser booleano');
  assert(isCode(m.latestVersionCode) && isCode(m.minSupportedVersionCode), 'versionCode inválido');
  assert(typeof m.releaseNotes === 'string' && m.releaseNotes.length <= 10000, 'releaseNotes inválido');
  if (!m.enabled) {
    assert(m.latestVersionCode === 0 && m.minSupportedVersionCode === 0, 'Manifesto inicial deve ter versões zero');
    assert(m.latestVersionName === null && m.apkUrl === null && m.sha256 === null && m.apkSizeBytes === null && m.publishedAt === null, 'Manifesto inicial não pode anunciar APK');
    assert(m.releaseNotes === '', 'Manifesto inicial não pode anunciar novidades');
    return true;
  }
  assert(m.latestVersionCode > 0, 'Versão publicada deve ser positiva');
  assert(m.minSupportedVersionCode <= m.latestVersionCode, 'minSupportedVersionCode maior que última versão');
  assert(isVersion(m.latestVersionName), 'latestVersionName inválido');
  assert(typeof m.sha256 === 'string' && /^[0-9a-f]{64}$/.test(m.sha256), 'SHA-256 inválido');
  assert(Number.isSafeInteger(m.apkSizeBytes) && m.apkSizeBytes >= 1024 && m.apkSizeBytes <= 52428800, 'Tamanho do APK inválido');
  const expected = `https://github.com/${REPO}/releases/download/v${m.latestVersionName}/unex-play-v${m.latestVersionName}.apk`;
  assert(m.apkUrl === expected, 'URL do APK não corresponde ao repositório/versão');
  assert(typeof m.publishedAt === 'string' && /Z$/.test(m.publishedAt) && !Number.isNaN(Date.parse(m.publishedAt)), 'publishedAt inválido');
  return true;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const path = process.argv[2] || 'update.json';
  try {
    validateManifest(JSON.parse(readFileSync(path, 'utf8')));
    console.log(`Manifesto OTA válido: ${path}`);
  } catch (error) {
    console.error(`Manifesto OTA inválido: ${error.message}`);
    process.exitCode = 1;
  }
}
