import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest } from '../scripts/validate-update.mjs';

const initial = JSON.parse(readFileSync(new URL('../update.json', import.meta.url), 'utf8'));
const validPublished = {
  schemaVersion: 1, enabled: true, latestVersionCode: 110, latestVersionName: '1.1.0',
  minSupportedVersionCode: 101,
  apkUrl: 'https://github.com/unexplay0-crypto/unex_ota/releases/download/v1.1.0/unex-play-v1.1.0.apk',
  sha256: 'a'.repeat(64), apkSizeBytes: 20000000,
  releaseNotes: 'Teste de contrato; este não é um APK disponível.',
  publishedAt: '2026-11-02T15:00:00.000Z',
};

test('manifesto inicial é válido e não anuncia nenhum APK', () => {
  assert.equal(validateManifest(initial), true);
  assert.equal(initial.enabled, false);
});
test('modelo publicado bem formado é aceito', () => {
  assert.equal(validateManifest(validPublished), true);
});
test('manifesto obrigatório não pode exceder versão disponível', () => {
  assert.throws(() => validateManifest({ ...validPublished, minSupportedVersionCode: 200 }));
});
test('URL de outro repositório é rejeitada', () => {
  assert.throws(() => validateManifest({ ...validPublished, apkUrl: 'https://example.com/test.apk' }));
});
test('hash ausente é rejeitado', () => {
  assert.throws(() => validateManifest({ ...validPublished, sha256: null }));
});
test('manifesto desativado não pode anunciar APK', () => {
  assert.throws(() => validateManifest({ ...initial, latestVersionCode: 8 }));
});
test('campos extras são rejeitados', () => {
  assert.throws(() => validateManifest({ ...initial, untrusted: true }));
});
test('arquivo acima do limite é rejeitado', () => {
  assert.throws(() => validateManifest({ ...validPublished, apkSizeBytes: 53000000 }));
});
