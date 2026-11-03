/**
 * OTA publisher for GitHub Actions. Public repository, but a private Owner-checked
 * Supabase bridge approves every job. No secret or APK is committed to Git.
 * Node 22, zero external npm dependencies.
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { validateManifest } from './validate-update.mjs';

const REPO = 'unexplay0-crypto/unex_ota';
const PROJECT = 'nuxgrazgpxoshewyruor';
const BUCKET = 'unex-ota-staging';
const MAX_APK = 52428800;
const SHA_REGEX = /^[0-9a-f]{64}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isCode = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2100000000;
const fail = (message) => { throw new Error(message); };
const assert = (predicate, message) => { if (!predicate) fail(message); };

const token = process.env.GH_TOKEN;
const bridgeToken = process.env.UNEX_OTA_BRIDGE_TOKEN;
const bridgeUrl = process.env.UNEX_OTA_BRIDGE_URL;
const packageName = process.env.UNEX_OTA_PACKAGE_NAME;
const signingCert = process.env.UNEX_OTA_SIGNING_CERT_SHA256;
let jobId;

function checkEnvironment() {
  assert(process.env.GITHUB_REPOSITORY === REPO, 'Repositório não autorizado');
  assert(token && bridgeToken && bridgeUrl, 'Configure o secret UNEX_OTA_BRIDGE_TOKEN e a variable UNEX_OTA_BRIDGE_URL');
  assert(typeof packageName === 'string' && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName), 'Configure UNEX_OTA_PACKAGE_NAME a partir do APK real');
  assert(typeof signingCert === 'string' && SHA_REGEX.test(signingCert.toLowerCase()), 'Configure UNEX_OTA_SIGNING_CERT_SHA256 a partir do APK real');
  assert(bridgeUrl === `https://${PROJECT}.supabase.co/functions/v1/ota-github-bridge`, 'Endpoint de ponte não permitido');
}

async function bridge(action, extra = {}) {
  const response = await fetch(bridgeUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${bridgeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, jobId, ...extra }),
    signal: AbortSignal.timeout(25000),
    redirect: 'error',
  });
  if (!response.ok) fail(`Ponte Supabase rejeitou operação ${action}: HTTP ${response.status}`);
  const data = await response.json();
  assert(data && typeof data === 'object' && !Array.isArray(data), 'Resposta inválida da ponte');
  return data;
}

async function githubApi(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'unex-ota-publisher',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) fail(`GitHub API falhou: ${method} ${path.split('?')[0]} HTTP ${response.status}`);
  return response.json();
}

async function getCurrentManifest() {
  const data = await githubApi('/contents/update.json?ref=main');
  assert(data && data.sha && data.encoding === 'base64', 'update.json ausente ou inválido');
  const manifest = JSON.parse(Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8'));
  validateManifest(manifest);
  return { manifest, sha: data.sha };
}

function readJobId() {
  const evt = JSON.parse(process.env.GITHUB_EVENT_PATH ? requireText(process.env.GITHUB_EVENT_PATH) : '{}');
  const fromEvent = evt.client_payload?.job_id ?? evt.inputs?.job_id ?? process.env.OTA_JOB_ID;
  assert(typeof fromEvent === 'string' && UUID_REGEX.test(fromEvent), 'job_id deve ser um UUID válido');
  return fromEvent;
}

// Synchronous read of tiny local GitHub event context only.
import { readFileSync } from 'node:fs';
const requireText = (path) => readFileSync(path, 'utf8');

function checkPayload(job) {
  assert(job && job.jobId === jobId && ['publish', 'policy'].includes(job.kind), 'Tipo de job inválido');
  const requested = process.env.OTA_EVENT_KIND;
  if (requested === 'unex-ota-publish') assert(job.kind === 'publish', 'Tipo de job difere do evento');
  if (requested === 'unex-ota-policy') assert(job.kind === 'policy', 'Tipo de job difere do evento');
  assert(isCode(job.minSupportedVersionCode), 'Política minSupportedVersionCode inválida');
  if (job.kind === 'publish') {
    assert(Number.isSafeInteger(job.versionCode) && job.versionCode > 0 && job.versionCode <= 2100000000, 'versionCode inválido');
    assert(typeof job.versionName === 'string' && /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(job.versionName), 'versionName inválido');
    assert(typeof job.releaseNotes === 'string' && job.releaseNotes.length <= 10000, 'Notas de versão inválidas');
    assert(typeof job.apkSha256 === 'string' && SHA_REGEX.test(job.apkSha256), 'Hash inválido');
    assert(Number.isSafeInteger(job.apkSizeBytes) && job.apkSizeBytes >= 1024 && job.apkSizeBytes <= MAX_APK, 'Tamanho inválido');
    assert(job.minSupportedVersionCode <= job.versionCode, 'Versão mínima acima da nova versão');
    assert(typeof job.signedApkUrl === 'string', 'URL do staging ausente');
    const u = new URL(job.signedApkUrl);
    assert(u.protocol === 'https:' && u.host === `${PROJECT}.supabase.co` && u.username === '' && u.password === '', 'Host privado não autorizado');
    assert(u.pathname.startsWith(`/storage/v1/object/sign/${BUCKET}/`) && u.searchParams.has('token'), 'Objeto privado não autorizado');
    assert(!u.hash, 'Hash de URL inválido');
  }
}

async function fetchApk(job, apkPath) {
  // URL temporária só existe na memória de execução; nunca em logs públicos.
  const response = await fetch(job.signedApkUrl, { redirect: 'error', signal: AbortSignal.timeout(180000) });
  assert(response.ok && response.body, `Falha no download do staging: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length) assert(length === job.apkSizeBytes, 'Content-Length divergente do banco');
  let size = 0;
  const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, _enc, callback) {
    size += chunk.length;
    if (size > MAX_APK || size > job.apkSizeBytes) return callback(new Error('Arquivo excedeu o tamanho declarado'));
    hash.update(chunk);
    callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(apkPath, { flags: 'wx', mode: 0o600 }));
  assert(size === job.apkSizeBytes && hash.digest('hex') === job.apkSha256, 'APK não confere em tamanho ou SHA-256');
  execFileSync('unzip', ['-tq', apkPath], { stdio: 'pipe' });
  const entries = execFileSync('unzip', ['-Z', '-1', apkPath], { encoding: 'utf8' }).split('\n');
  assert(entries.includes('AndroidManifest.xml'), 'Arquivo ZIP não contém AndroidManifest.xml');
  assert(entries.some((item) => /^classes\d*\.dex$/.test(item)), 'APK sem bytecode DEX');
  const badging = execFileSync('aapt', ['dump', 'badging', apkPath], { encoding: 'utf8', timeout: 30000 });
  const pkg = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
  assert(pkg, 'aapt não conseguiu ler versão/pacote do APK');
  assert(pkg[1] === packageName, 'O applicationId não corresponde ao aplicativo já instalado');
  assert(Number(pkg[2]) === job.versionCode && pkg[3] === job.versionName, 'Versão do APK diverge da versão informada pelo painel');
  const signature = execFileSync('apksigner', ['verify', '--verbose', '--print-certs', apkPath], { encoding: 'utf8', timeout: 30000 });
  const certs = [...signature.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f:]+)/ig)].map(x => x[1].replaceAll(':', '').toLowerCase());
  assert(certs.length === 1 && certs[0] === signingCert.toLowerCase(), 'O certificado de assinatura do APK não é o autorizado');
}

async function publishRelease(job, folder) {
  const tag = `v${job.versionName}`;
  const assetName = `unex-play-${tag}.apk`;
  const expectedUrl = `https://github.com/${REPO}/releases/download/${tag}/${assetName}`;
  const existing = await githubApi(`/releases/tags/${tag}`);
  if (existing) {
    const asset = (existing.assets || []).find((x) => x.name === assetName);
    assert(asset && asset.size === job.apkSizeBytes && asset.digest === `sha256:${job.apkSha256}` && !existing.draft, 'Tag existente sem APK público idêntico; publicação manual precisa de reconciliação');
    return expectedUrl;
  }
  const apkPath = join(folder, assetName);
  await fetchApk(job, apkPath);
  const notesPath = join(folder, 'release-notes.txt');
  await writeFile(notesPath, job.releaseNotes || 'Atualização do UNEX PLAY', 'utf8');
  // CLI uses only GITHUB_TOKEN scoped to this repository, not a personal token.
  execFileSync('gh', ['release', 'create', tag, apkPath, '--title', `UNEX PLAY ${job.versionName}`, '--notes-file', notesPath, '--latest'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GH_REPO: REPO, GH_TOKEN: token },
    timeout: 180000,
  });
  const created = await githubApi(`/releases/tags/${tag}`);
  const asset = (created?.assets || []).find((x) => x.name === assetName);
  assert(asset && asset.size === job.apkSizeBytes && !created.draft, 'Asset da Release não confirmado');
  // GitHub API may omit digest temporarily. We have verified downloaded bytes before release.
  if (asset.digest) assert(asset.digest === `sha256:${job.apkSha256}`, 'Hash do asset publicado divergente');
  return expectedUrl;
}

async function commitManifest(newManifest, priorSha) {
  validateManifest(newManifest);
  const current = await getCurrentManifest();
  assert(current.sha === priorSha, 'update.json mudou durante a publicação; não sobrescrever');
  if (JSON.stringify(current.manifest) === JSON.stringify(newManifest)) return;
  await githubApi('/contents/update.json', 'PUT', {
    message: `chore(ota): publish version ${newManifest.latestVersionCode}, minimum ${newManifest.minSupportedVersionCode}`,
    branch: 'main', sha: priorSha,
    content: Buffer.from(`${JSON.stringify(newManifest, null, 2)}\n`, 'utf8').toString('base64'),
  });
}

async function run() {
  checkEnvironment();
  jobId = readJobId();
  const job = await bridge('resolve');
  checkPayload(job);
  const { manifest: oldManifest, sha } = await getCurrentManifest();
  let folder;
  try {
    let next;
    if (job.kind === 'policy') {
      assert(oldManifest.enabled, 'Não existe release para alterar a política');
      assert(job.minSupportedVersionCode <= oldManifest.latestVersionCode, 'Política acima da versão disponível');
      next = { ...oldManifest, minSupportedVersionCode: job.minSupportedVersionCode };
    } else {
      assert(job.versionCode > oldManifest.latestVersionCode ||
        (oldManifest.enabled && job.versionCode === oldManifest.latestVersionCode && oldManifest.sha256 === job.apkSha256),
        'Nova versão deve ter versionCode maior que a anterior');
      folder = await mkdtemp(join(tmpdir(), 'unex-ota-'));
      const apkUrl = await publishRelease(job, folder);
      next = {
        schemaVersion: 1, enabled: true,
        latestVersionCode: job.versionCode,
        latestVersionName: job.versionName,
        minSupportedVersionCode: job.minSupportedVersionCode,
        apkUrl, sha256: job.apkSha256, apkSizeBytes: job.apkSizeBytes,
        releaseNotes: job.releaseNotes,
        publishedAt: oldManifest.enabled && oldManifest.latestVersionCode === job.versionCode
          ? oldManifest.publishedAt : new Date().toISOString(),
      };
    }
    await commitManifest(next, sha);
    await bridge('complete', { kind: job.kind, manifestVersionCode: next.latestVersionCode });
    console.log(`OTA ${job.kind} publicado para versionCode ${next.latestVersionCode}.`);
  } catch (error) {
    try { await bridge('fail', { error: 'Falha durante publicação; verificar GitHub Actions' }); } catch {}
    throw error;
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(`Falha OTA: ${error.message}`); process.exitCode = 1; });
